import express from 'express';
import multer from 'multer';
import { query, keyMatches, logActivity, pool } from './db.js';
import { startSession, endSession, requireUser, partnerOf } from './auth.js';
import { publicKey, saveSubscription, notify } from './push.js';

// Copy for the push banners.
const newShareTitle = (name, kind) =>
  kind === 'memory'
    ? `${name} shared a memory`
    : kind === 'note'
      ? `${name} left you a note`
      : `${name} asked you something`;

const replyTitle = (name, kind) =>
  kind === 'question' ? `${name} answered` : `${name} acknowledged your ${kind}`;

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

const SHARE_KINDS = ['question', 'memory', 'note'];

const QUESTION_SELECT = `
  SELECT q.id, q.kind, q.title, q.detail, q.status, q.version, q.created_at, q.updated_at,
         q.asker_id, q.recipient_id,
         asker.display_name  AS asker_name,
         recip.display_name  AS recipient_name,
         r.id AS response_id, r.body AS response_body, r.version AS response_version,
         r.created_at AS response_created_at, r.updated_at AS response_updated_at,
         r.responder_id
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

function shapeQuestion(row, attachments) {
  const qAtt = attachments.filter((a) => a.question_id === row.id);
  const rAtt = attachments.filter((a) => row.response_id && a.response_id === row.response_id);
  return {
    id: row.id,
    kind: row.kind || 'question',
    title: row.title,
    detail: row.detail,
    status: row.status,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    askerId: row.asker_id,
    askerName: row.asker_name,
    recipientId: row.recipient_id,
    recipientName: row.recipient_name,
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
  const attachments = await attachmentsFor(
    rows.map((r) => r.id),
    rows.filter((r) => r.response_id).map((r) => r.response_id)
  );
  const shaped = rows.map((r) => shapeQuestion(r, attachments));
  res.json({
    asked: shaped.filter((q) => q.askerId === req.user.id),
    received: shaped.filter((q) => q.recipientId === req.user.id),
  });
});

router.post('/questions', requireUser, async (req, res) => {
  const title = (req.body?.title || '').trim();
  const detail = (req.body?.detail || '').trim();
  const kind = SHARE_KINDS.includes(req.body?.kind) ? req.body.kind : 'question';
  if (!title) return res.status(400).json({ error: 'Give it a title.' });

  const partner = await partnerOf(req.user.id);
  if (!partner) return res.status(500).json({ error: 'No partner profile found.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO question (asker_id, recipient_id, kind, title, detail)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [req.user.id, partner.id, kind, title, detail]
    );
    const id = rows[0].id;
    await client.query(
      `INSERT INTO question_version (question_id, version, title, detail, edited_by)
       VALUES ($1, 1, $2, $3, $4)`,
      [id, title, detail, req.user.id]
    );
    await client.query('COMMIT');
    await logActivity(req.user.id, 'shared', 'question', id, { title, kind });
    notify(partner.id, { title: newShareTitle(req.user.display_name, kind), body: title });
    res.status(201).json({ id });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// Only the asker can edit, and only while it is still unanswered.
router.patch('/questions/:id', requireUser, async (req, res) => {
  const title = (req.body?.title || '').trim();
  const detail = (req.body?.detail || '').trim();
  if (!title) return res.status(400).json({ error: 'Give it a title.' });

  const { rows } = await query('SELECT * FROM question WHERE id = $1 AND is_removed = false', [
    req.params.id,
  ]);
  const q = rows[0];
  if (!q) return res.status(404).json({ error: 'Not found.' });
  if (q.asker_id !== req.user.id) return res.status(403).json({ error: 'This is not yours.' });
  if (q.status === 'answered')
    return res.status(409).json({ error: "This one's already resolved, so it's locked." });

  const nextVersion = q.version + 1;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE question SET title = $1, detail = $2, version = $3, updated_at = now() WHERE id = $4`,
      [title, detail, nextVersion, q.id]
    );
    await client.query(
      `INSERT INTO question_version (question_id, version, title, detail, edited_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [q.id, nextVersion, title, detail, req.user.id]
    );
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
    notify(q.asker_id, { title: replyTitle(req.user.display_name, q.kind), body: q.title });
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

export default router;
