import { useState, useEffect } from 'react';
import DecksView from './DecksView.jsx';
import { THISTHAT_TEMPLATES, PREDICT_TEMPLATES, WYR_TEMPLATES, GUESS_PROMPTS } from '../thisthat.js';
import { templateToItems } from './ThisThat.jsx';
import { DailyHistory } from './Daily.jsx';
import { Modal } from './Modals.jsx';
import { api } from '../api.js';

// How each scored game shows up in the breakdown window.
const SOURCE_META = {
  predict: { icon: '🔮', label: 'Predict My Pick' },
  guess: { icon: '💬', label: 'Guess My Answer' },
  this_that: { icon: '⚖️', label: 'This / That' },
  wyr: { icon: '🤔', label: 'Would You Rather' },
  reveal: { icon: '🃏', label: 'Decks' },
  daily: { icon: '📅', label: 'Daily question' },
};
const VERDICT_LABEL = { got_it: 'Got it', close: 'Close', missed: 'Missed' };

// "Games" groups the playful, low-stakes ways to start a share, nesting its own
// sub-tabs (Decks, This / That, Would You Rather, Guessing) beneath the top nav.
export default function GamesView({
  meId,
  onUsePrompt,
  onStartThisThat,
  onStartPredict,
  onStartWyr,
  onStartGuess,
  usedGames = [],
  knowingPoints = 0,
}) {
  const [pane, setPane] = useState('decks');
  const [scoreOpen, setScoreOpen] = useState(false);
  const used = new Set(usedGames);

  // Emojis mirror the score breakdown's per-game icons (SOURCE_META). The
  // Guessing tab holds both Predict (🔮) and Guess (💬), so it shows both.
  const tabs = [
    ['decks', 'Decks', '🃏'],
    ['thisthat', 'This / That', '⚖️'],
    ['wyr', 'Would You Rather', '🤔'],
    ['guessing', 'Guessing', '🔮💬'],
    ['today', 'Today’s ?', '📅'],
  ];

  return (
    <div className="games">
      <div className="games__head">
        <div className="calpanes" role="group" aria-label="Games">
          {tabs.map(([key, label, emoji]) => (
            <button
              key={key}
              type="button"
              className={`topnav__item ${pane === key ? 'is-active' : ''}`}
              aria-pressed={pane === key}
              onClick={() => setPane(key)}
            >
              <span className="topnav__emoji" aria-hidden="true">{emoji}</span>
              {label}
            </button>
          ))}
          {/* Score sits in the nav flow — always last, pushed fully right. */}
          <button
            type="button"
            className="knowmeter knowmeter--btn"
            onClick={() => setScoreOpen(true)}
            title="See how your score is calculated"
          >
            🧠 <b>{knowingPoints}</b>
          </button>
        </div>
      </div>

      {scoreOpen && <ScoreBreakdown onClose={() => setScoreOpen(false)} />}

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
            {PREDICT_TEMPLATES.map((t) => {
              const played = used.has(`pt:${t.id}`);
              return (
                <button
                  key={t.id}
                  type="button"
                  className={`ttset ${played ? 'is-played' : ''}`}
                  onClick={() => onStartPredict?.({ title: t.name, items: templateToItems(t), usedKey: `pt:${t.id}` })}
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
            {GUESS_PROMPTS.map((p) => {
              const played = used.has(`guess:${p.id}`);
              return (
                <button
                  key={p.id}
                  type="button"
                  className={`ttset ${played ? 'is-played' : ''}`}
                  onClick={() => onStartGuess?.({ title: p.text, usedKey: `guess:${p.id}` })}
                >
                  <span className="ttset__icon" aria-hidden="true">💬</span>
                  <span className="ttset__text">
                    <span className="ttset__name ttset__name--prompt">
                      {p.text}
                      {played && <span className="playedtag">Played</span>}
                    </span>
                  </span>
                </button>
              );
            })}
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

      {pane === 'today' && <DailyHistory meId={meId} />}
    </div>
  );
}

// The brain-icon window: what the "Knowing You" score is actually counting —
// the rules, every game that earned points, and what's still in flight.
function ScoreBreakdown({ onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    api
      .gamesScore()
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, []);

  const entries = data?.entries || [];
  const pending = data?.pending || {};
  const pendingNotes = [];
  if (pending.predictAwaitingReveal)
    pendingNotes.push(`${pending.predictAwaitingReveal} Predict game${pending.predictAwaitingReveal > 1 ? 's' : ''} will score once you both answer.`);
  if (pending.guessAwaitingVerdict)
    pendingNotes.push(`${pending.guessAwaitingVerdict} Guess game${pending.guessAwaitingVerdict > 1 ? 's' : ''} will score once it's judged.`);
  if (pending.deckAwaitingReveal)
    pendingNotes.push(`${pending.deckAwaitingReveal} Deck prompt${pending.deckAwaitingReveal > 1 ? 's' : ''} will score once you both answer.`);

  return (
    <Modal
      onScrimClick={onClose}
      eyebrow="Knowing You"
      title="How your score works"
      footer={
        <button type="button" className="btn btn--primary" onClick={onClose}>
          Got it
        </button>
      }
    >
      {error && <p className="notice notice--error">{error}</p>}
      {!data && !error && <p className="prose">Adding it up…</p>}

      {data && (
        <>
          <div className="scorehero">
            <span className="scorehero__brain" aria-hidden="true">🧠</span>
            <span className="scorehero__num">{data.total}</span>
            <span className="scorehero__cap">points together</span>
          </div>

          <p className="field__label">How points are earned</p>
          <ul className="scorelegend">
            {(data.legend || []).map((l) => (
              <li key={l.key} className="scorelegend__row">
                <span className="scorelegend__icon" aria-hidden="true">{SOURCE_META[l.key]?.icon || '•'}</span>
                <span className="scorelegend__text">
                  <b>{l.label}</b>
                  <span className="scorelegend__detail">{l.detail}</span>
                </span>
              </li>
            ))}
          </ul>

          <p className="field__label">Your games</p>
          {entries.length === 0 ? (
            <p className="prose scoreempty">
              No games have scored yet. Finish a This / That or Would You Rather (you both answer), have your partner
              guess a Predict, or judge a Guess — and points will land here.
            </p>
          ) : (
            <ul className="scorelist">
              {entries.map((e) => {
                const meta = SOURCE_META[e.source] || { icon: '•', label: e.source };
                return (
                  <li key={e.questionId} className={`scorerow ${e.isRemoved ? 'is-removed' : ''}`}>
                    <span className="scorerow__icon" aria-hidden="true">{meta.icon}</span>
                    <span className="scorerow__body">
                      <span className="scorerow__title">{e.title || meta.label}</span>
                      <span className="scorerow__meta">
                        {meta.label}
                        {e.source === 'guess' && e.verdict ? ` · ${VERDICT_LABEL[e.verdict] || ''}` : ''}
                        {e.isSpicy ? ' · 🔥' : ''}
                        {e.isRemoved ? ' · deleted' : ''}
                      </span>
                    </span>
                    <span className="scorerow__pts">
                      +{e.points}
                      {e.maxPoints ? <span className="scorerow__max"> / {e.maxPoints}</span> : null}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}

          <p className="field__label">Daily ritual</p>
          <ul className="scorelist">
            <li className="scorerow">
              <span className="scorerow__icon" aria-hidden="true">📅</span>
              <span className="scorerow__body">
                <span className="scorerow__title">Daily question</span>
                <span className="scorerow__meta">
                  {data.daily?.currentStreak > 0
                    ? `🔥 ${data.daily.currentStreak}-day streak`
                    : data.daily?.completedDays
                      ? 'Streak paused — answer today to restart'
                      : 'Not started yet'}
                  {data.daily?.completedDays
                    ? ` · ${data.daily.completedDays} day${data.daily.completedDays > 1 ? 's' : ''} together`
                    : ''}
                  {data.daily?.longestStreak > 1 ? ` · best ${data.daily.longestStreak}` : ''}
                </span>
              </span>
              <span className="scorerow__pts">+{data.daily?.points || 0}</span>
            </li>
          </ul>

          {pendingNotes.length > 0 && (
            <div className="scorenote">
              {pendingNotes.map((n, i) => (
                <p key={i} className="scorenote__line">⏳ {n}</p>
              ))}
            </div>
          )}

          <p className="scorefoot">
            Regular shares — questions, memories, notes and songs — are just for connecting, so they don’t add to this
            score.
          </p>
        </>
      )}
    </Modal>
  );
}
