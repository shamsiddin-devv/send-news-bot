import { InlineKeyboard, type Bot } from 'grammy';
import type { Repository, Channel } from '../db/repository.js';
import type { TelegramGateway } from '../services/telegram.js';
import { topics } from '../services/topics.js';
import { publicationTimes } from '../services/publish-schedule.js';
import { uz } from '../i18n/uz.js';
import { escapeHtml } from '../utils/text.js';
import type { BotContext } from './types.js';

function channelText(channel: Channel, timeZone: string): string {
  const status = !channel.available ? uz.inaccessible : channel.enabled ? uz.active : uz.paused;
  return `${channel.title}\nID: ${channel.id}\nHolat: ${status}\nKunlik limit: ${channel.dailyLimit}\nNashr vaqtlari: ${publicationTimes(channel.dailyLimit)}\nMavzular: ${channel.topics.map((topic) => topics[topic].label).join(', ')}\nVaqt mintaqasi: ${timeZone}`;
}

export function registerHandlers(bot: Bot<BotContext>, repository: Repository, telegram: TelegramGateway, timeZone: string, publishingEnabled: boolean): void {
  bot.command('start', (ctx) => ctx.reply(escapeHtml(uz.welcome), { parse_mode: 'HTML' }));
  bot.command('help', (ctx) => ctx.reply(escapeHtml(uz.help), { parse_mode: 'HTML' }));
  bot.command('cancel', async (ctx) => {
    await ctx.conversation.exitAll();
    await ctx.reply(escapeHtml(uz.cancelled), { parse_mode: 'HTML' });
  });
  bot.command('connect', (ctx) => ctx.conversation.enter('connectChannel'));
  bot.command('settings', (ctx) => ctx.conversation.enter('settings'));
  bot.command('channels', async (ctx) => {
    if (!ctx.from) return;
    const channels = repository.listChannels(ctx.from.id);
    if (!channels.length) { await ctx.reply(escapeHtml(uz.noChannels), { parse_mode: 'HTML' }); return; }
    for (const channel of channels) {
      const keyboard = new InlineKeyboard()
        .text(channel.enabled ? uz.stop : uz.start, `${channel.enabled ? 'stop' : 'start'}:${channel.id}`)
        .text(uz.settings, `settings:${channel.id}`);
      await ctx.reply(escapeHtml(channelText(channel, timeZone)), { parse_mode: 'HTML', reply_markup: keyboard });
    }
  });
  bot.callbackQuery(/^(start|stop|settings):(-\d+)$/, async (ctx) => {
    const action = ctx.match[1];
    const channelId = Number(ctx.match[2]);
    const channel = repository.getChannel(ctx.from.id, channelId);
    if (!channel) { await ctx.answerCallbackQuery({ text: uz.channelMissing }); return; }
    await ctx.answerCallbackQuery();
    if (action === 'settings') {
      await ctx.conversation.enter('settings', channelId);
      return;
    }
    if (action === 'start') {
      if (!publishingEnabled) { await ctx.reply(escapeHtml(uz.llmDisabled), { parse_mode: 'HTML' }); return; }
      const access = await telegram.verify(channel.id, ctx.from.id);
      if (!access.ok) {
        repository.markChannelUnavailable(channel.id);
        await ctx.reply(escapeHtml(access.message), { parse_mode: 'HTML' });
        return;
      }
    }
    const changed = repository.setEnabled(ctx.from.id, channel.id, action === 'start');
    await ctx.reply(escapeHtml(changed ? action === 'start' ? uz.started : uz.stopped : uz.inaccessible), { parse_mode: 'HTML' });
    if (changed) {
      const updated = repository.getChannel(ctx.from.id, channel.id);
      if (updated) await ctx.editMessageText(escapeHtml(channelText(updated, timeZone)), {
        parse_mode: 'HTML',
        reply_markup: new InlineKeyboard().text(updated.enabled ? uz.stop : uz.start, `${updated.enabled ? 'stop' : 'start'}:${channel.id}`)
          .text(uz.settings, `settings:${channel.id}`),
      });
    }
  });
  bot.callbackQuery(/.*/, (ctx) => ctx.answerCallbackQuery({ text: uz.commandDuringFlow }));
  bot.on('message', (ctx) => ctx.reply(escapeHtml(uz.welcome), { parse_mode: 'HTML' }));
}
