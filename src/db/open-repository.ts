import type { Config } from '../config.js';
import type { Repository } from './repository.js';
import { PostgresRepository } from './postgres-repository.js';
import { createPostgresPool, migratePostgres } from './postgres.js';

export async function openRepository(config: Config): Promise<Repository> {
  if (!config.DATABASE_URL) {
    const { openDatabase } = await import('./database.js');
    const { SqliteRepository } = await import('./sqlite-repository.js');
    return new SqliteRepository(openDatabase(config.DATABASE_PATH), config.TIMEZONE);
  }
  const pool = createPostgresPool(config.DATABASE_URL);
  const migrationPool = config.DATABASE_URL_UNPOOLED ? createPostgresPool(config.DATABASE_URL_UNPOOLED) : pool;
  try {
    await migratePostgres(migrationPool);
    return new PostgresRepository(pool, config.TIMEZONE);
  } catch (error) {
    await pool.end();
    throw error;
  } finally {
    if (migrationPool !== pool) await migrationPool.end();
  }
}
