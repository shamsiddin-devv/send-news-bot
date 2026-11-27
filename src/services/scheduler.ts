import type { Logger } from 'pino';
import type { Repository } from '../db/repository.js';
import type { NewsService } from './news.js';
import type { Publisher } from './publisher.js';
import { safeError } from '../utils/logger.js';

export class Scheduler {
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<void> | undefined;
  private nextIngestAt = 0;
  private stopping = false;

  constructor(
    private readonly repository: Repository,
    private readonly news: Pick<NewsService, 'ingest'>,
    private readonly publisher: Pick<Publisher, 'publish'>,
    private readonly logger: Logger,
    private readonly tickSeconds: number,
    private readonly ingestMinutes: number,
    private readonly publishingEnabled: boolean,
  ) {}

  start(): void {
    if (this.timer) return;
    this.stopping = false;
    const tick = () => {
      if (this.running || this.stopping) return;
      this.running = this.tick().catch((error: unknown) => {
        this.logger.error({ error: safeError(error) }, 'Rejalashtiruvchi aylanishida xato.');
      }).finally(() => { this.running = undefined; });
    };
    this.timer = setInterval(tick, this.tickSeconds * 1000);
    tick();
  }

  async tick(): Promise<void> {
    if (this.stopping) return;
    const now = Date.now();
    if (now >= this.nextIngestAt) {
      this.nextIngestAt = now + this.ingestMinutes * 60_000;
      await this.news.ingest(now);
    }
    if (this.stopping || !this.publishingEnabled) return;
    for (const channel of this.repository.acquireDueChannels(Date.now(), 20)) {
      if (this.stopping) break;
      try { await this.publisher.publish(channel); }
      catch (error) { this.logger.warn({ channelId: channel.id, error: safeError(error) }, 'Kanal nashri bajarilmadi.'); }
    }
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.running;
  }
}
