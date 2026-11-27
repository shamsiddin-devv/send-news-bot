import type { Topic } from '../services/topics.js';

export interface ChannelSettings {
  dailyLimit: number;
  topics: Topic[];
}
export interface Channel extends ChannelSettings {
  id: number;
  ownerId: number;
  title: string;
  enabled: boolean;
  available: boolean;
  revision: number;
}
export interface NewsInput {
  url: string;
  title: string;
  excerpt: string;
  source: string;
  publishedAt: number;
}
export interface NewsItem extends NewsInput {
  id: number;
  uzTitle: string | null;
  uzSummary: string | null;
  attempts: number;
}
export interface UzbekContent { title: string; summary: string }
export type ConnectResult = 'saved' | 'unavailable' | 'limit';

type Awaitable<T> = T | Promise<T>;

export interface Repository {
  touchUser(userId: number, now: number): Awaitable<void>;
  setUserBlocked(userId: number, blocked: boolean): Awaitable<void>;
  connectChannel(ownerId: number, id: number, title: string, defaults: ChannelSettings, maxChannels: number): Awaitable<ConnectResult>;
  listChannels(ownerId: number): Awaitable<Channel[]>;
  getChannel(ownerId: number, channelId: number): Awaitable<Channel | undefined>;
  setEnabled(ownerId: number, channelId: number, enabled: boolean): Awaitable<boolean>;
  updateSettings(ownerId: number, channelId: number, settings: ChannelSettings): Awaitable<boolean>;
  markChannelUnavailable(channelId: number): Awaitable<void>;
  acquireDueChannels(now: number, limit: number): Awaitable<Channel[]>;
  deferChannel(channelId: number, until: number): Awaitable<void>;
  saveNews(input: NewsInput): Awaitable<boolean>;
  candidates(channelId: number, since: number, now: number, requireSummary?: boolean): Awaitable<NewsItem[]>;
  saveContent(newsId: number, content: UzbekContent): Awaitable<void>;
  saveUzbekTitle(newsId: number, title: string): Awaitable<void>;
  failContent(newsId: number, retryAt: number): Awaitable<void>;
  publicationCount(channelId: number, day: string): Awaitable<number>;
  reservePublication(channel: Channel, news: number | readonly number[], day: string, now: number): Awaitable<boolean>;
  completePublication(channelId: number, newsId: number, messageId: number): Awaitable<void>;
  markPublicationUncertain(channelId: number, newsId: number): Awaitable<void>;
  releaseRejectedPublication(channelId: number, newsId: number): Awaitable<void>;
  readState(key: string): Awaitable<unknown>;
  writeState(key: string, value: unknown): Awaitable<void>;
  deleteState(key: string): Awaitable<void>;
  close(): Awaitable<void>;
}
