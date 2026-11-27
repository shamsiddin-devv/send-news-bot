import type { Context } from 'grammy';
import type { Config } from '../config.js';
import type { Repository } from '../db/repository.js';
import type { TelegramGateway } from '../services/telegram.js';
import { defaultTopics } from '../services/topics.js';
import { escapeHtml } from '../utils/text.js';
import { uz } from '../i18n/uz.js';
import { readMessage, parseInteger } from './input.js';
import type { BotConversation } from './types.js';

export function createConnectFlow(repository: Repository, telegram: TelegramGateway, config: Config) {
  return async function connectChannel(conversation: BotConversation, ctx: Context): Promise<void> {
    const ownerId = ctx.from?.id;
    if (!ownerId) return;
    await ctx.reply(escapeHtml(uz.connectPrompt), { parse_mode: 'HTML' });
    const reply = await readMessage(conversation);
    if (!reply) return;
    const origin = reply.message?.forward_origin;
    const text = reply.message?.text?.trim() ?? '';
    const numeric = /^-100\d+$/.test(text) ? parseInteger(text, Number.MIN_SAFE_INTEGER, -1) : undefined;
    const identifier = origin?.type === 'channel' ? origin.chat.id : /^@[a-zA-Z][a-zA-Z0-9_]{3,31}$/.test(text) ? text : numeric;
    if (identifier === undefined) { await reply.reply(escapeHtml(uz.invalidChannel), { parse_mode: 'HTML' }); return; }
    const result = await conversation.external(async () => {
      try {
        const access = await telegram.verify(identifier, ownerId);
        if (!access.ok) return access.message;
        const status = repository.connectChannel(ownerId, access.id, access.title, {
          dailyLimit: config.DEFAULT_DAILY_LIMIT,
          topics: [...defaultTopics],
        }, config.MAX_CHANNELS_PER_USER);
        return status === 'saved' ? uz.connected : status === 'limit' ? uz.limit : uz.unavailable;
      } catch { return uz.genericError; }
    });
    await reply.reply(escapeHtml(result), { parse_mode: 'HTML' });
  };
}
