// A share is a question, a memory or a note. Questions are answered; memories
// and notes are acknowledged (an optional reply). These helpers keep the
// wording consistent everywhere.

export const SHARE_KINDS = ['question', 'memory', 'note'];

const LABELS = { question: 'Question', memory: 'Memory', note: 'Note' };

export const kindOf = (share) => (SHARE_KINDS.includes(share?.kind) ? share.kind : 'question');

export const kindLabel = (share) => LABELS[kindOf(share)];

export const isQuestion = (share) => kindOf(share) === 'question';

// What the recipient does with an open share.
export const actionLabel = (share) => (isQuestion(share) ? 'Respond' : 'Acknowledge');
