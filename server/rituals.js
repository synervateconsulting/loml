// Shared bits for the weekly check-in (used by routes + the scheduler).

export const WEEKLY_PROMPTS = [
  { key: 'well', label: 'What went well between us this week?' },
  { key: 'need', label: 'What do you need more of from me?' },
  { key: 'ahead', label: 'What are you looking forward to together?' },
];
export const WEEKLY_KEYS = WEEKLY_PROMPTS.map((p) => p.key);

// The Sunday that begins the week containing `todayStr` ('YYYY-MM-DD'), returned
// as a 'YYYY-MM-DD' string. UTC math so it doesn't drift by timezone.
export function weekStart(todayStr) {
  const [y, m, d] = todayStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - dt.getUTCDay()); // back up to Sunday (0)
  const p = (n) => String(n).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}`;
}
