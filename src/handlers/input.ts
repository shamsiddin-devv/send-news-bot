import type { Context } from 'grammy';
import type { BotConversation } from './types.js';
import { uz } from '../i18n/uz.js';
import { escapeHtml } from '../utils/text.js';

export async function readMessage(conversation: BotConversation): Promise<Context | undefined> {
  const ctx = await conversation.waitFor('message', {
    otherwise: async (other) => {
      if (other.callbackQuery) await other.answerCallbackQuery({ text: uz.inputExpected });
      else await other.reply(escapeHtml(uz.inputExpected), { parse_mode: 'HTML' });
    },
  });
  const text = ctx.message.text?.trim() ?? '';
  if (text.startsWith('/')) {
    await ctx.reply(escapeHtml(/^\/cancel(?:@\w+)?(?:\s|$)/.test(text) ? uz.cancelled : uz.commandDuringFlow), { parse_mode: 'HTML' });
    return undefined;
  }
  return ctx;
}

export function parseInteger(text: string | undefined, min: number, max: number): number | undefined {
  if (!text || !/^-?\d+$/.test(text.trim())) return undefined;
  const value = Number(text);
  return Number.isSafeInteger(value) && value >= min && value <= max ? value : undefined;
}
