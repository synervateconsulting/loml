// Admin / cleanup console — hard deletes, gated behind ADMIN_ACCESS_KEY.
// Everything here is destructive and irreversible, so each purge runs in a
// transaction, cascades in FK-safe order, and is written to admin_action.
import express from 'express';
import { query, pool } from './db.js';
import {
  adminEnabled,
  adminKeyMatches,
  startAdminSession,
  endAdminSession,
  isAdmin,
  requireAdmin,
} from './auth.js';
import { promptForDay } from './daily.js';

const router = express.Router();

async function logAdmin(action, target, detail) {
  await query('INSERT INTO admin_action (action, target, detail) VALUES ($1, $2, $3)', [
    action,
    target ? String(target) : null,
    detail ? JSON.stringify(detail) : null,
  ]);
}

/* --------------------------------------------------------------- auth */

router.post('/login', (req, res) => {
  if (!adminEnabled()) return res.status(404).json({ error: 'Not found.' });
  if (!adminKeyMatches(req.body?.key)) return res.status(401).json({ error: 'Wrong admin key.' });
  startAdminSession(res);
  res.json({ ok: true });
});

router.post('/logout', (req, res) => {
  endAdminSession(res);
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  res.json({ enabled: adminEnabled(), admin: isAdmin(req) });
});

// Everything below requires an admin session.
router.use(requireAdmin);

/* ----------------------------------------------------------- overview */

router.get('/overview', async (_req, res) => {
  const users = (await query('SELECT id, display_name FROM app_user')).rows;
  const nameOf = (id) => users.find((u) => u.id === id)?.display_name || `#${id}`;

  const shares = (
    await query(
      `SELECT id, kind, title, is_spicy, status, is_removed, created_at, asker_id, recipient_id
         FROM question ORDER BY created_at DESC LIMIT 200`
    )
  ).rows.map((q) => ({
    id: q.id,
    kind: q.kind,
    title: q.title,
    isSpicy: q.is_spicy,
    status: q.status,
    isRemoved: q.is_removed,
    createdAt: q.created_at,
    from: nameOf(q.asker_id),
    to: nameOf(q.recipient_id),
  }));

  const events = (
    await query(
      `SELECT id, kind, title, starts_at, all_day, is_removed, created_at FROM calendar_event
        ORDER BY created_at DESC LIMIT 200`
    )
  ).rows.map((e) => ({
    id: e.id,
    kind: e.kind,
    title: e.title,
    startsAt: e.starts_at,
    allDay: e.all_day,
    isRemoved: e.is_removed,
  }));

  const dailyRows = (
    await query(
      "SELECT to_char(day,'YYYY-MM-DD') AS day, user_id, body FROM daily_answer ORDER BY day DESC, user_id"
    )
  ).rows;
  const byDay = new Map();
  for (const r of dailyRows) {
    if (!byDay.has(r.day)) byDay.set(r.day, []);
    byDay.get(r.day).push({ userId: r.user_id, name: nameOf(r.user_id), body: r.body });
  }
  const daily = [...byDay.entries()].map(([day, answers]) => ({ day, prompt: promptForDay(day), answers }));

  const points = (await query('SELECT COALESCE(SUM(points),0)::int AS n, count(*)::int AS rows FROM game_points')).rows[0];
  const played = (await query('SELECT count(*)::int AS n FROM game_used')).rows[0];

  res.json({
    users: users.map((u) => ({ id: u.id, name: u.display_name })),
    shares,
    events,
    daily,
    games: { points: points.n, pointRows: points.rows, playedKeys: played.n },
  });
});

/* -------------------------------------------------- share hard delete */

async function shareCounts(id) {
  const respIds = (await query('SELECT id FROM response WHERE question_id = $1', [id])).rows.map((r) => r.id);
  const one = async (sql, params) => (await query(sql, params)).rows[0].n;
  return {
    responses: respIds.length,
    revealAnswers: await one('SELECT count(*)::int n FROM reveal_answer WHERE question_id=$1', [id]),
    thisThatAnswers: await one('SELECT count(*)::int n FROM thisthat_answer WHERE question_id=$1', [id]),
    thisThatItems: await one('SELECT count(*)::int n FROM thisthat_item WHERE question_id=$1', [id]),
    keepsakes: await one('SELECT count(*)::int n FROM keepsake WHERE question_id=$1', [id]),
    gamePoints: await one('SELECT count(*)::int n FROM game_points WHERE question_id=$1', [id]),
    attachments: await one('SELECT count(*)::int n FROM attachment WHERE question_id=$1 OR response_id = ANY($2::uuid[])', [id, respIds]),
    reactions: await one(
      "SELECT count(*)::int n FROM reaction WHERE (target_kind IN ('question','reveal','thisthat') AND target_id=$1) OR (target_kind='response' AND target_id = ANY($2::uuid[]))",
      [id, respIds]
    ),
    versions: await one('SELECT count(*)::int n FROM question_version WHERE question_id=$1', [id]),
  };
}

// Preview: the share + what will cascade with it.
router.get('/share/:id', async (req, res) => {
  const { rows } = await query('SELECT id, kind, title, is_spicy, status, is_removed FROM question WHERE id = $1', [
    req.params.id,
  ]);
  if (!rows[0]) return res.status(404).json({ error: 'Not found.' });
  res.json({ share: rows[0], counts: await shareCounts(req.params.id) });
});

router.delete('/share/:id', async (req, res) => {
  const id = req.params.id;
  const { rows } = await query('SELECT id, title, kind FROM question WHERE id = $1', [id]);
  if (!rows[0]) return res.status(404).json({ error: 'Not found.' });
  const counts = await shareCounts(id);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const respIds = (await client.query('SELECT id FROM response WHERE question_id = $1', [id])).rows.map((r) => r.id);
    await client.query(
      "DELETE FROM reaction WHERE (target_kind IN ('question','reveal','thisthat') AND target_id=$1) OR (target_kind='response' AND target_id = ANY($2::uuid[]))",
      [id, respIds]
    );
    await client.query('DELETE FROM attachment WHERE question_id=$1 OR response_id = ANY($2::uuid[])', [id, respIds]);
    await client.query('DELETE FROM reveal_answer WHERE question_id=$1', [id]);
    await client.query('DELETE FROM thisthat_answer WHERE question_id=$1', [id]);
    await client.query('DELETE FROM thisthat_item WHERE question_id=$1', [id]);
    await client.query('DELETE FROM keepsake WHERE question_id=$1', [id]);
    await client.query('DELETE FROM game_points WHERE question_id=$1', [id]);
    await client.query('DELETE FROM response_version WHERE response_id = ANY($1::uuid[])', [respIds]);
    await client.query('DELETE FROM response WHERE question_id=$1', [id]);
    await client.query('DELETE FROM question_version WHERE question_id=$1', [id]);
    await client.query(
      "DELETE FROM activity_log WHERE (entity_kind='question' AND entity_id=$1) OR (entity_kind='response' AND entity_id = ANY($2::text[]))",
      [id, respIds]
    );
    await client.query('DELETE FROM question WHERE id=$1', [id]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  await logAdmin('delete_share', id, { title: rows[0].title, kind: rows[0].kind, counts });
  res.json({ ok: true, counts });
});

/* -------------------------------------------------- daily hard delete */

// Delete a whole day, or one person's answer for that day.
router.delete('/daily', async (req, res) => {
  const day = String(req.query.day || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return res.status(400).json({ error: 'Bad day.' });
  const userId = req.query.userId ? Number(req.query.userId) : null;
  const result = userId
    ? await query('DELETE FROM daily_answer WHERE day = $1::date AND user_id = $2', [day, userId])
    : await query('DELETE FROM daily_answer WHERE day = $1::date', [day]);
  await logAdmin('delete_daily', day, { userId, deleted: result.rowCount });
  res.json({ ok: true, deleted: result.rowCount });
});

/* ------------------------------------------------- calendar hard delete */

router.delete('/event/:id', async (req, res) => {
  const id = req.params.id;
  const { rows } = await query('SELECT id, title FROM calendar_event WHERE id = $1', [id]);
  if (!rows[0]) return res.status(404).json({ error: 'Not found.' });
  const counts = {
    comments: (await query('SELECT count(*)::int n FROM event_comment WHERE event_id=$1', [id])).rows[0].n,
    reactions: (await query("SELECT count(*)::int n FROM reaction WHERE target_kind='event' AND target_id=$1", [id])).rows[0].n,
  };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE couple_state SET countdown_event_id = NULL WHERE countdown_event_id = $1', [id]);
    await client.query("DELETE FROM reaction WHERE target_kind='event' AND target_id=$1", [id]);
    await client.query('DELETE FROM event_comment WHERE event_id=$1', [id]);
    await client.query('DELETE FROM event_notification WHERE event_id=$1', [id]);
    await client.query('DELETE FROM calendar_event WHERE id=$1', [id]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  await logAdmin('delete_event', id, { title: rows[0].title, counts });
  res.json({ ok: true, counts });
});

/* ------------------------------------------------------- games reset */

router.post('/games/reset', async (req, res) => {
  const clearPoints = Boolean(req.body?.points);
  const clearPlayed = Boolean(req.body?.played);
  const out = {};
  if (clearPoints) out.points = (await query('DELETE FROM game_points')).rowCount;
  if (clearPlayed) out.played = (await query('DELETE FROM game_used')).rowCount;
  await logAdmin('reset_games', null, out);
  res.json({ ok: true, ...out });
});

export default router;
