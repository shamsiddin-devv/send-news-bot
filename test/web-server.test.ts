import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createWebServer, telegramPath } from '../src/web-server.js';
import { logger } from './helpers.js';

test('webhook va nashr endpointlari tegishli maxfiy qiymatni talab qiladi', async (t) => {
  const updates: number[] = [];
  let calls = 0;
  const server = createWebServer({
    webhookSecret: 'telegram-secret', schedulerSecret: 'schedule-secret',
    handleUpdate: async (update) => { updates.push(update.update_id); },
    publish: async () => { calls++; }, logger,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  const request = async (path: string, options?: RequestInit) => {
    const response = await fetch(base + path, options);
    await response.text();
    return response.status;
  };
  assert.equal(await request('/health'), 200);
  assert.equal(await request(telegramPath, { method: 'POST', body: '{"update_id":42}' }), 401);
  assert.equal(await request(telegramPath, {
    method: 'POST', body: '{}', headers: { 'x-telegram-bot-api-secret-token': 'telegram-secret' },
  }), 400);
  assert.equal(await request(telegramPath, {
    method: 'POST', body: '{"update_id":42}', headers: { 'x-telegram-bot-api-secret-token': 'telegram-secret' },
  }), 200);
  assert.deepEqual(updates, [42]);
  assert.equal(await request('/internal/publish', { method: 'POST', headers: { authorization: 'Bearer telegram-secret' } }), 401);
  assert.equal(await request('/internal/publish', { method: 'POST', headers: { authorization: 'Bearer schedule-secret' } }), 200);
  assert.equal(calls, 1);
});
