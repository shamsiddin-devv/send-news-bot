import type { Context } from 'grammy';
import type { Repository } from '../db/repository.js';
import { isTopic } from '../services/topics.js';
import { MAX_DAILY_POSTS } from '../services/publish-schedule.js';
import { escapeHtml } from '../utils/text.js';
import { uz } from '../i18n/uz.js';
import { readMessage, parseInteger } from './input.js';
import type { BotConversation } from './types.js';

export function createSettingsFlow(repository: Repository) {
  return async function settings(conversation: BotConversation, ctx: Context, selectedId?: number): Promise<void> {
    const ownerId = ctx.from?.id;
    if (!ownerId) return;
    let channelId = selectedId;
    if (channelId === undefined) {
      await ctx.reply(escapeHtml(uz.chooseChannel), { parse_mode: 'HTML' });
      const reply = await readMessage(conversation);
      if (!reply) return;
      channelId = parseInteger(reply.message?.text, Number.MIN_SAFE_INTEGER, -1);
    }
    const id = channelId;
    const channel = id === undefined ? undefined : await conversation.external(() => repository.getChannel(ownerId, id));
    if (!channel) { await ctx.reply(escapeHtml(uz.channelMissing), { parse_mode: 'HTML' }); return; }
    await ctx.reply(escapeHtml(uz.dailyPrompt), { parse_mode: 'HTML' });
    const limitReply = await readMessage(conversation);
    if (!limitReply) return;
    const limit = parseInteger(limitReply.message?.text, 1, MAX_DAILY_POSTS);
    if (limit === undefined) { await limitReply.reply(escapeHtml(uz.invalidSettings), { parse_mode: 'HTML' }); return; }
    await limitReply.reply(escapeHtml(uz.topicsPrompt), { parse_mode: 'HTML' });
    const topicsReply = await readMessage(conversation);
    if (!topicsReply) return;
    const values = [...new Set((topicsReply.message?.text ?? '').toLowerCase().split(',').map((value) => value.trim()))];
    if (!values.length || !values.every(isTopic)) { await topicsReply.reply(escapeHtml(uz.invalidSettings), { parse_mode: 'HTML' }); return; }
    const saved = await conversation.external(() => repository.updateSettings(ownerId, channel.id, {
      dailyLimit: limit, topics: values,
    }));
    await topicsReply.reply(escapeHtml(saved ? uz.settingsSaved : uz.channelMissing), { parse_mode: 'HTML' });
  };
}
