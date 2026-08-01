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
  ADD CONSTRAINT question_kind_check CHECK (kind IN ('question', 'memory', 'note', 'song', 'reveal'));
ALTER TABLE question ADD COLUMN IF NOT EXISTS link TEXT;                              -- 'song' shares
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
  target_kind  TEXT NOT NULL CHECK (target_kind IN ('question', 'response')),
  target_id    UUID NOT NULL,
  emoji        TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, target_kind, target_id)
);

CREATE INDEX IF NOT EXISTS reaction_target_idx ON reaction (target_kind, target_id);

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
