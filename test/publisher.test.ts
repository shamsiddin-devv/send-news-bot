import test from 'node:test';
import assert from 'node:assert/strict';
import { GrammyError, HttpError } from 'grammy';
import { Publisher, formatPost } from '../src/services/publisher.js';
import { MyMemoryTitleTranslator } from '../src/services/title-translator.js';
import { addChannel, addNews, channelId, content, createRepository, fakeGateway, logger, now, ownerId } from './helpers.js';

test('inglizcha dayjest uchta havolani bitta postga joylaydi va kunlik limitda bir marta sanaladi', async (t) => {
  const repo = createRepository();
  t.after(() => repo.close());
  const channel = addChannel(repo, ownerId, channelId, 1);
  const item = addNews(repo);
  const candidate = repo.candidates(channelId, 0, now)[0];
  assert.ok(candidate);
  for (let attempt = 0; attempt < 3; attempt++) repo.failContent(candidate.id, now + 60_000);
  const second = addNews(repo, 'second');
  const third = addNews(repo, 'third');
  const fourth = addNews(repo, 'fourth', now - 1);
  const messages: string[] = [];
  const telegram = fakeGateway(async (_id, text) => { messages.push(text); return 1; });
  telegram.verify = async () => ({ ok: true, id: channelId, title: 'Sinov kanali', username: 'sinov_news' });
  const publisher = new Publisher(repo, undefined, telegram, logger, 'Asia/Tashkent', 48, () => now);
  await publisher.publish(channel);
  await publisher.publish(channel);
  assert.equal(messages.length, 1);
  const [message] = messages;
  assert.ok(message);
  assert.ok(message.startsWith('<b>AI va texnologiyada nima gap?</b>\nHozirgi soatgacha bo‘lgan yangiliklar:\n\n'));
  for (const article of [item, second, third]) {
    assert.ok(message.includes(`● <a href="${article.url}">${article.title}</a>`));
  }
  assert.ok(!message.includes('Source:'));
  assert.ok(!message.includes('🔗'));
  assert.ok(!message.includes('#Technology'));
  assert.ok(message.endsWith('\n\n@sinov_news'));
  assert.ok(!message.includes(item.excerpt));
  assert.equal(repo.publicationCount(channelId, '2026-11-12'), 1);
  assert.deepEqual(repo.candidates(channelId, 0, now, false).map((article) => article.url), [fourth.url]);
});

test('o‘zbekcha dayjest tarjima qilingan sarlavhani havolaga qo‘yadi va tarjimani kanallar o‘rtasida qayta ishlatadi', async (t) => {
  const repo = createRepository();
  t.after(() => repo.close());
  const channels = [addChannel(repo), addChannel(repo, 202, channelId - 1)];
  const item = addNews(repo);
  const title = 'Sun’iy intellektning yangi modeli';
  const messages: string[] = [];
  let requests = 0;
  const translator = new MyMemoryTitleTranslator(async (input) => {
    const url = new URL(String(input));
    assert.equal(url.searchParams.get('langpair'), 'en|uz');
    assert.equal(url.searchParams.get('q'), item.title);
    requests++;
    return Response.json({ responseStatus: 200, responseData: { translatedText: title } });
  });
  const telegram = fakeGateway(async (_id, text) => { messages.push(text); return 1; });
  const publisher = new Publisher(repo, undefined, telegram, logger, 'Asia/Tashkent', 48, () => now, translator);
  for (const channel of channels) await publisher.publish(channel);
  assert.equal(requests, 1);
  assert.equal(messages.length, 2);
  for (const message of messages) assert.ok(message.includes(`<a href="${item.url}">${title}</a>`));
});

test('Telegram dayjestni rad etsa, uning barcha yangiliklari qayta navbatga tushadi', async (t) => {
  const repo = createRepository();
  t.after(() => repo.close());
  const channel = addChannel(repo);
  addNews(repo, 'one');
  addNews(repo, 'two');
  addNews(repo, 'three');
  const telegram = fakeGateway(async () => {
    throw new GrammyError('Cheklov', { ok: false, error_code: 429, description: 'Too Many Requests', parameters: { retry_after: 60 } }, 'sendMessage', {});
  });
  const publisher = new Publisher(repo, undefined, telegram, logger, 'Asia/Tashkent', 48, () => now);
  await publisher.publish(channel);
  assert.equal(repo.publicationCount(channelId, '2026-11-12'), 0);
  assert.equal(repo.candidates(channelId, 0, now, false).length, 3);
});

test('xabar HTML bilan xavfsiz formatlanadi va har kanalga bir marta chiqadi', async (t) => {
  const repo = createRepository(); t.after(() => repo.close()); const channel = addChannel(repo); addNews(repo);
  const messages: string[] = [];
  const publisher = new Publisher(repo, { prepare: async () => content }, fakeGateway(async (_id, text) => { messages.push(text); return 10; }), logger, 'Asia/Tashkent', 48, () => now);
  await publisher.publish(channel); await publisher.publish(channel);
  assert.equal(messages.length, 1);
  assert.match(messages[0] ?? '', /#AI #Texnologiya/);
  const html = formatPost({ title: '<a>&"', summary: '<script>salom</script>' }, 'https://example.com/?a=1&b=2');
  assert.ok(html.includes('&lt;script&gt;')); assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('a=1&amp;b=2'));
});

test('429 dan so‘ng retry_after tugamaguncha kanal qayta olinmaydi', async (t) => {
  const repo = createRepository(); t.after(() => repo.close()); const channel = addChannel(repo); addNews(repo);
  const publisher = new Publisher(repo, { prepare: async () => content }, fakeGateway(async () => {
    throw new GrammyError('Cheklov', { ok: false, error_code: 429, description: 'Too Many Requests', parameters: { retry_after: 4000 } }, 'sendMessage', {});
  }), logger, 'Asia/Tashkent', 48, () => now);
  await publisher.publish(channel);
  assert.equal(repo.publicationCount(channelId, '2026-11-12'), 0);
  assert.equal(repo.acquireDueChannels(now + 4000_000, 20).length, 0);
  assert.equal(repo.acquireDueChannels(now + 4001_000, 20).length, 1);
  assert.equal(repo.candidates(channelId, 0, now).length, 1);
});

test('noaniq tarmoq xatosidan so‘ng bir yangilik qayta yuborilmaydi', async (t) => {
  const repo = createRepository(); t.after(() => repo.close()); const channel = addChannel(repo); addNews(repo);
  let calls = 0;
  const publisher = new Publisher(repo, { prepare: async () => content }, fakeGateway(async () => { calls++; throw new HttpError('Tarmoq uzildi', new Error()); }), logger, 'Asia/Tashkent', 48, () => now);
  await publisher.publish(channel); await publisher.publish(channel);
  assert.equal(calls, 1); assert.equal(repo.publicationCount(channelId, '2026-11-12'), 1);
});

test('Telegram 403 xatosi kanalni o‘chiradi va rad etilgan bandni bo‘shatadi', async (t) => {
  const repo = createRepository(); t.after(() => repo.close()); const channel = addChannel(repo); addNews(repo);
  const publisher = new Publisher(repo, { prepare: async () => content }, fakeGateway(async () => {
    throw new GrammyError('Ruxsat yo‘q', { ok: false, error_code: 403, description: 'Forbidden' }, 'sendMessage', {});
  }), logger, 'Asia/Tashkent', 48, () => now);
  await publisher.publish(channel);
  assert.equal(repo.getChannel(ownerId, channelId)?.available, false);
  assert.equal(repo.getChannel(ownerId, channelId)?.enabled, false);
  assert.equal(repo.publicationCount(channelId, '2026-11-12'), 0);
});

test('LLM ishlamasa, asl tildagi yangilik yuborilmaydi', async (t) => {
  const repo = createRepository(); t.after(() => repo.close()); const channel = addChannel(repo); addNews(repo);
  let calls = 0;
  const publisher = new Publisher(repo, { prepare: async () => undefined }, fakeGateway(async () => ++calls), logger, 'Asia/Tashkent', 48, () => now);
  await publisher.publish(channel);
  assert.equal(calls, 0); assert.equal(repo.publicationCount(channelId, '2026-11-12'), 0);
});

test('LLM ishlayotgan paytda stop bosilsa, nashr amalga oshmaydi', async (t) => {
  const repo = createRepository(); t.after(() => repo.close()); const channel = addChannel(repo); addNews(repo);
  let calls = 0;
  const publisher = new Publisher(repo, { prepare: async () => { repo.setEnabled(ownerId, channelId, false); return content; } }, fakeGateway(async () => ++calls), logger, 'Asia/Tashkent', 48, () => now);
  await publisher.publish(channel); assert.equal(calls, 0);
});

test('kunlik limit to‘lsa, yangi LLM so‘rovi yuborilmaydi', async (t) => {
  const repo = createRepository(); t.after(() => repo.close()); const channel = addChannel(repo, ownerId, channelId, 1);
  addNews(repo, 'first'); addNews(repo, 'second');
  let calls = 0;
  const publisher = new Publisher(repo, { prepare: async () => { calls++; return content; } }, fakeGateway(async () => 1), logger, 'Asia/Tashkent', 48, () => now);
  await publisher.publish(channel); await publisher.publish(channel); assert.equal(calls, 1);
});
