import type { Pool, PoolClient } from 'pg';
import type { Channel, ChannelSettings, ConnectResult, NewsInput, NewsItem, Repository, UzbekContent } from './repository.js';
import { transaction } from './postgres.js';
import { MAX_DAILY_POSTS, PublishSchedule } from '../services/publish-schedule.js';
import { hash, titleKey } from '../utils/text.js';

const channelFields = `c.id, c.owner_id AS "ownerId", c.title, c.enabled, c.available,
  c.daily_limit AS "dailyLimit", c.topics, c.revision`;

export class PostgresRepository implements Repository {
  private readonly schedule: PublishSchedule;

  constructor(private readonly pool: Pool, timeZone: string) {
    this.schedule = new PublishSchedule(timeZone);
  }

  async touchUser(userId: number, now: number): Promise<void> {
    await this.pool.query(`INSERT INTO users (id, created_at) VALUES ($1, $2)
      ON CONFLICT (id) DO UPDATE SET blocked = false WHERE users.blocked`, [userId, now]);
  }

  async setUserBlocked(userId: number, blocked: boolean): Promise<void> {
    await transaction(this.pool, async (client) => {
      await client.query('UPDATE users SET blocked = $2 WHERE id = $1', [userId, blocked]);
      if (blocked) {
        await client.query('UPDATE channels SET enabled = false, revision = revision + 1 WHERE owner_id = $1', [userId]);
      }
    });
  }

  async connectChannel(ownerId: number, id: number, title: string, defaults: ChannelSettings, maxChannels: number): Promise<ConnectResult> {
    return transaction(this.pool, async (client) => {
      await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [ownerId]);
      const { rows: [current] } = await client.query<{ owner_id: number }>('SELECT owner_id FROM channels WHERE id = $1', [id]);
      if (current) {
        if (current.owner_id !== ownerId) return 'unavailable';
        await client.query(`UPDATE channels SET title = $3, available = true, revision = revision + 1
          WHERE id = $1 AND owner_id = $2`, [id, ownerId, title]);
        return 'saved';
      }
      const { rows: [count] } = await client.query<{ n: number }>('SELECT COUNT(*) AS n FROM channels WHERE owner_id = $1', [ownerId]);
      if ((count?.n ?? 0) >= maxChannels) return 'limit';
      const result = await client.query(`INSERT INTO channels (id, owner_id, title, daily_limit, topics)
        VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`, [id, ownerId, title, defaults.dailyLimit, JSON.stringify(defaults.topics)]);
      return result.rowCount === 1 ? 'saved' : 'unavailable';
    });
  }

  async listChannels(ownerId: number): Promise<Channel[]> {
    return (await this.pool.query<Channel>(`SELECT ${channelFields} FROM channels c WHERE c.owner_id = $1 ORDER BY c.id`, [ownerId])).rows;
  }

  async getChannel(ownerId: number, channelId: number): Promise<Channel | undefined> {
    const result = await this.pool.query<Channel>(`SELECT ${channelFields} FROM channels c WHERE c.id = $1 AND c.owner_id = $2`, [channelId, ownerId]);
    return result.rows[0];
  }

  async setEnabled(ownerId: number, channelId: number, enabled: boolean): Promise<boolean> {
    const result = await this.pool.query(`UPDATE channels SET enabled = $3, revision = revision + 1
      WHERE id = $1 AND owner_id = $2 AND (NOT $3 OR available)`, [channelId, ownerId, enabled]);
    return result.rowCount === 1;
  }

  async updateSettings(ownerId: number, channelId: number, settings: ChannelSettings): Promise<boolean> {
    if (!Number.isInteger(settings.dailyLimit) || settings.dailyLimit < 1 || settings.dailyLimit > MAX_DAILY_POSTS) return false;
    const result = await this.pool.query(`UPDATE channels SET daily_limit = $3, topics = $4, revision = revision + 1
      WHERE id = $1 AND owner_id = $2`, [channelId, ownerId, settings.dailyLimit, JSON.stringify(settings.topics)]);
    return result.rowCount === 1;
  }

  async markChannelUnavailable(channelId: number): Promise<void> {
    await this.pool.query('UPDATE channels SET available = false, enabled = false, revision = revision + 1 WHERE id = $1', [channelId]);
  }

  async acquireDueChannels(now: number, limit: number): Promise<Channel[]> {
    const slots = this.schedule.currentSlots(now);
    if (!slots.length) return [];
    const result = await this.pool.query<Channel>(`WITH due AS (
        SELECT c.id FROM channels c JOIN users u ON u.id = c.owner_id
        JOIN unnest($1::integer[], $2::bigint[]) AS s(daily_limit, starts_at) ON s.daily_limit = c.daily_limit
        WHERE c.enabled AND c.available AND NOT u.blocked AND c.last_attempt_at < s.starts_at AND c.blocked_until <= $3
        ORDER BY c.last_attempt_at, c.id LIMIT $4 FOR UPDATE OF c SKIP LOCKED
      )
      UPDATE channels c SET last_attempt_at = $3 FROM due WHERE c.id = due.id RETURNING ${channelFields}`,
    [slots.map((slot) => slot.dailyLimit), slots.map((slot) => slot.startsAt), now, limit]);
    return result.rows;
  }

  async deferChannel(channelId: number, until: number): Promise<void> {
    await this.pool.query('UPDATE channels SET blocked_until = GREATEST(blocked_until, $2) WHERE id = $1', [channelId, until]);
  }

  async saveNews(input: NewsInput): Promise<boolean> {
    const keys = [`url:${hash(input.url)}`, `title:${titleKey(input.title)}`];
    return transaction(this.pool, async (client) => {
      // Bitta tranzaksiya maqola va uning ikkala kalitini birga yozadi.
      await client.query('SELECT pg_advisory_xact_lock(410622, 2)');
      const { rows: [existing] } = await client.query<{ news_id: number }>(
        'SELECT news_id FROM news_keys WHERE key = ANY($1) ORDER BY news_id LIMIT 1', [keys]);
      const { rows: [created] } = existing ? { rows: [] } : await client.query<{ id: number }>(
        'INSERT INTO news (url, title, excerpt, source, published_at) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [input.url, input.title, input.excerpt, input.source, input.publishedAt]);
      const id = existing?.news_id ?? created?.id;
      if (id === undefined) throw new Error('Yangilik identifikatori topilmadi.');
      await client.query('INSERT INTO news_keys (key, news_id) SELECT unnest($1::text[]), $2 ON CONFLICT (key) DO NOTHING', [keys, id]);
      return !existing;
    });
  }

  async candidates(channelId: number, since: number, now: number, requireSummary = true): Promise<NewsItem[]> {
    const result = await this.pool.query<NewsItem>(`SELECT n.id, n.url, n.title, n.excerpt, n.source, n.published_at AS "publishedAt",
        n.uz_title AS "uzTitle", n.uz_summary AS "uzSummary", n.attempts
      FROM news n WHERE n.published_at BETWEEN $2 AND $3 AND (NOT $4::boolean OR (n.attempts < 3 AND n.retry_at <= $3))
      AND NOT EXISTS (SELECT 1 FROM publications p WHERE p.channel_id = $1 AND p.news_id = n.id)
      ORDER BY n.published_at DESC, n.id DESC LIMIT 100`, [channelId, since, now, requireSummary]);
    return result.rows;
  }

  async saveContent(newsId: number, content: UzbekContent): Promise<void> {
    await this.pool.query('UPDATE news SET uz_title = $2, uz_summary = $3, retry_at = 0 WHERE id = $1', [newsId, content.title, content.summary]);
  }

  async saveUzbekTitle(newsId: number, title: string): Promise<void> {
    await this.pool.query('UPDATE news SET uz_title = $2 WHERE id = $1 AND uz_title IS NULL', [newsId, title]);
  }

  async failContent(newsId: number, retryAt: number): Promise<void> {
    await this.pool.query('UPDATE news SET attempts = attempts + 1, retry_at = $2 WHERE id = $1', [newsId, retryAt]);
  }

  async publicationCount(channelId: number, day: string, db: Pool | PoolClient = this.pool): Promise<number> {
    const { rows: [count] } = await db.query<{ n: number }>(
      'SELECT COUNT(DISTINCT COALESCE(digest_id, news_id)) AS n FROM publications WHERE channel_id = $1 AND day = $2', [channelId, day]);
    return count?.n ?? 0;
  }

  async reservePublication(channel: Channel, news: number | readonly number[], day: string, now: number): Promise<boolean> {
    if (!this.schedule.isOpen(now)) return false;
    const newsIds = typeof news === 'number' ? [news] : [...new Set(news)];
    const [firstId] = newsIds;
    if (firstId === undefined) return false;
    return transaction(this.pool, async (client) => {
      const { rows: [current] } = await client.query<{ daily_limit: number }>(`SELECT c.daily_limit
        FROM channels c JOIN users u ON u.id = c.owner_id
        WHERE c.id = $1 AND c.owner_id = $2 AND c.revision = $3 AND c.enabled AND c.available
          AND NOT u.blocked AND c.blocked_until <= $4 FOR UPDATE OF c`, [channel.id, channel.ownerId, channel.revision, now]);
      if (!current || await this.publicationCount(channel.id, day, client) >= current.daily_limit) return false;
      const existing = await client.query('SELECT 1 FROM publications WHERE channel_id = $1 AND news_id = ANY($2)', [channel.id, newsIds]);
      if (existing.rowCount) return false;
      await client.query(`INSERT INTO publications (channel_id, news_id, day, reserved_at, state, digest_id)
        SELECT $1, id, $2, $3, 'reserved', $4 FROM unnest($5::bigint[]) AS id`,
      [channel.id, day, now, newsIds.length > 1 ? firstId : null, newsIds]);
      await client.query('UPDATE channels SET last_attempt_at = GREATEST(last_attempt_at, $2) WHERE id = $1', [channel.id, now]);
      return true;
    });
  }

  async completePublication(channelId: number, newsId: number, messageId: number): Promise<void> {
    await this.pool.query(`UPDATE publications SET state = 'sent', message_id = $3
      WHERE channel_id = $1 AND COALESCE(digest_id, news_id) = $2`, [channelId, newsId, messageId]);
  }

  async markPublicationUncertain(channelId: number, newsId: number): Promise<void> {
    await this.pool.query(`UPDATE publications SET state = 'uncertain'
      WHERE channel_id = $1 AND COALESCE(digest_id, news_id) = $2`, [channelId, newsId]);
  }

  async releaseRejectedPublication(channelId: number, newsId: number): Promise<void> {
    await this.pool.query(`DELETE FROM publications WHERE channel_id = $1 AND COALESCE(digest_id, news_id) = $2 AND state = 'reserved'`,
    [channelId, newsId]);
  }

  async readState(key: string): Promise<unknown> {
    const { rows: [row] } = await this.pool.query<{ value: unknown }>('SELECT value FROM bot_state WHERE key = $1', [key]);
    return row?.value;
  }

  async writeState(key: string, value: unknown): Promise<void> {
    await this.pool.query(`INSERT INTO bot_state (key, value) VALUES ($1, $2)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [key, JSON.stringify(value)]);
  }

  async deleteState(key: string): Promise<void> { await this.pool.query('DELETE FROM bot_state WHERE key = $1', [key]); }
  async close(): Promise<void> { await this.pool.end(); }
}
