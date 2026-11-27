import 'dotenv/config';
import Database from 'better-sqlite3';
import { createPostgresPool, migratePostgres, transaction } from './postgres.js';

const tables = [
  { name: 'users', columns: ['id', 'blocked', 'created_at'], flags: ['blocked'] },
  { name: 'channels', columns: ['id', 'owner_id', 'title', 'enabled', 'available', 'daily_limit', 'topics',
    'revision', 'blocked_until', 'last_attempt_at'], flags: ['enabled', 'available'] },
  { name: 'news', columns: ['id', 'url', 'title', 'excerpt', 'source', 'published_at', 'uz_title', 'uz_summary', 'attempts', 'retry_at'], flags: [] },
  { name: 'news_keys', columns: ['key', 'news_id'], flags: [] },
  { name: 'publications', columns: ['channel_id', 'news_id', 'day', 'reserved_at', 'state', 'message_id', 'digest_id'], flags: [] },
  { name: 'bot_state', columns: ['key', 'value'], flags: [] },
];

async function main(): Promise<void> {
  const target = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!target) {
    console.error('PostgreSQL ulanishi uchun DATABASE_URL_UNPOOLED yoki DATABASE_URL qiymatini kiriting.');
    process.exitCode = 1;
    return;
  }
  const source = new Database(process.env.DATABASE_PATH ?? './data/bot.sqlite', { readonly: true, fileMustExist: true });
  const pool = createPostgresPool(target);
  try {
    const data = source.transaction(() => tables.map((table) => ({
      ...table,
      rows: source.prepare(`SELECT ${table.columns.join(', ')} FROM ${table.name}`).all() as Record<string, unknown>[],
    })))();
    await migratePostgres(pool);
    await transaction(pool, async (client) => {
      await client.query(`LOCK TABLE ${tables.map((table) => table.name).join(', ')} IN SHARE ROW EXCLUSIVE MODE`);
      for (const table of data) {
        const result = await client.query(`SELECT 1 FROM ${table.name} LIMIT 1`);
        if (result.rowCount) throw new Error('TargetNotEmpty');
      }
      for (const table of data) {
        const placeholders = table.columns.map((_, index) => `$${index + 1}`).join(', ');
        for (const row of table.rows) {
          const values = table.columns.map((column) => table.flags.includes(column) ? row[column] === 1 : row[column]);
          await client.query(`INSERT INTO ${table.name} (${table.columns.join(', ')}) VALUES (${placeholders})`, values);
        }
        console.log(`${table.name}: ${table.rows.length} ta yozuv o‘qildi.`);
      }
      await client.query(`SELECT setval(pg_get_serial_sequence('news', 'id'),
        COALESCE(MAX(id), 1), COUNT(*) > 0) FROM news`);
    });
    console.log('SQLite ma’lumotlari PostgreSQL’ga ko‘chirildi.');
  } finally {
    source.close();
    await pool.end();
  }
}

try { await main(); }
catch (error) {
  console.error(error instanceof Error && error.message === 'TargetNotEmpty'
    ? 'PostgreSQL bazasi bo‘sh emas. Mavjud ma’lumotlar o‘zgartirilmadi.'
    : 'Ko‘chirish bajarilmadi. SQLite sxemasi va PostgreSQL ulanishini tekshiring.');
  process.exitCode = 1;
}
