import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalUrl, dayKey } from '../src/utils/text.js';
import { matchesTopics } from '../src/services/topics.js';
import { loadConfig } from '../src/config.js';
import { CompatibleLlmWriter, validateContent } from '../src/services/llm.js';
import { NewsService } from '../src/services/news.js';
import { config, createRepository, logger, now } from './helpers.js';

const item = { url: 'https://example.com/ai', title: 'AI model released', excerpt: 'A new AI model was released to help software developers.', source: 'example.com', publishedAt: now };
const valid = { language: 'uz-Latn', title: 'Yangi sun’iy intellekt modeli taqdim etildi', sentences: ['Yangi model dasturchilar ishini yengillashtirishga mo‘ljallangan.', 'U dasturiy ta’minot yaratish jarayonida yordam beradi.'] };

test('havoladagi kuzatuv parametrlari tozalanadi, xavfli protokollar rad etiladi', () => {
  assert.equal(canonicalUrl('https://EXAMPLE.com/story/?utm_source=rss&b=2&a=1#part'), 'https://example.com/story?a=1&b=2');
  assert.equal(canonicalUrl('javascript:alert(1)'), undefined);
  assert.equal(canonicalUrl('https://user:password@example.com/'), undefined);
});

test('mavzu filtri AI harflarini boshqa so‘z ichidan topmaydi', () => {
  assert.equal(matchesTopics('AI model released', ['ai']), true);
  assert.equal(matchesTopics('The sailor said hello', ['ai']), false);
  assert.equal(matchesTopics('New smartphone launched', ['ai']), false);
  assert.equal(matchesTopics('New smartphone launched', ['gadgets']), true);
});

test('kun chegarasi Toshkent vaqtida hisoblanadi', () => {
  assert.equal(dayKey(Date.parse('2026-11-12T18:59:59Z'), 'Asia/Tashkent'), '2026-11-12');
  assert.equal(dayKey(Date.parse('2026-11-12T19:00:00Z'), 'Asia/Tashkent'), '2026-11-13');
});

test('LLM javobi 2–3 gap va lotin yozuvida bo‘lishi tekshiriladi', () => {
  assert.equal(validateContent(valid, item).summary, valid.sentences.join(' '));
  assert.throws(() => validateContent({ ...valid, sentences: [valid.sentences[0]] }, item));
  assert.throws(() => validateContent({ ...valid, title: 'Искусственный интеллект' }, item));
  assert.throws(() => validateContent({ ...valid, language: 'en' }, item));
  assert.throws(() => validateContent({ ...valid, sentences: ['Bu birinchi gap. Bu esa ikkinchi gap.', valid.sentences[1]] }, item));
});

test('manbadan uzun ko‘chirma rad etiladi', () => {
  const sentences = ['Yangi dastur foydalanuvchilarga har kuni juda ko‘p turli vazifalarni tez va oson bajarishda yaqindan yordam beradi.', 'U dasturiy ta’minot yaratish jarayonida yordam beradi.'];
  assert.throws(() => validateContent({ ...valid, sentences }, { ...item, excerpt: sentences.join(' ') }));
});

test('LLM yoqilganda kalit va model bo‘sh qolishi mumkin emas', () => {
  assert.throws(() => loadConfig({ BOT_TOKEN: config.BOT_TOKEN, RSS_FEEDS: 'https://example.com/feed', LLM_ENABLED: 'true' }));
  assert.throws(() => loadConfig({ BOT_TOKEN: config.BOT_TOKEN, RSS_FEEDS: 'file:///etc/passwd', LLM_ENABLED: 'false' }));
});

test('mos LLM provayderiga cheklangan parcha yuboriladi va javob tekshiriladi', async () => {
  let calls = 0;
  const writer = new CompatibleLlmWriter({ ...config, LLM_ENABLED: true, LLM_API_KEY: 'test-key', LLM_MODEL: 'test-model' }, async (url, init) => {
    calls++;
    assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
    const body = JSON.parse(String(init?.body)) as { messages: { content: string }[] };
    assert.deepEqual(JSON.parse(body.messages[1]?.content ?? '{}'), { title: item.title, excerpt: item.excerpt });
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(valid) } }] }));
  });
  assert.equal((await writer.summarize(item)).title, valid.title); assert.equal(calls, 1);
});

test('bitta RSS manbasi buzilsa boshqasi ishlaydi, eskirgan va mos kelmagan maqolalar olinmaydi', async (t) => {
  const repo = createRepository(); t.after(() => repo.close());
  const service = new NewsService(repo, [
    { name: 'broken', fetch: async () => { throw new Error('Sinov xatosi'); } },
    { name: 'working', fetch: async () => [item, { ...item, url: 'https://example.com/old', title: 'AI old', publishedAt: now - 100 * 3600_000 }, { ...item, url: 'https://example.com/other', title: 'Garden', excerpt: 'Growing flowers and trees.' }] },
  ], { summarize: async () => validateContent(valid, item) }, logger, 48);
  await service.ingest(now);
  assert.equal(repo.candidates(-1001, 0, now).length, 1);
});
