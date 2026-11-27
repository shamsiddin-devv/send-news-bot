import { readdir, readFile } from 'node:fs/promises';
import { Pool, type PoolClient, types } from 'pg';

export function createPostgresPool(connectionString: string): Pool {
  const pool = new Pool({
    connectionString,
    max: 4,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 5_000,
    types: {
      getTypeParser(oid, format) {
        if (oid === types.builtins.INT8 && format !== 'binary') {
          return (value: string) => {
            const number = Number(value);
            if (!Number.isSafeInteger(number)) throw new Error('PostgreSQL soni xavfsiz chegaradan tashqarida.');
            return number;
          };
        }
        return types.getTypeParser(oid, format);
      },
    },
  });
  pool.on('error', () => console.warn('Bo‘sh PostgreSQL ulanishi uzildi.'));
  return pool;
}

export async function transaction<T>(pool: Pool, action: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let discard = false;
  try {
    await client.query('BEGIN');
    const result = await action(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); }
    catch { discard = true; }
    throw error;
  } finally {
    client.release(discard);
  }
}

export async function migratePostgres(pool: Pool): Promise<void> {
  const directory = new URL('../../src/db/postgres-migrations/', import.meta.url);
  const names = (await readdir(directory)).filter((file) => /^\d+.*\.sql$/.test(file)).sort();
  await transaction(pool, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(410622, 1)');
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at BIGINT NOT NULL)');
    for (const name of names) {
      const existing = await client.query('SELECT 1 FROM schema_migrations WHERE name = $1', [name]);
      if (existing.rowCount) continue;
      await client.query(await readFile(new URL(name, directory), 'utf8'));
      await client.query('INSERT INTO schema_migrations (name, applied_at) VALUES ($1, $2)', [name, Date.now()]);
    }
  });
}
