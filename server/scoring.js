// The two couple-wide scores.
//   - Game score (🧠): the playful, competitive-ish side — every scored game,
//     plus coupons redeemed and bingo lines.
//   - Bond score (❤️): the connection side — every regular share, plus the
//     rituals (daily question, gratitude, weekly check-in) with a streak that
//     compounds the longer you keep it up.
// Keeping the weights, their plain-language legends, the boot-time backfill, and
// all the streak math in this one file means the write path (routes.js), the
// recompute, and the breakdown window can never drift out of agreement.

import { query } from './db.js';
import { appToday } from './daily.js';
import { WEEKLY_KEYS, weekStart } from './rituals.js';

/* ============================ GAME SCORE (🧠) ============================ */

// Points per game.
//   - This / That & WYR: a flat reward for playing it through together. Matching
//     is deliberately NOT worth more — opposites attract.
//   - Predict My Pick: a base for playing, plus a bonus for each pick the
//     partner guesses right (this is the game about knowing each other).
//   - Guess My Answer: scored by the author's verdict, with a floor for a miss
//     so playing still counts.
//   - Decks (a 'reveal' / answer-together share): one free-form question you
//     both answer, no right/wrong — a medium flat reward for completing it.
export const SCORE_WEIGHTS = {
  this_that: { complete: 5 },
  wyr: { complete: 5 },
  reveal: { complete: 2 },
  predict: { complete: 3, perCorrect: 3 },
  guess: { got_it: 10, close: 5, missed: 2 },
};

// Redeeming a coupon (following through on a favor) is worth a flat amount.
export const COUPON_POINTS = 5;
// Bingo: a completed line is worth this, a full card five times that.
export const BINGO_ROW_POINTS = 5;
export const BINGO_FULL_POINTS = 25;

/* ============================ BOND SCORE (❤️) ============================ */

// Every regular share (question / memory / note / song) is worth a flat amount.
export const SHARE_POINTS = 2;
export const SHARE_KINDS = ['question', 'memory', 'note', 'song'];

// Rituals compound with their streak: worth = base + (streak - 1) * step, capped.
// Weekly is weighted well above daily; gratitude is the lightest, everyday nudge.
export const DAILY_BASE = 2;
export const DAILY_STEP = 1;
export const DAILY_CAP = 12;
export const dailyDayPoints = (streakDay) =>
  Math.min(DAILY_CAP, DAILY_BASE + (Math.max(1, streakDay) - 1) * DAILY_STEP);

export const GRAT_BASE = 1;
export const GRAT_STEP = 1;
export const GRAT_CAP = 8;
export const gratDayPoints = (streakDay) =>
  Math.min(GRAT_CAP, GRAT_BASE + (Math.max(1, streakDay) - 1) * GRAT_STEP);

export const WEEK_BASE = 5;
export const WEEK_STEP = 2;
export const WEEK_CAP = 25;
export const weekWeekPoints = (streakWeek) =>
  Math.min(WEEK_CAP, WEEK_BASE + (Math.max(1, streakWeek) - 1) * WEEK_STEP);

// Weighted points for a finished pick game. `matches` only matters for predict.
export function pickPoints(kind, matches = 0) {
  if (kind === 'predict') return SCORE_WEIGHTS.predict.complete + SCORE_WEIGHTS.predict.perCorrect * Math.max(0, matches | 0);
  return SCORE_WEIGHTS[kind]?.complete || 0; // this_that / wyr: flat for completing
}

// Weighted points for a judged guess.
export const guessPoints = (verdict) => SCORE_WEIGHTS.guess[verdict] ?? 0;

// Flat points for completing a deck / answer-together share (both answered).
export const revealPoints = () => SCORE_WEIGHTS.reveal.complete;

// The most a single game of each kind could earn, for "3 / 12" style progress.
export const maxPointsFor = (kind, items = 0) => {
  if (kind === 'guess') return SCORE_WEIGHTS.guess.got_it;
  if (kind === 'predict') return SCORE_WEIGHTS.predict.complete + SCORE_WEIGHTS.predict.perCorrect * Math.max(0, items | 0);
  return SCORE_WEIGHTS[kind]?.complete || 0;
};

// Plain-language explanation of each source, per score, returned to the
// breakdown window so the copy always matches the weights above.
export const GAME_LEGEND = [
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
  { key: 'reveal', label: 'Decks', detail: `+${SCORE_WEIGHTS.reveal.complete} for answering a deck prompt together` },
  { key: 'coupon', label: 'Coupons', detail: `+${COUPON_POINTS} for each coupon redeemed` },
  { key: 'bingo', label: 'Bingo', detail: `+${BINGO_ROW_POINTS} for a line, +${BINGO_FULL_POINTS} for a full card` },
];

export const BOND_LEGEND = [
  { key: 'share', label: 'Shares', detail: `+${SHARE_POINTS} for every question, memory, note or song you share` },
  {
    key: 'daily',
    label: 'Daily question',
    detail: `+${DAILY_BASE} and climbing each day you both answer — longer streak, more per day (up to +${DAILY_CAP})`,
  },
  {
    key: 'gratitude',
    label: 'Gratitude',
    detail: `+${GRAT_BASE} and climbing each day an appreciation is added (up to +${GRAT_CAP})`,
  },
  {
    key: 'weekly',
    label: 'Weekly check-in',
    detail: `+${WEEK_BASE} and climbing each week you both finish it — the heaviest ritual (up to +${WEEK_CAP})`,
  },
];

// Couple-wide coupon points: a flat amount per redeemed coupon.
export async function computeCouponScore() {
  const { rows } = await query(
    "SELECT count(*)::int AS n FROM coupon WHERE status = 'redeemed' AND is_removed = false"
  );
  const count = rows[0].n;
  return { points: count * COUPON_POINTS, count };
}

// Completed lines (each row, column and both diagonals) and whether the whole
// card is done, for a set of done positions on a size×size board. This is the
// single source of truth for both the score and the board's gold highlighting.
export function bingoLines(size, doneSet) {
  const at = (r, c) => r * size + c;
  const seq = [...Array(size).keys()];
  let lines = 0;
  for (let r = 0; r < size; r++) if (seq.every((c) => doneSet.has(at(r, c)))) lines += 1;
  for (let c = 0; c < size; c++) if (seq.every((r) => doneSet.has(at(r, c)))) lines += 1;
  if (seq.every((i) => doneSet.has(at(i, i)))) lines += 1;
  if (seq.every((i) => doneSet.has(at(i, size - 1 - i)))) lines += 1;
  return { lines, full: doneSet.size >= size * size };
}

// Bingo points, counted live from the current squares: +row for EVERY completed
// line on every board (a full 3×3 has 8), +full once per blackout. Because it's
// live, the score always matches the gold lines shown on the board.
export async function computeBingoScore() {
  const { rows } = await query(
    `SELECT b.size, array_agg(s.position) FILTER (WHERE s.done_at IS NOT NULL) AS done
       FROM bingo_board b LEFT JOIN bingo_square s ON s.board_id = b.id
      WHERE b.is_removed = false GROUP BY b.id, b.size`
  );
  let points = 0;
  let lines = 0;
  let full = 0;
  for (const b of rows) {
    const done = new Set((b.done || []).filter((p) => p !== null));
    const res = bingoLines(b.size, done);
    lines += res.lines;
    if (res.full) full += 1;
    points += res.lines * BINGO_ROW_POINTS + (res.full ? BINGO_FULL_POINTS : 0);
  }
  return { points, lines, full };
}

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

// Bond: every regular (non-game) share is worth a flat amount.
export async function computeShareScore() {
  const { rows } = await query(
    `SELECT count(*)::int AS n FROM question
      WHERE kind = ANY($1) AND is_removed = false AND COALESCE(is_draft, false) = false`,
    [SHARE_KINDS]
  );
  return { points: rows[0].n * SHARE_POINTS, count: rows[0].n };
}

// Bond: gratitude streak. A day counts if at least one appreciation was added;
// consecutive such days compound. Live if the last day is today or yesterday.
export async function computeGratitudeScore() {
  const { rows } = await query(
    `SELECT to_char(day, 'YYYY-MM-DD') AS day, count(*)::int AS n
       FROM gratitude WHERE is_removed = false GROUP BY day ORDER BY day ASC`
  );
  let points = 0;
  let streak = 0;
  let longest = 0;
  let days = 0;
  let prev = null;
  for (const r of rows) {
    streak = prev && dayDiff(prev, r.day) === 1 ? streak + 1 : 1;
    prev = r.day;
    days += 1;
    points += gratDayPoints(streak);
    if (streak > longest) longest = streak;
  }
  let currentStreak = 0;
  if (prev && dayDiff(prev, appToday()) <= 1) currentStreak = streak;
  return { points, days, currentStreak, longestStreak: longest };
}

// Whole weeks apart, from two Sunday 'YYYY-MM-DD' week-start strings.
const weekDiff = (a, b) => Math.round(dayDiff(a, b) / 7);

// Bond: weekly check-in streak. A week counts once BOTH partners have finished
// all prompts; consecutive completed weeks compound (weighted the heaviest).
export async function computeWeeklyScore() {
  const { rows } = await query(
    `SELECT to_char(c.week_start, 'YYYY-MM-DD') AS ws,
            (SELECT count(*) FROM (
               SELECT a.user_id FROM checkin_answer a
                WHERE a.checkin_id = c.id AND a.body <> ''
                GROUP BY a.user_id HAVING count(*) >= $1
             ) done)::int AS finishers
       FROM checkin c ORDER BY c.week_start ASC`,
    [WEEKLY_KEYS.length]
  );
  let points = 0;
  let streak = 0;
  let longest = 0;
  let weeks = 0;
  let prev = null;
  for (const r of rows) {
    if (r.finishers < 2) {
      streak = 0;
      prev = null;
      continue; // only a week you both finished maintains the streak
    }
    streak = prev && weekDiff(prev, r.ws) === 1 ? streak + 1 : 1;
    prev = r.ws;
    weeks += 1;
    points += weekWeekPoints(streak);
    if (streak > longest) longest = streak;
  }
  let currentStreak = 0;
  if (prev && weekDiff(prev, weekStart(appToday())) <= 1) currentStreak = streak;
  return { points, weeks, currentStreak, longestStreak: longest };
}

// Game score (🧠): scored games + coupons redeemed + bingo lines.
export async function gameTotal() {
  const [gp, coupons, bingo] = await Promise.all([
    query('SELECT COALESCE(SUM(points), 0)::int AS total FROM game_points'),
    computeCouponScore(),
    computeBingoScore(),
  ]);
  return gp.rows[0].total + coupons.points + bingo.points;
}

// Bond score (❤️): regular shares + all three rituals.
export async function bondTotal() {
  const [shares, daily, gratitude, weekly] = await Promise.all([
    computeShareScore(),
    computeDailyScore(),
    computeGratitudeScore(),
    computeWeeklyScore(),
  ]);
  return shares.points + daily.points + gratitude.points + weekly.points;
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

  // Decks (answer-together shares) both people have answered.
  const { rows: reveals } = await query(
    `SELECT q.id, (SELECT count(*)::int FROM reveal_answer ra WHERE ra.question_id = q.id) AS n
       FROM question q WHERE q.kind = 'reveal' AND q.is_removed = false`
  );
  for (const rv of reveals) {
    if (rv.n < 2) continue; // not revealed yet
    const r = await query(
      `INSERT INTO game_points (question_id, source, points) VALUES ($1, 'reveal', $2)
         ON CONFLICT (question_id) DO UPDATE SET points = EXCLUDED.points, source = EXCLUDED.source
        WHERE game_points.points IS DISTINCT FROM EXCLUDED.points OR game_points.source IS DISTINCT FROM EXCLUDED.source`,
      [rv.id, revealPoints()]
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
