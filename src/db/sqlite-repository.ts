import type Database from 'better-sqlite3';
import { hash, titleKey } from '../utils/text.js';
import { isTopic } from '../services/topics.js';
import { MAX_DAILY_POSTS, PublishSchedule } from '../services/publish-schedule.js';
import type { Channel, ChannelSettings, ConnectResult, NewsInput, NewsItem, Repository, UzbekContent } from './repository.js';

interface ChannelRow {
  id: number; owner_id: number; title: string; enabled: number; available: number;
  daily_limit: number; topics: string; revision: number;
}
interface NewsRow {
  id: number; url: string; title: string; excerpt: string; source: string; published_at: number;
  uz_title: string | null; uz_summary: string | null; attempts: number;
}
function channelFromRow(row: ChannelRow): Channel {
  const values: unknown = JSON.parse(row.topics);
  if (!Array.isArray(values) || !values.every((value): value is string => typeof value === 'string' && isTopic(value))) {
    throw new Error('Bazadagi mavzular formati noto‘g‘ri.');
  }
  return {
    id: row.id, ownerId: row.owner_id, title: row.title, enabled: row.enabled === 1,
    available: row.available === 1, dailyLimit: row.daily_limit,
    topics: values.filter(isTopic), revision: row.revision,
  };
}
function newsFromRow(row: NewsRow): NewsItem {
  return { id: row.id, url: row.url, title: row.title, excerpt: row.excerpt, source: row.source,
    publishedAt: row.published_at, uzTitle: row.uz_title, uzSummary: row.uz_summary, attempts: row.attempts };
}

export class SqliteRepository implements Repository {
  private readonly schedule: PublishSchedule;

  constructor(private readonly db: Database.Database, timeZone = 'Asia/Tashkent') {
    this.schedule = new PublishSchedule(timeZone);
  }

  touchUser(userId: number, now: number): void {
    this.db.prepare(`INSERT INTO users (id, created_at) VALUES (?, ?)
      ON CONFLICT(id) DO UPDATE SET blocked = 0`).run(userId, now);
  }

  setUserBlocked(userId: number, blocked: boolean): void {
    this.db.transaction(() => {
      this.db.prepare('UPDATE users SET blocked = ? WHERE id = ?').run(Number(blocked), userId);
      if (blocked) this.db.prepare('UPDATE channels SET enabled = 0, revision = revision + 1 WHERE owner_id = ?').run(userId);
    })();
  }

  connectChannel(ownerId: number, id: number, title: string, defaults: ChannelSettings, maxChannels: number): ConnectResult {
    return this.db.transaction((): ConnectResult => {
      const current = this.db.prepare('SELECT owner_id FROM channels WHERE id = ?').get(id) as { owner_id: number } | undefined;
      if (current && current.owner_id !== ownerId) return 'unavailable';
      if (current) {
        this.db.prepare('UPDATE channels SET title = ?, available = 1, revision = revision + 1 WHERE id = ? AND owner_id = ?')
          .run(title, id, ownerId);
        return 'saved';
      }
      const count = this.db.prepare('SELECT COUNT(*) AS n FROM channels WHERE owner_id = ?').get(ownerId) as { n: number };
      if (count.n >= maxChannels) return 'limit';
      this.db.prepare(`INSERT INTO channels (id, owner_id, title, daily_limit, topics)
        VALUES (?, ?, ?, ?, ?)`).run(id, ownerId, title, defaults.dailyLimit, JSON.stringify(defaults.topics));
      return 'saved';
    }).immediate();
  }

  listChannels(ownerId: number): Channel[] {
    return (this.db.prepare('SELECT * FROM channels WHERE owner_id = ? ORDER BY id').all(ownerId) as ChannelRow[]).map(channelFromRow);
  }

  getChannel(ownerId: number, channelId: number): Channel | undefined {
    const row = this.db.prepare('SELECT * FROM channels WHERE id = ? AND owner_id = ?').get(channelId, ownerId) as ChannelRow | undefined;
    return row ? channelFromRow(row) : undefined;
  }

  setEnabled(ownerId: number, channelId: number, enabled: boolean): boolean {
    return this.db.prepare(`UPDATE channels SET enabled = ?, revision = revision + 1
      WHERE id = ? AND owner_id = ? AND (? = 0 OR available = 1)`).run(Number(enabled), channelId, ownerId, Number(enabled)).changes === 1;
  }

  updateSettings(ownerId: number, channelId: number, settings: ChannelSettings): boolean {
    if (!Number.isInteger(settings.dailyLimit) || settings.dailyLimit < 1 || settings.dailyLimit > MAX_DAILY_POSTS) return false;
    return this.db.prepare(`UPDATE channels SET daily_limit = ?, topics = ?,
      revision = revision + 1 WHERE id = ? AND owner_id = ?`)
      .run(settings.dailyLimit, JSON.stringify(settings.topics), channelId, ownerId).changes === 1;
  }

  markChannelUnavailable(channelId: number): void {
    this.db.prepare('UPDATE channels SET available = 0, enabled = 0, revision = revision + 1 WHERE id = ?').run(channelId);
  }

  acquireDueChannels(now: number, limit: number): Channel[] {
    const slots = this.schedule.currentSlots(now);
    if (!slots.length) return [];
    const placeholders = slots.map(() => '(?, ?)').join(', ');
    const params = slots.flatMap(({ dailyLimit, startsAt }) => [dailyLimit, startsAt]);
    return this.db.transaction(() => {
      const rows = this.db.prepare(`WITH slots(daily_limit, starts_at) AS (VALUES ${placeholders})
        SELECT c.* FROM channels c JOIN users u ON u.id = c.owner_id
        JOIN slots s ON s.daily_limit = c.daily_limit
        WHERE c.enabled = 1 AND c.available = 1 AND u.blocked = 0
          AND c.last_attempt_at < s.starts_at AND c.blocked_until <= ?
        ORDER BY c.last_attempt_at, c.id LIMIT ?`).all(...params, now, limit) as ChannelRow[];
      const update = this.db.prepare('UPDATE channels SET last_attempt_at = ? WHERE id = ?');
      for (const row of rows) update.run(now, row.id);
      return rows.map(channelFromRow);
    }).immediate();
  }

  deferChannel(channelId: number, until: number): void {
    this.db.prepare('UPDATE channels SET blocked_until = MAX(blocked_until, ?) WHERE id = ?').run(until, channelId);
  }

  saveNews(input: NewsInput): boolean {
    return this.db.transaction(() => {
      const urlKey = `url:${hash(input.url)}`;
      const textKey = `title:${titleKey(input.title)}`;
      const existing = this.db.prepare('SELECT news_id FROM news_keys WHERE key IN (?, ?) LIMIT 1').get(urlKey, textKey) as { news_id: number } | undefined;
      const id = existing?.news_id ?? Number(this.db.prepare(`INSERT INTO news (url, title, excerpt, source, published_at)
        VALUES (?, ?, ?, ?, ?)`).run(input.url, input.title, input.excerpt, input.source, input.publishedAt).lastInsertRowid);
      const insertKey = this.db.prepare('INSERT OR IGNORE INTO news_keys (key, news_id) VALUES (?, ?)');
      insertKey.run(urlKey, id);
      insertKey.run(textKey, id);
      return !existing;
    }).immediate();
  }

  candidates(channelId: number, since: number, now: number, requireSummary = true): NewsItem[] {
    const rows = this.db.prepare(`SELECT n.* FROM news n WHERE n.published_at BETWEEN ? AND ?
      AND (? = 0 OR (n.attempts < 3 AND n.retry_at <= ?)) AND NOT EXISTS
      (SELECT 1 FROM publications p WHERE p.channel_id = ? AND p.news_id = n.id)
      ORDER BY n.published_at DESC, n.id DESC LIMIT 100`).all(since, now, Number(requireSummary), now, channelId) as NewsRow[];
    return rows.map(newsFromRow);
  }

  saveContent(newsId: number, content: UzbekContent): void {
    this.db.prepare('UPDATE news SET uz_title = ?, uz_summary = ?, retry_at = 0 WHERE id = ?').run(content.title, content.summary, newsId);
  }

  saveUzbekTitle(newsId: number, title: string): void {
    this.db.prepare('UPDATE news SET uz_title = ? WHERE id = ? AND uz_title IS NULL').run(title, newsId);
  }

  failContent(newsId: number, retryAt: number): void {
    this.db.prepare('UPDATE news SET attempts = attempts + 1, retry_at = ? WHERE id = ?').run(retryAt, newsId);
  }

  publicationCount(channelId: number, day: string): number {
    const row = this.db.prepare('SELECT COUNT(DISTINCT COALESCE(digest_id, news_id)) AS n FROM publications WHERE channel_id = ? AND day = ?')
      .get(channelId, day) as { n: number };
    return row.n;
  }

  reservePublication(channel: Channel, news: number | readonly number[], day: string, now: number): boolean {
    if (!this.schedule.isOpen(now)) return false;
    const newsIds = typeof news === 'number' ? [news] : [...new Set(news)];
    const [firstId] = newsIds;
    if (firstId === undefined) return false;
    return this.db.transaction(() => {
      const current = this.db.prepare(`SELECT c.* FROM channels c JOIN users u ON u.id = c.owner_id
        WHERE c.id = ? AND c.owner_id = ? AND c.revision = ? AND c.enabled = 1 AND c.available = 1 AND u.blocked = 0 AND c.blocked_until <= ?`)
        .get(channel.id, channel.ownerId, channel.revision, now) as ChannelRow | undefined;
      if (!current) return false;
      if (this.publicationCount(channel.id, day) >= current.daily_limit) return false;
      const existing = this.db.prepare('SELECT 1 FROM publications WHERE channel_id = ? AND news_id = ?');
      if (newsIds.some((newsId) => existing.get(channel.id, newsId))) return false;
      const digestId = newsIds.length > 1 ? firstId : null;
      const insert = this.db.prepare(`INSERT INTO publications (channel_id, news_id, day, reserved_at, state, digest_id)
        VALUES (?, ?, ?, ?, 'reserved', ?)`);
      for (const newsId of newsIds) insert.run(channel.id, newsId, day, now, digestId);
      this.db.prepare('UPDATE channels SET last_attempt_at = MAX(last_attempt_at, ?) WHERE id = ?').run(now, channel.id);
      return true;
    }).immediate();
  }

  completePublication(channelId: number, newsId: number, messageId: number): void {
    this.db.prepare("UPDATE publications SET state = 'sent', message_id = ? WHERE channel_id = ? AND COALESCE(digest_id, news_id) = ?")
      .run(messageId, channelId, newsId);
  }

  markPublicationUncertain(channelId: number, newsId: number): void {
    this.db.prepare("UPDATE publications SET state = 'uncertain' WHERE channel_id = ? AND COALESCE(digest_id, news_id) = ?").run(channelId, newsId);
  }

  releaseRejectedPublication(channelId: number, newsId: number): void {
    this.db.prepare("DELETE FROM publications WHERE channel_id = ? AND COALESCE(digest_id, news_id) = ? AND state = 'reserved'").run(channelId, newsId);
  }

  readState(key: string): unknown {
    const row = this.db.prepare('SELECT value FROM bot_state WHERE key = ?').get(key) as { value: string } | undefined;
    return row ? JSON.parse(row.value) as unknown : undefined;
  }

  writeState(key: string, value: unknown): void {
    this.db.prepare('INSERT INTO bot_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, JSON.stringify(value));
  }

  deleteState(key: string): void { this.db.prepare('DELETE FROM bot_state WHERE key = ?').run(key); }
  close(): void { this.db.close(); }
}
