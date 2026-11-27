import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { openDatabase, migrate } from '../src/db/database.js';
import { SqliteRepository } from '../src/db/sqlite-repository.js';
import { addChannel, addNews, channelId, createRepository, now, ownerId } from './helpers.js';

test('foydalanuvchi faqat o‘z kanallarini o‘qiydi va boshqaradi', (t) => {
  const repo = createRepository(); t.after(() => repo.close());
  addChannel(repo);
  assert.equal(repo.listChannels(202).length, 0);
  assert.equal(repo.getChannel(202, channelId), undefined);
  assert.equal(repo.setEnabled(202, channelId, false), false);
  assert.equal(repo.updateSettings(202, channelId, { dailyLimit: 4, topics: ['gadgets'] }), false);
  repo.touchUser(202, now);
  assert.equal(repo.connectChannel(202, channelId, 'Begona kanal', { dailyLimit: 5, topics: ['ai'] }, 10), 'unavailable');
  assert.equal(repo.getChannel(ownerId, channelId)?.enabled, true);
});

test('bir kanalga bitta yangilik qayta band qilinmaydi, boshqa kanalga chiqishi mumkin', (t) => {
  const repo = createRepository(); t.after(() => repo.close());
  const first = addChannel(repo);
  const second = addChannel(repo, 202, channelId - 1);
  addNews(repo);
  const item = repo.candidates(channelId, 0, now)[0]; assert.ok(item);
  assert.equal(repo.reservePublication(first, item.id, '2026-11-12', now), true);
  repo.completePublication(first.id, item.id, 42);
  assert.equal(repo.reservePublication(first, item.id, '2026-11-13', now + 86400_000), false);
  assert.equal(repo.reservePublication(second, item.id, '2026-11-12', now), true);
});

test('kunlik limit va yangi kun hisoblagichi har kanal uchun alohida', (t) => {
  const repo = createRepository(); t.after(() => repo.close());
  const channel = addChannel(repo, ownerId, channelId, 1);
  addNews(repo, 'first'); addNews(repo, 'second');
  const [first, second] = repo.candidates(channelId, 0, now); assert.ok(first); assert.ok(second);
  assert.equal(repo.reservePublication(channel, first.id, '2026-11-12', now), true);
  assert.equal(repo.reservePublication(channel, second.id, '2026-11-12', now), false);
  assert.equal(repo.reservePublication(channel, second.id, '2026-11-13', now + 86400_000), true);
});

test('to‘xtatilgan kanal, bloklangan egasi va eskirgan sozlamalar nashrni to‘sadi', (t) => {
  const repo = createRepository(); t.after(() => repo.close());
  const channel = addChannel(repo); addNews(repo);
  const item = repo.candidates(channelId, 0, now)[0]; assert.ok(item);
  repo.setEnabled(ownerId, channelId, false);
  assert.equal(repo.reservePublication(channel, item.id, '2026-11-12', now), false);
  repo.setEnabled(ownerId, channelId, true);
  assert.equal(repo.reservePublication(channel, item.id, '2026-11-12', now), false);
  const current = repo.getChannel(ownerId, channelId); assert.ok(current);
  repo.setUserBlocked(ownerId, true);
  assert.equal(repo.reservePublication(current, item.id, '2026-11-12', now), false);
  assert.deepEqual(repo.acquireDueChannels(now, 20), []);
});

test('URL va sarlavha dublikatlari yangi muqobil kalitlarni ham eslab qoladi', (t) => {
  const repo = createRepository(); t.after(() => repo.close()); addChannel(repo);
  const original = addNews(repo);
  assert.equal(repo.saveNews(original), false);
  assert.equal(repo.saveNews({ ...original, url: 'https://other.example/story' }), false);
  assert.equal(repo.saveNews({ ...original, url: 'https://other.example/story', title: 'AI changed headline' }), false);
  assert.equal(repo.candidates(channelId, 0, now).length, 1);
});

test('uchta nashr 09:00, 13:00 va 17:00 da navbatga olinadi, tunda navbat ochilmaydi', (t) => {
  const repo = createRepository();
  t.after(() => repo.close());
  const channel = addChannel(repo, ownerId, channelId, 3);
  const at = (time: string) => Date.parse(`2026-11-12T${time}:00+05:00`);
  assert.equal(repo.updateSettings(ownerId, channelId, { dailyLimit: 6, topics: ['ai'] }), false);
  assert.deepEqual(repo.acquireDueChannels(at('08:59'), 20), []);
  for (const time of ['09:00', '13:00', '17:00']) {
    assert.equal(repo.acquireDueChannels(at(time), 20).length, 1);
    assert.deepEqual(repo.acquireDueChannels(at(time) + 60_000, 20), []);
  }
  assert.deepEqual(repo.acquireDueChannels(at('21:00'), 20), []);
  addNews(repo);
  const item = repo.candidates(channelId, 0, now)[0]; assert.ok(item);
  assert.equal(repo.reservePublication(channel, item.id, '2026-11-12', at('21:00')), false);
  assert.equal(repo.acquireDueChannels(at('09:00') + 86_400_000, 20).length, 1);
});

test('stop, start va sozlash Telegram kutish muddatini bekor qilmaydi', (t) => {
  const repo = createRepository(); t.after(() => repo.close()); addChannel(repo); addNews(repo);
  repo.deferChannel(channelId, now + 7200_000);
  repo.setEnabled(ownerId, channelId, false);
  repo.setEnabled(ownerId, channelId, true);
  repo.updateSettings(ownerId, channelId, { dailyLimit: 5, topics: ['ai'] });
  assert.equal(repo.acquireDueChannels(now + 3600_000, 20).length, 0);
  const channel = repo.getChannel(ownerId, channelId); assert.ok(channel);
  const item = repo.candidates(channelId, 0, now)[0]; assert.ok(item);
  assert.equal(repo.reservePublication(channel, item.id, '2026-11-12', now), false);
  assert.equal(repo.acquireDueChannels(now + 7200_000, 20).length, 1);
});

test('migratsiya takror bajariladi, nashr tarixi qayta ochilganda saqlanadi', (t) => {
  const parent = resolve('test');
  const directory = mkdtempSync(join(parent, '.tmp-'));
  const path = join(directory, 'bot.sqlite');
  const db = openDatabase(path); migrate(db);
  let repo = new SqliteRepository(db);
  t.after(() => {
    repo.close();
    assert.equal(dirname(resolve(directory)), parent);
    assert.ok(basename(directory).startsWith('.tmp-'));
    rmSync(directory, { recursive: true, force: true });
  });
  const channel = addChannel(repo); addNews(repo);
  const item = repo.candidates(channelId, 0, now)[0]; assert.ok(item);
  repo.reservePublication(channel, item.id, '2026-11-12', now);
  repo.writeState(`conversation:${ownerId}`, { version: [0, 1], state: {} });
  repo.close();
  repo = new SqliteRepository(openDatabase(path));
  assert.equal(repo.candidates(channelId, 0, now).length, 0);
  assert.equal(repo.reservePublication(channel, item.id, '2026-11-13', now), false);
  assert.deepEqual(repo.readState(`conversation:${ownerId}`), { version: [0, 1], state: {} });
});

test('qayta ulash sozlamalar va nashr tarixini saqlaydi', (t) => {
  const repo = createRepository(); t.after(() => repo.close()); const channel = addChannel(repo); addNews(repo);
  const item = repo.candidates(channelId, 0, now)[0]; assert.ok(item);
  repo.reservePublication(channel, item.id, '2026-11-12', now);
  repo.markChannelUnavailable(channelId);
  repo.connectChannel(ownerId, channelId, 'Yangi nom', { dailyLimit: 4, topics: ['gadgets'] }, 10);
  const current = repo.getChannel(ownerId, channelId); assert.ok(current);
  assert.equal(current.available, true); assert.equal(current.enabled, false);
  assert.equal(current.dailyLimit, 5); assert.deepEqual(current.topics, ['ai']);
  assert.equal(repo.candidates(channelId, 0, now).length, 0);
});
