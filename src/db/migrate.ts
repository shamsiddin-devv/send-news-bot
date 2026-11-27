import 'dotenv/config';
import { openDatabase } from './database.js';
import { createPostgresPool, migratePostgres } from './postgres.js';

try {
  const target = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (target) {
    const pool = createPostgresPool(target);
    try { await migratePostgres(pool); }
    finally { await pool.end(); }
  } else {
    openDatabase(process.env.DATABASE_PATH ?? './data/bot.sqlite').close();
  }
  console.log('Ma’lumotlar bazasi migratsiyalari bajarildi.');
} catch {
  console.error('Migratsiya bajarilmadi. Baza ulanishi va ruxsatlarni tekshiring.');
  process.exitCode = 1;
}
