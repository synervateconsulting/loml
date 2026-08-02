// The shared "Knowing You" score. Every game type — plus the daily question —
// feeds one couple-wide number. Keeping the weights, their plain-language
// legend, the boot-time backfill, and the daily-streak math all in this one
// file means the write path (routes.js), the recompute, and the breakdown
// window can never drift out of agreement.

import { query } from './db.js';
import { appToday } from './daily.js';

// Points per game.
//   - This / That & WYR: a flat reward for playing it through together. Matching
//     is deliberately NOT worth more — opposites attract.
//   - Predict My Pick: a base for playing, plus a bonus for each pick the
//     partner guesses right (this is the game about knowing each other).
//   - Guess My Answer: scored by the author's verdict, with a floor for a miss
//     so playing still counts.
export const SCORE_WEIGHTS = {
  this_that: { complete: 5 },
  wyr: { complete: 5 },
  predict: { complete: 3, perCorrect: 3 },
  guess: { got_it: 10, close: 5, missed: 2 },
};

// Daily question: each day you BOTH answer is worth more than the last, so a
// long streak compounds. Worth = base + (streakDay - 1) * step, capped.
export const DAILY_BASE = 2;
export const DAILY_STEP = 1;
export const DAILY_CAP = 12;
export const dailyDayPoints = (streakDay) =>
  Math.min(DAILY_CAP, DAILY_BASE + (Math.max(1, streakDay) - 1) * DAILY_STEP);

// Weighted points for a finished pick game. `matches` only matters for predict.
export function pickPoints(kind, matches = 0) {
  if (kind === 'predict') return SCORE_WEIGHTS.predict.complete + SCORE_WEIGHTS.predict.perCorrect * Math.max(0, matches | 0);
  return SCORE_WEIGHTS[kind]?.complete || 0; // this_that / wyr: flat for completing
}

// Weighted points for a judged guess.
export const guessPoints = (verdict) => SCORE_WEIGHTS.guess[verdict] ?? 0;

// The most a single game of each kind could earn, for "3 / 12" style progress.
export const maxPointsFor = (kind, items = 0) => {
  if (kind === 'guess') return SCORE_WEIGHTS.guess.got_it;
  if (kind === 'predict') return SCORE_WEIGHTS.predict.complete + SCORE_WEIGHTS.predict.perCorrect * Math.max(0, items | 0);
  return SCORE_WEIGHTS[kind]?.complete || 0;
};

// Plain-language explanation of each source, returned to the breakdown window so
// the copy always matches the weights above.
export const SCORE_LEGEND = [
  {
    key: 'guess',
    label: 'Guess My Answer',
    detail: `Got it +${SCORE_WEIGHTS.guess.got_it} · Close +${SCORE_WEIGHTS.guess.close} · Missed +${SCORE_WEIGHTS.guess.missed}`,
  },
  {
    key: 'predict',
    label: 'Predict My Pick',
    detail: `+${SCORE_WEIGHTS.predict.complete} for playing, +${SCORE_WEIGHTS.predict.perCorrect} for each pick your partner nails`,
  },
  { key: 'this_that', label: 'This / That', detail: `+${SCORE_WEIGHTS.this_that.complete} for playing it through together` },
  { key: 'wyr', label: 'Would You Rather', detail: `+${SCORE_WEIGHTS.wyr.complete} for playing it through together` },
  {
    key: 'daily',
    label: 'Daily question',
    detail: `+${DAILY_BASE} and climbing each day you both answer — longer streak, more per day (up to +${DAILY_CAP})`,
  },
];

// One day apart? Compares two 'YYYY-MM-DD' strings by calendar days (UTC-safe).
function dayDiff(a, b) {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

// Couple-wide daily-question points. A day counts once BOTH partners answered.
// Consecutive completed days build a streak; each is worth dailyDayPoints(pos).
// currentStreak is only "live" if the last completed day is today or yesterday.
export async function computeDailyScore() {
  const { rows } = await query(
    `SELECT to_char(day, 'YYYY-MM-DD') AS day, count(DISTINCT user_id)::int AS answerers
       FROM daily_answer GROUP BY day ORDER BY day ASC`
  );
  let points = 0;
  let streak = 0;
  let longest = 0;
  let completed = 0;
  let prev = null;
  for (const r of rows) {
    if (r.answerers < 2) {
      streak = 0;
      prev = null;
      continue; // only a day you both answered maintains the streak
    }
    streak = prev && dayDiff(prev, r.day) === 1 ? streak + 1 : 1;
    prev = r.day;
    completed += 1;
    points += dailyDayPoints(streak);
    if (streak > longest) longest = streak;
  }

  // Is the trailing streak still alive?
  let currentStreak = 0;
  if (prev) {
    const today = appToday();
    const gap = dayDiff(prev, today);
    if (gap <= 1) currentStreak = streak;
  }

  return { points, completedDays: completed, currentStreak, longestStreak: longest };
}

// The grand total shown on the brain meter: all game points + daily points.
export async function knowingTotal() {
  const [gp, daily] = await Promise.all([
    query('SELECT COALESCE(SUM(points), 0)::int AS total FROM game_points'),
    computeDailyScore(),
  ]);
  return gp.rows[0].total + daily.points;
}

// Recompute every game's points from the current weights on boot. This is what
// makes games you've *already* played count and lets a weight change take effect
// retroactively. (Daily points are always computed live, so they need no
// backfill.) Idempotent — only touches rows whose value actually changes.
export async function backfillScores() {
  let touched = 0;

  // Pick games that are fully revealed (both people answered every item).
  const { rows: picks } = await query(
    `SELECT q.id, q.kind,
            (SELECT count(*)::int FROM thisthat_item ti WHERE ti.question_id = q.id) AS items,
            (SELECT count(*)::int FROM thisthat_answer a WHERE a.question_id = q.id AND a.user_id = q.asker_id) AS asker_n,
            (SELECT count(*)::int FROM thisthat_answer b WHERE b.question_id = q.id AND b.user_id = q.recipient_id) AS rec_n,
            (SELECT count(*)::int FROM thisthat_answer a
               JOIN thisthat_answer b ON a.item_id = b.item_id AND a.choice = b.choice
              WHERE a.question_id = q.id AND a.user_id = q.asker_id AND b.user_id = q.recipient_id) AS matches
       FROM question q
      WHERE q.kind IN ('this_that', 'predict', 'wyr') AND q.is_removed = false`
  );
  for (const p of picks) {
    if (!p.items || p.asker_n < p.items || p.rec_n < p.items) continue; // not revealed yet
    const points = pickPoints(p.kind, p.matches);
    const r = await query(
      `INSERT INTO game_points (question_id, source, points) VALUES ($1, $2, $3)
         ON CONFLICT (question_id) DO UPDATE SET points = EXCLUDED.points, source = EXCLUDED.source
        WHERE game_points.points IS DISTINCT FROM EXCLUDED.points OR game_points.source IS DISTINCT FROM EXCLUDED.source`,
      [p.id, p.kind, points]
    );
    touched += r.rowCount;
  }

  // Guesses that have been judged.
  const { rows: guesses } = await query(
    "SELECT id, guess_verdict FROM question WHERE kind = 'guess' AND is_removed = false AND guess_verdict IS NOT NULL"
  );
  for (const g of guesses) {
    const points = guessPoints(g.guess_verdict);
    const r = await query(
      `INSERT INTO game_points (question_id, source, points) VALUES ($1, 'guess', $2)
         ON CONFLICT (question_id) DO UPDATE SET points = EXCLUDED.points, source = EXCLUDED.source
        WHERE game_points.points IS DISTINCT FROM EXCLUDED.points OR game_points.source IS DISTINCT FROM EXCLUDED.source`,
      [g.id, points]
    );
    touched += r.rowCount;
  }

  if (touched) console.log(`Scoring backfill: updated ${touched} game(s).`);
  return touched;
}
