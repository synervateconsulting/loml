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

// Stable hash of a 'YYYY-MM-DD' string → pool index. Same date → same prompt.
export function promptForDay(day) {
  let h = 0;
  for (let i = 0; i < day.length; i++) h = (h * 31 + day.charCodeAt(i)) >>> 0;
  return DAILY_QUESTIONS[h % DAILY_QUESTIONS.length];
}
