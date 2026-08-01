import { useState } from 'react';
import { DECKS } from '../decks.js';

// Browse a deck, tap a prompt -> opens the composer prefilled (as an
// "answer together" reveal by default).
export default function DecksView({ onUsePrompt }) {
  const [open, setOpen] = useState(DECKS[0]?.id || null);

  return (
    <div className="decks">
      <p className="decks__hint">
        Pick a card to start a share — great as an answer-together.
      </p>
      {DECKS.map((deck) => (
        <section key={deck.id} className="deck">
          <button
            type="button"
            className="deck__head"
            aria-expanded={open === deck.id}
            onClick={() => setOpen(open === deck.id ? null : deck.id)}
          >
            <span className="deck__name">{deck.name}</span>
            <span className="deck__blurb">{deck.blurb}</span>
            <span className="deck__chev" aria-hidden="true">
              {open === deck.id ? '–' : '+'}
            </span>
          </button>
          {open === deck.id && (
            <ul className="deck__cards">
              {deck.prompts.map((p) => (
                <li key={p}>
                  <button type="button" className="deck__card" onClick={() => onUsePrompt(p)}>
                    {p}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
