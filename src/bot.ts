import { GrammyError, type Bot, type Context } from 'grammy';
import { autoRetry } from '@grammyjs/auto-retry';
import { conversations, createConversation, type ConversationData, type VersionedState } from '@grammyjs/conversations';
import type { Logger } from 'pino';
import type { Config } from './config.js';
import type { Repository } from './db/repository.js';
import { createConnectFlow } from './handlers/connect.js';
import { createSettingsFlow } from './handlers/settings.js';
import { registerHandlers } from './handlers/start.js';
import type { BotContext } from './handlers/types.js';
import { retryOptions, type TelegramGateway } from './services/telegram.js';
import { safeError } from './utils/logger.js';
import { escapeHtml } from './utils/text.js';
import { uz } from './i18n/uz.js';

export function setupBot(bot: Bot<BotContext>, config: Config, repository: Repository, logger: Logger, telegram: TelegramGateway) {
  bot.api.config.use(autoRetry(retryOptions));
  bot.on('my_chat_member', async (ctx) => {
    const member = ctx.myChatMember.new_chat_member;
    if (ctx.chat.type === 'channel') {
      if (member.status !== 'administrator' || !member.can_post_messages) await repository.markChannelUnavailable(ctx.chat.id);
    } else if (ctx.chat.type === 'private') {
      await repository.setUserBlocked(ctx.chat.id, member.status === 'kicked');
    }
  });
  bot.use(async (ctx, next) => {
    if (ctx.chat?.type !== 'private' || !ctx.from || ctx.from.is_bot) return;
    await repository.touchUser(ctx.from.id, Date.now());
    await next();
  });
  bot.use(conversations<BotContext, Context>({
    storage: {
      type: 'key', version: 2, prefix: 'conversation:', getStorageKey: (ctx) => ctx.from?.id.toString(),
      adapter: {
        read: async (key) => await repository.readState(key) as VersionedState<ConversationData> | undefined,
        write: (key, state) => repository.writeState(key, state),
        delete: (key) => repository.deleteState(key),
      },
    },
    plugins: [async (ctx, next) => { ctx.api.config.use(autoRetry(retryOptions)); await next(); }],
  }));
  bot.use(createConversation(createConnectFlow(repository, telegram, config), 'connectChannel'));
  bot.use(createConversation(createSettingsFlow(repository), 'settings'));
  registerHandlers(bot, repository, telegram, config.TIMEZONE, config.NEWS_LANGUAGE !== 'uz' || config.LLM_ENABLED);
  const handleError: Parameters<typeof bot.catch>[0] = async ({ error, ctx }) => {
    logger.error({ updateId: ctx.update.update_id, error: safeError(error) }, 'Bot yangilanishini qayta ishlashda xato.');
    if (error instanceof GrammyError && error.error_code === 403 && ctx.chat?.type === 'private') {
      await repository.setUserBlocked(ctx.chat.id, true);
      return;
    }
    if (ctx.chat?.type === 'private') {
      try { await ctx.reply(escapeHtml(uz.genericError), { parse_mode: 'HTML' }); }
      catch (replyError) {
        if (replyError instanceof GrammyError && replyError.error_code === 403) await repository.setUserBlocked(ctx.chat.id, true);
        logger.warn({ error: safeError(replyError) }, 'Xato xabarini yuborib bo‘lmadi.');
      }
    }
  };
  bot.catch(handleError);
  return handleError;
}
