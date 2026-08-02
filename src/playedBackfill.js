// One-time reconciliation for the "Played" tag. The tag is driven by keys in
// game_used, written only at creation time — so games played before that
// feature (and any whose key never got recorded) show as un-played. The key is
// never stored on the game itself, so we can't read the link back; we infer it
// by matching each existing game to the template it was launched from.
//
// Matching is deliberately conservative:
//   - Decks & Guess: exact (trimmed) title / prompt-text match.
//   - This/That, Predict, WYR: title == template name AND every one of the
//     template's item pairs is present (the composer lets you add items before
//     sending, so the game's items are a superset). This makes a false positive
//     essentially impossible — a custom build would have to reproduce a
//     template's name and its exact pairs. Edited titles simply won't match
//     (a missing tag, never a wrong one).

import { DECKS } from './decks.js';
import { THISTHAT_TEMPLATES, PREDICT_TEMPLATES, WYR_TEMPLATES, GUESS_PROMPTS } from './thisthat.js';

const norm = (s) => String(s ?? '').trim();

// prompt/text string -> key
const deckByPrompt = new Map();
for (const deck of DECKS) (deck.prompts || []).forEach((p, i) => deckByPrompt.set(norm(p), `deck:${deck.id}:${i}`));

const guessByText = new Map();
for (const g of GUESS_PROMPTS) guessByText.set(norm(g.text), `guess:${g.id}`);

// For pick games: name -> { key, pairs:Set } so we can require the template's
// pairs to all be present in the game.
const pickIndex = (templates, prefix) => {
  const byName = new Map();
  for (const t of templates) {
    const pairs = new Set((t.items || []).map((it) => `${norm(it.left)}|${norm(it.right)}`));
    byName.set(norm(t.name), { key: `${prefix}:${t.id}`, pairs });
  }
  return byName;
};
const thisThatByName = pickIndex(THISTHAT_TEMPLATES, 'tt');
const predictByName = pickIndex(PREDICT_TEMPLATES, 'pt');
const wyrByName = pickIndex(WYR_TEMPLATES, 'wyr');

const pickPairs = (q) =>
  new Set((q.thisThat?.items || []).map((it) => `${norm(it.leftLabel)}|${norm(it.rightLabel)}`));

// A template matches a pick game when the name lines up and all its pairs are
// present in the game's items.
function matchPick(index, q) {
  const cand = index.get(norm(q.title));
  if (!cand) return null;
  const have = pickPairs(q);
  for (const p of cand.pairs) if (!have.has(p)) return null;
  return cand.key;
}

function keyForGame(q) {
  switch (q.kind) {
    case 'reveal':
      return deckByPrompt.get(norm(q.title)) || null;
    case 'guess':
      return guessByText.get(norm(q.title)) || null;
    case 'this_that':
      return matchPick(thisThatByName, q);
    case 'predict':
      return matchPick(predictByName, q);
    case 'wyr':
      return matchPick(wyrByName, q);
    default:
      return null;
  }
}

// Given every game the couple has and the keys already marked played, return the
// template keys that should be added. Empty when there's nothing to do.
export function missingPlayedKeys(questions = [], usedKeys = []) {
  const have = new Set(usedKeys);
  const missing = new Set();
  for (const q of questions) {
    const key = keyForGame(q);
    if (key && !have.has(key)) missing.add(key);
  }
  return [...missing];
}
