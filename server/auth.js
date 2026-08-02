import crypto from 'node:crypto';
import { query } from './db.js';

const COOKIE = 'loml_session';
const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
const SECRET = process.env.SESSION_SECRET;

if (!SECRET) {
  console.error('SESSION_SECRET is not set.');
  process.exit(1);
}

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${mac}`;
}

function unsign(token) {
  if (!token || !token.includes('.')) return null;
  const [body, mac] = token.split('.');
  const expected = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function startSession(res, user) {
  const token = sign({ uid: user.id, slug: user.slug, exp: Date.now() + THIRTY_DAYS });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: THIRTY_DAYS,
  });
}

export function endSession(res) {
  res.clearCookie(COOKIE);
}

export async function attachUser(req, _res, next) {
  const payload = unsign(req.cookies?.[COOKIE]);
  if (payload) {
    try {
      const { rows } = await query('SELECT id, slug, display_name FROM app_user WHERE id = $1', [
        payload.uid,
      ]);
      if (rows[0]) req.user = rows[0];
    } catch (err) {
      return next(err);
    }
  }
  next();
}

export function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Sign in to continue.' });
  next();
}

/* ------------------------------------------------------------------ admin */
// A separate maintenance identity — NOT one of the two couple members. Enabled
// only when ADMIN_ACCESS_KEY is set; otherwise every admin route 404s.
const ADMIN_COOKIE = 'loml_admin';
const ADMIN_KEY = process.env.ADMIN_ACCESS_KEY || '';

export const adminEnabled = () => Boolean(ADMIN_KEY);

export function adminKeyMatches(key) {
  if (!ADMIN_KEY) return false;
  const a = Buffer.from(String(key || ''));
  const b = Buffer.from(ADMIN_KEY);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function startAdminSession(res) {
  const token = sign({ admin: true, exp: Date.now() + THIRTY_DAYS });
  res.cookie(ADMIN_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: THIRTY_DAYS,
  });
}

export function endAdminSession(res) {
  res.clearCookie(ADMIN_COOKIE);
}

export function isAdmin(req) {
  if (!ADMIN_KEY) return false;
  return Boolean(unsign(req.cookies?.[ADMIN_COOKIE])?.admin);
}

export function requireAdmin(req, res, next) {
  if (!ADMIN_KEY) return res.status(404).json({ error: 'Not found.' });
  if (!isAdmin(req)) return res.status(401).json({ error: 'Admin sign-in required.' });
  next();
}

/** The other half of the pair. This app always has exactly two people in it. */
export async function partnerOf(userId) {
  const { rows } = await query(
    'SELECT id, slug, display_name FROM app_user WHERE id <> $1 ORDER BY id LIMIT 1',
    [userId]
  );
  return rows[0] || null;
}
