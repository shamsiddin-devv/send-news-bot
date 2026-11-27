import { Bot, BotError } from 'grammy';
import type { Server } from 'node:http';
import { once } from 'node:events';
import { loadConfig } from './config.js';
import { setupBot } from './bot.js';
import { openRepository } from './db/open-repository.js';
import type { BotContext } from './handlers/types.js';
import { createLogger, safeError } from './utils/logger.js';
import { RssSource } from './services/sources.js';
import { CompatibleLlmWriter } from './services/llm.js';
import { NewsService } from './services/news.js';
import { GrammyGateway } from './services/telegram.js';
import { Publisher } from './services/publisher.js';
import { Scheduler } from './services/scheduler.js';
import { MyMemoryTitleTranslator } from './services/title-translator.js';
import { createWebServer, telegramPath } from './web-server.js';

const allowedUpdates = ['message', 'callback_query', 'my_chat_member'] as const;

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.LOG_LEVEL);
  const repository = await openRepository(config);
  const bot = new Bot<BotContext>(config.BOT_TOKEN, { client: { timeoutSeconds: 30 } });
  const telegram = new GrammyGateway(config.BOT_TOKEN, () => bot.botInfo.id);
  const handleBotError = setupBot(bot, config, repository, logger, telegram);
  let server: Server | undefined;
  let scheduler: Scheduler | undefined;
  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('Bot to‘xtatilmoqda.');
    void scheduler?.stop();
    server?.close();
    if (bot.isRunning()) void bot.stop().catch(() => { process.exitCode = 1; });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  try {
    await bot.init();
    if (shuttingDown) return;
    const news = new NewsService(repository, config.RSS_FEEDS.map((url) => new RssSource(url)),
      new CompatibleLlmWriter(config), logger, config.MAX_NEWS_AGE_HOURS);
    const useDigest = config.NEWS_LANGUAGE !== 'uz';
    const translator = config.NEWS_LANGUAGE === 'uz-title' ? new MyMemoryTitleTranslator() : undefined;
    const publisher = new Publisher(repository, useDigest ? undefined : news, telegram, logger, config.TIMEZONE,
      config.MAX_NEWS_AGE_HOURS, Date.now, translator);
    scheduler = new Scheduler(repository, news, publisher, logger, config.SCHEDULER_TICK_SECONDS,
      config.INGEST_INTERVAL_MINUTES, useDigest || config.LLM_ENABLED);
    await bot.api.setMyCommands([
      { command: 'start', description: 'Botni boshlash' },
      { command: 'connect', description: 'Kanal ulash' },
      { command: 'channels', description: 'Kanallarni boshqarish' },
      { command: 'settings', description: 'Kanal sozlamalari' },
      { command: 'cancel', description: 'Suhbatni bekor qilish' },
      { command: 'help', description: 'Foydalanish yo‘riqnomasi' },
    ]);
    if (shuttingDown) return;
    if (translator) logger.info('O‘zbekcha sarlavhali dayjest yoqilgan.');
    else if (useDigest) logger.info('Inglizcha RSS nashri yoqilgan.');
    else if (!config.LLM_ENABLED) logger.warn('O‘zbekcha xulosa xizmati o‘chiq.');
    if (config.BOT_MODE === 'webhook') {
      const { WEBHOOK_SECRET, SCHEDULER_SECRET, WEBHOOK_BASE_URL } = config;
      if (!WEBHOOK_SECRET || !SCHEDULER_SECRET || !WEBHOOK_BASE_URL) throw new Error('Webhook konfiguratsiyasi yetishmayapti.');
      const activeScheduler = scheduler;
      server = createWebServer({
        webhookSecret: WEBHOOK_SECRET, schedulerSecret: SCHEDULER_SECRET, logger,
        publish: () => activeScheduler.run(),
        handleUpdate: async (update) => {
          try { await bot.handleUpdate(update); }
          catch (error) {
            if (!(error instanceof BotError)) throw error;
            await handleBotError(error);
          }
        },
      });
      server.listen(config.PORT, '0.0.0.0');
      await once(server, 'listening');
      if (shuttingDown) return;
      await bot.api.setWebhook(new URL(telegramPath, WEBHOOK_BASE_URL).href, {
        secret_token: WEBHOOK_SECRET, max_connections: 1, allowed_updates: [...allowedUpdates],
      });
      logger.info('Bot webhook rejimida ishga tushdi.');
      if (!shuttingDown) await once(server, 'close');
    } else {
      await bot.api.deleteWebhook({ drop_pending_updates: false });
      if (shuttingDown) return;
      await bot.start({
        allowed_updates: allowedUpdates,
        onStart: () => { logger.info('Bot uzoq so‘rov rejimida ishga tushdi.'); scheduler?.start(); },
      });
    }
  } catch (error) {
    logger.fatal({ error: safeError(error) }, 'Bot to‘xtadi. Token, tarmoq va muhit sozlamalarini tekshiring.');
    process.exitCode = 1;
  } finally {
    server?.close();
    await scheduler?.stop();
    await repository.close();
    process.removeListener('SIGINT', shutdown);
    process.removeListener('SIGTERM', shutdown);
  }
}

main().catch((error: unknown) => {
  const configurationError = error instanceof Error && error.message.startsWith('Muhit sozlamalari noto‘g‘ri:');
  console.error(configurationError ? error.message : 'Botni ishga tushirib bo‘lmadi.');
  process.exitCode = 1;
});
