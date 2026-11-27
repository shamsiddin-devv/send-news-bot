CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  blocked INTEGER NOT NULL DEFAULT 0 CHECK (blocked IN (0, 1)),
  created_at INTEGER NOT NULL
);

CREATE TABLE channels (
  id INTEGER PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  available INTEGER NOT NULL DEFAULT 1 CHECK (available IN (0, 1)),
  interval_minutes INTEGER NOT NULL CHECK (interval_minutes BETWEEN 5 AND 1440),
  daily_limit INTEGER NOT NULL CHECK (daily_limit BETWEEN 1 AND 100),
  topics TEXT NOT NULL CHECK (json_valid(topics)),
  revision INTEGER NOT NULL DEFAULT 0,
  next_publish_at INTEGER NOT NULL
);
CREATE INDEX channels_owner ON channels(owner_id);
CREATE INDEX channels_due ON channels(enabled, available, next_publish_at);

CREATE TABLE news (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  excerpt TEXT NOT NULL,
  source TEXT NOT NULL,
  published_at INTEGER NOT NULL,
  uz_title TEXT,
  uz_summary TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  retry_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX news_recent ON news(published_at DESC);
CREATE TABLE news_keys (
  key TEXT PRIMARY KEY,
  news_id INTEGER NOT NULL REFERENCES news(id)
);

CREATE TABLE publications (
  channel_id INTEGER NOT NULL REFERENCES channels(id),
  news_id INTEGER NOT NULL REFERENCES news(id),
  day TEXT NOT NULL,
  reserved_at INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('reserved', 'sent', 'uncertain')),
  message_id INTEGER,
  PRIMARY KEY (channel_id, news_id)
);
CREATE INDEX publications_daily ON publications(channel_id, day);

CREATE TABLE bot_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL CHECK (json_valid(value))
);
