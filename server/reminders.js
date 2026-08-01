// Nudges for the daily question. At noon, 5pm and 10pm (in APP_TZ) we push a
// reminder to anyone who hasn't answered today's question yet. The app badge
// rides along automatically (notify() sets it, and an unanswered daily counts).
import { query } from './db.js';
import { notify } from './push.js';
import { promptForDay, appToday, appClock, APP_TZ } from './daily.js';

const REMINDER_HOURS = [12, 17, 22];
let lastFiredKey = null;

export async function sendDailyReminders() {
  const today = appToday();
  const prompt = promptForDay(today);
  const { rows: users } = await query('SELECT id FROM app_user');
  const notified = [];
  for (const u of users) {
    const answered = await query('SELECT 1 FROM daily_answer WHERE day = $1::date AND user_id = $2', [today, u.id]);
    if (answered.rows[0]) continue;
    await notify(u.id, { title: '🗓️ Today’s question is waiting', body: prompt });
    notified.push(u.id);
  }
  return notified;
}

function tick() {
  const { hour, minute } = appClock();
  if (minute !== 0 || !REMINDER_HOURS.includes(hour)) return;
  const key = `${appToday()}:${hour}`;
  if (key === lastFiredKey) return; // fire once per reminder slot
  lastFiredKey = key;
  sendDailyReminders().catch((e) => console.error('daily reminder error:', e?.message));
}

export function startDailyReminders() {
  // Poll every 30s so we reliably catch each reminder minute regardless of boot time.
  setInterval(tick, 30 * 1000);
  console.log(`Daily reminders: ${REMINDER_HOURS.map((h) => `${h}:00`).join(', ')} (${APP_TZ}).`);
}
