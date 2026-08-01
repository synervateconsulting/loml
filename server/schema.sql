-- loml schema
-- Nothing in this app is ever hard-deleted. Removals set flags; edits write history rows.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS app_user (
  id            SERIAL PRIMARY KEY,
  slug          TEXT UNIQUE NOT NULL,
  display_name  TEXT NOT NULL,
  key_hash      TEXT NOT NULL,
  key_salt      TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A "share" is a question, a memory or a note. Questions get answered;
-- memories and notes get acknowledged (an optional reply). The table keeps its
-- historical `question` name; the `kind` column carries the distinction.
CREATE TABLE IF NOT EXISTS question (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asker_id      INTEGER NOT NULL REFERENCES app_user(id),
  recipient_id  INTEGER NOT NULL REFERENCES app_user(id),
  kind          TEXT NOT NULL DEFAULT 'question', -- 'question' | 'memory' | 'note'
  title         TEXT NOT NULL,
  detail        TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'open',   -- 'open' | 'answered' (answered == acknowledged)
  version       INTEGER NOT NULL DEFAULT 1,
  is_removed    BOOLEAN NOT NULL DEFAULT false, -- soft delete only
  removed_at    TIMESTAMPTZ,
  removed_by    INTEGER REFERENCES app_user(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Backfill / extend for older databases. Idempotent on boot.
ALTER TABLE question ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'question';
ALTER TABLE question DROP CONSTRAINT IF EXISTS question_kind_check;
ALTER TABLE question
  ADD CONSTRAINT question_kind_check CHECK (kind IN ('question', 'memory', 'note', 'song', 'reveal', 'this_that', 'predict', 'guess', 'wyr'));
-- 'guess' shares: after seeing the partner's guess, the author judges it.
ALTER TABLE question ADD COLUMN IF NOT EXISTS guess_verdict TEXT CHECK (guess_verdict IN ('got_it', 'close', 'missed'));
ALTER TABLE question ADD COLUMN IF NOT EXISTS link TEXT;                              -- 'song' shares
ALTER TABLE question ADD COLUMN IF NOT EXISTS artist TEXT;                            -- 'song' shares
ALTER TABLE question ADD COLUMN IF NOT EXISTS is_keepsake BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE question ADD COLUMN IF NOT EXISTS seen_at TIMESTAMPTZ;                    -- recipient saw the share
ALTER TABLE question ADD COLUMN IF NOT EXISTS seen_by INTEGER REFERENCES app_user(id);
ALTER TABLE question ADD COLUMN IF NOT EXISTS is_spicy BOOLEAN NOT NULL DEFAULT false; -- lives only in the 🔥😈🔥 tab

-- One row per saved state of a question, including the original.
CREATE TABLE IF NOT EXISTS question_version (
  id           BIGSERIAL PRIMARY KEY,
  question_id  UUID NOT NULL REFERENCES question(id),
  version      INTEGER NOT NULL,
  title        TEXT NOT NULL,
  detail       TEXT NOT NULL,
  edited_by    INTEGER REFERENCES app_user(id),
  edited_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (question_id, version)
);

CREATE TABLE IF NOT EXISTS response (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id   UUID NOT NULL REFERENCES question(id),
  responder_id  INTEGER NOT NULL REFERENCES app_user(id),
  body          TEXT NOT NULL DEFAULT '',
  version       INTEGER NOT NULL DEFAULT 1,
  is_removed    BOOLEAN NOT NULL DEFAULT false,
  removed_at    TIMESTAMPTZ,
  removed_by    INTEGER REFERENCES app_user(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE response ADD COLUMN IF NOT EXISTS seen_at TIMESTAMPTZ;                    -- asker saw the reply
ALTER TABLE response ADD COLUMN IF NOT EXISTS seen_by INTEGER REFERENCES app_user(id);

-- At most one live response per question; superseded ones stay in the table.
CREATE UNIQUE INDEX IF NOT EXISTS response_one_live_per_question
  ON response (question_id) WHERE is_removed = false;

CREATE TABLE IF NOT EXISTS response_version (
  id           BIGSERIAL PRIMARY KEY,
  response_id  UUID NOT NULL REFERENCES response(id),
  version      INTEGER NOT NULL,
  body         TEXT NOT NULL,
  edited_by    INTEGER REFERENCES app_user(id),
  edited_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (response_id, version)
);

-- Attachment bytes live in Postgres. Phase 1 has no upload UI, but the
-- endpoints and storage are live so audio/video is a front-end change only.
CREATE TABLE IF NOT EXISTS attachment (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_kind     TEXT NOT NULL CHECK (owner_kind IN ('question', 'response')),
  question_id    UUID REFERENCES question(id),
  response_id    UUID REFERENCES response(id),
  uploaded_by    INTEGER NOT NULL REFERENCES app_user(id),
  media_kind     TEXT NOT NULL,   -- 'audio' | 'video' | 'image' | 'file'
  mime_type      TEXT NOT NULL,
  file_name      TEXT,
  byte_size      INTEGER NOT NULL,
  duration_secs  NUMERIC,
  bytes          BYTEA NOT NULL,
  is_removed     BOOLEAN NOT NULL DEFAULT false,  -- hidden, still retrievable
  removed_at     TIMESTAMPTZ,
  removed_by     INTEGER REFERENCES app_user(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (owner_kind = 'question'  AND question_id IS NOT NULL AND response_id IS NULL) OR
    (owner_kind = 'response'  AND response_id IS NOT NULL AND question_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS attachment_question_idx ON attachment (question_id);
CREATE INDEX IF NOT EXISTS attachment_response_idx ON attachment (response_id);

-- Append-only trail of everything that happened.
CREATE TABLE IF NOT EXISTS activity_log (
  id           BIGSERIAL PRIMARY KEY,
  actor_id     INTEGER REFERENCES app_user(id),
  action       TEXT NOT NULL,
  entity_kind  TEXT NOT NULL,
  entity_id    TEXT NOT NULL,
  detail       JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS question_recipient_idx ON question (recipient_id, status);
CREATE INDEX IF NOT EXISTS question_asker_idx ON question (asker_id, status);

-- Web push subscriptions. One per browser/device; a person can have several.
CREATE TABLE IF NOT EXISTS push_subscription (
  id          BIGSERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES app_user(id),
  endpoint    TEXT NOT NULL UNIQUE,
  p256dh      TEXT NOT NULL,
  auth        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS push_sub_user_idx ON push_subscription (user_id);

-- A quick tap of feeling on a share or its reply. One live reaction per person
-- per thing; changing it replaces the old one.
CREATE TABLE IF NOT EXISTS reaction (
  id           BIGSERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES app_user(id),
  target_kind  TEXT NOT NULL CHECK (target_kind IN ('question', 'response', 'reveal', 'event')),
  target_id    UUID NOT NULL,   -- a reveal reaction targets the question; it means
                                -- "my reaction to the other person's blind answer"
  emoji        TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, target_kind, target_id)
);

-- Widen the target set on older databases.
ALTER TABLE reaction DROP CONSTRAINT IF EXISTS reaction_target_kind_check;
ALTER TABLE reaction
  ADD CONSTRAINT reaction_target_kind_check CHECK (target_kind IN ('question', 'response', 'reveal', 'event', 'thisthat'));

CREATE INDEX IF NOT EXISTS reaction_target_idx ON reaction (target_kind, target_id);

-- "This / That" shares: a set of binary picks. Items are the questions; each
-- person's choices stay blind until BOTH have answered every item (like a
-- 'reveal', but structured). A 'thisthat' reaction targets the question id.
CREATE TABLE IF NOT EXISTS thisthat_item (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id  UUID NOT NULL REFERENCES question(id),
  position     INTEGER NOT NULL,
  left_label   TEXT NOT NULL,
  right_label  TEXT NOT NULL,
  left_icon    TEXT NOT NULL DEFAULT '',
  right_icon   TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS thisthat_item_q_idx ON thisthat_item (question_id);

CREATE TABLE IF NOT EXISTS thisthat_answer (
  id           BIGSERIAL PRIMARY KEY,
  question_id  UUID NOT NULL REFERENCES question(id),
  item_id      UUID NOT NULL REFERENCES thisthat_item(id),
  user_id      INTEGER NOT NULL REFERENCES app_user(id),
  choice       TEXT NOT NULL CHECK (choice IN ('left', 'right')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (item_id, user_id)
);
CREATE INDEX IF NOT EXISTS thisthat_answer_q_idx ON thisthat_answer (question_id);
-- Optional one-line "why" per pick, used by Would You Rather.
ALTER TABLE thisthat_answer ADD COLUMN IF NOT EXISTS note TEXT NOT NULL DEFAULT '';

-- Running "Knowing You" points, one row per scored game (so re-reveals don't
-- double count). Couple-wide total = SUM(points).
CREATE TABLE IF NOT EXISTS game_points (
  question_id  UUID PRIMARY KEY REFERENCES question(id),
  source       TEXT NOT NULL,   -- 'predict' | 'guess'
  points       INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The daily question: both partners answer the same date-derived prompt, blind
-- until both are in. One answer per person per day.
CREATE TABLE IF NOT EXISTS daily_answer (
  id           BIGSERIAL PRIMARY KEY,
  day          DATE NOT NULL,
  user_id      INTEGER NOT NULL REFERENCES app_user(id),
  body         TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (day, user_id)
);

-- Which game prompts/templates the two of you have already played. Couple-wide
-- (this app is a single couple), keyed by a stable id like 'deck:playful:2' or
-- 'tt:food'. Presence just drives a "Played" tag; sets stay replayable.
CREATE TABLE IF NOT EXISTS game_used (
  game_key   TEXT PRIMARY KEY,
  used_by    INTEGER REFERENCES app_user(id),
  used_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Blind answers for a 'reveal' share: both people answer, neither sees the
-- other until both have. One answer per person per prompt.
CREATE TABLE IF NOT EXISTS reveal_answer (
  id           BIGSERIAL PRIMARY KEY,
  question_id  UUID NOT NULL REFERENCES question(id),
  user_id      INTEGER NOT NULL REFERENCES app_user(id),
  body         TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (question_id, user_id)
);

-- Single shared row for the two of you (the countdown, and room to grow).
CREATE TABLE IF NOT EXISTS couple_state (
  id               INTEGER PRIMARY KEY DEFAULT 1,
  countdown_title  TEXT,
  countdown_date   DATE,
  countdown_time   TIME,                          -- optional time of day
  updated_by       INTEGER REFERENCES app_user(id),
  updated_at       TIMESTAMPTZ,
  CHECK (id = 1)
);
ALTER TABLE couple_state ADD COLUMN IF NOT EXISTS countdown_time TIME;
INSERT INTO couple_state (id) VALUES (1) ON CONFLICT DO NOTHING;

-- "Thinking of you" taps. Shown once to the recipient, then marked seen.
CREATE TABLE IF NOT EXISTS nudge (
  id          BIGSERIAL PRIMARY KEY,
  from_id     INTEGER NOT NULL REFERENCES app_user(id),
  to_id       INTEGER NOT NULL REFERENCES app_user(id),
  seen        BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS nudge_to_idx ON nudge (to_id, seen);

-- Shared checklists (bucket list, watchlist, places...). Nothing hard-deleted.
CREATE TABLE IF NOT EXISTS list (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title        TEXT NOT NULL,
  created_by   INTEGER NOT NULL REFERENCES app_user(id),
  is_removed   BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS list_item (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id      UUID NOT NULL REFERENCES list(id),
  text         TEXT NOT NULL,
  created_by   INTEGER NOT NULL REFERENCES app_user(id),
  checked_by   INTEGER REFERENCES app_user(id),
  checked_at   TIMESTAMPTZ,
  is_removed   BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS list_item_list_idx ON list_item (list_id);

-- Keepsakes are now per-person: each of you keeps your own. A share can be kept
-- by one, both, or neither.
CREATE TABLE IF NOT EXISTS keepsake (
  user_id      INTEGER NOT NULL REFERENCES app_user(id),
  question_id  UUID NOT NULL REFERENCES question(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, question_id)
);

CREATE INDEX IF NOT EXISTS keepsake_q_idx ON keepsake (question_id);

-- One-time migration: the old shared flag becomes a keepsake for both people,
-- then the flag is cleared so this never runs twice.
INSERT INTO keepsake (user_id, question_id)
  SELECT u.id, q.id FROM question q CROSS JOIN app_user u WHERE q.is_keepsake = true
  ON CONFLICT DO NOTHING;
UPDATE question SET is_keepsake = false WHERE is_keepsake = true;

-- Shared couples calendar. Either person can create or edit any event.
-- starts_at is a naive wall-clock (no timezone) so both people see the same
-- time regardless of where they are; created/updated are true instants.
CREATE TABLE IF NOT EXISTS calendar_event (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind         TEXT NOT NULL CHECK (kind IN ('vacation', 'appointment', 'work_trip', 'date_night', 'other')),
  title        TEXT NOT NULL,
  starts_at    TIMESTAMP NOT NULL,
  all_day      BOOLEAN NOT NULL DEFAULT false,
  description  TEXT NOT NULL DEFAULT '',
  location     TEXT NOT NULL DEFAULT '',
  created_by   INTEGER NOT NULL REFERENCES app_user(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by   INTEGER NOT NULL REFERENCES app_user(id),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_removed   BOOLEAN NOT NULL DEFAULT false
);
ALTER TABLE calendar_event ADD COLUMN IF NOT EXISTS all_day BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS calendar_event_start_idx ON calendar_event (starts_at);

CREATE TABLE IF NOT EXISTS event_comment (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     UUID NOT NULL REFERENCES calendar_event(id),
  user_id      INTEGER NOT NULL REFERENCES app_user(id),
  body         TEXT NOT NULL,
  is_removed   BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS event_comment_event_idx ON event_comment (event_id);

-- One notification per calendar action, aimed at the other person, acknowledged
-- like a share and then filed under "acknowledged".
CREATE TABLE IF NOT EXISTS event_notification (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id         UUID NOT NULL REFERENCES calendar_event(id),
  to_id            INTEGER NOT NULL REFERENCES app_user(id),
  from_id          INTEGER NOT NULL REFERENCES app_user(id),
  action           TEXT NOT NULL CHECK (action IN ('created', 'edited', 'commented', 'reacted')),
  acknowledged     BOOLEAN NOT NULL DEFAULT false,
  acknowledged_at  TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS event_notification_to_idx ON event_notification (to_id, acknowledged);

-- The countdown is now a pointer to a calendar event.
ALTER TABLE couple_state ADD COLUMN IF NOT EXISTS countdown_event_id UUID REFERENCES calendar_event(id);

-- One-time migration: fold any existing standalone countdown into a calendar
-- event and point at it, then clear the old columns so this never runs twice.
DO $$
DECLARE cs RECORD; eid UUID;
BEGIN
  SELECT * INTO cs FROM couple_state WHERE id = 1;
  IF cs.countdown_date IS NOT NULL AND cs.countdown_event_id IS NULL THEN
    INSERT INTO calendar_event (kind, title, starts_at, all_day, created_by, updated_by)
    VALUES ('other',
            COALESCE(NULLIF(cs.countdown_title, ''), 'Countdown'),
            (cs.countdown_date + COALESCE(cs.countdown_time, TIME '00:00')),
            (cs.countdown_time IS NULL),
            COALESCE(cs.updated_by, (SELECT MIN(id) FROM app_user)),
            COALESCE(cs.updated_by, (SELECT MIN(id) FROM app_user)))
    RETURNING id INTO eid;
    UPDATE couple_state
       SET countdown_event_id = eid, countdown_title = NULL, countdown_date = NULL, countdown_time = NULL
     WHERE id = 1;
  END IF;
END $$;
