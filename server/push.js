// Server-side web push. Everything degrades to a no-op if the VAPID keys
// aren't configured, so the app runs fine without notifications set up.
import webpush from 'web-push';
import { query } from './db.js';
import { appToday } from './daily.js';

const PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const SUBJECT = process.env.VAPID_SUBJECT || 'mailto:loml@example.com';

export const pushEnabled = Boolean(PUBLIC_KEY && PRIVATE_KEY);

if (pushEnabled) {
  webpush.setVapidDetails(SUBJECT, PUBLIC_KEY, PRIVATE_KEY);
  console.log('Web push enabled.');
} else {
  console.log('Web push disabled (set VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY to enable).');
}

export const publicKey = () => PUBLIC_KEY;

export async function saveSubscription(userId, sub) {
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) return false;
  await query(
    `INSERT INTO push_subscription (user_id, endpoint, p256dh, auth)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (endpoint) DO UPDATE
       SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
    [userId, sub.endpoint, sub.keys.p256dh, sub.keys.auth]
  );
  return true;
}

// How many shares are waiting on this person — the number for the icon badge.
async function waitingCount(userId) {
  const { rows } = await query(
    `SELECT count(*)::int AS n FROM question
      WHERE recipient_id = $1 AND status = 'open' AND is_removed = false`,
    [userId]
  );
  let n = rows[0]?.n ?? 0;
  // An unanswered daily question also counts toward the app badge.
  const daily = await query('SELECT 1 FROM daily_answer WHERE day = $1::date AND user_id = $2', [appToday(), userId]);
  if (!daily.rows[0]) n += 1;
  return n;
}

// Send a notification to every device a user has. Dead subscriptions are pruned.
// Fire-and-forget from callers; never throws into a request handler.
export async function notify(userId, { title, body, url = '/' }) {
  if (!pushEnabled) return;
  try {
    const badge = await waitingCount(userId);
    const { rows } = await query(
      'SELECT endpoint, p256dh, auth FROM push_subscription WHERE user_id = $1',
      [userId]
    );
    const payload = JSON.stringify({ title, body, url, badge });
    await Promise.all(
      rows.map(async (r) => {
        const subscription = { endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } };
        try {
          await webpush.sendNotification(subscription, payload);
        } catch (err) {
          if (err?.statusCode === 404 || err?.statusCode === 410) {
            await query('DELETE FROM push_subscription WHERE endpoint = $1', [r.endpoint]);
          } else {
            console.error('push send failed:', err?.statusCode || err?.message);
          }
        }
      })
    );
  } catch (err) {
    console.error('notify error:', err?.message);
  }
}
