import { useState } from 'react';
import DecksView from './DecksView.jsx';
import { THISTHAT_TEMPLATES, WYR_TEMPLATES, GUESS_PROMPTS } from '../thisthat.js';
import { templateToItems } from './ThisThat.jsx';

// "Games" groups the playful, low-stakes ways to start a share, nesting its own
// sub-tabs (Decks, This / That, Would You Rather, Guessing) beneath the top nav.
export default function GamesView({
  onUsePrompt,
  onStartThisThat,
  onStartPredict,
  onStartWyr,
  onStartGuess,
  usedGames = [],
  knowingPoints = 0,
}) {
  const [pane, setPane] = useState('decks');
  const used = new Set(usedGames);

  const tabs = [
    ['decks', 'Decks'],
    ['thisthat', 'This / That'],
    ['wyr', 'Would You Rather'],
    ['guessing', 'Guessing'],
  ];

  return (
    <div className="games">
      <div className="games__head">
        <div className="calpanes" role="group" aria-label="Games">
          {tabs.map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`topnav__item ${pane === key ? 'is-active' : ''}`}
              aria-pressed={pane === key}
              onClick={() => setPane(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="knowmeter" title="Points from Predict & Guess">
          🧠 <b>{knowingPoints}</b>
        </span>
      </div>

      {pane === 'decks' && <DecksView onUsePrompt={onUsePrompt} used={used} />}

      {pane === 'thisthat' && (
        <div className="thisthat">
          <p className="decks__hint">
            Pick a set, choose your own sides, and send it — you’ll both see where you match once they answer.
          </p>
          <div className="ttsets">
            {THISTHAT_TEMPLATES.map((t) => {
              const played = used.has(`tt:${t.id}`);
              return (
                <button
                  key={t.id}
                  type="button"
                  className={`ttset ${played ? 'is-played' : ''}`}
                  onClick={() => onStartThisThat?.({ title: t.name, items: templateToItems(t), usedKey: `tt:${t.id}` })}
                >
                  <span className="ttset__icon" aria-hidden="true">{t.icon}</span>
                  <span className="ttset__text">
                    <span className="ttset__name">
                      {t.name}
                      {played && <span className="playedtag">Played</span>}
                    </span>
                    <span className="ttset__blurb">{t.blurb}</span>
                  </span>
                  <span className="ttset__count">{t.items.length}</span>
                </button>
              );
            })}
          </div>
          <button type="button" className="ttset ttset--build" onClick={() => onStartThisThat?.({ title: '', items: null })}>
            <span className="ttset__icon" aria-hidden="true">＋</span>
            <span className="ttset__text">
              <span className="ttset__name">Build your own</span>
              <span className="ttset__blurb">Start from scratch — at least 3 this-or-thats.</span>
            </span>
          </button>
        </div>
      )}

      {pane === 'wyr' && (
        <div className="thisthat">
          <p className="decks__hint">
            Impossible choices — you both pick blind (add a “why” if you like), then see where you land.
          </p>
          <div className="ttsets">
            {WYR_TEMPLATES.map((t) => {
              const played = used.has(`wyr:${t.id}`);
              return (
                <button
                  key={t.id}
                  type="button"
                  className={`ttset ${played ? 'is-played' : ''}`}
                  onClick={() => onStartWyr?.({ title: t.name, items: templateToItems(t), usedKey: `wyr:${t.id}` })}
                >
                  <span className="ttset__icon" aria-hidden="true">{t.icon}</span>
                  <span className="ttset__text">
                    <span className="ttset__name">
                      {t.name}
                      {played && <span className="playedtag">Played</span>}
                    </span>
                    <span className="ttset__blurb">{t.blurb}</span>
                  </span>
                  <span className="ttset__count">{t.items.length}</span>
                </button>
              );
            })}
          </div>
          <button type="button" className="ttset ttset--build" onClick={() => onStartWyr?.({ title: '', items: null })}>
            <span className="ttset__icon" aria-hidden="true">＋</span>
            <span className="ttset__text">
              <span className="ttset__name">Build your own</span>
              <span className="ttset__blurb">Your own dilemmas — at least 3.</span>
            </span>
          </button>
        </div>
      )}

      {pane === 'guessing' && (
        <div className="thisthat">
          {/* Predict My Pick */}
          <p className="games__sub">🔮 Predict My Pick</p>
          <p className="decks__hint">Lock in your real picks — they guess how well they know you.</p>
          <div className="ttsets">
            {THISTHAT_TEMPLATES.map((t) => (
              <button
                key={t.id}
                type="button"
                className="ttset"
                onClick={() => onStartPredict?.({ title: t.name, items: templateToItems(t) })}
              >
                <span className="ttset__icon" aria-hidden="true">{t.icon}</span>
                <span className="ttset__text">
                  <span className="ttset__name">{t.name}</span>
                  <span className="ttset__blurb">{t.blurb}</span>
                </span>
                <span className="ttset__count">{t.items.length}</span>
              </button>
            ))}
          </div>
          <button type="button" className="ttset ttset--build" onClick={() => onStartPredict?.({ title: '', items: null })}>
            <span className="ttset__icon" aria-hidden="true">＋</span>
            <span className="ttset__text">
              <span className="ttset__name">Build your own</span>
              <span className="ttset__blurb">Your own picks for them to guess — at least 3.</span>
            </span>
          </button>

          {/* Guess My Answer */}
          <p className="games__sub games__sub--gap">💬 Guess My Answer</p>
          <p className="decks__hint">Answer an open prompt privately — they type a guess, you score it.</p>
          <div className="ttsets">
            {GUESS_PROMPTS.map((p) => (
              <button
                key={p.id}
                type="button"
                className="ttset"
                onClick={() => onStartGuess?.({ title: p.text, usedKey: `guess:${p.id}` })}
              >
                <span className="ttset__icon" aria-hidden="true">💬</span>
                <span className="ttset__text">
                  <span className="ttset__name ttset__name--prompt">{p.text}</span>
                </span>
              </button>
            ))}
          </div>
          <button type="button" className="ttset ttset--build" onClick={() => onStartGuess?.({ title: '' })}>
            <span className="ttset__icon" aria-hidden="true">＋</span>
            <span className="ttset__text">
              <span className="ttset__name">Write your own prompt</span>
              <span className="ttset__blurb">Ask anything only you’d know the answer to.</span>
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
