DROP INDEX channels_due;
ALTER TABLE channels DROP COLUMN interval_minutes;
ALTER TABLE channels DROP COLUMN next_publish_at;
ALTER TABLE channels ADD COLUMN last_attempt_at INTEGER NOT NULL DEFAULT 0;

UPDATE channels SET
  daily_limit = MIN(daily_limit, 5),
  last_attempt_at = COALESCE((SELECT MAX(reserved_at) FROM publications WHERE channel_id = channels.id), 0);

CREATE INDEX channels_due ON channels(enabled, available, daily_limit, last_attempt_at);

CREATE TRIGGER channels_daily_limit_insert
BEFORE INSERT ON channels WHEN NEW.daily_limit NOT BETWEEN 1 AND 5
BEGIN
  SELECT RAISE(ABORT, 'Kunlik limit 1 va 5 orasida bo‘lishi kerak.');
END;

CREATE TRIGGER channels_daily_limit_update
BEFORE UPDATE OF daily_limit ON channels WHEN NEW.daily_limit NOT BETWEEN 1 AND 5
BEGIN
  SELECT RAISE(ABORT, 'Kunlik limit 1 va 5 orasida bo‘lishi kerak.');
END;
