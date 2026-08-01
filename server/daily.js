// The daily question. Both partners get the SAME prompt each day, picked
// deterministically from the date so no server state is needed to choose it.
export const DAILY_QUESTIONS = [
  'What was the best part of your day?',
  'What are you looking forward to this week?',
  'What’s something small I did recently that you appreciated?',
  'What’s on your mind right now that you haven’t said out loud?',
  'If we could teleport anywhere for dinner tonight, where?',
  'What’s a tiny thing that made you smile today?',
  'What do you need more of from me this week?',
  'What’s a moment from this week you want to remember?',
  'What song is stuck in your head?',
  'What’s something you’re proud of lately?',
  'What would make tomorrow a great day?',
  'What’s a little worry you could hand off to me?',
  'When did you feel most like yourself today?',
  'What’s something you’re curious about right now?',
  'What’s the last thing that made you laugh?',
  'What do you wish we did more often?',
  'What’s your comfort thing when you’re tired?',
  'What’s one thing you’re grateful for today?',
  'If today had a title, what would it be?',
  'What’s something you want to tell me but keep forgetting?',
];

// The couple's timezone — drives when "today" rolls over and when reminders
// fire. Set APP_TZ on the host (e.g. "America/New_York") to match where you are.
export const APP_TZ = process.env.APP_TZ || process.env.TZ || 'America/New_York';

// Today's date in the couple's timezone, as 'YYYY-MM-DD' (en-CA gives ISO order).
export const appToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: APP_TZ }).format(new Date());

// Current wall-clock { hour, minute } in the couple's timezone.
export const appClock = () => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: APP_TZ,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(new Date());
  const get = (t) => Number(parts.find((p) => p.type === t)?.value);
  let hour = get('hour');
  if (hour === 24) hour = 0; // some environments render midnight as 24
  return { hour, minute: get('minute') };
};

// Stable hash of a 'YYYY-MM-DD' string → pool index. Same date → same prompt.
export function promptForDay(day) {
  let h = 0;
  for (let i = 0; i < day.length; i++) h = (h * 31 + day.charCodeAt(i)) >>> 0;
  return DAILY_QUESTIONS[h % DAILY_QUESTIONS.length];
}
