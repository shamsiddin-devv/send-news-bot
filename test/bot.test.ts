import test from 'node:test';
import assert from 'node:assert/strict';
import { Bot } from 'grammy';
import type { Update, UserFromGetMe } from 'grammy/types';
import { setupBot } from '../src/bot.js';
import type { BotContext } from '../src/handlers/types.js';
import type { TelegramGateway } from '../src/services/telegram.js';
import { addChannel, channelId, config, createRepository, fakeGateway, logger, ownerId } from './helpers.js';

const botInfo: UserFromGetMe = {
  id: 123456, is_bot: true, first_name: 'Sinov', username: 'sinov_bot',
  can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: false,
  can_connect_to_business: false, has_main_web_app: false,
  has_topics_enabled: false, allows_users_to_create_topics: false, can_manage_bots: false, supports_join_request_queries: false,
};
function createHarness(repo: ReturnType<typeof createRepository>, gateway = fakeGateway(async () => 1)) {
  const messages: string[] = [];
  const bot = new Bot<BotContext>(config.BOT_TOKEN, { botInfo, client: {
    apiRoot: 'http://telegram.invalid',
    fetch: async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const method = String(input).split('/').at(-1);
      const data = JSON.parse(String(init?.body)) as Record<string, unknown>;
      if (method === 'sendMessage' || method === 'editMessageText') {
        messages.push(String(data.text));
        return new Response(JSON.stringify({ ok: true, result: { message_id: messages.length, date: 1, chat: { id: data.chat_id, type: 'private' }, text: data.text } }));
      }
      assert.equal(method, 'answerCallbackQuery');
      return new Response(JSON.stringify({ ok: true, result: true }));
    },
  } });
  setupBot(bot, { ...config, LLM_ENABLED: true }, repo, logger, gateway);
  let sequence = 0;
  const send = (text: string, user = ownerId) => {
    const update: Update = {
      update_id: ++sequence,
      message: {
        message_id: sequence, date: 1, chat: { id: user, type: 'private', first_name: 'Sinov' },
        from: { id: user, is_bot: false, first_name: 'Sinov' }, text,
        ...(text.startsWith('/') ? { entities: [{ type: 'bot_command' as const, offset: 0, length: text.split(' ')[0]?.length ?? 0 }] } : {}),
      },
    };
    return bot.handleUpdate(update);
  };
  return { bot, messages, send };
}

test('kanal ulash suhbati qayta yaratilgan botda davom etadi va tekshiruv bir marta bajariladi', async (t) => {
  const repo = createRepository(); t.after(() => repo.close());
  let checks = 0;
  const gateway: TelegramGateway = { verify: async () => { checks++; return { ok: true, id: channelId, title: '<Sinov>' }; }, send: async () => 1 };
  const first = createHarness(repo, gateway);
  await first.send('/connect');
  assert.ok(repo.readState(`conversation:${ownerId}`));
  const second = createHarness(repo, gateway);
  await second.send('@sinov_kanali');
  assert.equal(repo.getChannel(ownerId, channelId)?.title, '<Sinov>');
  assert.equal(repo.getChannel(ownerId, channelId)?.enabled, false);
  assert.equal(checks, 1);
  assert.ok(second.messages.some((message) => message.includes('Kanal ulandi')));
});

test('ruxsat tekshiruvi muvaffaqiyatsiz bo‘lsa kanal saqlanmaydi', async (t) => {
  const repo = createRepository(); t.after(() => repo.close());
  const bot = createHarness(repo, { verify: async () => ({ ok: false, message: 'Ruxsat yo‘q.' }), send: async () => 1 });
  await bot.send('/connect'); await bot.send('@sinov_kanali');
  assert.equal(repo.listChannels(ownerId).length, 0);
});

test('sozlash suhbati qiymatlarni saqlaydi va begona foydalanuvchiga ochilmaydi', async (t) => {
  const repo = createRepository(); t.after(() => repo.close()); addChannel(repo);
  const bot = createHarness(repo);
  await bot.send('/settings'); await bot.send(String(channelId)); await bot.send('6');
  assert.equal(repo.getChannel(ownerId, channelId)?.dailyLimit, 5);
  await bot.send('/settings'); await bot.send(String(channelId)); await bot.send('3'); await bot.send('ai,software');
  const channel = repo.getChannel(ownerId, channelId); assert.ok(channel);
  assert.equal(channel.dailyLimit, 3); assert.deepEqual(channel.topics, ['ai', 'software']);
  await bot.send('/channels');
  assert.ok(bot.messages.at(-1)?.includes('09:00, 13:00, 17:00'));
  await bot.send('/settings', 202); await bot.send(String(channelId), 202);
  assert.ok(bot.messages.at(-1)?.includes('sizga tegishli emas'));
});

test('cancel faol suhbatni tugatadi', async (t) => {
  const repo = createRepository(); t.after(() => repo.close());
  const bot = createHarness(repo);
  await bot.send('/connect'); await bot.send('/cancel'); await bot.send('/channels');
  assert.ok(bot.messages.at(-1)?.includes('Hali kanal ulanmagan'));
});

test('soxta callback orqali begona kanalni to‘xtatib bo‘lmaydi', async (t) => {
  const repo = createRepository(); t.after(() => repo.close()); addChannel(repo);
  const harness = createHarness(repo);
  await harness.bot.handleUpdate({ update_id: 100, callback_query: {
    id: 'test', from: { id: 202, is_bot: false, first_name: 'Sinov' }, chat_instance: 'test', data: `stop:${channelId}`,
    message: { message_id: 1, date: 1, chat: { id: 202, type: 'private', first_name: 'Sinov' }, text: 'Sinov' },
  } });
  assert.equal(repo.getChannel(ownerId, channelId)?.enabled, true);
});

test('botning kanaldagi huquqi olib tashlansa kanal to‘xtaydi', async (t) => {
  const repo = createRepository(); t.after(() => repo.close()); addChannel(repo);
  const harness = createHarness(repo);
  await harness.bot.handleUpdate({ update_id: 100, my_chat_member: {
    chat: { id: channelId, type: 'channel', title: 'Sinov' }, from: { id: ownerId, is_bot: false, first_name: 'Sinov' }, date: 1,
    old_chat_member: { status: 'member', user: botInfo }, new_chat_member: { status: 'left', user: botInfo },
  } });
  assert.equal(repo.getChannel(ownerId, channelId)?.available, false);
  assert.equal(repo.getChannel(ownerId, channelId)?.enabled, false);
});

test('foydalanuvchi botni bloklasa uning kanallari to‘xtaydi', async (t) => {
  const repo = createRepository(); t.after(() => repo.close()); addChannel(repo);
  const harness = createHarness(repo);
  await harness.bot.handleUpdate({ update_id: 100, my_chat_member: {
    chat: { id: ownerId, type: 'private', first_name: 'Sinov' }, from: { id: ownerId, is_bot: false, first_name: 'Sinov' }, date: 1,
    old_chat_member: { status: 'member', user: botInfo }, new_chat_member: { status: 'kicked', user: botInfo, until_date: 0 },
  } });
  assert.equal(repo.getChannel(ownerId, channelId)?.enabled, false);
});
