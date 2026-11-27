import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createPostgresPool, migratePostgres } from '../src/db/postgres.js';
import { PostgresRepository } from '../src/db/postgres-repository.js';

const url = process.env.TEST_POSTGRES_URL;
test('PostgreSQL bir vaqtdagi nashrlarni va kanal egaligini nazorat qiladi', { skip: !url }, async (t) => {
  assert.ok(url);
  const admin = createPostgresPool(url);
  const schema = `test_${randomUUID().replace(/-/g, '')}`;
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const scoped = new URL(url);
  scoped.searchParams.set('options', `-c search_path=${schema}`);
  const pool = createPostgresPool(scoped.href);
  const repo = new PostgresRepository(pool, 'Asia/Tashkent');
  t.after(async () => {
    await repo.close();
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  });
  await migratePostgres(pool);
  await migratePostgres(pool);
  const now = Date.parse('2026-11-12T09:00:00+05:00');
  const owner = 2_000_000_001;
  const channel = -1_002_000_000_001;
  await repo.touchUser(owner, now);
  await repo.touchUser(owner + 1, now);
  assert.equal(await repo.connectChannel(owner, channel, 'Sinov', { dailyLimit: 1, topics: ['ai'] }, 5), 'saved');
  assert.equal(await repo.connectChannel(owner + 1, channel, 'Begona', { dailyLimit: 1, topics: ['ai'] }, 5), 'unavailable');
  assert.equal(await repo.getChannel(owner + 1, channel), undefined);
  assert.equal(await repo.setEnabled(owner + 1, channel, true), false);
  assert.equal(await repo.setEnabled(owner, channel, true), true);

  const item = { title: 'AI tools', url: 'https://example.org/one', excerpt: 'AI news', source: 'example.org', publishedAt: now };
  assert.deepEqual((await Promise.all([repo.saveNews(item), repo.saveNews(item)])).sort(), [false, true]);
  await repo.saveNews({ ...item, title: 'AI tools update', url: 'https://example.org/two' });
  const claimed = (await Promise.all([repo.acquireDueChannels(now, 10), repo.acquireDueChannels(now, 10)])).flat();
  assert.equal(claimed.length, 1);
  const [active] = claimed;
  assert.ok(active);
  const news = await repo.candidates(channel, now, now, false);
  const ids = news.map((article) => article.id);
  const [first] = ids;
  assert.ok(first);
  assert.deepEqual((await Promise.all([
    repo.reservePublication(active, ids, '2026-11-12', now),
    repo.reservePublication(active, ids, '2026-11-12', now),
  ])).sort(), [false, true]);
  assert.equal(await repo.publicationCount(channel, '2026-11-12'), 1);
  await repo.completePublication(channel, first, 42);
  assert.deepEqual(await repo.candidates(channel, now, now, false), []);
  assert.deepEqual(await repo.acquireDueChannels(now + 12 * 3600_000, 10), []);
  await repo.writeState('conversation:test', { version: [0, 2] });
  assert.deepEqual(await repo.readState('conversation:test'), { version: [0, 2] });
  await repo.deleteState('conversation:test');
  assert.equal(await repo.readState('conversation:test'), undefined);
});
