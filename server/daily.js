// The daily question. Both partners get the SAME prompt each day, chosen so it
// never repeats until the whole pool has been used (see promptForDay below).

// Grouped for authoring; the order on screen is a fixed deterministic shuffle
// (seededShuffle) so adjacent days feel varied. Keep every entry unique.
export const DAILY_QUESTIONS = [
  // — light daily check-ins —
  'What was the best part of your day?',
  'What’s a tiny thing that made you smile today?',
  'What’s the last thing that made you laugh?',
  'When did you feel most like yourself today?',
  'If today had a title, what would it be?',
  'What song is stuck in your head?',
  'What’s something small that annoyed you today?',
  'What’s the best thing you ate today?',
  'What surprised you today?',
  'What did you daydream about today?',
  'What’s one word for how today felt?',
  'What’s something you noticed today that most people would miss?',
  'What gave you energy today, and what drained it?',
  'What’s a small win you had today?',
  'What are you looking forward to tomorrow?',
  'What was the quietest moment of your day?',
  'Who crossed your mind today that you haven’t talked to in a while?',
  'What’s something you’re glad you did today?',
  'What did today teach you, if anything?',
  'What would’ve made today 10% better?',

  // — appreciation & love —
  'What’s something small I did recently that you appreciated?',
  'When did you last feel really loved by me?',
  'What’s something I do that you hope I never stop doing?',
  'What’s a way I make your life easier?',
  'What do you brag about me to other people?',
  'What’s a quality of mine you admired early on?',
  'When are you proudest to be with me?',
  'What’s something you find attractive about me that isn’t physical?',
  'What’s a moment you felt like we were a great team?',
  'What’s one thing you’d thank me for right now?',
  'How do you most like to be shown love?',
  'What makes you feel safe with me?',
  'What’s something I understand about you that others don’t?',
  'When do you feel most connected to me?',
  'What’s a compliment you wish I gave you more often?',
  'What’s something about us you’re grateful for today?',
  'What’s a little thing I could do this week that would mean a lot?',
  'What’s something you love about the way we argue or make up?',
  'What part of me do you think I underrate?',
  'What’s a way I’ve made you feel understood lately?',

  // — memories & our history —
  'What do you remember about the first time we met?',
  'What was your first honest impression of me?',
  'What’s a tiny moment with me you still think about?',
  'What’s our best day together so far?',
  'A song that takes you straight back to us?',
  'What’s a trip or outing you’d relive exactly as it was?',
  'When did you realize you had real feelings for me?',
  'What’s a photo of us you love, and why?',
  'What’s something we did early on that you miss?',
  'What’s a fight we had that actually made us better?',
  'What’s the funniest thing that’s ever happened to us?',
  'What’s a place that will always be “ours”?',
  'What’s a meal we shared that you still think about?',
  'What’s a moment you knew we’d be okay?',
  'What did you tell your friends about me at the start?',
  'What’s a small tradition of ours you cherish?',
  'What’s something brave one of us did in this relationship?',
  'When have you seen me change for the better?',
  'What’s a memory of us that makes you laugh every time?',
  'What’s the most nervous you’ve ever been around me?',

  // — future & dreams together —
  'Where do you most want to travel with me?',
  'What does an ideal ordinary Sunday look like for us in five years?',
  'What’s a tradition you’d love for us to start?',
  'What’s something you want us to learn together?',
  'What does “home” look like for us someday?',
  'What’s a dream you’re a little scared to say out loud?',
  'What do you hope stays exactly the same about us?',
  'What adventure should be on our someday list?',
  'What kind of older couple do you hope we become?',
  'If money were no object for a year, what would we do?',
  'What’s a goal you want us to chase as a team?',
  'What’s something you want to build or create together?',
  'What would our perfect anniversary look like?',
  'What’s a skill you’d love us both to have?',
  'What’s a place you’d love to live, even just for a season?',
  'What do you want more of in our life next year?',
  'What’s a promise you’d like us to make each other?',
  'What’s a small dream we could actually do this month?',
  'What do you hope we’re laughing about in ten years?',
  'What’s something you want to say yes to more often?',

  // — playful & silly —
  'If we swapped bodies for a day, what’s the first thing you’d do?',
  'What emoji am I?',
  'If our life were a sitcom, what’s this week’s episode title?',
  'What’s a hill you’ll die on?',
  'Pick our theme song, no thinking.',
  'What’s the weirdest thing you secretly find attractive about me?',
  'If we had a band, what would we be called?',
  'What fictional couple are we most like?',
  'What would your villain origin story be?',
  'If you could give me a ridiculous superpower, what is it?',
  'What’s a totally useless talent you wish you had?',
  'If we got a pet right now, what would we name it?',
  'What’s the pettiest thing that bothers you?',
  'What would be on the menu at our restaurant?',
  'If I were an animal, which one?',
  'What’s a conspiracy theory you kind of enjoy?',
  'What would our reality-show tagline be?',
  'If today were a movie genre, which one?',
  'What’s the most “us” thing we own?',
  'What’s a snack that describes your personality?',

  // — deeper & vulnerable —
  'What’s on your mind right now that you haven’t said out loud?',
  'What’s a worry you could hand off to me today?',
  'What are you a little afraid to ask me?',
  'When did you last feel truly proud of yourself?',
  'What’s something you’re working through right now?',
  'What do you need more of from me this week?',
  'What’s a fear you don’t talk about much?',
  'What makes you feel most seen?',
  'What’s something you’ve changed your mind about lately?',
  'When do you feel most alone, and what helps?',
  'What’s a part of yourself you’re still learning to accept?',
  'What’s something you wish you were braver about?',
  'What’s a hard thing you’re glad you went through?',
  'What do you do when you’re overwhelmed that I might not notice?',
  'What’s something you needed to hear as a kid?',
  'What’s a boundary you’re trying to hold better?',
  'What does support look like for you on a bad day?',
  'What’s something you’re grieving, big or small?',
  'When did you last cry, and why?',
  'What’s a truth about you that took me a while to learn?',

  // — values & beliefs —
  'What does a life well-lived look like to you?',
  'What’s a value you refuse to compromise on?',
  'What does success mean to you now versus five years ago?',
  'What’s something you believe that most people around you don’t?',
  'What do you want to be remembered for?',
  'What’s a cause you quietly care a lot about?',
  'What’s money for, in your opinion?',
  'What does “family” mean to you?',
  'What’s a lesson from your childhood you still carry?',
  'What do you think you owe the people you love?',
  'What’s a rule you live by?',
  'What does forgiveness mean to you?',
  'What’s something you’re unlearning?',
  'What makes you respect someone instantly?',
  'What does being a good partner mean to you?',
  'What’s a tradition or belief from your upbringing you want to keep?',
  'What’s one you want to leave behind?',
  'When do you feel most at peace?',
  'What does “enough” look like for you?',
  'What’s something you think is worth being stubborn about?',

  // — romance & closeness —
  'What’s the most romantic thing someone could do for you?',
  'Where’s your favorite place to be kissed — cheek, forehead, hand?',
  'What’s your idea of a perfect date night right now?',
  'What makes you feel wanted?',
  'What’s a small gesture that melts you every time?',
  'What’s a song you’d slow-dance to with me?',
  'What would make an ordinary night feel special?',
  'What’s something you’d love to hear me whisper?',
  'Cozy night in or a night out — and what kind?',
  'What’s the most attractive thing about confidence to you?',
  'What’s a nickname you secretly love?',
  'When do you feel most desired?',
  'What’s a tiny ritual of affection you’d never want to lose?',
  'What would you plan for us if you had a free evening and a small budget?',
  'What’s the last thing I did that gave you butterflies?',
  'What’s your love language on a hard day versus a good one?',
  'What’s a gift that would surprise you in the best way?',
  'What does a lazy, perfect morning together look like?',
  'What’s something small that feels intimate to you?',
  'What makes you feel closest to me physically?',

  // — getting to know you / preferences —
  'What’s your comfort thing when you’re tired?',
  'What’s a food you could eat every day forever?',
  'What’s your ideal way to spend a day off, alone?',
  'What’s a hobby you’d pick up if time and money weren’t issues?',
  'What’s a small luxury you love?',
  'What’s your most-used app and what does that say about you?',
  'What’s a book, show, or movie that changed you?',
  'What’s your comfort rewatch?',
  'Morning person or night owl, honestly?',
  'What’s something you’re weirdly picky about?',
  'What’s a smell that instantly comforts you?',
  'What’s your ideal weather and what would you do in it?',
  'What’s a topic you could talk about for an hour?',
  'What’s your go-to karaoke song?',
  'What did you want to be when you grew up?',
  'What’s something you collect, literally or in spirit?',
  'What’s your favorite way to be taken care of when you’re sick?',
  'What’s a place that always makes you feel calm?',
  'What’s a season of your life you’d love to revisit for a day?',
  'What’s the best gift you’ve ever received?',

  // — hypotheticals & would-you —
  'If we could teleport anywhere for dinner tonight, where?',
  'If you could master one skill overnight, what would it be?',
  'If we had a totally free 24 hours tomorrow, what’s the plan?',
  'If you could relive one day of your life, which?',
  'If you had to give a TED talk tomorrow, on what?',
  'Would you rather have more time or more money, and why?',
  'If our house was on fire and everyone was safe, what one object?',
  'If you could have dinner with anyone, living or dead, who?',
  'If you could freeze one age forever, which?',
  'If you won a year off work, what would you actually do?',
  'If you could send one text to your past self, what would it say?',
  'If we started a business together, what would it be?',
  'If you could instantly be fluent in a language, which?',
  'If you had a personal theme song that played when you walked in, what?',
  'If we could add one room to a dream home, what’s in it?',
  'If you could witness any moment in history, which?',
  'If you had to teach a class on something, what?',
  'If you could keep only five foods forever, what makes the list?',
  'If tomorrow you woke up brave, what would you do first?',
  'If you could give everyone one piece of advice, what?',

  // — growth & self-reflection —
  'What’s something you’re proud of lately?',
  'What’s a habit you’re trying to build or break?',
  'What’s something you’re curious about right now?',
  'What would make tomorrow a great day?',
  'What’s a fear you’ve outgrown?',
  'What’s a mistake you’re glad you made?',
  'What’s something you want to get better at this year?',
  'Who are you becoming that you like?',
  'What’s a compliment that stuck with you?',
  'What’s something you’ve been avoiding that you know you should do?',
  'What did you believe strongly a year ago that’s softened?',
  'What’s a risk you’re glad you took?',
  'What’s a small change that made a big difference for you?',
  'What’s something you want to say no to more?',
  'What’s a version of rest that actually restores you?',
  'What’s a strength of yours you sometimes forget you have?',
  'What’s a question you wish people asked you more?',
  'What’s something you’re slowly making peace with?',
  'What would “taking better care of yourself” look like this week?',
  'What’s a goal that scares and excites you?',

  // — gratitude & comfort —
  'What’s one thing you’re grateful for today?',
  'Who are you grateful for right now, and why?',
  'What’s a simple pleasure you’re thankful for?',
  'What’s something your past self would be amazed by?',
  'What part of your routine are you secretly grateful for?',
  'What’s a kindness someone showed you recently?',
  'What’s something about your body you’re thankful for?',
  'What’s a small comfort that always works for you?',
  'What made you feel taken care of recently?',
  'What’s something you have now that you once only hoped for?',
  'What’s a place you’re grateful exists?',
  'What’s a hard thing you’re grateful is behind you?',
  'What ordinary thing would you miss most if it were gone?',
  'Who made your life better this week without knowing it?',
  'What’s something beautiful you saw recently?',
  'What are you grateful I don’t make you do alone?',
  'What’s a memory you’re thankful to have?',
  'What’s something you’re looking forward to being grateful for?',
  'What made you feel lucky today?',
  'What’s a comfort from childhood you still reach for?',

  // — us as a couple —
  'What do you wish we did more often?',
  'What’s something we’re really good at as a couple?',
  'What’s a small thing we could do to feel more connected?',
  'What’s a way we balance each other out?',
  'What’s a decision we made together that you’re proud of?',
  'What’s our best inside joke?',
  'What’s something you want us to protect time for?',
  'How do you think we’ve grown since we started?',
  'What’s a phase of us you loved?',
  'What’s something we handle better now than we used to?',
  'What’s a habit as a couple you’d love to start?',
  'What’s something you never want us to take for granted?',
  'What do we always end up talking about?',
  'What’s a way I could support your friendships or family better?',
  'What’s our love in one metaphor?',
  'What’s something you hope our future selves remember about now?',
  'What recharges us as a couple?',
  'What’s a tiny ritual that keeps us close?',
  'What would a perfect low-key weekend for us look like?',
  'What’s something you’d like us to celebrate that we usually skip?',

  // — a moment / this week —
  'What’s a moment from this week you want to remember?',
  'What was the highlight of your week?',
  'What was hardest about this week?',
  'What did you learn about yourself this week?',
  'What’s something you’re glad you said no to this week?',
  'Who made your week better?',
  'What’s a small thing you’re proud of from this week?',
  'What do you want next week to feel like?',
  'What drained you most this week?',
  'What’s something you want to leave behind in this week?',
  'What surprised you about this week?',
  'What’s a promise you want to keep next week?',
  'What did we do this week that you loved?',
  'What’s something you meant to do this week and didn’t?',
  'What made you feel most alive this week?',

  // — connection & communication —
  'What’s something you want to tell me but keep forgetting?',
  'Is there anything on your mind you’ve been waiting for the right moment to say?',
  'What’s a question you’ve always wanted me to ask you?',
  'What’s something you wish I knew without you having to say it?',
  'How are you, really — not the short version?',
  'What’s a way I could listen better?',
  'What’s something you’d love to be asked at the end of every day?',
  'What do you need to feel heard?',
  'What’s a topic we should talk about more?',
  'What’s something you’ve been curious what I think about?',
  'What’s a small misunderstanding we could clear up?',
  'What would make it easier to tell me hard things?',
  'What’s something you appreciate about how we communicate?',
  'What’s a subject you’d love a long, lazy conversation about?',
  'What’s a way we could check in more often?',
];

// A fixed, deterministic shuffle so the daily order feels varied but is the
// same for both partners and stable across restarts (seeded PRNG, not random).
function seededShuffle(list, seed) {
  const a = list.slice();
  let s = seed >>> 0;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const SEQUENCE = seededShuffle(DAILY_QUESTIONS, 20260215);

// Days since a fixed epoch — walking the shuffled pool one per day means a
// question never repeats until the whole pool has been used (then it cycles,
// evenly spaced).
const EPOCH_UTC = Date.UTC(2025, 0, 1);
export function promptForDay(day) {
  const [y, m, d] = day.split('-').map(Number);
  const idx = Math.floor((Date.UTC(y, m - 1, d) - EPOCH_UTC) / 86400000);
  const n = SEQUENCE.length;
  return SEQUENCE[((idx % n) + n) % n];
}

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
