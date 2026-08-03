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
-- A share with attachments is created as a draft (hidden, no push) so its photo
-- can upload first; "finalize" flips it live. Never shared without its photo.
ALTER TABLE question ADD COLUMN IF NOT EXISTS is_draft BOOLEAN NOT NULL DEFAULT false;
-- Sweep drafts abandoned mid-upload (never finalized) so they don't linger.
UPDATE question SET is_removed = true
  WHERE is_draft = true AND is_removed = false AND created_at < now() - INTERVAL '24 hours';

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

-- Attachments can live in object storage (R2) instead of Postgres bytea. `bytes`
-- is nullable once a row is stored in R2; `storage` says where the file is.
ALTER TABLE attachment ADD COLUMN IF NOT EXISTS storage TEXT NOT NULL DEFAULT 'db'; -- 'db' | 'r2'
ALTER TABLE attachment ADD COLUMN IF NOT EXISTS storage_key TEXT;                   -- R2 object key
ALTER TABLE attachment ALTER COLUMN bytes DROP NOT NULL;
-- Cross-platform transcode: videos get a web-friendly H.264 MP4 alongside the
-- original. Served in place of the original once done.
ALTER TABLE attachment ADD COLUMN IF NOT EXISTS transcode_status TEXT NOT NULL DEFAULT 'none'; -- none|pending|done|failed
ALTER TABLE attachment ADD COLUMN IF NOT EXISTS web_key TEXT;
ALTER TABLE attachment ADD COLUMN IF NOT EXISTS web_mime TEXT;

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
  ADD CONSTRAINT reaction_target_kind_check CHECK (target_kind IN ('question', 'response', 'reveal', 'event', 'thisthat', 'list'));

CREATE INDEX IF NOT EXISTS reaction_target_idx ON reaction (target_kind, target_id);

-- Free-form comments on a completed game (reveal / this_that / predict / wyr /
-- guess). Either partner can add as many as they like once it's revealed — this
-- is separate from their blind answer, which stays locked.
CREATE TABLE IF NOT EXISTS question_comment (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id  UUID NOT NULL REFERENCES question(id),
  user_id      INTEGER NOT NULL REFERENCES app_user(id),
  body         TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS question_comment_q_idx ON question_comment (question_id);

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

-- Audit trail for the admin console's hard deletes (records the action, not the
-- purged data itself).
CREATE TABLE IF NOT EXISTS admin_action (
  id          BIGSERIAL PRIMARY KEY,
  action      TEXT NOT NULL,
  target      TEXT,
  detail      JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
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

-- Reactions and comments on a day's revealed daily question. Keyed by day (the
-- daily question isn't a `question` row). One live reaction per person per day;
-- comments are free-form and unlimited, added once both have answered.
CREATE TABLE IF NOT EXISTS daily_reaction (
  day          DATE NOT NULL,
  user_id      INTEGER NOT NULL REFERENCES app_user(id),
  emoji        TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (day, user_id)
);
CREATE TABLE IF NOT EXISTS daily_comment (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  day          DATE NOT NULL,
  user_id      INTEGER NOT NULL REFERENCES app_user(id),
  body         TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS daily_comment_day_idx ON daily_comment (day);

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

-- Lists are typed (Activities / Couple Goals / To-Do / Other) and remember who
-- last edited them. Existing lists default to 'other'.
ALTER TABLE list ADD COLUMN IF NOT EXISTS list_type TEXT NOT NULL DEFAULT 'other';
ALTER TABLE list ADD COLUMN IF NOT EXISTS last_edited_by INTEGER REFERENCES app_user(id);
ALTER TABLE list ADD COLUMN IF NOT EXISTS last_edited_at TIMESTAMPTZ;
ALTER TABLE list DROP CONSTRAINT IF EXISTS list_type_check;
ALTER TABLE list ADD CONSTRAINT list_type_check
  CHECK (list_type IN ('activities', 'couple_goals', 'to_do', 'other'));

-- Item completion now tracks the LAST state change (done or undone) with who and
-- when — state_at is null until an item has ever been toggled. checked_by /
-- checked_at are kept only as the source for the one-time migration below.
ALTER TABLE list_item ADD COLUMN IF NOT EXISTS is_done BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE list_item ADD COLUMN IF NOT EXISTS state_by INTEGER REFERENCES app_user(id);
ALTER TABLE list_item ADD COLUMN IF NOT EXISTS state_at TIMESTAMPTZ;
-- Idempotent: only migrates legacy checked rows that the new system hasn't
-- touched yet (state_at still null). Once toggled, state_at is set and this
-- no-ops. Never-checked rows (checked_at null) stay is_done=false / state_at null.
UPDATE list_item SET is_done = true, state_by = checked_by, state_at = checked_at
  WHERE state_at IS NULL AND checked_at IS NOT NULL;

-- Comments on a whole list (reactions ride on the shared `reaction` table with
-- target_kind 'list'). Free-form, unlimited, either partner.
CREATE TABLE IF NOT EXISTS list_comment (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id      UUID NOT NULL REFERENCES list(id),
  user_id      INTEGER NOT NULL REFERENCES app_user(id),
  body         TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS list_comment_list_idx ON list_comment (list_id);

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

-- Comments are editable in place; edited_at is null until first edited.
ALTER TABLE question_comment ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
ALTER TABLE daily_comment ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
ALTER TABLE list_comment ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
ALTER TABLE event_comment ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;

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

-- A date request: one partner proposes a date (title + optional description /
-- location, no time yet); the other picks a date & time to accept it, which
-- creates the calendar event (event_id). Declined/cancelled requests are
-- soft-removed. Nothing is hard-deleted.
CREATE TABLE IF NOT EXISTS date_request (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id INTEGER NOT NULL REFERENCES app_user(id),
  recipient_id INTEGER NOT NULL REFERENCES app_user(id),
  title        TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  location     TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled')),
  event_id     UUID REFERENCES calendar_event(id),
  responded_by INTEGER REFERENCES app_user(id),
  responded_at TIMESTAMPTZ,
  is_removed   BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS date_request_people_idx ON date_request (requester_id, recipient_id);

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

/* ============================================================================
   Groundwork: one generic comment table, universal reactions, polymorphic
   attachment ownership. Migrations are idempotent (copy, reuse ids) and leave
   the legacy tables/columns intact as a backup — a later cleanup drops them.
   ========================================================================== */

-- One comment table for every commentable thing. target_id is TEXT so it holds
-- UUIDs (shares/lists/events) and the daily question's day string alike.
CREATE TABLE IF NOT EXISTS comment (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type  TEXT NOT NULL,   -- 'question' | 'daily' | 'list' | 'event' | (future)
  target_id    TEXT NOT NULL,
  user_id      INTEGER NOT NULL REFERENCES app_user(id),
  body         TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  edited_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS comment_target_idx ON comment (target_type, target_id);

-- Copy the four legacy comment tables in (reusing ids → safe to re-run).
INSERT INTO comment (id, target_type, target_id, user_id, body, created_at, edited_at)
  SELECT id, 'question', question_id::text, user_id, body, created_at, edited_at FROM question_comment
  ON CONFLICT (id) DO NOTHING;
INSERT INTO comment (id, target_type, target_id, user_id, body, created_at, edited_at)
  SELECT id, 'daily', to_char(day, 'YYYY-MM-DD'), user_id, body, created_at, edited_at FROM daily_comment
  ON CONFLICT (id) DO NOTHING;
INSERT INTO comment (id, target_type, target_id, user_id, body, created_at, edited_at)
  SELECT id, 'list', list_id::text, user_id, body, created_at, edited_at FROM list_comment
  ON CONFLICT (id) DO NOTHING;
INSERT INTO comment (id, target_type, target_id, user_id, body, created_at, edited_at)
  SELECT id, 'event', event_id::text, user_id, body, created_at, edited_at FROM event_comment
  ON CONFLICT (id) DO NOTHING;

-- Reactions become universal: target_id widens to TEXT so day-keyed daily
-- reactions live in the same table, and the kind check is permissive.
ALTER TABLE reaction ALTER COLUMN target_id TYPE TEXT;
ALTER TABLE reaction DROP CONSTRAINT IF EXISTS reaction_target_kind_check;
ALTER TABLE reaction
  ADD CONSTRAINT reaction_target_kind_check
  CHECK (target_kind IN ('question', 'response', 'reveal', 'event', 'thisthat', 'list', 'daily'));
-- Fold daily_reaction into the reaction table (day as the text target_id).
INSERT INTO reaction (user_id, target_kind, target_id, emoji, created_at)
  SELECT user_id, 'daily', to_char(day, 'YYYY-MM-DD'), emoji, created_at FROM daily_reaction
  ON CONFLICT (user_id, target_kind, target_id) DO NOTHING;

-- Attachments get a polymorphic owner so capsules/albums/etc. can own files.
-- Legacy question_id/response_id stay populated as a backup.
ALTER TABLE attachment ADD COLUMN IF NOT EXISTS owner_id UUID;
UPDATE attachment SET owner_id = COALESCE(question_id, response_id) WHERE owner_id IS NULL;
-- Drop the rigid legacy checks (owner_kind IN (...) and the question/response
-- exclusivity) and require an owner_id instead. owner_kind is app-validated.
DO $$
DECLARE c text;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint WHERE conrelid = 'attachment'::regclass AND contype = 'c' LOOP
    EXECUTE 'ALTER TABLE attachment DROP CONSTRAINT ' || quote_ident(c);
  END LOOP;
END $$;
ALTER TABLE attachment ADD CONSTRAINT attachment_owner_present CHECK (owner_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS attachment_owner_idx ON attachment (owner_kind, owner_id);

-- Coupon book: redeemable favors one partner gives the other. Redeeming awards
-- Knowing-You points (computed live in scoring.js). Soft-delete only.
CREATE TABLE IF NOT EXISTS coupon (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_id      INTEGER NOT NULL REFERENCES app_user(id),
  to_id        INTEGER NOT NULL REFERENCES app_user(id),
  title        TEXT NOT NULL,
  note         TEXT NOT NULL DEFAULT '',
  icon         TEXT NOT NULL DEFAULT '🎟️',
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'redeemed', 'revoked')),
  redeemed_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_removed   BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS coupon_people_idx ON coupon (from_id, to_id);

-- Gratitude ritual: a directed daily appreciation (from → to). A wall; the
-- streak is per-person (consecutive days you added one).
CREATE TABLE IF NOT EXISTS gratitude (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_id      INTEGER NOT NULL REFERENCES app_user(id),
  to_id        INTEGER NOT NULL REFERENCES app_user(id),
  day          DATE NOT NULL,
  body         TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_removed   BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS gratitude_day_idx ON gratitude (day);

-- Weekly check-in: both answer a few prompts privately, revealed once both are
-- in (the daily-question mechanic, weekly). week_start is that week's Sunday.
CREATE TABLE IF NOT EXISTS checkin (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  week_start   DATE NOT NULL UNIQUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS checkin_answer (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checkin_id   UUID NOT NULL REFERENCES checkin(id),
  user_id      INTEGER NOT NULL REFERENCES app_user(id),
  prompt_key   TEXT NOT NULL,
  body         TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (checkin_id, user_id, prompt_key)
);

-- Couple bingo. A completed line awards +5 (once per board), a full card +25
-- (once) — tracked by the awarded flags. Squares record who marked them.
CREATE TABLE IF NOT EXISTS bingo_board (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title         TEXT NOT NULL,
  size          INTEGER NOT NULL DEFAULT 5,
  created_by    INTEGER REFERENCES app_user(id),
  awarded_row   BOOLEAN NOT NULL DEFAULT false,
  awarded_full  BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_removed    BOOLEAN NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS bingo_square (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id  UUID NOT NULL REFERENCES bingo_board(id),
  position  INTEGER NOT NULL,
  text      TEXT NOT NULL,
  done_by   INTEGER REFERENCES app_user(id),
  done_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS bingo_square_board_idx ON bingo_square (board_id);

-- Time capsules. A sealed letter (with optional media) to open together on a
-- future date. Content stays hidden until unlock_on arrives AND someone opens
-- it (a small ceremony). `notified` guards the one-time "ready to open" push.
-- Media rides along as polymorphic attachments (owner_kind = 'capsule'), served
-- only once opened_at is set.
CREATE TABLE IF NOT EXISTS capsule (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by  INTEGER REFERENCES app_user(id),
  title       TEXT NOT NULL,
  body        TEXT NOT NULL DEFAULT '',
  unlock_on   DATE NOT NULL,
  opened_at   TIMESTAMPTZ,
  opened_by   INTEGER REFERENCES app_user(id),
  notified    BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_removed  BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS capsule_unlock_idx ON capsule (unlock_on);
