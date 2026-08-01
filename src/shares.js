// A share is a question, a memory, a note, a song, or a "reveal" (both answer
// blind, then it unlocks). Questions and reveals are answered; memories, notes
// and songs are acknowledged (an optional reply). These helpers keep the
// wording consistent everywhere.

export const SHARE_KINDS = ['question', 'memory', 'note', 'song', 'reveal', 'this_that'];

const LABELS = {
  question: 'Question',
  memory: 'Memory',
  note: 'Note',
  song: 'Song',
  reveal: 'Together',
  this_that: 'This / That',
};

export const kindOf = (share) => (SHARE_KINDS.includes(share?.kind) ? share.kind : 'question');

export const kindLabel = (share) => LABELS[kindOf(share)];

export const isQuestion = (share) => kindOf(share) === 'question';
export const isReveal = (share) => kindOf(share) === 'reveal';
export const isSong = (share) => kindOf(share) === 'song';
export const isThisThat = (share) => kindOf(share) === 'this_that';

// What the recipient does with an open share.
export const actionLabel = (share) => {
  const k = kindOf(share);
  if (k === 'question') return 'Respond';
  if (k === 'reveal') return 'Answer';
  if (k === 'this_that') return 'Play';
  return 'Acknowledge';
};

export const REACTION_EMOJI = ['❤️', '🔥', '😈', '😂', '🥹', '👀'];
