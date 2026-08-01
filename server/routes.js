import express from 'express';
import multer from 'multer';
import { query, keyMatches, logActivity, pool } from './db.js';
import { startSession, endSession, requireUser, partnerOf } from './auth.js';
import { publicKey, saveSubscription, notify } from './push.js';

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

const SHARE_KINDS = ['question', 'memory', 'note', 'song', 'reveal'];

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
   WHERE q.is_removed = false
`;

async function attachmentsFor(questionIds, responseIds) {
  if (!questionIds.length && !responseIds.length) return [];
  const { rows } = await query(
    `SELECT id, owner_kind, question_id, response_id, media_kind, mime_type,
            file_name, byte_size, duration_secs, is_removed, created_at
       FROM attachment
      WHERE (question_id = ANY($1::uuid[]) OR response_id = ANY($2::uuid[]))
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
      WHERE (target_kind = 'question' AND target_id = ANY($1::uuid[]))
         OR (target_kind = 'reveal'   AND target_id = ANY($1::uuid[]))
         OR (target_kind = 'response' AND target_id = ANY($2::uuid[]))`,
    [questionIds, responseIds]
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

async function keepersFor(questionIds) {
  if (!questionIds.length) return [];
  const { rows } = await query(
    'SELECT question_id, user_id FROM keepsake WHERE question_id = ANY($1::uuid[])',
    [questionIds]
  );
  return rows;
}

const reactionsOn = (reactions, kind, id) =>
  reactions.filter((x) => x.target_kind === kind && x.target_id === id).map((x) => ({ userId: x.user_id, emoji: x.emoji }));

function shapeQuestion(row, ctx) {
  const { attachments, reactions, revealAnswers, keepers, viewerId, partnerId } = ctx;
  const qAtt = attachments.filter((a) => a.question_id === row.id);
  const rAtt = attachments.filter((a) => row.response_id && a.response_id === row.response_id);

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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    askerId: row.asker_id,
    askerName: row.asker_name,
    recipientId: row.recipient_id,
    recipientName: row.recipient_name,
    reactions: reactionsOn(reactions, 'question', row.id),
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
  const [attachments, reactions, revealAnswers, keepers, partner] = await Promise.all([
    attachmentsFor(qIds, rIds),
    reactionsFor(qIds, rIds),
    revealAnswersFor(rows.filter((r) => r.kind === 'reveal').map((r) => r.id)),
    keepersFor(qIds),
    partnerOf(req.user.id),
  ]);
  const ctx = { attachments, reactions, revealAnswers, keepers, viewerId: req.user.id, partnerId: partner?.id };
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
  const kind = SHARE_KINDS.includes(req.body?.kind) ? req.body.kind : 'question';
  if (!title) return res.status(400).json({ error: 'Give it a title.' });
  if (kind === 'song' && !/^https?:\/\//i.test(link))
    return res.status(400).json({ error: 'Paste a link to the song.' });

  const partner = await partnerOf(req.user.id);
  if (!partner) return res.status(500).json({ error: 'No partner profile found.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO question (asker_id, recipient_id, kind, title, detail, link, artist, is_spicy)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [req.user.id, partner.id, kind, title, detail, kind === 'song' ? link : null, kind === 'song' ? artist : null, spicy]
    );
    const id = rows[0].id;
    await client.query(
      `INSERT INTO question_version (question_id, version, title, detail, edited_by)
       VALUES ($1, 1, $2, $3, $4)`,
      [id, title, detail, req.user.id]
    );
    // For a reveal prompt the asker answers blind up front; the recipient's
    // answer unlocks both later.
    if (kind === 'reveal') {
      await client.query(
        `INSERT INTO reveal_answer (question_id, user_id, body) VALUES ($1, $2, $3)`,
        [id, req.user.id, revealAnswer]
      );
    }
    await client.query('COMMIT');
    await logActivity(req.user.id, 'shared', 'question', id, { title, kind, spicy });
    notify(
      partner.id,
      spicy ? discreetShare(req.user.display_name) : { title: newShareTitle(req.user.display_name, kind), body: title }
    );
    res.status(201).json({ id });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
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
/* No UI yet in phase 1. These are live so adding audio/video later is a
   front-end job only. */

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

  const { rows } = await query(
    `INSERT INTO attachment
       (owner_kind, question_id, response_id, uploaded_by, media_kind, mime_type,
        file_name, byte_size, duration_secs, bytes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id, media_kind, mime_type, file_name, byte_size, duration_secs`,
    [
      ownerKind,
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

  const bytes = a.bytes; // Buffer straight from bytea
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
    "SELECT * FROM question WHERE id = $1 AND is_removed = false AND kind = 'reveal'",
    [req.params.id]
  );
  const q = rows[0];
  if (!q) return res.status(404).json({ error: 'Not found.' });
  if (q.asker_id !== req.user.id && q.recipient_id !== req.user.id)
    return res.status(403).json({ error: "This isn't yours." });
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
    if (revealed)
      await client.query("UPDATE question SET status = 'answered', updated_at = now() WHERE id = $1", [
        q.id,
      ]);
    await client.query('COMMIT');
    await logActivity(req.user.id, 'reveal_answered', 'question', q.id, { revealed });
    const other = q.asker_id === req.user.id ? q.recipient_id : q.asker_id;
    notify(
      other,
      q.is_spicy
        ? discreetReply(req.user.display_name)
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

/* ---------------------------------------------------------------- reactions */

const REACTION_EMOJI = ['❤️', '🔥', '😈', '😂', '🥹', '👀'];

router.post('/reactions', requireUser, async (req, res) => {
  const { targetKind, targetId, emoji } = req.body || {};
  if (!['question', 'response', 'reveal'].includes(targetKind))
    return res.status(400).json({ error: 'Bad target.' });

  // Confirm the target is part of a share you're in, and figure out whether
  // you authored it — you can't react to your own.
  let member = false;
  let isAuthor = false;
  if (targetKind === 'question') {
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
         FROM question q WHERE id = $1 AND kind = 'reveal' AND is_removed = false`,
      [targetId]
    );
    const q = rows[0];
    if (q && (q.asker_id === req.user.id || q.recipient_id === req.user.id) && Number(q.answered) >= 2) {
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
    `SELECT countdown_title,
            to_char(countdown_date, 'YYYY-MM-DD') AS countdown_date,
            to_char(countdown_time, 'HH24:MI')    AS countdown_time
       FROM couple_state WHERE id = 1`
  );
  res.json({
    countdownTitle: rows[0]?.countdown_title || null,
    countdownDate: rows[0]?.countdown_date || null,
    countdownTime: rows[0]?.countdown_time || null,
  });
});

router.post('/couple/countdown', requireUser, async (req, res) => {
  const title = (req.body?.title || '').trim();
  const date = req.body?.date || null; // 'YYYY-MM-DD', or null/empty to clear
  const time = date ? req.body?.time || null : null; // 'HH:MM', optional; cleared with the date
  await query(
    `UPDATE couple_state
        SET countdown_title = $1, countdown_date = $2, countdown_time = $3,
            updated_by = $4, updated_at = now()
      WHERE id = 1`,
    [title || null, date || null, time, req.user.id]
  );
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

router.get('/lists', requireUser, async (_req, res) => {
  const lists = await query(
    'SELECT id, title, created_by, created_at FROM list WHERE is_removed = false ORDER BY created_at'
  );
  const items = await query(
    `SELECT id, list_id, text, created_by, checked_by, checked_at
       FROM list_item WHERE is_removed = false ORDER BY created_at`
  );
  res.json(
    lists.rows.map((l) => ({
      id: l.id,
      title: l.title,
      createdBy: l.created_by,
      createdAt: l.created_at,
      items: items.rows
        .filter((i) => i.list_id === l.id)
        .map((i) => ({
          id: i.id,
          text: i.text,
          createdBy: i.created_by,
          checkedBy: i.checked_by,
          checkedAt: i.checked_at,
        })),
    }))
  );
});

router.post('/lists', requireUser, async (req, res) => {
  const title = (req.body?.title || '').trim();
  if (!title) return res.status(400).json({ error: 'Name the list.' });
  const { rows } = await query('INSERT INTO list (title, created_by) VALUES ($1, $2) RETURNING id', [
    title,
    req.user.id,
  ]);
  await logActivity(req.user.id, 'made_list', 'list', rows[0].id, { title });
  res.status(201).json({ id: rows[0].id });
});

router.post('/lists/:id/items', requireUser, async (req, res) => {
  const text = (req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Add some text.' });
  const l = await query('SELECT id FROM list WHERE id = $1 AND is_removed = false', [req.params.id]);
  if (!l.rows[0]) return res.status(404).json({ error: 'List not found.' });
  const { rows } = await query(
    'INSERT INTO list_item (list_id, text, created_by) VALUES ($1, $2, $3) RETURNING id',
    [req.params.id, text, req.user.id]
  );
  res.status(201).json({ id: rows[0].id });
});

router.post('/list-items/:id/toggle', requireUser, async (req, res) => {
  const { rows } = await query('SELECT checked_by FROM list_item WHERE id = $1 AND is_removed = false', [
    req.params.id,
  ]);
  if (!rows[0]) return res.status(404).json({ error: 'Item not found.' });
  if (rows[0].checked_by)
    await query('UPDATE list_item SET checked_by = NULL, checked_at = NULL WHERE id = $1', [req.params.id]);
  else
    await query('UPDATE list_item SET checked_by = $1, checked_at = now() WHERE id = $2', [
      req.user.id,
      req.params.id,
    ]);
  res.json({ ok: true });
});

router.post('/lists/:id/remove', requireUser, async (req, res) => {
  await query('UPDATE list SET is_removed = true WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

router.post('/list-items/:id/remove', requireUser, async (req, res) => {
  await query('UPDATE list_item SET is_removed = true WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

export default router;
