import 'dotenv/config';
import { z } from 'zod';
import { MAX_DAILY_POSTS } from './services/publish-schedule.js';

const httpUrl = z.string().url().refine((value) => {
  const url = new URL(value);
  return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
}, 'HTTP yoki HTTPS havolasi kerak.');
const boolean = z.enum(['true', 'false']).transform((value) => value === 'true');
const integer = (min: number, max: number, fallback: number) =>
  z.coerce.number().int().min(min).max(max).default(fallback);
const postgresUrl = z.string().url().refine((value) => /^postgres(?:ql)?:\/\//i.test(value), 'PostgreSQL havolasi kerak.');

const schema = z.object({
  BOT_TOKEN: z.string().regex(/^\d+:[A-Za-z0-9_-]{20,}$/, 'Bot tokeni noto‘g‘ri.'),
  DATABASE_PATH: z.string().min(1).default('./data/bot.sqlite'),
  DATABASE_URL: postgresUrl.optional(),
  DATABASE_URL_UNPOOLED: postgresUrl.optional(),
  BOT_MODE: z.enum(['polling', 'webhook']).default('polling'),
  WEBHOOK_BASE_URL: httpUrl.optional(),
  WEBHOOK_SECRET: z.string().regex(/^[A-Za-z0-9_-]{32,256}$/).optional(),
  SCHEDULER_SECRET: z.string().regex(/^[A-Za-z0-9_-]{32,256}$/).optional(),
  PORT: integer(1, 65535, 10000),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),
  TIMEZONE: z.string().default('Asia/Tashkent').refine((zone) => {
    try { new Intl.DateTimeFormat('en', { timeZone: zone }); return true; }
    catch { return false; }
  }, 'Vaqt mintaqasi noto‘g‘ri.'),
  RSS_FEEDS: z.string().min(1).transform((value) => value.split(',').map((url) => url.trim()))
    .pipe(z.array(httpUrl).min(1).max(30)),
  INGEST_INTERVAL_MINUTES: integer(1, 1440, 10),
  SCHEDULER_TICK_SECONDS: integer(5, 300, 15),
  MAX_NEWS_AGE_HOURS: integer(1, 168, 48),
  DEFAULT_DAILY_LIMIT: integer(1, MAX_DAILY_POSTS, MAX_DAILY_POSTS),
  MAX_CHANNELS_PER_USER: integer(1, 100, 10),
  NEWS_LANGUAGE: z.enum(['uz', 'en', 'uz-title']).default('uz'),
  LLM_ENABLED: boolean.default(true),
  LLM_BASE_URL: httpUrl.default('https://openrouter.ai/api/v1'),
  LLM_API_KEY: z.string().default(''),
  LLM_MODEL: z.string().default(''),
  LLM_TIMEOUT_MS: integer(1000, 120000, 45000),
  LLM_JSON_MODE: boolean.default(true),
}).superRefine((value, ctx) => {
  if (value.BOT_MODE === 'webhook') {
    for (const key of ['DATABASE_URL', 'WEBHOOK_SECRET', 'SCHEDULER_SECRET'] as const) {
      if (!value[key]) ctx.addIssue({ code: 'custom', path: [key], message: 'Webhook rejimida qiymat majburiy.' });
    }
    if (!value.WEBHOOK_BASE_URL?.startsWith('https://')) {
      ctx.addIssue({ code: 'custom', path: ['WEBHOOK_BASE_URL'], message: 'Webhook rejimida HTTPS manzili majburiy.' });
    }
    if (value.WEBHOOK_SECRET && value.WEBHOOK_SECRET === value.SCHEDULER_SECRET) {
      ctx.addIssue({ code: 'custom', path: ['SCHEDULER_SECRET'], message: 'Ikkita alohida maxfiy qiymat ishlating.' });
    }
  }
  if (value.NEWS_LANGUAGE === 'uz' && value.LLM_ENABLED) {
    for (const key of ['LLM_API_KEY', 'LLM_MODEL'] as const) {
      if (!value[key].trim()) ctx.addIssue({ code: 'custom', path: [key], message: 'LLM uchun qiymat majburiy.' });
    }
  }
});

export type Config = z.infer<typeof schema>;
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = schema.safeParse({ ...env, WEBHOOK_BASE_URL: env.WEBHOOK_BASE_URL ?? env.RENDER_EXTERNAL_URL });
  if (!result.success) {
    const details = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.code === 'custom' ? issue.message : 'qiymat yo‘q yoki ruxsat etilgan format va chegaralarga mos emas.'}`).join('; ');
    throw new Error(`Muhit sozlamalari noto‘g‘ri: ${details}`);
  }
  return result.data;
}
