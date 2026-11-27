import { GrammyError } from 'grammy';
import type { Logger } from 'pino';
import type { Channel, NewsItem, Repository, UzbekContent } from '../db/repository.js';
import { dayKey, escapeHtml } from '../utils/text.js';
import { safeError } from '../utils/logger.js';
import { matchesTopics } from './topics.js';
import { isAccessError, type TelegramGateway } from './telegram.js';
import type { NewsService } from './news.js';
import type { MyMemoryTitleTranslator } from './title-translator.js';
import { PublishSchedule } from './publish-schedule.js';

export function formatPost(content: UzbekContent, url: string): string {
  return `📰 <b>${escapeHtml(content.title)}</b>\n\n${escapeHtml(content.summary)}\n\n🔗 Manba: <a href="${escapeHtml(url)}">${escapeHtml(url)}</a>\n\n#AI #Texnologiya`;
}

function formatDigest(items: readonly Pick<NewsItem, 'title' | 'url'>[], channel: { title: string; username?: string }): string {
  const headlines = items.map(({ title, url }) => `● <a href="${escapeHtml(url)}">${escapeHtml(title)}</a>`).join('\n');
  const footer = channel.username ? `@${channel.username}` : channel.title;
  return `<b>AI va texnologiyada nima gap?</b>\nHozirgi soatgacha bo‘lgan yangiliklar:\n\n${headlines}\n\n${escapeHtml(footer)}`;
}

export class Publisher {
  private readonly schedule: PublishSchedule;

  constructor(
    private readonly repository: Repository,
    private readonly news: Pick<NewsService, 'prepare'> | undefined,
    private readonly telegram: TelegramGateway,
    private readonly logger: Logger,
    private readonly timeZone: string,
    private readonly maxAgeHours: number,
    private readonly now: () => number = Date.now,
    private readonly titleTranslator?: Pick<MyMemoryTitleTranslator, 'translate'>,
  ) {
    this.schedule = new PublishSchedule(timeZone);
  }

  async publish(channel: Channel): Promise<void> {
    const now = this.now();
    if (!this.schedule.isOpen(now)) return;
    if (await this.repository.publicationCount(channel.id, dayKey(now, this.timeZone)) >= channel.dailyLimit) return;
    const items = (await this.repository.candidates(channel.id, now - this.maxAgeHours * 3600_000, now, this.news !== undefined))
      .filter((item) => matchesTopics(`${item.title} ${item.excerpt}`, channel.topics));
    if (items.length === 0) return;
    const access = await this.telegram.verify(channel.id, channel.ownerId);
    if (!access.ok) { await this.repository.markChannelUnavailable(channel.id); return; }
    const selected = items.slice(0, 3);
    if (!this.news) {
      const headlines = [];
      for (const item of selected) {
        if (!this.titleTranslator) {
          headlines.push(item);
          continue;
        }
        try {
          const title = item.uzTitle ?? await this.titleTranslator.translate(item.title);
          if (!item.uzTitle) await this.repository.saveUzbekTitle(item.id, title);
          headlines.push({ id: item.id, url: item.url, title });
        } catch (error) {
          this.logger.warn({ newsId: item.id, error: safeError(error) }, 'Yangilik sarlavhasi tarjima qilinmadi.');
        }
      }
      if (headlines.length) await this.sendPost(channel, headlines.map((item) => item.id), formatDigest(headlines, access));
      return;
    }
    // Bitta kanal bir aylanishda ko‘pi bilan uchta LLM so‘rovini ishlatadi.
    for (const item of selected) {
      const content = await this.news.prepare(item);
      if (!content) continue;
      await this.sendPost(channel, [item.id], formatPost(content, item.url));
      return;
    }
  }

  private async sendPost(channel: Channel, newsIds: readonly number[], post: string): Promise<void> {
    const [postId] = newsIds;
    if (postId === undefined) return;
    const sendAt = this.now();
    if (!await this.repository.reservePublication(channel, newsIds, dayKey(sendAt, this.timeZone), sendAt)) return;
    try {
      const messageId = await this.telegram.send(channel.id, post);
      await this.repository.completePublication(channel.id, postId, messageId);
      this.logger.info({ channelId: channel.id, newsIds, messageId }, 'Yangilik nashr qilindi.');
    } catch (error) {
      if (error instanceof GrammyError && error.error_code === 429) {
        await this.repository.releaseRejectedPublication(channel.id, postId);
        const seconds = Math.max(1, error.parameters.retry_after ?? 60);
        // Kutish vaqti bazada saqlanadi.
        await this.repository.deferChannel(channel.id, this.now() + seconds * 1000 + 1000);
        this.logger.warn({ channelId: channel.id, retryAfter: seconds }, 'Telegram cheklovi: keyingi nashr kechiktirildi.');
      } else if (error instanceof GrammyError && error.error_code >= 400 && error.error_code < 500) {
        await this.repository.releaseRejectedPublication(channel.id, postId);
        if (isAccessError(error)) await this.repository.markChannelUnavailable(channel.id);
        else await this.repository.deferChannel(channel.id, this.now() + 3600_000);
        this.logger.warn({ channelId: channel.id, code: error.error_code }, 'Telegram nashrni rad etdi.');
      } else {
        await this.repository.markPublicationUncertain(channel.id, postId);
        this.logger.error({ channelId: channel.id, newsIds, error: safeError(error) }, 'Nashr holati noaniq; qayta yuborilmaydi.');
      }
    }
  }
}
