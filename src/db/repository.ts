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

export interface Repository {
  touchUser(userId: number, now: number): void;
  setUserBlocked(userId: number, blocked: boolean): void;
  connectChannel(ownerId: number, id: number, title: string, defaults: ChannelSettings, maxChannels: number): ConnectResult;
  listChannels(ownerId: number): Channel[];
  getChannel(ownerId: number, channelId: number): Channel | undefined;
  setEnabled(ownerId: number, channelId: number, enabled: boolean): boolean;
  updateSettings(ownerId: number, channelId: number, settings: ChannelSettings): boolean;
  markChannelUnavailable(channelId: number): void;
  acquireDueChannels(now: number, limit: number): Channel[];
  deferChannel(channelId: number, until: number): void;
  saveNews(input: NewsInput): boolean;
  candidates(channelId: number, since: number, now: number, requireSummary?: boolean): NewsItem[];
  saveContent(newsId: number, content: UzbekContent): void;
  saveUzbekTitle(newsId: number, title: string): void;
  failContent(newsId: number, retryAt: number): void;
  publicationCount(channelId: number, day: string): number;
  reservePublication(channel: Channel, news: number | readonly number[], day: string, now: number): boolean;
  completePublication(channelId: number, newsId: number, messageId: number): void;
  markPublicationUncertain(channelId: number, newsId: number): void;
  releaseRejectedPublication(channelId: number, newsId: number): void;
  readState(key: string): unknown;
  writeState(key: string, value: unknown): void;
  deleteState(key: string): void;
  close(): void;
}
