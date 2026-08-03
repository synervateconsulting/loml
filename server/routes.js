import express from 'express';
import multer from 'multer';
import { query, keyMatches, logActivity, pool } from './db.js';
import { startSession, endSession, requireUser, partnerOf } from './auth.js';
import { publicKey, saveSubscription, notify } from './push.js';
import { promptForDay, appToday } from './daily.js';
import { WEEKLY_PROMPTS, WEEKLY_KEYS, weekStart } from './rituals.js';
import {
  pickPoints,
  guessPoints,
  revealPoints,
  maxPointsFor,
  SCORE_LEGEND,
  computeDailyScore,
  computeCouponScore,
  computeBingoScore,
  knowingTotal,
} from './scoring.js';
import {
  r2Enabled,
  newOriginalKey,
  presignPut,
  presignGet,
  headObject,
  createMultipart,
  presignUploadPart,
  completeMultipart,
  abortMultipart,
} from './storage.js';

// Copy for the push banners.
const newShareTitle = (name, kind) =>
  ({
    memory: `${name} shared a memory`,
    note: `${name} left you a note`,
    song: `${name} shared a song`,
    reveal: `${name} wants to answer something together`,
  })[kind] || `${name} asked you something`;

const replyTitle = (name, kind) =>
  kind === 'question' ? `${name} answered` : `${name} acknowledged your ${kind}`;

// Spicy pushes never reveal content — no title/body preview on the lock screen.
const discreetShare = (name) => ({ title: `${name} sent you something 🔥`, body: '' });
const discreetReply = (name) => ({ title: `${name} replied 🔥`, body: '' });

const EVENT_KINDS = ['vacation', 'appointment', 'work_trip', 'date_night', 'other'];
const EVENT_VERB = { created: 'added', edited: 'updated', commented: 'commented on', reacted: 'reacted to' };

// Tell the other person about a calendar action, and push it.
async function notifyEvent(eventId, actor, action, eventTitle) {
  const partner = await partnerOf(actor.id);
  if (!partner) return;
  await query('INSERT INTO event_notification (event_id, to_id, from_id, action) VALUES ($1, $2, $3, $4)', [
    eventId,
    partner.id,
    actor.id,
    action,
  ]);
  notify(partner.id, { title: `${actor.name} ${EVENT_VERB[action] || 'updated'} an event`, body: eventTitle });
}

const router = express.Router();

// Express 4 does not catch rejected promises from async handlers. Wrap them all.
for (const method of ['get', 'post', 'patch']) {
  const original = router[method].bind(router);
  router[method] = (path, ...handlers) =>
    original(
      path,
      ...handlers.map((h) => (req, res, next) => Promise.resolve(h(req, res, next)).catch(next))
    );
}

const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 60);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
});

const publicUser = (u) => (u ? { id: u.id, slug: u.slug, name: u.display_name } : null);

function mediaKindFor(mime = '') {
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('image/')) return 'image';
  return 'file';
}

// Browsers sometimes hand us a useless Content-Type for a recorded blob
// (empty, octet-stream, or even text/plain), which would strand a real video
// as a download link. When the mime is generic we fall back to the extension.
const GENERIC_MIME = new Set(['', 'text/plain', 'application/octet-stream', 'binary/octet-stream']);

const EXT_MEDIA = {
  webm: ['video', 'video/webm'], // audio-only .webm normally arrives correctly tagged
  mp4: ['video', 'video/mp4'],
  m4v: ['video', 'video/mp4'],
  mov: ['video', 'video/quicktime'],
  ogv: ['video', 'video/ogg'],
  m4a: ['audio', 'audio/mp4'],
  mp3: ['audio', 'audio/mpeg'],
  wav: ['audio', 'audio/wav'],
  aac: ['audio', 'audio/aac'],
  oga: ['audio', 'audio/ogg'],
  ogg: ['audio', 'audio/ogg'],
  opus: ['audio', 'audio/ogg'],
  weba: ['audio', 'audio/webm'],
  jpg: ['image', 'image/jpeg'],
  jpeg: ['image', 'image/jpeg'],
  png: ['image', 'image/png'],
  gif: ['image', 'image/gif'],
  webp: ['image', 'image/webp'],
  heic: ['image', 'image/heic'],
};

function guessFromName(name = '') {
  const ext = (name.split('.').pop() || '').toLowerCase();
  const hit = EXT_MEDIA[ext];
  return hit ? { kind: hit[0], mime: hit[1] } : null;
}

const isGeneric = (mime) => GENERIC_MIME.has(mime || '');

// The kind/mime a client should actually use, correcting a generic upload mime
// against the file name.
function effectiveMedia({ mime_type, media_kind, file_name }) {
  const guess = guessFromName(file_name);
  const mime = isGeneric(mime_type) && guess ? guess.mime : mime_type;
  let kind = media_kind && media_kind !== 'file' ? media_kind : mediaKindFor(mime);
  if (kind === 'file' && guess) kind = guess.kind;
  return { mime, kind };
}

/* ---------------------------------------------------------------- session */

router.post('/login', async (req, res) => {
  const key = (req.body?.accessKey || '').trim();
  if (!key) return res.status(400).json({ error: 'Enter your access key.' });

  const { rows } = await query('SELECT * FROM app_user ORDER BY id');
  const user = rows.find((u) => keyMatches(key, u.key_hash, u.key_salt));
  if (!user) return res.status(401).json({ error: "That key doesn't match either profile." });

  startSession(res, user);
  await logActivity(user.id, 'signed_in', 'user', user.id);
  res.json({ me: publicUser(user), partner: publicUser(await partnerOf(user.id)) });
});

router.post('/logout', (req, res) => {
  endSession(res);
  res.json({ ok: true });
});

router.get('/me', async (req, res) => {
  if (!req.user) return res.json({ me: null, partner: null });
  res.json({ me: publicUser(req.user), partner: publicUser(await partnerOf(req.user.id)) });
});

/* ------------------------------------------------------------------- push */

router.get('/push/key', (_req, res) => res.json({ key: publicKey() }));

router.post('/push/subscribe', requireUser, async (req, res) => {
  const ok = await saveSubscription(req.user.id, req.body);
  if (!ok) return res.status(400).json({ error: 'Bad subscription.' });
  res.status(201).json({ ok: true });
});

/* -------------------------------------------------------------- questions */

const SHARE_KINDS = ['question', 'memory', 'note', 'song', 'reveal', 'this_that', 'predict', 'guess', 'wyr'];
// Kinds built on binary pick items (this_that grid): both answer, reveal when
// both have. 'predict' = the partner guesses the author's picks; 'wyr' adds a
// "why" note per pick.
const PICK_KINDS = ['this_that', 'predict', 'wyr'];

const QUESTION_SELECT = `
  SELECT q.id, q.kind, q.title, q.detail, q.link, q.artist, q.status, q.version,
         q.is_keepsake, q.is_spicy, q.seen_at, q.created_at, q.updated_at,
         q.asker_id, q.recipient_id,
         asker.display_name  AS asker_name,
         recip.display_name  AS recipient_name,
         r.id AS response_id, r.body AS response_body, r.version AS response_version,
         r.created_at AS response_created_at, r.updated_at AS response_updated_at,
         r.responder_id, r.seen_at AS response_seen_at
    FROM question q
    JOIN app_user asker ON asker.id = q.asker_id
    JOIN app_user recip ON recip.id = q.recipient_id
    LEFT JOIN response r ON r.question_id = q.id AND r.is_removed = false
   WHERE q.is_removed = false AND q.is_draft = false
`;

async function attachmentsFor(questionIds, responseIds) {
  if (!questionIds.length && !responseIds.length) return [];
  const { rows } = await query(
    `SELECT id, owner_kind, owner_id, media_kind, mime_type,
            file_name, byte_size, duration_secs, is_removed, created_at, transcode_status
       FROM attachment
      WHERE (owner_kind = 'question' AND owner_id = ANY($1::uuid[]))
         OR (owner_kind = 'response' AND owner_id = ANY($2::uuid[]))
      ORDER BY created_at`,
    [questionIds, responseIds]
  );
  // Correct any generically-typed rows so the client renders the right player.
  return rows.map((a) => {
    const { mime, kind } = effectiveMedia(a);
    return kind === a.media_kind && mime === a.mime_type
      ? a
      : { ...a, media_kind: kind, mime_type: mime };
  });
}

async function reactionsFor(questionIds, responseIds) {
  if (!questionIds.length && !responseIds.length) return [];
  const { rows } = await query(
    `SELECT user_id, target_kind, target_id, emoji FROM reaction
      WHERE (target_kind IN ('question', 'reveal', 'thisthat') AND target_id = ANY($1::text[]))
         OR (target_kind = 'response' AND target_id = ANY($2::text[]))`,
    [questionIds.map(String), responseIds.map(String)]
  );
  return rows;
}

async function revealAnswersFor(questionIds) {
  if (!questionIds.length) return [];
  const { rows } = await query(
    'SELECT question_id, user_id, body FROM reveal_answer WHERE question_id = ANY($1::uuid[])',
    [questionIds]
  );
  return rows;
}

async function thisThatItemsFor(questionIds) {
  if (!questionIds.length) return [];
  const { rows } = await query(
    `SELECT id, question_id, position, left_label, right_label, left_icon, right_icon
       FROM thisthat_item WHERE question_id = ANY($1::uuid[]) ORDER BY position`,
    [questionIds]
  );
  return rows;
}

async function thisThatAnswersFor(questionIds) {
  if (!questionIds.length) return [];
  const { rows } = await query(
    'SELECT question_id, item_id, user_id, choice, note FROM thisthat_answer WHERE question_id = ANY($1::uuid[])',
    [questionIds]
  );
  return rows;
}

async function pointsFor(questionIds) {
  if (!questionIds.length) return {};
  const { rows } = await query('SELECT question_id, points FROM game_points WHERE question_id = ANY($1::uuid[])', [
    questionIds,
  ]);
  return Object.fromEntries(rows.map((r) => [r.question_id, r.points]));
}

async function keepersFor(questionIds) {
  if (!questionIds.length) return [];
  const { rows } = await query(
    'SELECT question_id, user_id FROM keepsake WHERE question_id = ANY($1::uuid[])',
    [questionIds]
  );
  return rows;
}

// Generic comments (one table for every commentable thing). Load comments for a
// set of targets of one type; `ids` are strings (UUIDs or the daily day-string).
async function commentsForTargets(targetType, ids) {
  if (!ids.length) return [];
  const { rows } = await query(
    `SELECT c.id, c.target_id, c.user_id, c.body, c.created_at, c.edited_at, u.display_name
       FROM comment c JOIN app_user u ON u.id = c.user_id
      WHERE c.target_type = $1 AND c.target_id = ANY($2::text[]) ORDER BY c.created_at ASC`,
    [targetType, ids.map(String)]
  );
  return rows;
}

const shapeComment = (c) => ({
  id: c.id,
  userId: c.user_id,
  userName: c.display_name,
  body: c.body,
  createdAt: c.created_at,
  editedAt: c.edited_at,
});

// Comments filtered from a preloaded set to one target id.
const commentsOn = (comments, targetId) =>
  (comments || []).filter((c) => c.target_id === String(targetId)).map(shapeComment);

const reactionsOn = (reactions, kind, id) =>
  reactions
    .filter((x) => x.target_kind === kind && x.target_id === String(id))
    .map((x) => ({ userId: x.user_id, emoji: x.emoji }));

// Load reactions for a set of same-kind targets (ids as strings).
async function reactionsForTargets(targetKind, ids) {
  if (!ids.length) return [];
  const { rows } = await query(
    'SELECT user_id, target_id, emoji FROM reaction WHERE target_kind = $1 AND target_id = ANY($2::text[])',
    [targetKind, ids.map(String)]
  );
  return rows;
}

function shapeQuestion(row, ctx) {
  const { attachments, reactions, revealAnswers, thisThatItems, thisThatAnswers, keepers, viewerId, partnerId } = ctx;
  const qAtt = attachments.filter((a) => a.owner_kind === 'question' && a.owner_id === row.id);
  const rAtt = attachments.filter((a) => row.response_id && a.owner_kind === 'response' && a.owner_id === row.response_id);

  // Pick games (this_that / predict / wyr): a set of binary items, blind until
  // both answer every item. For 'predict' the recipient's answers are guesses
  // at the asker's picks; the "score" is how many matched.
  let thisThat = null;
  if (PICK_KINDS.includes(row.kind)) {
    const items = (thisThatItems || [])
      .filter((it) => it.question_id === row.id)
      .map((it) => ({
        id: it.id,
        position: it.position,
        leftLabel: it.left_label,
        rightLabel: it.right_label,
        leftIcon: it.left_icon || '',
        rightIcon: it.right_icon || '',
      }));
    const answers = (thisThatAnswers || []).filter((a) => a.question_id === row.id);
    const n = items.length;
    const countFor = (uid) => answers.filter((a) => a.user_id === uid).length;
    const iAnswered = n > 0 && countFor(viewerId) === n;
    const revealed = n > 0 && countFor(row.asker_id) === n && countFor(row.recipient_id) === n;
    const mapFor = (uid) => {
      const m = {};
      answers.filter((a) => a.user_id === uid).forEach((a) => (m[a.item_id] = a.choice));
      return m;
    };
    const notesFor = (uid) => {
      const m = {};
      answers.filter((a) => a.user_id === uid && a.note).forEach((a) => (m[a.item_id] = a.note));
      return m;
    };
    const askerMap = mapFor(row.asker_id);
    const recipMap = mapFor(row.recipient_id);
    const matches = revealed ? items.filter((it) => askerMap[it.id] && askerMap[it.id] === recipMap[it.id]).length : 0;
    thisThat = {
      items,
      revealed,
      iAnswered,
      myAnswers: mapFor(viewerId),
      myNotes: notesFor(viewerId),
      askerAnswers: revealed ? askerMap : null,
      recipientAnswers: revealed ? recipMap : null,
      askerNotes: revealed ? notesFor(row.asker_id) : null,
      recipientNotes: revealed ? notesFor(row.recipient_id) : null,
      matches,
      points: ctx.pointsByQ?.[row.id] ?? null,
      reactions: revealed ? reactionsOn(reactions, 'thisthat', row.id) : [],
    };
  }

  // Guess My Answer: the author answers an open prompt; the partner types a
  // guess. Once the partner guesses, both see both, and the author judges it.
  let guess = null;
  if (row.kind === 'guess') {
    const answers = revealAnswers.filter((a) => a.question_id === row.id);
    const iAmAsker = viewerId === row.asker_id;
    const mine = answers.find((a) => a.user_id === viewerId);
    const byAsker = answers.find((a) => a.user_id === row.asker_id);
    const byRecip = answers.find((a) => a.user_id === row.recipient_id);
    const revealed = Boolean(byRecip); // once the guesser has guessed
    guess = {
      revealed,
      iAmAsker,
      iAnswered: iAmAsker ? true : Boolean(byRecip),
      prompt: row.title,
      myBody: mine ? mine.body : '',
      truthBody: iAmAsker || revealed ? byAsker?.body ?? '' : null,
      guessBody: revealed ? byRecip?.body ?? '' : null,
      verdict: row.guess_verdict || null,
      canJudge: iAmAsker && revealed && !row.guess_verdict,
      points: ctx.pointsByQ?.[row.id] ?? null,
      reactions: revealed ? reactionsOn(reactions, 'reveal', row.id) : [],
    };
  }

  // Reveal prompts: the partner's blind answer stays hidden until both are in.
  let reveal = null;
  if (row.kind === 'reveal') {
    const answers = revealAnswers.filter((a) => a.question_id === row.id);
    const mine = answers.find((a) => a.user_id === viewerId);
    const revealed = answers.length >= 2;
    const byAsker = answers.find((a) => a.user_id === row.asker_id);
    const byRecip = answers.find((a) => a.user_id === row.recipient_id);
    reveal = {
      revealed,
      iAnswered: Boolean(mine),
      myBody: mine ? mine.body : '',
      askerBody: revealed ? byAsker?.body ?? '' : null,
      recipientBody: revealed ? byRecip?.body ?? '' : null,
      // Reactions to the blind answers (each is "reactor → the OTHER's answer").
      reactions: revealed ? reactionsOn(reactions, 'reveal', row.id) : [],
    };
  }

  return {
    id: row.id,
    kind: row.kind || 'question',
    title: row.title,
    detail: row.detail,
    link: row.link || null,
    artist: row.artist || null,
    status: row.status,
    version: row.version,
    isSpicy: row.is_spicy,
    keptByMe: keepers.some((k) => k.question_id === row.id && k.user_id === viewerId),
    keptByPartner: keepers.some((k) => k.question_id === row.id && k.user_id === partnerId),
    seenAt: row.seen_at,
    reveal,
    thisThat,
    guess,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    askerId: row.asker_id,
    askerName: row.asker_name,
    recipientId: row.recipient_id,
    recipientName: row.recipient_name,
    reactions: reactionsOn(reactions, 'question', row.id),
    // Free-form comments — only games carry them (loaded for game ids only).
    comments: commentsOn(ctx.comments, row.id),
    attachments: qAtt.filter((a) => !a.is_removed),
    removedAttachmentCount: qAtt.filter((a) => a.is_removed).length,
    response: row.response_id
      ? {
          id: row.response_id,
          body: row.response_body,
          version: row.response_version,
          createdAt: row.response_created_at,
          updatedAt: row.response_updated_at,
          responderId: row.responder_id,
          seenAt: row.response_seen_at,
          reactions: reactionsOn(reactions, 'response', row.response_id),
          attachments: rAtt.filter((a) => !a.is_removed),
          removedAttachmentCount: rAtt.filter((a) => a.is_removed).length,
        }
      : null,
  };
}

// Everything the signed-in person can see, in one call.
router.get('/questions', requireUser, async (req, res) => {
  const { rows } = await query(
    `${QUESTION_SELECT} AND (q.asker_id = $1 OR q.recipient_id = $1)
     ORDER BY q.created_at DESC`,
    [req.user.id]
  );
  const qIds = rows.map((r) => r.id);
  const rIds = rows.filter((r) => r.response_id).map((r) => r.response_id);
  const ttIds = rows.filter((r) => PICK_KINDS.includes(r.kind)).map((r) => r.id);
  const blindIds = rows.filter((r) => r.kind === 'reveal' || r.kind === 'guess').map((r) => r.id);
  const scoredIds = rows.filter((r) => r.kind === 'predict' || r.kind === 'guess').map((r) => r.id);
  const [attachments, reactions, revealAnswers, thisThatItems, thisThatAnswers, pointsByQ, keepers, comments, partner] = await Promise.all([
    attachmentsFor(qIds, rIds),
    reactionsFor(qIds, rIds),
    revealAnswersFor(blindIds),
    thisThatItemsFor(ttIds),
    thisThatAnswersFor(ttIds),
    pointsFor(scoredIds),
    keepersFor(qIds),
    commentsForTargets('question', qIds), // comments can live on any finished share
    partnerOf(req.user.id),
  ]);
  const ctx = { attachments, reactions, revealAnswers, thisThatItems, thisThatAnswers, pointsByQ, keepers, comments, viewerId: req.user.id, partnerId: partner?.id };
  const shaped = rows.map((r) => shapeQuestion(r, ctx));
  res.json({
    asked: shaped.filter((q) => q.askerId === req.user.id),
    received: shaped.filter((q) => q.recipientId === req.user.id),
  });
});

router.post('/questions', requireUser, async (req, res) => {
  const title = (req.body?.title || '').trim();
  const detail = (req.body?.detail || '').trim();
  const link = (req.body?.link || '').trim();
  const artist = (req.body?.artist || '').trim();
  const revealAnswer = (req.body?.answer || '').trim(); // the asker's own blind answer
  const spicy = Boolean(req.body?.spicy);
  const usedKey = (req.body?.usedKey || '').trim().slice(0, 120); // deck prompt / template it came from
  const kind = SHARE_KINDS.includes(req.body?.kind) ? req.body.kind : 'question';
  // A share carrying attachments is created hidden (draft); the client uploads
  // the file(s), then calls /finalize to actually send it. This guarantees a
  // share is never delivered without its attachment.
  const draft = Boolean(req.body?.draft);
  if (!title) return res.status(400).json({ error: 'Give it a title.' });
  if (kind === 'song' && !/^https?:\/\//i.test(link))
    return res.status(400).json({ error: 'Paste a link to the song.' });

  // Pick games (this_that / predict / wyr): >=3 binary items; the asker answers
  // their own side up front (blind), like a reveal. 'wyr' allows a "why" note.
  let ttItems = null;
  if (PICK_KINDS.includes(kind)) {
    const raw = Array.isArray(req.body?.items) ? req.body.items : [];
    ttItems = raw.slice(0, 20).map((it) => ({
      leftLabel: String(it?.leftLabel || '').trim().slice(0, 60),
      rightLabel: String(it?.rightLabel || '').trim().slice(0, 60),
      leftIcon: String(it?.leftIcon || '').trim().slice(0, 8),
      rightIcon: String(it?.rightIcon || '').trim().slice(0, 8),
      choice: it?.choice === 'right' ? 'right' : it?.choice === 'left' ? 'left' : null,
      note: kind === 'wyr' ? String(it?.note || '').trim().slice(0, 200) : '',
    }));
    if (ttItems.length < 3) return res.status(400).json({ error: 'Add at least 3 this-or-thats.' });
    if (ttItems.some((it) => !it.leftLabel || !it.rightLabel))
      return res.status(400).json({ error: 'Each item needs both sides.' });
    if (ttItems.some((it) => !it.choice))
      return res.status(400).json({ error: 'Answer every item before sending.' });
  }
  // Guess My Answer: the asker writes their real answer up front (hidden).
  if (kind === 'guess' && !revealAnswer)
    return res.status(400).json({ error: 'Write your real answer first.' });

  const partner = await partnerOf(req.user.id);
  if (!partner) return res.status(500).json({ error: 'No partner profile found.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO question (asker_id, recipient_id, kind, title, detail, link, artist, is_spicy, is_draft)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [req.user.id, partner.id, kind, title, detail, kind === 'song' ? link : null, kind === 'song' ? artist : null, spicy, draft]
    );
    const id = rows[0].id;
    await client.query(
      `INSERT INTO question_version (question_id, version, title, detail, edited_by)
       VALUES ($1, 1, $2, $3, $4)`,
      [id, title, detail, req.user.id]
    );
    // Reveal + Guess: the asker's blind/real answer up front; the recipient's
    // answer (or guess) unlocks both later.
    if (kind === 'reveal' || kind === 'guess') {
      await client.query(
        `INSERT INTO reveal_answer (question_id, user_id, body) VALUES ($1, $2, $3)`,
        [id, req.user.id, revealAnswer]
      );
    }
    if (PICK_KINDS.includes(kind)) {
      for (let i = 0; i < ttItems.length; i++) {
        const it = ttItems[i];
        const { rows: ir } = await client.query(
          `INSERT INTO thisthat_item (question_id, position, left_label, right_label, left_icon, right_icon)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [id, i, it.leftLabel, it.rightLabel, it.leftIcon, it.rightIcon]
        );
        await client.query(
          `INSERT INTO thisthat_answer (question_id, item_id, user_id, choice, note) VALUES ($1, $2, $3, $4, $5)`,
          [id, ir[0].id, req.user.id, it.choice, it.note || '']
        );
      }
    }
    await client.query('COMMIT');
    // A draft isn't "sent" yet — hold the played-marker, activity and push until
    // /finalize (after its attachments upload). Non-drafts send immediately.
    if (!draft) {
      // Mark the source deck prompt / template as played (couple-wide, replayable).
      if (usedKey)
        await query('INSERT INTO game_used (game_key, used_by) VALUES ($1, $2) ON CONFLICT (game_key) DO NOTHING', [
          usedKey,
          req.user.id,
        ]);
      await logActivity(req.user.id, 'shared', 'question', id, { title, kind, spicy });
      notify(
        partner.id,
        spicy ? discreetShare(req.user.display_name) : { title: newShareTitle(req.user.display_name, kind), body: title }
      );
    }
    res.status(201).json({ id, draft });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// Finalize a draft share once its attachments have uploaded: flip it live and
// fire the same activity + push a normal create would have. Idempotent-ish —
// a non-draft (already sent) just returns ok.
router.post('/questions/:id/finalize', requireUser, async (req, res) => {
  const { rows } = await query('SELECT * FROM question WHERE id = $1 AND is_removed = false', [req.params.id]);
  const q = rows[0];
  if (!q) return res.status(404).json({ error: 'Not found.' });
  if (q.asker_id !== req.user.id) return res.status(403).json({ error: "This isn't yours." });
  if (!q.is_draft) return res.json({ ok: true }); // already sent
  await query('UPDATE question SET is_draft = false, updated_at = now() WHERE id = $1', [q.id]);
  const partner = await partnerOf(req.user.id);
  await logActivity(req.user.id, 'shared', 'question', q.id, { title: q.title, kind: q.kind, spicy: q.is_spicy });
  if (partner)
    notify(
      partner.id,
      q.is_spicy ? discreetShare(req.user.display_name) : { title: newShareTitle(req.user.display_name, q.kind), body: q.title }
    );
  res.json({ ok: true });
});

// Only the asker can edit, and only while it is still unanswered/unacknowledged.
router.patch('/questions/:id', requireUser, async (req, res) => {
  const title = (req.body?.title || '').trim();
  const detail = (req.body?.detail || '').trim();
  const link = (req.body?.link || '').trim();
  const artist = (req.body?.artist || '').trim();
  const hasAnswer = typeof req.body?.answer === 'string'; // reveal: edit your blind answer
  const answer = (req.body?.answer || '').trim();
  if (!title) return res.status(400).json({ error: 'Give it a title.' });

  const { rows } = await query('SELECT * FROM question WHERE id = $1 AND is_removed = false', [
    req.params.id,
  ]);
  const q = rows[0];
  if (!q) return res.status(404).json({ error: 'Not found.' });
  if (q.asker_id !== req.user.id) return res.status(403).json({ error: 'This is not yours.' });
  if (q.status === 'answered')
    return res.status(409).json({ error: "This one's already resolved, so it's locked." });
  if (q.kind === 'song' && !/^https?:\/\//i.test(link))
    return res.status(400).json({ error: 'Paste a link to the song.' });

  const nextVersion = q.version + 1;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE question SET title = $1, detail = $2, link = $3, artist = $4, version = $5, updated_at = now() WHERE id = $6`,
      [title, detail, q.kind === 'song' ? link : q.link, q.kind === 'song' ? artist : q.artist, nextVersion, q.id]
    );
    await client.query(
      `INSERT INTO question_version (question_id, version, title, detail, edited_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [q.id, nextVersion, title, detail, req.user.id]
    );
    // A reveal's blind answer can still be changed while it's unrevealed.
    if (q.kind === 'reveal' && hasAnswer) {
      await client.query(
        `UPDATE reveal_answer SET body = $1 WHERE question_id = $2 AND user_id = $3`,
        [answer, q.id, req.user.id]
      );
    }
    await client.query('COMMIT');
    await logActivity(req.user.id, 'edited_question', 'question', q.id, { version: nextVersion });
    res.json({ ok: true, version: nextVersion });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// Soft delete: the row stays, it just stops being listed.
router.post('/questions/:id/remove', requireUser, async (req, res) => {
  const { rows } = await query('SELECT * FROM question WHERE id = $1', [req.params.id]);
  const q = rows[0];
  if (!q) return res.status(404).json({ error: 'Question not found.' });
  if (q.asker_id !== req.user.id) return res.status(403).json({ error: 'This is not your question.' });

  await query(
    `UPDATE question SET is_removed = true, removed_at = now(), removed_by = $1 WHERE id = $2`,
    [req.user.id, q.id]
  );
  await logActivity(req.user.id, 'removed_question', 'question', q.id);
  res.json({ ok: true });
});

router.get('/questions/:id/history', requireUser, async (req, res) => {
  const { rows } = await query('SELECT * FROM question WHERE id = $1', [req.params.id]);
  const q = rows[0];
  if (!q) return res.status(404).json({ error: 'Question not found.' });
  if (q.asker_id !== req.user.id && q.recipient_id !== req.user.id)
    return res.status(403).json({ error: 'Not yours to view.' });

  const versions = await query(
    'SELECT version, title, detail, edited_at FROM question_version WHERE question_id = $1 ORDER BY version',
    [q.id]
  );
  const responses = await query('SELECT id FROM response WHERE question_id = $1', [q.id]);
  const responseIds = responses.rows.map((r) => r.id);
  const responseVersions = responseIds.length
    ? await query(
        'SELECT response_id, version, body, edited_at FROM response_version WHERE response_id = ANY($1::uuid[]) ORDER BY version',
        [responseIds]
      )
    : { rows: [] };
  const attachments = await attachmentsFor([q.id], responseIds);

  res.json({
    questionVersions: versions.rows,
    responseVersions: responseVersions.rows,
    attachments, // includes removed ones; they are still downloadable
  });
});

/* -------------------------------------------------------------- responses */

router.post('/questions/:id/response', requireUser, async (req, res) => {
  const body = (req.body?.body || '').trim();
  const { rows } = await query('SELECT * FROM question WHERE id = $1 AND is_removed = false', [
    req.params.id,
  ]);
  const q = rows[0];
  if (!q) return res.status(404).json({ error: 'Question not found.' });
  if (q.recipient_id !== req.user.id)
    return res.status(403).json({ error: "This wasn't shared with you." });

  const existing = await query(
    'SELECT id FROM response WHERE question_id = $1 AND is_removed = false',
    [q.id]
  );
  if (existing.rows[0])
    return res.status(409).json({ error: 'This already has a reply. Edit it instead.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const inserted = await client.query(
      `INSERT INTO response (question_id, responder_id, body) VALUES ($1, $2, $3) RETURNING id`,
      [q.id, req.user.id, body]
    );
    const responseId = inserted.rows[0].id;
    await client.query(
      `INSERT INTO response_version (response_id, version, body, edited_by) VALUES ($1, 1, $2, $3)`,
      [responseId, body, req.user.id]
    );
    await client.query(`UPDATE question SET status = 'answered', updated_at = now() WHERE id = $1`, [
      q.id,
    ]);
    await client.query('COMMIT');
    await logActivity(req.user.id, 'answered_question', 'response', responseId, { questionId: q.id });
    notify(
      q.asker_id,
      q.is_spicy ? discreetReply(req.user.display_name) : { title: replyTitle(req.user.display_name, q.kind), body: q.title }
    );
    res.status(201).json({ id: responseId });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

router.patch('/responses/:id', requireUser, async (req, res) => {
  const body = (req.body?.body || '').trim();
  const { rows } = await query('SELECT * FROM response WHERE id = $1 AND is_removed = false', [
    req.params.id,
  ]);
  const r = rows[0];
  if (!r) return res.status(404).json({ error: 'Answer not found.' });
  if (r.responder_id !== req.user.id)
    return res.status(403).json({ error: 'Only the person who answered can edit this.' });

  const nextVersion = r.version + 1;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'UPDATE response SET body = $1, version = $2, updated_at = now() WHERE id = $3',
      [body, nextVersion, r.id]
    );
    await client.query(
      `INSERT INTO response_version (response_id, version, body, edited_by) VALUES ($1, $2, $3, $4)`,
      [r.id, nextVersion, body, req.user.id]
    );
    await client.query('COMMIT');
    await logActivity(req.user.id, 'edited_response', 'response', r.id, { version: nextVersion });
    res.json({ ok: true, version: nextVersion });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

/* ------------------------------------------------------------ attachments */

// Shared owner/permission check for attaching to a question or a response.
async function attachTarget(userId, ownerKind, questionId, responseId) {
  if (ownerKind === 'question') {
    const { rows } = await query('SELECT * FROM question WHERE id = $1 AND is_removed = false', [questionId]);
    const q = rows[0];
    if (!q) return { status: 404, error: 'Not found.' };
    if (q.asker_id !== userId) return { status: 403, error: 'This is not yours.' };
    if (q.status === 'answered') return { status: 409, error: "This one's already resolved, so it's locked." };
    return { ok: true };
  }
  if (ownerKind === 'response') {
    const { rows } = await query('SELECT * FROM response WHERE id = $1 AND is_removed = false', [responseId]);
    const r = rows[0];
    if (!r) return { status: 404, error: 'Answer not found.' };
    if (r.responder_id !== userId) return { status: 403, error: 'Only the person who answered can attach to it.' };
    return { ok: true };
  }
  return { status: 400, error: 'ownerKind must be question or response.' };
}

// Direct-to-R2 upload, step 1: hand back a presigned PUT the browser uploads to.
// If R2 isn't configured, the client falls back to the legacy multipart POST.
router.post('/attachments/presign', requireUser, async (req, res) => {
  if (!r2Enabled()) return res.json({ enabled: false });
  const { ownerKind, questionId, responseId, byteSize } = req.body || {};
  const t = await attachTarget(req.user.id, ownerKind, questionId, responseId);
  if (t.error) return res.status(t.status).json({ error: t.error });
  if (Number(byteSize) > MAX_UPLOAD_MB * 1024 * 1024)
    return res.status(413).json({ error: `That file is too large — the limit is ${MAX_UPLOAD_MB} MB.` });
  const key = newOriginalKey();
  const url = await presignPut(key);
  res.json({ enabled: true, key, url });
});

// Record a finished R2 object as an attachment row. Shared by the single-PUT
// and multipart completion paths.
async function recordR2Attachment(userId, { ownerKind, questionId, responseId, key, fileName, mimeType, durationSecs, byteSize }) {
  const { mime, kind } = effectiveMedia({
    mime_type: mimeType,
    media_kind: mediaKindFor(mimeType),
    file_name: fileName,
  });
  const ownerId = ownerKind === 'question' ? questionId : responseId;
  const { rows } = await query(
    `INSERT INTO attachment
       (owner_kind, owner_id, question_id, response_id, uploaded_by, media_kind, mime_type,
        file_name, byte_size, duration_secs, storage, storage_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'r2', $11)
     RETURNING id, media_kind, mime_type, file_name, byte_size, duration_secs`,
    [
      ownerKind,
      ownerId,
      ownerKind === 'question' ? questionId : null,
      ownerKind === 'response' ? responseId : null,
      userId,
      kind,
      mime || 'application/octet-stream',
      fileName || null,
      byteSize,
      durationSecs ? Number(durationSecs) : null,
      key,
    ]
  );
  await logActivity(userId, 'added_attachment', 'attachment', rows[0].id);
  return rows[0];
}

const validKey = (k) => typeof k === 'string' && k.startsWith('att/');

// Direct-to-R2 upload, step 2: verify the object landed, then record it.
router.post('/attachments/complete', requireUser, async (req, res) => {
  if (!r2Enabled()) return res.status(409).json({ error: 'Object storage is not enabled.' });
  const { ownerKind, questionId, responseId, key, fileName, mimeType, durationSecs } = req.body || {};
  const t = await attachTarget(req.user.id, ownerKind, questionId, responseId);
  if (t.error) return res.status(t.status).json({ error: t.error });
  if (!validKey(key)) return res.status(400).json({ error: 'Bad key.' });
  const head = await headObject(key);
  if (!head) return res.status(400).json({ error: 'Upload did not finish. Try again.' });
  const row = await recordR2Attachment(req.user.id, {
    ownerKind,
    questionId,
    responseId,
    key,
    fileName,
    mimeType,
    durationSecs,
    byteSize: head.size,
  });
  res.status(201).json(row);
});

/* ---- resumable multipart (files over the threshold) ---- */

// Step 1: start a multipart upload.
router.post('/attachments/multipart/init', requireUser, async (req, res) => {
  if (!r2Enabled()) return res.json({ enabled: false });
  const { ownerKind, questionId, responseId, byteSize, mimeType } = req.body || {};
  const t = await attachTarget(req.user.id, ownerKind, questionId, responseId);
  if (t.error) return res.status(t.status).json({ error: t.error });
  if (Number(byteSize) > MAX_UPLOAD_MB * 1024 * 1024)
    return res.status(413).json({ error: `That file is too large — the limit is ${MAX_UPLOAD_MB} MB.` });
  const key = newOriginalKey();
  const uploadId = await createMultipart(key, mimeType);
  res.json({ enabled: true, key, uploadId, partSize: 8 * 1024 * 1024 });
});

// Step 2 (per part): presign one part PUT. Called once per part, and again on a
// retry — so a dropped part resumes without restarting the whole upload.
router.post('/attachments/multipart/part', requireUser, async (req, res) => {
  if (!r2Enabled()) return res.status(409).json({ error: 'Object storage is not enabled.' });
  const { key, uploadId, partNumber } = req.body || {};
  const n = Number(partNumber);
  if (!validKey(key) || !uploadId || !(n >= 1)) return res.status(400).json({ error: 'Bad part request.' });
  const url = await presignUploadPart(key, uploadId, n);
  res.json({ url });
});

// Step 3: assemble the parts, verify, and record the attachment.
router.post('/attachments/multipart/complete', requireUser, async (req, res) => {
  if (!r2Enabled()) return res.status(409).json({ error: 'Object storage is not enabled.' });
  const { ownerKind, questionId, responseId, key, uploadId, parts, fileName, mimeType, durationSecs } = req.body || {};
  const t = await attachTarget(req.user.id, ownerKind, questionId, responseId);
  if (t.error) return res.status(t.status).json({ error: t.error });
  if (!validKey(key) || !uploadId || !Array.isArray(parts) || !parts.length)
    return res.status(400).json({ error: 'Bad completion request.' });
  const Parts = parts
    .map((p) => ({ PartNumber: Number(p.partNumber), ETag: p.etag }))
    .sort((a, b) => a.PartNumber - b.PartNumber);
  await completeMultipart(key, uploadId, Parts);
  const head = await headObject(key);
  if (!head) return res.status(400).json({ error: 'Upload did not finish. Try again.' });
  const row = await recordR2Attachment(req.user.id, {
    ownerKind,
    questionId,
    responseId,
    key,
    fileName,
    mimeType,
    durationSecs,
    byteSize: head.size,
  });
  res.status(201).json(row);
});

// Cancel/cleanup an abandoned multipart so R2 doesn't keep orphan parts.
router.post('/attachments/multipart/abort', requireUser, async (req, res) => {
  const { key, uploadId } = req.body || {};
  if (r2Enabled() && validKey(key) && uploadId) await abortMultipart(key, uploadId);
  res.json({ ok: true });
});

// Legacy path: multipart upload buffered through the server into Postgres bytea.
// Used only when R2 isn't configured (the client falls back to this).
router.post('/attachments', requireUser, upload.single('file'), async (req, res) => {
  const { ownerKind, questionId, responseId, durationSecs } = req.body || {};
  if (!req.file) return res.status(400).json({ error: 'No file received.' });
  if (!['question', 'response'].includes(ownerKind))
    return res.status(400).json({ error: 'ownerKind must be question or response.' });

  if (ownerKind === 'question') {
    const { rows } = await query('SELECT * FROM question WHERE id = $1 AND is_removed = false', [
      questionId,
    ]);
    const q = rows[0];
    if (!q) return res.status(404).json({ error: 'Not found.' });
    if (q.asker_id !== req.user.id) return res.status(403).json({ error: 'This is not yours.' });
    if (q.status === 'answered')
      return res.status(409).json({ error: "This one's already resolved, so it's locked." });
  } else {
    const { rows } = await query('SELECT * FROM response WHERE id = $1 AND is_removed = false', [
      responseId,
    ]);
    const r = rows[0];
    if (!r) return res.status(404).json({ error: 'Answer not found.' });
    if (r.responder_id !== req.user.id)
      return res.status(403).json({ error: 'Only the person who answered can attach to it.' });
  }

  // Trust the extension over a generic upload mime so recordings never land as
  // plain "file" downloads.
  const { mime, kind } = effectiveMedia({
    mime_type: req.file.mimetype,
    media_kind: mediaKindFor(req.file.mimetype),
    file_name: req.file.originalname,
  });

  const ownerId = ownerKind === 'question' ? questionId : responseId;
  const { rows } = await query(
    `INSERT INTO attachment
       (owner_kind, owner_id, question_id, response_id, uploaded_by, media_kind, mime_type,
        file_name, byte_size, duration_secs, bytes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING id, media_kind, mime_type, file_name, byte_size, duration_secs`,
    [
      ownerKind,
      ownerId,
      ownerKind === 'question' ? questionId : null,
      ownerKind === 'response' ? responseId : null,
      req.user.id,
      kind,
      mime || 'application/octet-stream',
      req.file.originalname || null,
      req.file.size,
      durationSecs ? Number(durationSecs) : null,
      req.file.buffer,
    ]
  );
  await logActivity(req.user.id, 'added_attachment', 'attachment', rows[0].id);
  res.status(201).json(rows[0]);
});

router.get('/attachments/:id', requireUser, async (req, res) => {
  const { rows } = await query(
    `SELECT a.*,
            COALESCE(q.asker_id, rq.asker_id)         AS asker_id,
            COALESCE(q.recipient_id, rq.recipient_id) AS recipient_id
       FROM attachment a
       LEFT JOIN question q  ON q.id = a.question_id
       LEFT JOIN response r  ON r.id = a.response_id
       LEFT JOIN question rq ON rq.id = r.question_id
      WHERE a.id = $1`,
    [req.params.id]
  );
  const a = rows[0];
  if (!a) return res.status(404).json({ error: 'Attachment not found.' });
  if (a.asker_id !== req.user.id && a.recipient_id !== req.user.id)
    return res.status(403).json({ error: 'Not yours to open.' });

  // Stored in R2: auth is done, hand off to a short-lived presigned URL. R2
  // serves the bytes and Range requests directly (streaming, seeking). Prefer
  // the transcoded web version once it's ready.
  if (a.storage === 'r2' && a.storage_key) {
    const useWeb = a.transcode_status === 'done' && a.web_key;
    const key = useWeb ? a.web_key : a.storage_key;
    const mime = useWeb ? a.web_mime || 'video/mp4' : effectiveMedia(a).mime;
    const url = await presignGet(key, { mime, fileName: a.file_name });
    res.setHeader('Cache-Control', 'private, no-store'); // don't cache the redirect to an expiring URL
    return res.redirect(302, url);
  }

  const bytes = a.bytes; // Buffer straight from bytea (legacy)
  const total = bytes.length;

  // Serve a real media type even if this row was stored with a generic one,
  // so the browser will play it inline rather than treat it as a download.
  const { mime } = effectiveMedia(a);

  res.setHeader('Content-Type', mime || 'application/octet-stream');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  // Advertise range support so media elements can stream and seek. iOS Safari
  // will not play audio/video at all without a 206 answer to its Range request.
  res.setHeader('Accept-Ranges', 'bytes');
  if (a.file_name) {
    res.setHeader('Content-Disposition', `inline; filename="${a.file_name.replace(/"/g, '')}"`);
  }

  // A single `bytes=start-end` range, with the usual open-ended and suffix forms.
  const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (match && (match[1] || match[2])) {
    let start;
    let end;
    if (match[1] === '') {
      // Suffix: the last N bytes.
      start = Math.max(0, total - Number(match[2]));
      end = total - 1;
    } else {
      start = Number(match[1]);
      end = match[2] === '' ? total - 1 : Math.min(Number(match[2]), total - 1);
    }
    if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= total) {
      res.setHeader('Content-Range', `bytes */${total}`);
      return res.status(416).end();
    }
    const chunk = bytes.subarray(start, end + 1);
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
    res.setHeader('Content-Length', chunk.length);
    return res.send(chunk);
  }

  res.setHeader('Content-Length', total);
  res.send(bytes);
});

// Hides the attachment. The bytes stay in the table and stay downloadable.
router.post('/attachments/:id/remove', requireUser, async (req, res) => {
  const { rows } = await query('SELECT * FROM attachment WHERE id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Attachment not found.' });
  await query(
    'UPDATE attachment SET is_removed = true, removed_at = now(), removed_by = $1 WHERE id = $2',
    [req.user.id, req.params.id]
  );
  await logActivity(req.user.id, 'removed_attachment', 'attachment', req.params.id);
  res.json({ ok: true });
});

router.post('/attachments/:id/restore', requireUser, async (req, res) => {
  await query(
    'UPDATE attachment SET is_removed = false, removed_at = NULL, removed_by = NULL WHERE id = $1',
    [req.params.id]
  );
  await logActivity(req.user.id, 'restored_attachment', 'attachment', req.params.id);
  res.json({ ok: true });
});

/* --------------------------------------------------- both answer, then reveal */

// Submit your blind answer to a reveal prompt. The recipient's answer unlocks
// both (the asker already answered at creation time).
router.post('/questions/:id/reveal', requireUser, async (req, res) => {
  const body = (req.body?.body || '').trim();
  const { rows } = await query(
    "SELECT * FROM question WHERE id = $1 AND is_removed = false AND kind IN ('reveal', 'guess')",
    [req.params.id]
  );
  const q = rows[0];
  if (!q) return res.status(404).json({ error: 'Not found.' });
  if (q.asker_id !== req.user.id && q.recipient_id !== req.user.id)
    return res.status(403).json({ error: "This isn't yours." });
  const isGuess = q.kind === 'guess';
  if (isGuess && req.user.id === q.asker_id)
    return res.status(403).json({ error: 'You wrote this one — wait for their guess.' });
  const existing = await query('SELECT id FROM reveal_answer WHERE question_id = $1 AND user_id = $2', [
    q.id,
    req.user.id,
  ]);
  if (existing.rows[0]) return res.status(409).json({ error: 'You already answered this one.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('INSERT INTO reveal_answer (question_id, user_id, body) VALUES ($1, $2, $3)', [
      q.id,
      req.user.id,
      body,
    ]);
    const { rows: c } = await client.query(
      'SELECT count(*)::int AS n FROM reveal_answer WHERE question_id = $1',
      [q.id]
    );
    const revealed = c[0].n >= 2;
    if (revealed) {
      await client.query("UPDATE question SET status = 'answered', updated_at = now() WHERE id = $1", [
        q.id,
      ]);
      // A completed deck / answer-together share earns a flat medium score (no
      // right/wrong). Guesses are scored later at verdict, not here.
      if (q.kind === 'reveal')
        await client.query(
          `INSERT INTO game_points (question_id, source, points) VALUES ($1, 'reveal', $2)
           ON CONFLICT (question_id) DO UPDATE SET points = EXCLUDED.points, source = EXCLUDED.source`,
          [q.id, revealPoints()]
        );
    }
    await client.query('COMMIT');
    await logActivity(req.user.id, 'reveal_answered', 'question', q.id, { revealed });
    const other = q.asker_id === req.user.id ? q.recipient_id : q.asker_id;
    notify(
      other,
      q.is_spicy
        ? discreetReply(req.user.display_name)
        : isGuess
          ? { title: `${req.user.display_name} took a guess`, body: q.title }
          : revealed
            ? { title: `${req.user.display_name} answered — it's revealed`, body: q.title }
            : { title: `${req.user.display_name} wants to answer together`, body: q.title }
    );
    res.status(201).json({ ok: true, revealed });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// Answer a This / That set. Blind until both people have answered every item.
router.post('/questions/:id/thisthat', requireUser, async (req, res) => {
  const { rows } = await query(
    "SELECT * FROM question WHERE id = $1 AND is_removed = false AND kind IN ('this_that', 'predict', 'wyr')",
    [req.params.id]
  );
  const q = rows[0];
  if (!q) return res.status(404).json({ error: 'Not found.' });
  if (q.asker_id !== req.user.id && q.recipient_id !== req.user.id)
    return res.status(403).json({ error: "This isn't yours." });
  // A predict is the author's own picks; only the partner guesses.
  if (q.kind === 'predict' && req.user.id === q.asker_id)
    return res.status(403).json({ error: 'You made this one — wait for their guesses.' });

  const mine = await query(
    'SELECT count(*)::int AS n FROM thisthat_answer WHERE question_id = $1 AND user_id = $2',
    [q.id, req.user.id]
  );
  if (mine.rows[0].n > 0) return res.status(409).json({ error: 'You already answered this one.' });

  const items = await query('SELECT id FROM thisthat_item WHERE question_id = $1', [q.id]);
  const itemIds = new Set(items.rows.map((r) => r.id));
  const raw = Array.isArray(req.body?.answers) ? req.body.answers : [];
  const chosen = new Map();
  for (const a of raw) {
    const itemId = String(a?.itemId || '');
    const choice = a?.choice === 'right' ? 'right' : a?.choice === 'left' ? 'left' : null;
    const note = q.kind === 'wyr' ? String(a?.note || '').trim().slice(0, 200) : '';
    if (itemIds.has(itemId) && choice) chosen.set(itemId, { choice, note });
  }
  if (chosen.size !== itemIds.size) return res.status(400).json({ error: 'Answer every item.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const [itemId, { choice, note }] of chosen) {
      await client.query(
        `INSERT INTO thisthat_answer (question_id, item_id, user_id, choice, note) VALUES ($1, $2, $3, $4, $5)`,
        [q.id, itemId, req.user.id, choice, note]
      );
    }
    const { rows: cc } = await client.query(
      'SELECT user_id, count(*)::int AS n FROM thisthat_answer WHERE question_id = $1 GROUP BY user_id',
      [q.id]
    );
    const n = itemIds.size;
    const revealed = cc.length >= 2 && cc.every((r) => r.n >= n);
    if (revealed) {
      await client.query("UPDATE question SET status = 'answered', updated_at = now() WHERE id = $1", [q.id]);
      // Every pick game feeds the "Knowing You" score. This / That & WYR score a
      // flat amount for completing together; predict adds a bonus per pick the
      // partner guessed right. See server/scoring.js.
      let matches = 0;
      if (q.kind === 'predict') {
        const { rows: mr } = await client.query(
          `SELECT count(*)::int AS matches FROM thisthat_answer a
             JOIN thisthat_answer b ON a.item_id = b.item_id AND a.choice = b.choice
            WHERE a.question_id = $1 AND a.user_id = $2 AND b.user_id = $3`,
          [q.id, q.asker_id, q.recipient_id]
        );
        matches = mr[0].matches;
      }
      await client.query(
        `INSERT INTO game_points (question_id, source, points) VALUES ($1, $2, $3)
         ON CONFLICT (question_id) DO UPDATE SET points = EXCLUDED.points, source = EXCLUDED.source`,
        [q.id, q.kind, pickPoints(q.kind, matches)]
      );
    }
    await client.query('COMMIT');
    await logActivity(req.user.id, 'thisthat_answered', 'question', q.id, { revealed, kind: q.kind });
    const other = q.asker_id === req.user.id ? q.recipient_id : q.asker_id;
    const playedWord =
      q.kind === 'predict' ? 'guessed your picks' : q.kind === 'wyr' ? 'played Would You Rather' : 'played This / That';
    notify(
      other,
      q.is_spicy
        ? discreetReply(req.user.display_name)
        : revealed
          ? { title: `${req.user.display_name} answered — it's revealed`, body: q.title }
          : { title: `${req.user.display_name} ${playedWord}`, body: q.title }
    );
    res.status(201).json({ ok: true, revealed });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// Author judges the partner's guess for a 'guess' share (got it / close /
// missed) and the couple earns 2 / 1 / 0 points.
router.post('/questions/:id/verdict', requireUser, async (req, res) => {
  const verdict = ['got_it', 'close', 'missed'].includes(req.body?.verdict) ? req.body.verdict : null;
  if (!verdict) return res.status(400).json({ error: 'Pick a verdict.' });
  const { rows } = await query(
    "SELECT * FROM question WHERE id = $1 AND is_removed = false AND kind = 'guess'",
    [req.params.id]
  );
  const q = rows[0];
  if (!q) return res.status(404).json({ error: 'Not found.' });
  if (q.asker_id !== req.user.id) return res.status(403).json({ error: 'Only you can judge your answer.' });
  const guessed = await query(
    'SELECT 1 FROM reveal_answer WHERE question_id = $1 AND user_id = $2',
    [q.id, q.recipient_id]
  );
  if (!guessed.rows[0]) return res.status(409).json({ error: 'They haven’t guessed yet.' });

  const pts = guessPoints(verdict);
  await query('UPDATE question SET guess_verdict = $1, updated_at = now() WHERE id = $2', [verdict, q.id]);
  await query(
    `INSERT INTO game_points (question_id, source, points) VALUES ($1, 'guess', $2)
     ON CONFLICT (question_id) DO UPDATE SET points = EXCLUDED.points`,
    [q.id, pts]
  );
  await logActivity(req.user.id, 'guess_judged', 'question', q.id, { verdict });
  notify(q.recipient_id, { title: `${req.user.display_name} scored your guess`, body: q.title });
  res.json({ ok: true, verdict, points: pts });
});

/* ---------------------------------------------------------- share comments */

/* ------------------------------------------------------------- comments */

// Permission + a notify closure for commenting on a given target. One place
// that every commentable thing goes through.
async function authorizeComment(user, targetType, targetId) {
  const partner = await partnerOf(user.id);
  if (targetType === 'question') {
    const { rows } = await query('SELECT * FROM question WHERE id = $1 AND is_removed = false', [targetId]);
    const q = rows[0];
    if (!q) return { status: 404, error: 'Not found.' };
    if (q.asker_id !== user.id && q.recipient_id !== user.id) return { status: 403, error: "This isn't yours." };
    if (q.status !== 'answered') return { status: 409, error: 'You can comment once it’s complete.' };
    const other = q.asker_id === user.id ? q.recipient_id : q.asker_id;
    return {
      onCreated: (body) =>
        notify(other, q.is_spicy ? discreetReply(user.display_name) : { title: `${user.display_name} commented`, body: q.title }),
    };
  }
  if (targetType === 'daily') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(targetId)) return { status: 400, error: 'Bad day.' };
    if (!(await dailyRevealed(targetId))) return { status: 409, error: 'Not revealed yet.' };
    return {
      onCreated: (body) => partner && notify(partner.id, { title: `${user.display_name} commented on today’s question`, body }),
    };
  }
  if (targetType === 'list') {
    const { rows } = await query('SELECT id, title FROM list WHERE id = $1 AND is_removed = false', [targetId]);
    if (!rows[0]) return { status: 404, error: 'List not found.' };
    return {
      onCreated: (body) => partner && notify(partner.id, { title: `${user.display_name} commented on “${rows[0].title}”`, body }),
    };
  }
  if (targetType === 'event') {
    const { rows } = await query('SELECT id, title FROM calendar_event WHERE id = $1 AND is_removed = false', [targetId]);
    if (!rows[0]) return { status: 404, error: 'Event not found.' };
    return { onCreated: () => notifyEvent(targetId, asUser(user.id, user.display_name), 'commented', rows[0].title) };
  }
  if (targetType === 'coupon') {
    const { rows } = await query('SELECT from_id, to_id, title FROM coupon WHERE id = $1 AND is_removed = false', [targetId]);
    const c = rows[0];
    if (!c) return { status: 404, error: 'Not found.' };
    if (c.from_id !== user.id && c.to_id !== user.id) return { status: 403, error: "This isn't yours." };
    const other = c.from_id === user.id ? c.to_id : c.from_id;
    return { onCreated: (body) => notify(other, { title: `${user.display_name} commented on a coupon`, body }) };
  }
  if (targetType === 'gratitude') {
    const { rows } = await query('SELECT from_id, to_id FROM gratitude WHERE id = $1 AND is_removed = false', [targetId]);
    const g = rows[0];
    if (!g) return { status: 404, error: 'Not found.' };
    if (g.from_id !== user.id && g.to_id !== user.id) return { status: 403, error: "This isn't yours." };
    const other = g.from_id === user.id ? g.to_id : g.from_id;
    return { onCreated: (body) => notify(other, { title: `${user.display_name} commented`, body }) };
  }
  if (targetType === 'checkin') {
    if (!(await checkinRevealed(targetId))) return { status: 409, error: 'You can comment once it’s revealed.' };
    return { onCreated: (body) => partner && notify(partner.id, { title: `${user.display_name} commented on your check-in`, body }) };
  }
  if (targetType === 'bingo') {
    const { rows } = await query('SELECT id FROM bingo_board WHERE id = $1 AND is_removed = false', [targetId]);
    if (!rows[0]) return { status: 404, error: 'Not found.' };
    return { onCreated: (body) => partner && notify(partner.id, { title: `${user.display_name} commented on a bingo board`, body }) };
  }
  return { status: 400, error: 'Unknown comment target.' };
}

// Add a comment to anything (share, daily question, list, event, …).
router.post('/comments', requireUser, async (req, res) => {
  const targetType = String(req.body?.targetType || '');
  const targetId = String(req.body?.targetId || '');
  const body = (req.body?.body || '').trim().slice(0, 500);
  if (!body) return res.status(400).json({ error: 'Write a comment.' });
  const auth = await authorizeComment(req.user, targetType, targetId);
  if (auth.error) return res.status(auth.status).json({ error: auth.error });
  const ins = await query(
    'INSERT INTO comment (target_type, target_id, user_id, body) VALUES ($1, $2, $3, $4) RETURNING id, created_at',
    [targetType, targetId, req.user.id, body]
  );
  await logActivity(req.user.id, 'commented', targetType, targetId);
  await auth.onCreated?.(body);
  res.status(201).json({
    id: ins.rows[0].id,
    userId: req.user.id,
    userName: req.user.display_name,
    body,
    createdAt: ins.rows[0].created_at,
    editedAt: null,
  });
});

// Edit a comment in place (author only).
router.patch('/comments/:id', requireUser, async (req, res) => {
  const body = (req.body?.body || '').trim().slice(0, 500);
  if (!body) return res.status(400).json({ error: 'Write a comment.' });
  const cur = await query('SELECT user_id FROM comment WHERE id = $1', [req.params.id]);
  if (!cur.rows[0]) return res.status(404).json({ error: 'Not found.' });
  if (cur.rows[0].user_id !== req.user.id) return res.status(403).json({ error: 'You can only edit your own comment.' });
  const upd = await query('UPDATE comment SET body = $1, edited_at = now() WHERE id = $2 RETURNING edited_at', [
    body,
    req.params.id,
  ]);
  res.json({ id: req.params.id, body, editedAt: upd.rows[0].edited_at });
});

/* ---------------------------------------------------------------- keepsakes */

router.post('/questions/:id/keepsake', requireUser, async (req, res) => {
  const { rows } = await query(
    'SELECT asker_id, recipient_id FROM question WHERE id = $1 AND is_removed = false',
    [req.params.id]
  );
  const q = rows[0];
  if (!q) return res.status(404).json({ error: 'Not found.' });
  if (q.asker_id !== req.user.id && q.recipient_id !== req.user.id)
    return res.status(403).json({ error: 'Not yours.' });

  const existing = await query('SELECT 1 FROM keepsake WHERE user_id = $1 AND question_id = $2', [
    req.user.id,
    req.params.id,
  ]);
  const next = !existing.rows[0];
  if (next) {
    await query(
      'INSERT INTO keepsake (user_id, question_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [req.user.id, req.params.id]
    );
  } else {
    await query('DELETE FROM keepsake WHERE user_id = $1 AND question_id = $2', [
      req.user.id,
      req.params.id,
    ]);
  }
  await logActivity(req.user.id, next ? 'kept' : 'unkept', 'question', req.params.id);
  res.json({ ok: true, keptByMe: next });
});

/* -------------------------------------------------------------------- games */

/* ------------------------------------------------------------- daily question */

const fmtDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// A day's daily question is "revealed" (open to reactions/comments) once both
// partners have answered it.
async function dailyRevealed(day) {
  const { rows } = await query(
    'SELECT count(DISTINCT user_id)::int AS n FROM daily_answer WHERE day = $1::date',
    [day]
  );
  return rows[0].n >= 2;
}

router.get('/daily', requireUser, async (req, res) => {
  const partner = await partnerOf(req.user.id);
  const today = appToday();
  const prompt = promptForDay(today);

  const { rows } = await query(
    "SELECT to_char(day, 'YYYY-MM-DD') AS day, user_id, body FROM daily_answer WHERE day > $1::date - INTERVAL '45 days' ORDER BY day DESC",
    [today]
  );
  const byDay = new Map();
  for (const r of rows) {
    if (!byDay.has(r.day)) byDay.set(r.day, {});
    byDay.get(r.day)[r.user_id] = r.body;
  }
  const mineToday = byDay.get(today)?.[req.user.id];
  const theirsToday = partner ? byDay.get(today)?.[partner.id] : undefined;
  const iAnswered = mineToday !== undefined;
  const revealed = iAnswered && theirsToday !== undefined;

  // Streak: consecutive days (ending today or yesterday) where BOTH answered.
  const both = new Set([...byDay.entries()].filter(([, m]) => Object.keys(m).length >= 2).map(([d]) => d));
  const cur = new Date(`${today}T00:00:00`);
  if (!both.has(fmtDay(cur))) cur.setDate(cur.getDate() - 1);
  let streak = 0;
  while (both.has(fmtDay(cur))) {
    streak++;
    cur.setDate(cur.getDate() - 1);
  }

  // Recent revealed days (skip today) for a little history.
  const recent = [...byDay.entries()]
    .filter(([d, m]) => d !== today && partner && m[req.user.id] !== undefined && m[partner.id] !== undefined)
    .slice(0, 10)
    .map(([d, m]) => ({ day: d, prompt: promptForDay(d), mine: m[req.user.id], theirs: m[partner.id] }));

  // Once revealed, both can react to and comment on today's question.
  const [reactions, comments] = revealed
    ? await Promise.all([reactionsForTargets('daily', [today]), commentsForTargets('daily', [today])])
    : [[], []];

  res.json({
    today,
    prompt,
    iAnswered,
    revealed,
    myBody: mineToday || '',
    partnerBody: revealed ? theirsToday : null,
    partnerName: partner?.display_name || 'them',
    streak,
    recent,
    reactions: reactions.map((r) => ({ userId: r.user_id, emoji: r.emoji })),
    comments: comments.map(shapeComment),
  });
});

// The archive: every day from today back to your first answer (capped), most
// recent first, with each person's answer state.
router.get('/daily/history', requireUser, async (req, res) => {
  const partner = await partnerOf(req.user.id);
  const today = appToday();
  const { rows } = await query(
    "SELECT to_char(day, 'YYYY-MM-DD') AS day, user_id, body FROM daily_answer WHERE day > $1::date - INTERVAL '75 days' ORDER BY day",
    [today]
  );
  const byDay = new Map();
  for (const r of rows) {
    if (!byDay.has(r.day)) byDay.set(r.day, {});
    byDay.get(r.day)[r.user_id] = r.body;
  }
  const answeredDays = [...byDay.keys()].sort();
  const earliest = answeredDays[0] || today;

  // Days where both answered can carry reactions/comments; batch-load them.
  const revealedDays = [...byDay.entries()]
    .filter(([, m]) => partner && m[req.user.id] !== undefined && m[partner.id] !== undefined)
    .map(([d]) => d);
  const [dReacts, dComments] = await Promise.all([
    reactionsForTargets('daily', revealedDays),
    commentsForTargets('daily', revealedDays),
  ]);
  const reactsByDay = new Map();
  for (const r of dReacts) {
    if (!reactsByDay.has(r.target_id)) reactsByDay.set(r.target_id, []);
    reactsByDay.get(r.target_id).push({ userId: r.user_id, emoji: r.emoji });
  }
  const commentsByDay = new Map();
  for (const c of dComments) {
    if (!commentsByDay.has(c.target_id)) commentsByDay.set(c.target_id, []);
    commentsByDay.get(c.target_id).push(shapeComment(c));
  }

  const days = [];
  const cur = new Date(`${today}T00:00:00`);
  const stop = new Date(`${earliest}T00:00:00`);
  const floor = new Date(cur);
  floor.setDate(floor.getDate() - 60); // hard cap on how far back we list
  const start = stop < floor ? floor : stop;
  while (cur >= start) {
    const day = fmtDay(cur);
    const m = byDay.get(day) || {};
    const mine = m[req.user.id];
    const theirs = partner ? m[partner.id] : undefined;
    const iAnswered = mine !== undefined;
    const partnerAnswered = theirs !== undefined;
    // Blind only guards TODAY; past days are shown in full.
    const showTheirs = day !== today || (iAnswered && partnerAnswered);
    const revealed = iAnswered && partnerAnswered;
    days.push({
      day,
      prompt: promptForDay(day),
      iAnswered,
      partnerAnswered,
      mine: mine ?? null,
      theirs: showTheirs ? theirs ?? null : null,
      reactions: revealed ? reactsByDay.get(day) || [] : [],
      comments: revealed ? commentsByDay.get(day) || [] : [],
    });
    cur.setDate(cur.getDate() - 1);
  }
  res.json({ today, partnerName: partner?.display_name || 'them', days });
});

router.post('/daily', requireUser, async (req, res) => {
  const body = (req.body?.body || '').trim();
  if (!body) return res.status(400).json({ error: 'Write your answer.' });
  const today = appToday();
  const existing = await query('SELECT 1 FROM daily_answer WHERE day = $1::date AND user_id = $2', [today, req.user.id]);
  if (existing.rows[0]) return res.status(409).json({ error: 'You already answered today.' });
  await query('INSERT INTO daily_answer (day, user_id, body) VALUES ($1::date, $2, $3)', [today, req.user.id, body]);
  const partner = await partnerOf(req.user.id);
  const p = partner
    ? await query('SELECT 1 FROM daily_answer WHERE day = $1::date AND user_id = $2', [today, partner.id])
    : { rows: [] };
  const revealed = p.rows.length > 0;
  await logActivity(req.user.id, 'daily_answered', 'daily', 'today', { revealed });
  if (partner)
    notify(partner.id, {
      title: revealed
        ? `${req.user.display_name} answered — today’s question is revealed`
        : `${req.user.display_name} answered today’s question`,
      body: '',
    });
  res.status(201).json({ ok: true, revealed });
});

// Edit today's answer — allowed only while it's still blind (partner hasn't
// answered yet). Once both are in, it's locked.
router.patch('/daily', requireUser, async (req, res) => {
  const body = (req.body?.body || '').trim();
  if (!body) return res.status(400).json({ error: 'Write your answer.' });
  const today = appToday();
  const mine = await query('SELECT 1 FROM daily_answer WHERE day = $1::date AND user_id = $2', [today, req.user.id]);
  if (!mine.rows[0]) return res.status(404).json({ error: 'You haven’t answered today yet.' });
  const partner = await partnerOf(req.user.id);
  const theirs = partner
    ? await query('SELECT 1 FROM daily_answer WHERE day = $1::date AND user_id = $2', [today, partner.id])
    : { rows: [] };
  if (theirs.rows[0]) return res.status(409).json({ error: 'It’s already revealed — no more edits.' });
  await query('UPDATE daily_answer SET body = $1 WHERE day = $2::date AND user_id = $3', [body, today, req.user.id]);
  res.json({ ok: true });
});

// (Daily reactions & comments now go through the generic /reactions and
// /comments endpoints with target_type/kind 'daily' and the day as the id.)

/* ------------------------------------------------------------- gratitude */

// Per-person streak: consecutive days (ending today or yesterday) you posted.
async function gratitudeStreak(userId) {
  const { rows } = await query(
    "SELECT DISTINCT to_char(day, 'YYYY-MM-DD') AS day FROM gratitude WHERE from_id = $1 AND is_removed = false",
    [userId]
  );
  const set = new Set(rows.map((r) => r.day));
  const cur = new Date(`${appToday()}T00:00:00`);
  if (!set.has(fmtDay(cur))) cur.setDate(cur.getDate() - 1);
  let streak = 0;
  while (set.has(fmtDay(cur))) {
    streak++;
    cur.setDate(cur.getDate() - 1);
  }
  return streak;
}

router.get('/gratitude', requireUser, async (req, res) => {
  const partner = await partnerOf(req.user.id);
  const { rows } = await query(
    `SELECT g.id, g.from_id, g.to_id, to_char(g.day, 'YYYY-MM-DD') AS day, g.body, g.created_at,
            f.display_name AS from_name, t.display_name AS to_name
       FROM gratitude g JOIN app_user f ON f.id = g.from_id JOIN app_user t ON t.id = g.to_id
      WHERE g.is_removed = false ORDER BY g.created_at DESC LIMIT 100`
  );
  const ids = rows.map((r) => r.id);
  const [reactions, comments] = await Promise.all([
    reactionsForTargets('gratitude', ids),
    commentsForTargets('gratitude', ids),
  ]);
  const today = appToday();
  res.json({
    partnerName: partner?.display_name || 'them',
    streak: await gratitudeStreak(req.user.id),
    addedToday: rows.some((r) => r.from_id === req.user.id && r.day === today),
    wall: rows.map((g) => ({
      id: g.id,
      fromId: g.from_id,
      fromName: g.from_name,
      toId: g.to_id,
      toName: g.to_name,
      day: g.day,
      body: g.body,
      createdAt: g.created_at,
      reactions: reactions.filter((r) => r.target_id === String(g.id)).map((r) => ({ userId: r.user_id, emoji: r.emoji })),
      comments: commentsOn(comments, g.id),
    })),
  });
});

router.post('/gratitude', requireUser, async (req, res) => {
  const body = (req.body?.body || '').trim().slice(0, 500);
  if (!body) return res.status(400).json({ error: 'Write a little something.' });
  const partner = await partnerOf(req.user.id);
  if (!partner) return res.status(400).json({ error: 'No partner.' });
  const { rows } = await query(
    'INSERT INTO gratitude (from_id, to_id, day, body) VALUES ($1, $2, $3::date, $4) RETURNING id',
    [req.user.id, partner.id, appToday(), body]
  );
  await logActivity(req.user.id, 'gratitude', 'gratitude', rows[0].id);
  notify(partner.id, { title: `${req.user.display_name} appreciated you 🌷`, body });
  res.status(201).json({ id: rows[0].id });
});

/* ------------------------------------------------------- weekly check-in */

const checkinDone = (answersByUser, userId) => {
  const a = answersByUser.get(userId) || {};
  return WEEKLY_KEYS.every((k) => (a[k] || '').trim());
};

// A check-in is revealed once both partners have filled every prompt.
async function checkinRevealed(id) {
  const { rows } = await query(
    "SELECT count(*)::int AS filled FROM checkin_answer WHERE checkin_id = $1 AND body <> ''",
    [id]
  );
  return rows[0].filled >= 2 * WEEKLY_KEYS.length;
}

async function loadCheckin(ws) {
  const { rows } = await query('SELECT id FROM checkin WHERE week_start = $1::date', [ws]);
  if (!rows[0]) return { id: null, answersByUser: new Map() };
  const id = rows[0].id;
  const ans = await query('SELECT user_id, prompt_key, body FROM checkin_answer WHERE checkin_id = $1', [id]);
  const map = new Map();
  for (const r of ans.rows) {
    if (!map.has(r.user_id)) map.set(r.user_id, {});
    map.get(r.user_id)[r.prompt_key] = r.body;
  }
  return { id, answersByUser: map };
}

// Consecutive weeks (ending this or last week) both partners fully completed.
async function checkinStreak(today) {
  const { rows } = await query(
    `SELECT to_char(c.week_start, 'YYYY-MM-DD') AS ws,
            count(*) FILTER (WHERE ca.body <> '') AS filled
       FROM checkin c LEFT JOIN checkin_answer ca ON ca.checkin_id = c.id
      GROUP BY c.week_start`
  );
  const need = 2 * WEEKLY_KEYS.length;
  const complete = new Set(rows.filter((r) => Number(r.filled) >= need).map((r) => r.ws));
  const cur = new Date(`${weekStart(today)}T00:00:00`);
  if (!complete.has(fmtDay(cur))) cur.setDate(cur.getDate() - 7); // this week not done yet
  let streak = 0;
  while (complete.has(fmtDay(cur))) {
    streak++;
    cur.setDate(cur.getDate() - 7);
  }
  return streak;
}

router.get('/checkin', requireUser, async (req, res) => {
  const partner = await partnerOf(req.user.id);
  const today = appToday();
  const ws = weekStart(today);
  const { id, answersByUser } = await loadCheckin(ws);
  const iDone = checkinDone(answersByUser, req.user.id);
  const pDone = partner ? checkinDone(answersByUser, partner.id) : false;
  const revealed = iDone && pDone;
  const [reactions, comments] =
    id && revealed
      ? await Promise.all([reactionsForTargets('checkin', [id]), commentsForTargets('checkin', [id])])
      : [[], []];
  res.json({
    id,
    weekStart: ws,
    prompts: WEEKLY_PROMPTS,
    partnerName: partner?.display_name || 'them',
    mine: answersByUser.get(req.user.id) || {},
    theirs: revealed && partner ? answersByUser.get(partner.id) || {} : null,
    iSubmitted: iDone,
    partnerSubmitted: pDone,
    revealed,
    streak: await checkinStreak(today),
    reactions: reactions.map((r) => ({ userId: r.user_id, emoji: r.emoji })),
    comments: comments.map(shapeComment),
  });
});

router.post('/checkin', requireUser, async (req, res) => {
  const today = appToday();
  const ws = weekStart(today);
  const partner = await partnerOf(req.user.id);
  const before = await loadCheckin(ws);
  const alreadyRevealed = checkinDone(before.answersByUser, req.user.id) && partner && checkinDone(before.answersByUser, partner.id);
  if (alreadyRevealed) return res.status(409).json({ error: 'It’s already revealed — no more edits.' });

  let id = before.id;
  if (!id) {
    const r = await query(
      'INSERT INTO checkin (week_start) VALUES ($1::date) ON CONFLICT (week_start) DO UPDATE SET week_start = EXCLUDED.week_start RETURNING id',
      [ws]
    );
    id = r.rows[0].id;
  }
  const answers = Array.isArray(req.body?.answers) ? req.body.answers : [];
  for (const a of answers) {
    const key = String(a?.promptKey || '');
    if (!WEEKLY_KEYS.includes(key)) continue;
    const body = String(a?.body || '').trim().slice(0, 1000);
    await query(
      `INSERT INTO checkin_answer (checkin_id, user_id, prompt_key, body) VALUES ($1, $2, $3, $4)
       ON CONFLICT (checkin_id, user_id, prompt_key) DO UPDATE SET body = EXCLUDED.body, updated_at = now()`,
      [id, req.user.id, key, body]
    );
  }
  const after = await loadCheckin(ws);
  const nowRevealed = checkinDone(after.answersByUser, req.user.id) && partner && checkinDone(after.answersByUser, partner.id);
  if (partner)
    notify(partner.id, {
      title: nowRevealed
        ? `${req.user.display_name} finished the weekly check-in — it’s revealed`
        : `${req.user.display_name} did this week’s check-in`,
      body: '',
    });
  res.json({ ok: true, revealed: nowRevealed });
});

router.get('/checkin/history', requireUser, async (req, res) => {
  const partner = await partnerOf(req.user.id);
  const { rows } = await query(
    "SELECT id, to_char(week_start, 'YYYY-MM-DD') AS ws FROM checkin ORDER BY week_start DESC LIMIT 26"
  );
  const weeks = [];
  for (const c of rows) {
    const { answersByUser } = await loadCheckin(c.ws);
    if (!(checkinDone(answersByUser, req.user.id) && partner && checkinDone(answersByUser, partner.id))) continue;
    weeks.push({
      id: c.id,
      weekStart: c.ws,
      prompts: WEEKLY_PROMPTS,
      mine: answersByUser.get(req.user.id) || {},
      theirs: partner ? answersByUser.get(partner.id) || {} : {},
      partnerName: partner?.display_name || 'them',
    });
  }
  res.json({ weeks });
});

// Played keys + the shared "Knowing You" points total.
router.get('/games/used', requireUser, async (_req, res) => {
  const [used, total] = await Promise.all([query('SELECT game_key FROM game_used'), knowingTotal()]);
  res.json({ keys: used.rows.map((r) => r.game_key), knowingPoints: total });
});

// Mark templates as played. Used by the client's one-time reconciliation to tag
// games that were played before the "Played" feature existed — the client
// matches existing shares to their templates and sends the missing keys here.
const PLAYED_PREFIXES = ['deck:', 'tt:', 'pt:', 'wyr:', 'guess:'];
router.post('/games/used', requireUser, async (req, res) => {
  const raw = Array.isArray(req.body?.keys) ? req.body.keys : [];
  const keys = [
    ...new Set(
      raw
        .map((k) => String(k || '').trim().slice(0, 120))
        .filter((k) => PLAYED_PREFIXES.some((p) => k.startsWith(p)))
    ),
  ].slice(0, 500);
  let added = 0;
  for (const key of keys) {
    const r = await query(
      'INSERT INTO game_used (game_key, used_by) VALUES ($1, $2) ON CONFLICT (game_key) DO NOTHING',
      [key, req.user.id]
    );
    added += r.rowCount;
  }
  res.json({ ok: true, added });
});

// A breakdown of the "Knowing You" score: every game that actually earned
// points (with how many and why), plus games still in flight that will score
// once they're finished. This is what the brain-icon window reads so a person
// can see exactly what the number is — and isn't — counting.
router.get('/games/score', requireUser, async (_req, res) => {
  // Scored games: each game_points row, joined to its share for a title and,
  // for predict, the number of items (the most it could have scored).
  const { rows: scored } = await query(
    `SELECT gp.question_id, gp.source, gp.points, gp.created_at,
            q.title, q.kind, q.is_spicy, q.is_removed, q.guess_verdict,
            (SELECT count(*)::int FROM thisthat_item ti WHERE ti.question_id = gp.question_id) AS item_count
       FROM game_points gp
       JOIN question q ON q.id = gp.question_id
      ORDER BY gp.created_at DESC`
  );

  const entries = scored.map((r) => ({
    questionId: r.question_id,
    source: r.source, // 'this_that' | 'predict' | 'wyr' | 'guess'
    points: r.points,
    maxPoints: maxPointsFor(r.kind, r.item_count || 0),
    title: r.title,
    kind: r.kind,
    isSpicy: r.is_spicy,
    isRemoved: r.is_removed,
    verdict: r.guess_verdict || null,
    createdAt: r.created_at,
  }));

  // In flight: games that can still score but haven't yet. A predict share is
  // scored only once both people have answered (status flips to 'answered'); a
  // guess is scored only once the author judges it; a deck scores once both
  // have answered it.
  const [predictOpen, guessUnjudged, revealOpen, daily, coupons, bingo] = await Promise.all([
    query(
      "SELECT count(*)::int AS n FROM question WHERE kind = 'predict' AND is_removed = false AND status <> 'answered'"
    ),
    query(
      `SELECT count(*)::int AS n FROM question q
        WHERE q.kind = 'guess' AND q.is_removed = false AND q.guess_verdict IS NULL
          AND EXISTS (SELECT 1 FROM reveal_answer ra WHERE ra.question_id = q.id AND ra.user_id = q.recipient_id)`
    ),
    query(
      "SELECT count(*)::int AS n FROM question WHERE kind = 'reveal' AND is_removed = false AND status <> 'answered'"
    ),
    computeDailyScore(),
    computeCouponScore(),
    computeBingoScore(),
  ]);

  const gamesTotal = entries.reduce((sum, e) => sum + e.points, 0);
  res.json({
    total: gamesTotal + daily.points + coupons.points + bingo.points,
    entries,
    daily,
    coupons,
    bingo,
    legend: SCORE_LEGEND,
    pending: {
      predictAwaitingReveal: predictOpen.rows[0].n,
      guessAwaitingVerdict: guessUnjudged.rows[0].n,
      deckAwaitingReveal: revealOpen.rows[0].n,
    },
  });
});

/* ---------------------------------------------------------------- reactions */

const REACTION_EMOJI = ['❤️', '🔥', '😈', '😂', '🥹', '👀'];

router.post('/reactions', requireUser, async (req, res) => {
  const { targetKind, targetId, emoji } = req.body || {};
  if (!['question', 'response', 'reveal', 'event', 'thisthat', 'list', 'daily', 'coupon', 'gratitude', 'checkin', 'bingo'].includes(targetKind))
    return res.status(400).json({ error: 'Bad target.' });

  // Confirm the target is part of a share you're in, and figure out whether
  // you authored it — you can't react to your own (except calendar events).
  let member = false;
  let isAuthor = false;
  let eventTitle = null;
  if (targetKind === 'event') {
    // Calendar events are shared; reacting to your own is fine.
    const { rows } = await query('SELECT title FROM calendar_event WHERE id = $1 AND is_removed = false', [
      targetId,
    ]);
    if (rows[0]) {
      member = true;
      eventTitle = rows[0].title;
    }
  } else if (targetKind === 'list') {
    // Lists are shared; reacting to a list you're in (either partner) is fine.
    const { rows } = await query('SELECT id FROM list WHERE id = $1 AND is_removed = false', [targetId]);
    if (rows[0]) member = true;
  } else if (targetKind === 'daily') {
    // The daily question is shared once both have answered that day.
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(targetId)) && (await dailyRevealed(String(targetId)))) member = true;
  } else if (targetKind === 'coupon') {
    const { rows } = await query('SELECT from_id, to_id FROM coupon WHERE id = $1 AND is_removed = false', [targetId]);
    if (rows[0] && (rows[0].from_id === req.user.id || rows[0].to_id === req.user.id)) member = true;
  } else if (targetKind === 'gratitude') {
    const { rows } = await query('SELECT from_id, to_id FROM gratitude WHERE id = $1 AND is_removed = false', [targetId]);
    if (rows[0] && (rows[0].from_id === req.user.id || rows[0].to_id === req.user.id)) member = true;
  } else if (targetKind === 'checkin') {
    if (await checkinRevealed(targetId)) member = true;
  } else if (targetKind === 'bingo') {
    const { rows } = await query('SELECT id FROM bingo_board WHERE id = $1 AND is_removed = false', [targetId]);
    if (rows[0]) member = true;
  } else if (targetKind === 'question') {
    const { rows } = await query('SELECT asker_id, recipient_id FROM question WHERE id = $1', [targetId]);
    const q = rows[0];
    if (q && (q.asker_id === req.user.id || q.recipient_id === req.user.id)) {
      member = true;
      isAuthor = q.asker_id === req.user.id;
    }
  } else if (targetKind === 'reveal') {
    // A reveal reaction is always to the OTHER person's blind answer, so it's
    // never "your own". Only allowed once both have answered.
    const { rows } = await query(
      `SELECT asker_id, recipient_id,
              (SELECT count(*) FROM reveal_answer WHERE question_id = q.id) AS answered
         FROM question q WHERE id = $1 AND kind IN ('reveal', 'guess') AND is_removed = false`,
      [targetId]
    );
    const q = rows[0];
    if (q && (q.asker_id === req.user.id || q.recipient_id === req.user.id) && Number(q.answered) >= 2) {
      member = true;
    }
  } else if (targetKind === 'thisthat') {
    // Only reactable once revealed (both answered every item).
    const { rows } = await query(
      `SELECT q.asker_id, q.recipient_id,
              (SELECT count(*) FROM thisthat_item WHERE question_id = q.id) AS items,
              (SELECT count(*) FROM thisthat_answer a WHERE a.question_id = q.id AND a.user_id = q.asker_id) AS asker_n,
              (SELECT count(*) FROM thisthat_answer a WHERE a.question_id = q.id AND a.user_id = q.recipient_id) AS recip_n
         FROM question q WHERE id = $1 AND kind IN ('this_that', 'predict', 'wyr') AND is_removed = false`,
      [targetId]
    );
    const q = rows[0];
    if (
      q &&
      (q.asker_id === req.user.id || q.recipient_id === req.user.id) &&
      Number(q.items) > 0 &&
      Number(q.asker_n) >= Number(q.items) &&
      Number(q.recip_n) >= Number(q.items)
    ) {
      member = true;
    }
  } else {
    const { rows } = await query(
      `SELECT r.responder_id, q.asker_id, q.recipient_id
         FROM response r JOIN question q ON q.id = r.question_id WHERE r.id = $1`,
      [targetId]
    );
    const row = rows[0];
    if (row && (row.asker_id === req.user.id || row.recipient_id === req.user.id)) {
      member = true;
      isAuthor = row.responder_id === req.user.id;
    }
  }
  if (!member) return res.status(404).json({ error: 'Not found.' });
  if (isAuthor) return res.status(403).json({ error: "You can't react to your own." });

  const cur = await query(
    'SELECT emoji FROM reaction WHERE user_id = $1 AND target_kind = $2 AND target_id = $3',
    [req.user.id, targetKind, targetId]
  );
  // Tapping your current reaction (or sending none) clears it.
  if (!emoji || cur.rows[0]?.emoji === emoji) {
    await query('DELETE FROM reaction WHERE user_id = $1 AND target_kind = $2 AND target_id = $3', [
      req.user.id,
      targetKind,
      targetId,
    ]);
    return res.json({ ok: true, emoji: null });
  }
  if (!REACTION_EMOJI.includes(emoji)) return res.status(400).json({ error: 'Unknown reaction.' });
  await query(
    `INSERT INTO reaction (user_id, target_kind, target_id, emoji) VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, target_kind, target_id) DO UPDATE SET emoji = EXCLUDED.emoji, created_at = now()`,
    [req.user.id, targetKind, targetId, emoji]
  );
  if (targetKind === 'event')
    await notifyEvent(targetId, asUser(req.user.id, req.user.display_name), 'reacted', eventTitle);
  res.json({ ok: true, emoji });
});

/* -------------------------------------------------------------- seen, gently */

router.post('/seen', requireUser, async (req, res) => {
  const { kind, id } = req.body || {};
  if (kind === 'question') {
    // Only the recipient marks a share as seen.
    await query(
      'UPDATE question SET seen_at = now(), seen_by = $1 WHERE id = $2 AND recipient_id = $1 AND seen_at IS NULL',
      [req.user.id, id]
    );
  } else if (kind === 'response') {
    // Only the asker of the share marks its reply as seen.
    await query(
      `UPDATE response SET seen_at = now(), seen_by = $1
        WHERE id = $2 AND seen_at IS NULL
          AND question_id IN (SELECT id FROM question WHERE asker_id = $1)`,
      [req.user.id, id]
    );
  } else {
    return res.status(400).json({ error: 'Bad target.' });
  }
  res.json({ ok: true });
});

/* ---------------------------------------------------------- countdown (couple) */

router.get('/couple', requireUser, async (_req, res) => {
  const { rows } = await query(
    `SELECT e.id AS event_id, e.kind, e.title, e.all_day,
            to_char(e.starts_at, 'YYYY-MM-DD"T"HH24:MI') AS starts_at
       FROM couple_state cs
       JOIN calendar_event e ON e.id = cs.countdown_event_id AND e.is_removed = false
      WHERE cs.id = 1`
  );
  const c = rows[0];
  res.json({
    countdown: c
      ? { eventId: c.event_id, kind: c.kind, title: c.title, startsAt: c.starts_at, allDay: c.all_day }
      : null,
  });
});

// Create or edit the countdown's underlying calendar event (from the banner),
// or clear the selection. Editing/creating notifies the partner like any event.
// "Set as our countdown" — point the shared countdown at an existing event.
// (Countdowns are created/edited through the normal calendar-event endpoints;
// the banner just opens the event editor.)
router.post('/couple/countdown/select', requireUser, async (req, res) => {
  const eventId = req.body?.eventId;
  const { rows } = await query('SELECT id FROM calendar_event WHERE id = $1 AND is_removed = false', [
    eventId,
  ]);
  if (!rows[0]) return res.status(404).json({ error: 'Event not found.' });
  await query('UPDATE couple_state SET countdown_event_id = $1 WHERE id = 1', [eventId]);
  res.json({ ok: true });
});

/* ----------------------------------------------------------- thinking of you */

router.post('/nudge', requireUser, async (req, res) => {
  const partner = await partnerOf(req.user.id);
  if (!partner) return res.status(500).json({ error: 'No partner profile found.' });
  await query('INSERT INTO nudge (from_id, to_id) VALUES ($1, $2)', [req.user.id, partner.id]);
  await logActivity(req.user.id, 'thinking_of_you', 'user', partner.id);
  notify(partner.id, { title: `${req.user.display_name} is thinking of you`, body: '💛' });
  res.status(201).json({ ok: true });
});

// The most recent unseen nudge (if any), and marks them seen.
router.get('/nudges', requireUser, async (req, res) => {
  const { rows } = await query(
    `SELECT u.display_name AS from_name, n.created_at
       FROM nudge n JOIN app_user u ON u.id = n.from_id
      WHERE n.to_id = $1 AND n.seen = false
      ORDER BY n.created_at DESC`,
    [req.user.id]
  );
  if (rows.length) await query('UPDATE nudge SET seen = true WHERE to_id = $1 AND seen = false', [req.user.id]);
  res.json({
    latest: rows[0] ? { fromName: rows[0].from_name, at: rows[0].created_at, count: rows.length } : null,
  });
});

/* -------------------------------------------------------------- shared lists */

const LIST_TYPES = ['activities', 'couple_goals', 'to_do', 'other'];
const listType = (t) => (LIST_TYPES.includes(t) ? t : 'other');

router.get('/lists', requireUser, async (_req, res) => {
  const lists = await query(
    `SELECT id, title, list_type, created_by, created_at, last_edited_by, last_edited_at
       FROM list WHERE is_removed = false ORDER BY created_at`
  );
  const items = await query(
    `SELECT id, list_id, text, created_by, is_done, state_by, state_at
       FROM list_item WHERE is_removed = false ORDER BY created_at`
  );
  const listIds = lists.rows.map((l) => l.id);
  // Reactions + comments on the list as a whole (not the items).
  const [reactions, comments] = await Promise.all([
    reactionsForTargets('list', listIds),
    commentsForTargets('list', listIds),
  ]);
  res.json(
    lists.rows.map((l) => ({
      id: l.id,
      title: l.title,
      type: l.list_type,
      createdBy: l.created_by,
      createdAt: l.created_at,
      lastEditedBy: l.last_edited_by,
      lastEditedAt: l.last_edited_at,
      items: items.rows
        .filter((i) => i.list_id === l.id)
        .map((i) => ({
          id: i.id,
          text: i.text,
          ownerId: i.created_by, // who added / last edited it
          isDone: i.is_done,
          stateBy: i.state_by, // who last toggled it
          stateAt: i.state_at,
        })),
      reactions: reactions.filter((r) => r.target_id === String(l.id)).map((r) => ({ userId: r.user_id, emoji: r.emoji })),
      comments: commentsOn(comments, l.id),
    }))
  );
});

// Create a list with a name, a type, and any number of items.
router.post('/lists', requireUser, async (req, res) => {
  const title = (req.body?.title || '').trim().slice(0, 120);
  if (!title) return res.status(400).json({ error: 'Name the list.' });
  const type = listType(req.body?.type);
  const texts = (Array.isArray(req.body?.items) ? req.body.items : [])
    .map((t) => String(t || '').trim().slice(0, 200))
    .filter(Boolean)
    .slice(0, 200);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'INSERT INTO list (title, list_type, created_by) VALUES ($1, $2, $3) RETURNING id',
      [title, type, req.user.id]
    );
    const listId = rows[0].id;
    for (const text of texts)
      await client.query('INSERT INTO list_item (list_id, text, created_by) VALUES ($1, $2, $3)', [
        listId,
        text,
        req.user.id,
      ]);
    await client.query('COMMIT');
    await logActivity(req.user.id, 'made_list', 'list', listId, { title, type, items: texts.length });
    res.status(201).json({ id: listId });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// Save edits to a list: title, type, and its items (add / edit / soft-remove).
// Editing an item's text transfers its ownership to whoever edited it. Changes
// are logged per-item (activity_log) and the list's last-edited stamp is set.
router.patch('/lists/:id', requireUser, async (req, res) => {
  const id = req.params.id;
  const cur = await query('SELECT id, title, list_type FROM list WHERE id = $1 AND is_removed = false', [id]);
  if (!cur.rows[0]) return res.status(404).json({ error: 'List not found.' });
  const title = (req.body?.title || '').trim().slice(0, 120);
  if (!title) return res.status(400).json({ error: 'Name the list.' });
  const type = listType(req.body?.type ?? cur.rows[0].list_type);
  const incoming = Array.isArray(req.body?.items) ? req.body.items : [];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let changed = false;

    if (title !== cur.rows[0].title || type !== cur.rows[0].list_type) {
      await client.query('UPDATE list SET title = $1, list_type = $2 WHERE id = $3', [title, type, id]);
      await logActivity(req.user.id, 'edited_list', 'list', id, { title, type });
      changed = true;
    }

    const existing = await client.query(
      'SELECT id, text FROM list_item WHERE list_id = $1 AND is_removed = false',
      [id]
    );
    const byId = new Map(existing.rows.map((r) => [r.id, r]));
    for (const raw of incoming) {
      const text = String(raw?.text || '').trim().slice(0, 200);
      if (raw?.id && byId.has(raw.id)) {
        if (raw.removed) {
          await client.query('UPDATE list_item SET is_removed = true WHERE id = $1', [raw.id]);
          await logActivity(req.user.id, 'removed_list_item', 'list', id, { itemId: raw.id });
          changed = true;
        } else if (text && text !== byId.get(raw.id).text) {
          // Editing counts as (re)adding: ownership moves to the editor.
          await client.query('UPDATE list_item SET text = $1, created_by = $2 WHERE id = $3', [
            text,
            req.user.id,
            raw.id,
          ]);
          await logActivity(req.user.id, 'edited_list_item', 'list', id, { itemId: raw.id });
          changed = true;
        }
      } else if (!raw?.id && !raw?.removed && text) {
        await client.query('INSERT INTO list_item (list_id, text, created_by) VALUES ($1, $2, $3)', [
          id,
          text,
          req.user.id,
        ]);
        await logActivity(req.user.id, 'added_list_item', 'list', id);
        changed = true;
      }
    }

    if (changed)
      await client.query('UPDATE list SET last_edited_by = $1, last_edited_at = now() WHERE id = $2', [
        req.user.id,
        id,
      ]);
    await client.query('COMMIT');
    res.json({ ok: true, changed });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// Toggle an item's done state. Records who changed it and when (kept even when
// marked back to not-done). Ownership is unaffected — only edits change that.
router.post('/list-items/:id/toggle', requireUser, async (req, res) => {
  const { rows } = await query('SELECT is_done FROM list_item WHERE id = $1 AND is_removed = false', [
    req.params.id,
  ]);
  if (!rows[0]) return res.status(404).json({ error: 'Item not found.' });
  const next = !rows[0].is_done;
  await query('UPDATE list_item SET is_done = $1, state_by = $2, state_at = now() WHERE id = $3', [
    next,
    req.user.id,
    req.params.id,
  ]);
  res.json({ ok: true, isDone: next });
});

// Soft-delete a whole list (all deletes in loml are soft).
router.post('/lists/:id/remove', requireUser, async (req, res) => {
  await query('UPDATE list SET is_removed = true WHERE id = $1', [req.params.id]);
  await logActivity(req.user.id, 'removed_list', 'list', req.params.id);
  res.json({ ok: true });
});

// (List comments go through the generic /comments endpoint, target_type 'list'.)

/* -------------------------------------------------------------- calendar */

const STARTS_AT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const asUser = (id, name) => ({ id, name });

// Everything the two of you can see: all events (with reactions + comments) and
// this person's calendar notifications, in one call.
router.get('/calendar', requireUser, async (req, res) => {
  const events = await query(
    `SELECT e.id, e.kind, e.title,
            to_char(e.starts_at, 'YYYY-MM-DD"T"HH24:MI') AS starts_at, e.all_day,
            e.description, e.location,
            e.created_by, cu.display_name AS created_name, e.created_at,
            e.updated_by, uu.display_name AS updated_name, e.updated_at
       FROM calendar_event e
       JOIN app_user cu ON cu.id = e.created_by
       JOIN app_user uu ON uu.id = e.updated_by
      WHERE e.is_removed = false
      ORDER BY e.starts_at`
  );
  const ids = events.rows.map((e) => e.id);
  const [reactions, comments] = await Promise.all([
    reactionsForTargets('event', ids),
    commentsForTargets('event', ids),
  ]);

  const shaped = events.rows.map((e) => ({
    id: e.id,
    kind: e.kind,
    title: e.title,
    startsAt: e.starts_at,
    allDay: e.all_day,
    description: e.description,
    location: e.location,
    createdBy: asUser(e.created_by, e.created_name),
    createdAt: e.created_at,
    updatedBy: asUser(e.updated_by, e.updated_name),
    updatedAt: e.updated_at,
    reactions: reactions.filter((r) => r.target_id === String(e.id)).map((r) => ({ userId: r.user_id, emoji: r.emoji })),
    comments: commentsOn(comments, e.id),
  }));

  const notes = await query(
    `SELECT n.id, n.action, n.acknowledged, n.acknowledged_at, n.created_at,
            u.display_name AS from_name,
            e.id AS event_id, e.title AS event_title, e.kind AS event_kind, e.is_removed AS event_removed,
            to_char(e.starts_at, 'YYYY-MM-DD"T"HH24:MI') AS event_starts_at
       FROM event_notification n
       JOIN app_user u ON u.id = n.from_id
       JOIN calendar_event e ON e.id = n.event_id
      WHERE n.to_id = $1
      ORDER BY n.created_at DESC`,
    [req.user.id]
  );
  const shapeNote = (n) => ({
    id: n.id,
    action: n.action,
    fromName: n.from_name,
    createdAt: n.created_at,
    acknowledgedAt: n.acknowledged_at,
    event: {
      id: n.event_id,
      title: n.event_title,
      kind: n.event_kind,
      startsAt: n.event_starts_at,
      removed: n.event_removed,
    },
  });

  // Date requests (pending + accepted), with the accepted event's when.
  const reqs = await query(
    `SELECT r.id, r.requester_id, r.recipient_id, r.title, r.description, r.location, r.status,
            r.event_id, r.responded_by, r.responded_at, r.created_at,
            ru.display_name AS requester_name, cu.display_name AS recipient_name,
            e.kind AS event_kind, e.all_day AS event_all_day,
            to_char(e.starts_at, 'YYYY-MM-DD"T"HH24:MI') AS event_starts_at
       FROM date_request r
       JOIN app_user ru ON ru.id = r.requester_id
       JOIN app_user cu ON cu.id = r.recipient_id
       LEFT JOIN calendar_event e ON e.id = r.event_id
      WHERE r.is_removed = false AND (r.requester_id = $1 OR r.recipient_id = $1)
      ORDER BY r.created_at DESC`,
    [req.user.id]
  );
  const dateRequests = reqs.rows.map((r) => ({
    id: r.id,
    requesterId: r.requester_id,
    requesterName: r.requester_name,
    recipientId: r.recipient_id,
    recipientName: r.recipient_name,
    title: r.title,
    description: r.description,
    location: r.location,
    status: r.status,
    eventId: r.event_id,
    eventStartsAt: r.event_starts_at,
    eventAllDay: r.event_all_day,
    eventKind: r.event_kind,
    respondedAt: r.responded_at,
    createdAt: r.created_at,
  }));

  res.json({
    events: shaped,
    dateRequests,
    notifications: {
      needsAck: notes.rows.filter((n) => !n.acknowledged).map(shapeNote),
      acknowledged: notes.rows.filter((n) => n.acknowledged).map(shapeNote),
    },
  });
});

router.post('/calendar/events', requireUser, async (req, res) => {
  const kind = EVENT_KINDS.includes(req.body?.kind) ? req.body.kind : null;
  const title = (req.body?.title || '').trim();
  const allDay = Boolean(req.body?.allDay);
  const startsAt = (req.body?.startsAt || '').trim();
  const description = (req.body?.description || '').trim();
  const location = (req.body?.location || '').trim();
  if (!kind) return res.status(400).json({ error: 'Pick an event type.' });
  if (!title) return res.status(400).json({ error: 'Give it a title.' });
  if (!STARTS_AT_RE.test(startsAt)) return res.status(400).json({ error: 'Pick a date.' });

  const { rows } = await query(
    `INSERT INTO calendar_event (kind, title, starts_at, all_day, description, location, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $7) RETURNING id`,
    [kind, title, startsAt, allDay, description, location, req.user.id]
  );
  await logActivity(req.user.id, 'created_event', 'event', rows[0].id, { title });
  await notifyEvent(rows[0].id, asUser(req.user.id, req.user.display_name), 'created', title);
  res.status(201).json({ id: rows[0].id });
});

router.patch('/calendar/events/:id', requireUser, async (req, res) => {
  const { rows } = await query('SELECT * FROM calendar_event WHERE id = $1 AND is_removed = false', [
    req.params.id,
  ]);
  const ev = rows[0];
  if (!ev) return res.status(404).json({ error: 'Event not found.' });

  const kind = EVENT_KINDS.includes(req.body?.kind) ? req.body.kind : ev.kind;
  const title = (req.body?.title || '').trim();
  const allDay = Boolean(req.body?.allDay);
  const startsAt = (req.body?.startsAt || '').trim();
  const description = (req.body?.description || '').trim();
  const location = (req.body?.location || '').trim();
  if (!title) return res.status(400).json({ error: 'Give it a title.' });
  if (!STARTS_AT_RE.test(startsAt)) return res.status(400).json({ error: 'Pick a date.' });

  await query(
    `UPDATE calendar_event
        SET kind = $1, title = $2, starts_at = $3, all_day = $4, description = $5, location = $6,
            updated_by = $7, updated_at = now()
      WHERE id = $8`,
    [kind, title, startsAt, allDay, description, location, req.user.id, ev.id]
  );
  await logActivity(req.user.id, 'edited_event', 'event', ev.id, { title });
  await notifyEvent(ev.id, asUser(req.user.id, req.user.display_name), 'edited', title);
  res.json({ ok: true });
});

router.post('/calendar/events/:id/remove', requireUser, async (req, res) => {
  await query(
    'UPDATE calendar_event SET is_removed = true, updated_by = $1, updated_at = now() WHERE id = $2',
    [req.user.id, req.params.id]
  );
  await query('UPDATE couple_state SET countdown_event_id = NULL WHERE id = 1 AND countdown_event_id = $1', [
    req.params.id,
  ]);
  await logActivity(req.user.id, 'removed_event', 'event', req.params.id);
  res.json({ ok: true });
});

// (Event comments go through the generic /comments endpoint, target_type
// 'event' — which also fires the calendar "commented" notification.)

router.post('/calendar/notifications/:id/ack', requireUser, async (req, res) => {
  await query(
    'UPDATE event_notification SET acknowledged = true, acknowledged_at = now() WHERE id = $1 AND to_id = $2 AND acknowledged = false',
    [req.params.id, req.user.id]
  );
  res.json({ ok: true });
});

/* ------------------------------------------------------------ date requests */

// Propose a date: title (+ optional description / location), no time yet.
router.post('/date-requests', requireUser, async (req, res) => {
  const title = (req.body?.title || '').trim().slice(0, 160);
  if (!title) return res.status(400).json({ error: 'Give it a title.' });
  const description = (req.body?.description || '').trim();
  const location = (req.body?.location || '').trim();
  const partner = await partnerOf(req.user.id);
  if (!partner) return res.status(400).json({ error: 'No partner to send to.' });
  const { rows } = await query(
    `INSERT INTO date_request (requester_id, recipient_id, title, description, location)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [req.user.id, partner.id, title, description, location]
  );
  await logActivity(req.user.id, 'date_requested', 'date_request', rows[0].id, { title });
  notify(partner.id, { title: `${req.user.display_name} sent a date request`, body: title });
  res.status(201).json({ id: rows[0].id });
});

// Accept: the recipient sets a date/time (+ type, editable details), which
// creates the calendar event and marks the request accepted.
router.post('/date-requests/:id/accept', requireUser, async (req, res) => {
  const { rows } = await query(
    "SELECT * FROM date_request WHERE id = $1 AND is_removed = false AND status = 'pending'",
    [req.params.id]
  );
  const r = rows[0];
  if (!r) return res.status(404).json({ error: 'Request not found.' });
  if (r.recipient_id !== req.user.id) return res.status(403).json({ error: 'Only the person asked can accept.' });

  const kind = EVENT_KINDS.includes(req.body?.kind) ? req.body.kind : 'date_night';
  const title = (req.body?.title || r.title || '').trim().slice(0, 160);
  const startsAt = (req.body?.startsAt || '').trim();
  const allDay = Boolean(req.body?.allDay);
  const description = (req.body?.description ?? r.description ?? '').trim();
  const location = (req.body?.location ?? r.location ?? '').trim();
  if (!title) return res.status(400).json({ error: 'Give it a title.' });
  if (!STARTS_AT_RE.test(startsAt)) return res.status(400).json({ error: 'Pick a date.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ev = await client.query(
      `INSERT INTO calendar_event (kind, title, starts_at, all_day, description, location, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7) RETURNING id`,
      [kind, title, startsAt, allDay, description, location, req.user.id]
    );
    const eventId = ev.rows[0].id;
    await client.query(
      "UPDATE date_request SET status = 'accepted', event_id = $1, responded_by = $2, responded_at = now() WHERE id = $3",
      [eventId, req.user.id, r.id]
    );
    await client.query('COMMIT');
    await logActivity(req.user.id, 'accepted_date_request', 'date_request', r.id, { eventId });
    // A real event now exists — the requester gets a calendar notification + push.
    await notifyEvent(eventId, asUser(req.user.id, req.user.display_name), 'created', title);
    res.status(201).json({ ok: true, eventId });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// Decline (recipient): soft-removed; the requester is notified.
router.post('/date-requests/:id/decline', requireUser, async (req, res) => {
  const { rows } = await query(
    "SELECT * FROM date_request WHERE id = $1 AND is_removed = false AND status = 'pending'",
    [req.params.id]
  );
  const r = rows[0];
  if (!r) return res.status(404).json({ error: 'Request not found.' });
  if (r.recipient_id !== req.user.id) return res.status(403).json({ error: 'Only the person asked can decline.' });
  await query(
    "UPDATE date_request SET status = 'declined', is_removed = true, responded_by = $1, responded_at = now() WHERE id = $2",
    [req.user.id, r.id]
  );
  notify(r.requester_id, { title: `${req.user.display_name} declined a date request`, body: r.title });
  res.json({ ok: true });
});

// Cancel / withdraw (requester): soft-removed; the recipient is notified.
router.post('/date-requests/:id/cancel', requireUser, async (req, res) => {
  const { rows } = await query(
    "SELECT * FROM date_request WHERE id = $1 AND is_removed = false AND status = 'pending'",
    [req.params.id]
  );
  const r = rows[0];
  if (!r) return res.status(404).json({ error: 'Request not found.' });
  if (r.requester_id !== req.user.id) return res.status(403).json({ error: 'Only the requester can cancel.' });
  await query(
    "UPDATE date_request SET status = 'cancelled', is_removed = true, responded_by = $1, responded_at = now() WHERE id = $2",
    [req.user.id, r.id]
  );
  notify(r.recipient_id, { title: `${req.user.display_name} withdrew a date request`, body: r.title });
  res.json({ ok: true });
});

/* ------------------------------------------------------------- coupons */

router.get('/coupons', requireUser, async (req, res) => {
  const { rows } = await query(
    `SELECT c.id, c.from_id, c.to_id, c.title, c.note, c.icon, c.status, c.redeemed_at, c.created_at,
            f.display_name AS from_name, t.display_name AS to_name
       FROM coupon c JOIN app_user f ON f.id = c.from_id JOIN app_user t ON t.id = c.to_id
      WHERE c.is_removed = false AND (c.from_id = $1 OR c.to_id = $1)
      ORDER BY c.created_at DESC`,
    [req.user.id]
  );
  const ids = rows.map((r) => r.id);
  const [reactions, comments] = await Promise.all([
    reactionsForTargets('coupon', ids),
    commentsForTargets('coupon', ids),
  ]);
  res.json(
    rows.map((c) => ({
      id: c.id,
      fromId: c.from_id,
      fromName: c.from_name,
      toId: c.to_id,
      toName: c.to_name,
      title: c.title,
      note: c.note,
      icon: c.icon,
      status: c.status,
      redeemedAt: c.redeemed_at,
      createdAt: c.created_at,
      reactions: reactions.filter((r) => r.target_id === String(c.id)).map((r) => ({ userId: r.user_id, emoji: r.emoji })),
      comments: commentsOn(comments, c.id),
    }))
  );
});

// Give the partner a coupon.
router.post('/coupons', requireUser, async (req, res) => {
  const title = (req.body?.title || '').trim().slice(0, 120);
  if (!title) return res.status(400).json({ error: 'Give the coupon a title.' });
  const note = (req.body?.note || '').trim().slice(0, 300);
  const icon = (req.body?.icon || '🎟️').trim().slice(0, 8) || '🎟️';
  const partner = await partnerOf(req.user.id);
  if (!partner) return res.status(400).json({ error: 'No partner to give it to.' });
  const { rows } = await query(
    'INSERT INTO coupon (from_id, to_id, title, note, icon) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [req.user.id, partner.id, title, note, icon]
  );
  await logActivity(req.user.id, 'gave_coupon', 'coupon', rows[0].id, { title });
  notify(partner.id, { title: `${req.user.display_name} gave you a coupon 🎟️`, body: title });
  res.status(201).json({ id: rows[0].id });
});

// Redeem a coupon you were given (awards Knowing-You points, computed live).
router.post('/coupons/:id/redeem', requireUser, async (req, res) => {
  const { rows } = await query("SELECT * FROM coupon WHERE id = $1 AND is_removed = false AND status = 'active'", [req.params.id]);
  const c = rows[0];
  if (!c) return res.status(404).json({ error: 'Not found.' });
  if (c.to_id !== req.user.id) return res.status(403).json({ error: 'Only the person it was given to can redeem it.' });
  await query("UPDATE coupon SET status = 'redeemed', redeemed_at = now() WHERE id = $1", [c.id]);
  await logActivity(req.user.id, 'redeemed_coupon', 'coupon', c.id);
  notify(c.from_id, { title: `${req.user.display_name} redeemed a coupon 🎟️`, body: c.title });
  res.json({ ok: true });
});

// Take back a coupon you gave (only while still active). Soft-removed.
router.post('/coupons/:id/revoke', requireUser, async (req, res) => {
  const { rows } = await query("SELECT * FROM coupon WHERE id = $1 AND is_removed = false AND status = 'active'", [req.params.id]);
  const c = rows[0];
  if (!c) return res.status(404).json({ error: 'Not found.' });
  if (c.from_id !== req.user.id) return res.status(403).json({ error: 'Only the giver can take it back.' });
  await query("UPDATE coupon SET status = 'revoked', is_removed = true WHERE id = $1", [c.id]);
  notify(c.to_id, { title: `${req.user.display_name} took back a coupon`, body: c.title });
  res.json({ ok: true });
});

/* ------------------------------------------------------------- bingo */

// Any full line, and whether the whole card is done, for a set of done squares.
function bingoStatus(size, doneSet) {
  const at = (r, c) => r * size + c;
  let anyLine = false;
  for (let r = 0; r < size; r++) if ([...Array(size).keys()].every((c) => doneSet.has(at(r, c)))) anyLine = true;
  for (let c = 0; c < size; c++) if ([...Array(size).keys()].every((r) => doneSet.has(at(r, c)))) anyLine = true;
  if ([...Array(size).keys()].every((i) => doneSet.has(at(i, i)))) anyLine = true;
  if ([...Array(size).keys()].every((i) => doneSet.has(at(i, size - 1 - i)))) anyLine = true;
  return { anyLine, full: doneSet.size >= size * size };
}

router.get('/bingo', requireUser, async (_req, res) => {
  const boards = await query(
    `SELECT id, title, size, created_by, awarded_row, awarded_full, created_at
       FROM bingo_board WHERE is_removed = false ORDER BY created_at DESC`
  );
  const bIds = boards.rows.map((b) => b.id);
  const squares = bIds.length
    ? (await query('SELECT id, board_id, position, text, done_by, done_at FROM bingo_square WHERE board_id = ANY($1::uuid[]) ORDER BY position', [bIds])).rows
    : [];
  const [reactions, comments] = await Promise.all([reactionsForTargets('bingo', bIds), commentsForTargets('bingo', bIds)]);
  res.json(
    boards.rows.map((b) => ({
      id: b.id,
      title: b.title,
      size: b.size,
      createdBy: b.created_by,
      awardedRow: b.awarded_row,
      awardedFull: b.awarded_full,
      createdAt: b.created_at,
      squares: squares
        .filter((s) => s.board_id === b.id)
        .map((s) => ({ id: s.id, position: s.position, text: s.text, doneBy: s.done_by, doneAt: s.done_at })),
      reactions: reactions.filter((r) => r.target_id === String(b.id)).map((r) => ({ userId: r.user_id, emoji: r.emoji })),
      comments: commentsOn(comments, b.id),
    }))
  );
});

router.post('/bingo', requireUser, async (req, res) => {
  const title = (req.body?.title || '').trim().slice(0, 120);
  if (!title) return res.status(400).json({ error: 'Name the board.' });
  const size = [3, 5].includes(Number(req.body?.size)) ? Number(req.body.size) : 5;
  const usedKey = (req.body?.usedKey || '').trim().slice(0, 120);
  const squares = (Array.isArray(req.body?.squares) ? req.body.squares : []).map((t) => String(t || '').trim().slice(0, 120));
  if (squares.length !== size * size || squares.some((t) => !t))
    return res.status(400).json({ error: `Give all ${size * size} squares.` });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('INSERT INTO bingo_board (title, size, created_by) VALUES ($1, $2, $3) RETURNING id', [
      title,
      size,
      req.user.id,
    ]);
    const id = rows[0].id;
    for (let i = 0; i < squares.length; i++)
      await client.query('INSERT INTO bingo_square (board_id, position, text) VALUES ($1, $2, $3)', [id, i, squares[i]]);
    await client.query('COMMIT');
    if (usedKey)
      await query('INSERT INTO game_used (game_key, used_by) VALUES ($1, $2) ON CONFLICT (game_key) DO NOTHING', [usedKey, req.user.id]);
    await logActivity(req.user.id, 'made_bingo', 'bingo', id, { title });
    const partner = await partnerOf(req.user.id);
    if (partner) notify(partner.id, { title: `${req.user.display_name} started a bingo board`, body: title });
    res.status(201).json({ id });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

router.post('/bingo/squares/:id/toggle', requireUser, async (req, res) => {
  const { rows } = await query(
    `SELECT s.id, s.done_at, b.id AS board_id, b.size, b.awarded_row, b.awarded_full, b.is_removed
       FROM bingo_square s JOIN bingo_board b ON b.id = s.board_id WHERE s.id = $1`,
    [req.params.id]
  );
  const sq = rows[0];
  if (!sq || sq.is_removed) return res.status(404).json({ error: 'Not found.' });
  const next = !sq.done_at;
  if (next) await query('UPDATE bingo_square SET done_by = $1, done_at = now() WHERE id = $2', [req.user.id, sq.id]);
  else await query('UPDATE bingo_square SET done_by = NULL, done_at = NULL WHERE id = $1', [sq.id]);

  const done = await query('SELECT position FROM bingo_square WHERE board_id = $1 AND done_at IS NOT NULL', [sq.board_id]);
  const { anyLine, full } = bingoStatus(sq.size, new Set(done.rows.map((r) => r.position)));
  let newLine = false;
  let newFull = false;
  if (anyLine && !sq.awarded_row) {
    await query('UPDATE bingo_board SET awarded_row = true WHERE id = $1', [sq.board_id]);
    newLine = true;
  }
  if (full && !sq.awarded_full) {
    await query('UPDATE bingo_board SET awarded_full = true WHERE id = $1', [sq.board_id]);
    newFull = true;
  }
  res.json({ ok: true, isDone: next, newLine, newFull });
});

router.post('/bingo/:id/remove', requireUser, async (req, res) => {
  await query('UPDATE bingo_board SET is_removed = true WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

export default router;
