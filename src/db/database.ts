import Database from 'better-sqlite3';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

export function openDatabase(path: string): Database.Database {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  try { migrate(db); return db; }
  catch (error) { db.close(); throw error; }
}

export function migrate(db: Database.Database): void {
  const directory = new URL('../../src/db/migrations/', import.meta.url);
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');
  db.transaction(() => {
    for (const name of readdirSync(directory).filter((file) => /^\d+.*\.sql$/.test(file)).sort()) {
      if (db.prepare('SELECT 1 FROM schema_migrations WHERE name = ?').get(name)) continue;
      db.exec(readFileSync(new URL(name, directory), 'utf8'));
      db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(name, Date.now());
    }
  }).immediate();
}
