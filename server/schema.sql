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

-- Backfill for databases created before `kind` existed. Idempotent on boot.
ALTER TABLE question ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'question';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'question_kind_check') THEN
    ALTER TABLE question
      ADD CONSTRAINT question_kind_check CHECK (kind IN ('question', 'memory', 'note'));
  END IF;
END $$;

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
