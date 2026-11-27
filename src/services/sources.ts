import Parser from 'rss-parser';
import type { NewsInput } from '../db/repository.js';
import { canonicalUrl, plainText } from '../utils/text.js';

export interface NewsSource {
  readonly name: string;
  fetch(now: number): Promise<NewsInput[]>;
}

export class RssSource implements NewsSource {
  readonly name: string;
  private readonly parser = new Parser({ timeout: 15000, maxRedirects: 3 });
  constructor(private readonly feedUrl: string) { this.name = new URL(feedUrl).hostname; }

  async fetch(now: number): Promise<NewsInput[]> {
    const response = await fetch(this.feedUrl, {
      signal: AbortSignal.timeout(15000),
      headers: { 'user-agent': 'UzbekNewsBot/1.0', accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' },
    });
    if (!response.ok || !response.body) throw new Error('RSS manbasi javob bermadi.');
    const chunks: Uint8Array[] = [];
    const reader = response.body.getReader();
    let size = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > 2_000_000) throw new Error('RSS hajmi belgilangan chegaradan oshdi.');
        chunks.push(part.value);
      }
    } finally { await reader.cancel(); }
    const feed = await this.parser.parseString(Buffer.concat(chunks).toString('utf8'));
    const items: NewsInput[] = [];
    for (const item of feed.items.slice(0, 100)) {
      const url = canonicalUrl(item.link ?? '');
      const title = plainText(item.title ?? '', 300);
      const excerpt = plainText(item.contentSnippet ?? item.summary ?? '', 1400);
      const publishedAt = Date.parse(item.isoDate ?? item.pubDate ?? '');
      if (!url || !title || !excerpt || !Number.isFinite(publishedAt) || publishedAt > now) continue;
      items.push({ url, title, excerpt, source: this.name, publishedAt });
    }
    return items;
  }
}
