// A share is a question, a memory, a note, a song, or a "reveal" (both answer
// blind, then it unlocks). Questions and reveals are answered; memories, notes
// and songs are acknowledged (an optional reply). These helpers keep the
// wording consistent everywhere.

export const SHARE_KINDS = ['question', 'memory', 'note', 'song', 'reveal', 'this_that', 'predict', 'guess', 'wyr'];

// Kinds built on the binary-pick grid.
export const PICK_KINDS = ['this_that', 'predict', 'wyr'];

// Kinds a user can start from the free "+ Share" composer. Everything else
// (reveal/Together and the game kinds) is launched from its own flow — the
// prompt decks and the Games tab — with the kind locked, so it never appears
// in the +Share picker.
export const COMPOSE_KINDS = ['question', 'memory', 'note', 'song'];

const LABELS = {
  question: 'Question',
  memory: 'Memory',
  note: 'Note',
  song: 'Song',
  reveal: 'Together',
  this_that: 'This / That',
  predict: 'Predict',
  guess: 'Guess',
  wyr: 'Would You Rather',
};

export const kindOf = (share) => (SHARE_KINDS.includes(share?.kind) ? share.kind : 'question');

export const kindLabel = (share) => LABELS[kindOf(share)];

export const isQuestion = (share) => kindOf(share) === 'question';
export const isReveal = (share) => kindOf(share) === 'reveal';
export const isSong = (share) => kindOf(share) === 'song';
export const isThisThat = (share) => kindOf(share) === 'this_that';
export const isPredict = (share) => kindOf(share) === 'predict';
export const isGuess = (share) => kindOf(share) === 'guess';
export const isWyr = (share) => kindOf(share) === 'wyr';
export const isPickGame = (share) => PICK_KINDS.includes(kindOf(share));

// What the recipient does with an open share.
export const actionLabel = (share) => {
  const k = kindOf(share);
  if (k === 'question') return 'Respond';
  if (k === 'reveal') return 'Answer';
  if (k === 'this_that' || k === 'wyr') return 'Play';
  if (k === 'predict' || k === 'guess') return 'Guess';
  return 'Acknowledge';
};

export const REACTION_EMOJI = ['❤️', '🔥', '😈', '😂', '🥹', '👀'];
