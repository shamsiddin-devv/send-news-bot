import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Update } from 'grammy/types';
import type { Logger } from 'pino';
import { safeError } from './utils/logger.js';

export const telegramPath = '/telegram/webhook';
const maxBodyBytes = 1024 * 1024;

interface Options {
  webhookSecret: string;
  schedulerSecret: string;
  handleUpdate: (update: Update) => Promise<void>;
  publish: () => Promise<void>;
  logger: Logger;
}

function hasSecret(value: string | string[] | undefined, expected: string): boolean {
  if (typeof value !== 'string') return false;
  const given = Buffer.from(value);
  const correct = Buffer.from(expected);
  return given.length === correct.length && timingSafeEqual(given, correct);
}

function reply(response: ServerResponse, status: number, message: string): void {
  response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
  response.end(message);
}

async function readUpdate(request: IncomingMessage): Promise<Update | undefined> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > maxBodyBytes) return undefined;
    chunks.push(chunk);
  }
  try {
    const update: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (typeof update === 'object' && update !== null && 'update_id' in update &&
        typeof update.update_id === 'number' && Number.isSafeInteger(update.update_id)) return update as Update;
  } catch { return undefined; }
  return undefined;
}

export function createWebServer(options: Options) {
  let processing: Promise<void> = Promise.resolve();
  return createServer((request, response) => {
    const handle = async () => {
      if (request.method === 'GET' && request.url === '/health') {
        reply(response, 200, 'ok');
      } else if (request.method === 'POST' && request.url === telegramPath) {
        if (!hasSecret(request.headers['x-telegram-bot-api-secret-token'], options.webhookSecret)) {
          reply(response, 401, 'Unauthorized');
          return;
        }
        const update = await readUpdate(request);
        if (!update) { reply(response, 400, 'Invalid update'); return; }
        // Telegram qayta yuborsa ham suhbat yangilanishlari ketma-ket ishlanadi.
        const job = processing.then(() => options.handleUpdate(update));
        processing = job.catch(() => {});
        await job;
        reply(response, 200, 'ok');
      } else if (request.method === 'POST' && request.url === '/internal/publish') {
        if (!hasSecret(request.headers.authorization, `Bearer ${options.schedulerSecret}`)) {
          reply(response, 401, 'Unauthorized');
          return;
        }
        await options.publish();
        reply(response, 200, 'ok');
      } else {
        reply(response, 404, 'Not found');
      }
    };
    void handle().catch((error: unknown) => {
      options.logger.error({ error: safeError(error) }, 'HTTP so‘rovi bajarilmadi.');
      if (!response.headersSent) reply(response, 500, 'Internal error');
      else response.end();
    });
  });
}
