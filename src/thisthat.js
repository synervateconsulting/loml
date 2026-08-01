// Pre-made "This / That" sets. Picking one starts a This/That share prefilled
// with these items (you can add your own before sending). Build-your-own needs
// at least MIN_ITEMS; templates carry 5–10.
export const MIN_ITEMS = 3;

// Prompts for "Guess My Answer": you answer privately, partner guesses.
export const GUESS_PROMPTS = [
  { id: 'comfort-food', text: 'What’s my ultimate comfort food?' },
  { id: 'perfect-day', text: 'Describe my perfect day off in one line.' },
  { id: 'first-impression', text: 'What did I first think when we met?' },
  { id: 'secret-talent', text: 'What’s a hidden talent I wish I had?' },
  { id: 'guilty-pleasure', text: 'What’s my guiltiest pleasure?' },
  { id: 'dream-trip', text: 'Where would I go if we could leave tomorrow?' },
  { id: 'love-language', text: 'How do I most like to be shown love?' },
  { id: 'pet-peeve', text: 'What’s my biggest pet peeve?' },
];

export const THISTHAT_TEMPLATES = [
  {
    id: 'food',
    name: 'Food',
    icon: '🍽️',
    blurb: 'Settle the great snack debates.',
    items: [
      { left: 'Sushi', leftIcon: '🍣', right: 'Pizza', rightIcon: '🍕' },
      { left: 'Cook in', leftIcon: '🏠', right: 'Eat out', rightIcon: '🍽️' },
      { left: 'Thai', leftIcon: '🌶️', right: 'Indian', rightIcon: '🍛' },
      { left: 'Coffee', leftIcon: '☕', right: 'Tea', rightIcon: '🍵' },
      { left: 'Sweet', leftIcon: '🍰', right: 'Savory', rightIcon: '🧀' },
      { left: 'Tacos', leftIcon: '🌮', right: 'Burgers', rightIcon: '🍔' },
      { left: 'Brunch', leftIcon: '🥞', right: 'Late dinner', rightIcon: '🌙' },
    ],
  },
  {
    id: 'music',
    name: 'Music',
    icon: '🎧',
    blurb: 'Whose playlist wins?',
    items: [
      { left: 'Throwbacks', leftIcon: '📼', right: 'New releases', rightIcon: '✨' },
      { left: 'Concert', leftIcon: '🎤', right: 'Cozy vinyl', rightIcon: '🎶' },
      { left: 'Pop', leftIcon: '💿', right: 'Indie', rightIcon: '🎸' },
      { left: 'Sing along', leftIcon: '🎙️', right: 'Just vibe', rightIcon: '😌' },
      { left: 'Slow songs', leftIcon: '🕯️', right: 'Dance floor', rightIcon: '🪩' },
      { left: 'Headphones', leftIcon: '🎧', right: 'Speaker out loud', rightIcon: '🔊' },
    ],
  },
  {
    id: 'vacation',
    name: 'Vacation',
    icon: '🌴',
    blurb: 'Plan the trip in your heads.',
    items: [
      { left: 'Beach', leftIcon: '🏖️', right: 'Mountains', rightIcon: '⛰️' },
      { left: 'Big city', leftIcon: '🏙️', right: 'Tiny village', rightIcon: '🏡' },
      { left: 'Plan it all', leftIcon: '🗺️', right: 'Wing it', rightIcon: '🎲' },
      { left: 'Resort', leftIcon: '🍹', right: 'Road trip', rightIcon: '🚗' },
      { left: 'Adventure', leftIcon: '🧗', right: 'Total rest', rightIcon: '🛌' },
      { left: 'Window seat', leftIcon: '🪟', right: 'Aisle seat', rightIcon: '🚶' },
      { left: 'Sunrise', leftIcon: '🌅', right: 'Sunset', rightIcon: '🌇' },
    ],
  },
  {
    id: 'cozy',
    name: 'Cozy night',
    icon: '🛋️',
    blurb: 'How we do a night in.',
    items: [
      { left: 'Movie', leftIcon: '🎬', right: 'Series', rightIcon: '📺' },
      { left: 'Takeout', leftIcon: '🥡', right: 'Home cooked', rightIcon: '🍲' },
      { left: 'Lights low', leftIcon: '🕯️', right: 'Lights on', rightIcon: '💡' },
      { left: 'Blanket fort', leftIcon: '🛖', right: 'Spread out', rightIcon: '🛋️' },
      { left: 'Early night', leftIcon: '😴', right: 'Stay up late', rightIcon: '🌙' },
      { left: 'Popcorn', leftIcon: '🍿', right: 'Ice cream', rightIcon: '🍨' },
    ],
  },
  {
    id: 'us',
    name: 'About us',
    icon: '💞',
    blurb: 'A few soft ones about the two of you.',
    items: [
      { left: 'Big surprise', leftIcon: '🎉', right: 'Quiet gesture', rightIcon: '🤍' },
      { left: 'Handwritten note', leftIcon: '✍️', right: 'Long voice note', rightIcon: '🎙️' },
      { left: 'Morning person', leftIcon: '🌞', right: 'Night owl', rightIcon: '🦉' },
      { left: 'Little spoon', leftIcon: '🥄', right: 'Big spoon', rightIcon: '🥄' },
      { left: 'Plan a date', leftIcon: '📅', right: 'Spontaneous date', rightIcon: '⚡' },
      { left: 'Gifts', leftIcon: '🎁', right: 'Quality time', rightIcon: '⏳' },
    ],
  },
];
