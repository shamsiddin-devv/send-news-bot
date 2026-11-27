import type { Logger } from 'pino';
import type { Repository, NewsItem, UzbekContent } from '../db/repository.js';
import type { NewsSource } from './sources.js';
import { ContentUnavailableError, type ContentWriter } from './llm.js';
import { isTopic, matchesTopics, topics } from './topics.js';
import { safeError } from '../utils/logger.js';

export class NewsService {
  constructor(
    private readonly repository: Repository,
    private readonly sources: NewsSource[],
    private readonly writer: ContentWriter,
    private readonly logger: Logger,
    private readonly maxAgeHours: number,
  ) {}

  async ingest(now = Date.now()): Promise<void> {
    const allTopics = Object.keys(topics).filter(isTopic);
    for (const source of this.sources) {
      try {
        let added = 0;
        for (const item of await source.fetch(now)) {
          if (item.publishedAt < now - this.maxAgeHours * 3600_000) continue;
          if (!matchesTopics(`${item.title} ${item.excerpt}`, allTopics)) continue;
          if (await this.repository.saveNews(item)) added++;
        }
        this.logger.info({ source: source.name, added }, 'RSS manbasi tekshirildi.');
      } catch (error) { this.logger.warn({ source: source.name, error: safeError(error) }, 'RSS manbasini o‘qib bo‘lmadi.'); }
    }
  }

  async prepare(item: NewsItem): Promise<UzbekContent | undefined> {
    if (item.uzTitle && item.uzSummary) return { title: item.uzTitle, summary: item.uzSummary };
    try {
      const content = await this.writer.summarize(item);
      await this.repository.saveContent(item.id, content);
      return content;
    } catch (error) {
      const retryAt = error instanceof ContentUnavailableError ? error.retryAt : Date.now() + 300_000 * (item.attempts + 1);
      await this.repository.failContent(item.id, retryAt);
      this.logger.warn({ newsId: item.id, error: safeError(error) }, 'O‘zbekcha xulosa tayyorlanmadi; nashr qilinmadi.');
      return undefined;
    }
  }
}
