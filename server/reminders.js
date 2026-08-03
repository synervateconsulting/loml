// A tiny in-process scheduler. Any time-triggered job (daily reminders now;
// capsule unlocks / weekly check-ins / monthly recaps later) registers a tick
// handler here and the single 30s poll drives them all. Jobs get {hour, minute,
// today} and are responsible for their own "fire once per slot" bookkeeping.
import { query } from './db.js';
import { notify } from './push.js';
import { promptForDay, appToday, appClock, APP_TZ } from './daily.js';
import { weekStart, WEEKLY_KEYS } from './rituals.js';

const tasks = [];
// Register a scheduled task: fn({ hour, minute, today }) → runs every poll.
export function registerScheduledTask(fn) {
  tasks.push(fn);
}

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

// The daily-question reminder, as a registered task.
function dailyReminderTask({ hour, minute, today }) {
  if (minute !== 0 || !REMINDER_HOURS.includes(hour)) return;
  const key = `${today}:${hour}`;
  if (key === lastFiredKey) return; // fire once per reminder slot
  lastFiredKey = key;
  sendDailyReminders().catch((e) => console.error('daily reminder error:', e?.message));
}
registerScheduledTask(dailyReminderTask);

// Gratitude nudge at 8pm if you haven't added one today.
let lastGratitudeKey = null;
async function gratitudeReminderTask({ hour, minute, today }) {
  if (minute !== 0 || hour !== 20 || lastGratitudeKey === today) return;
  lastGratitudeKey = today;
  const { rows: users } = await query('SELECT id FROM app_user');
  for (const u of users) {
    const added = await query('SELECT 1 FROM gratitude WHERE from_id = $1 AND day = $2::date', [u.id, today]);
    if (!added.rows[0]) await notify(u.id, { title: '🌷 A gratitude for today?', body: 'One little thing you appreciated.' });
  }
}
registerScheduledTask(gratitudeReminderTask);

// Weekly check-in nudge Sunday 6pm if you haven't finished this week's.
let lastWeeklyKey = null;
async function weeklyReminderTask({ hour, minute, today }) {
  if (minute !== 0 || hour !== 18) return;
  if (new Date(`${today}T00:00:00`).getDay() !== 0) return; // Sunday only
  const ws = weekStart(today);
  if (lastWeeklyKey === ws) return;
  lastWeeklyKey = ws;
  const ck = await query('SELECT id FROM checkin WHERE week_start = $1::date', [ws]);
  const id = ck.rows[0]?.id;
  const { rows: users } = await query('SELECT id FROM app_user');
  for (const u of users) {
    let done = false;
    if (id) {
      const n = await query("SELECT count(*)::int AS c FROM checkin_answer WHERE checkin_id = $1 AND user_id = $2 AND body <> ''", [id, u.id]);
      done = n.rows[0].c >= WEEKLY_KEYS.length;
    }
    if (!done) await notify(u.id, { title: '🫶 Weekly check-in', body: 'Take a few minutes together this week.' });
  }
}
registerScheduledTask(weeklyReminderTask);

function tick() {
  const { hour, minute } = appClock();
  const ctx = { hour, minute, today: appToday() };
  for (const task of tasks) {
    try {
      task(ctx);
    } catch (e) {
      console.error('scheduled task error:', e?.message);
    }
  }
}

// Kept the name so index.js is unchanged; it now starts the whole scheduler.
export function startDailyReminders() {
  // Poll every 30s so we reliably catch each scheduled minute regardless of boot time.
  setInterval(tick, 30 * 1000);
  console.log(`Scheduler running (daily reminders ${REMINDER_HOURS.map((h) => `${h}:00`).join(', ')} ${APP_TZ}).`);
}
export { startDailyReminders as startScheduler };
