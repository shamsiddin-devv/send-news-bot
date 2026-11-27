import assert from 'node:assert/strict';
import { openDatabase } from '../src/db/database.js';
import { SqliteRepository } from '../src/db/sqlite-repository.js';
import { loadConfig } from '../src/config.js';
import type { Channel, NewsInput } from '../src/db/repository.js';
import type { TelegramGateway } from '../src/services/telegram.js';
import { createLogger } from '../src/utils/logger.js';

export const now = Date.parse('2026-11-12T06:00:00Z');
export const ownerId = 101;
export const channelId = -1001111111111;
export const logger = createLogger('silent');
export const content = { title: 'Sun’iy intellekt uchun yangi imkoniyatlar taqdim etildi', summary: 'Yangi vosita kundalik ishlarni bajarishga yordam beradi. Foydalanuvchilar undan turli vazifalarda foydalanishi mumkin.' };
export const config = loadConfig({ BOT_TOKEN: '123456:abcdefghijklmnopqrstuvwxyz', RSS_FEEDS: 'https://example.com/feed', LLM_ENABLED: 'false' });

export function createRepository(): SqliteRepository { return new SqliteRepository(openDatabase(':memory:')); }
export function addChannel(repository: SqliteRepository, owner = ownerId, id = channelId, dailyLimit = 5): Channel {
  repository.touchUser(owner, now);
  repository.connectChannel(owner, id, 'Sinov kanali', { dailyLimit, topics: ['ai'] }, 10);
  repository.setEnabled(owner, id, true);
  const channel = repository.getChannel(owner, id);
  assert.ok(channel);
  return channel;
}
export function addNews(repository: SqliteRepository, suffix = 'one', publishedAt = now): NewsInput {
  const item = { url: `https://example.com/${suffix}`, title: `AI model ${suffix}`, excerpt: 'Artificial intelligence model helps developers build useful software.', source: 'example.com', publishedAt };
  repository.saveNews(item);
  return item;
}
export function fakeGateway(send: TelegramGateway['send']): TelegramGateway {
  return { verify: async () => ({ ok: true, id: channelId, title: 'Sinov kanali' }), send };
}
