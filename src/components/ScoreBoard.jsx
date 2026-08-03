import { useEffect, useState } from 'react';
import { Modal } from './Modals.jsx';
import { api } from '../api.js';

// Icon + label per scoring source, shared by both score sections.
const SOURCE_META = {
  predict: { icon: '🔮', label: 'Predict My Pick' },
  guess: { icon: '💬', label: 'Guess My Answer' },
  this_that: { icon: '⚖️', label: 'This / That' },
  wyr: { icon: '🤔', label: 'Would You Rather' },
  reveal: { icon: '🃏', label: 'Decks' },
  coupon: { icon: '🎟️', label: 'Coupons' },
  bingo: { icon: '🎉', label: 'Bingo' },
  share: { icon: '📮', label: 'Shares' },
  daily: { icon: '🗓️', label: 'Daily question' },
  gratitude: { icon: '🌷', label: 'Gratitude' },
  weekly: { icon: '🫶', label: 'Weekly check-in' },
};
const VERDICT_LABEL = { got_it: 'Got it', close: 'Close', missed: 'Missed' };

// The streak/summary line for a ritual row.
function ritualMeta(s, unit, verb) {
  if (!s) return 'Not started yet';
  if (s.currentStreak > 0) {
    const best = s.longestStreak > s.currentStreak ? ` · best ${s.longestStreak}` : '';
    return `🔥 ${s.currentStreak}-${unit} streak${best}`;
  }
  const done = s.completedDays ?? s.days ?? s.weeks ?? 0;
  if (done) return `Streak paused — ${verb} to restart`;
  return 'Not started yet';
}

function Legend({ rows }) {
  return (
    <ul className="scorelegend">
      {rows.map((l) => (
        <li key={l.key} className="scorelegend__row">
          <span className="scorelegend__icon" aria-hidden="true">{SOURCE_META[l.key]?.icon || '•'}</span>
          <span className="scorelegend__text">
            <b>{l.label}</b>
            <span className="scorelegend__detail">{l.detail}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function Row({ icon, title, meta, pts }) {
  return (
    <li className="scorerow">
      <span className="scorerow__icon" aria-hidden="true">{icon}</span>
      <span className="scorerow__body">
        <span className="scorerow__title">{title}</span>
        <span className="scorerow__meta">{meta}</span>
      </span>
      <span className="scorerow__pts">+{pts}</span>
    </li>
  );
}

// The score window: both couple-wide scores (🧠 game / ❤️ bond), each broken
// into how points are earned and what has earned them so far.
export default function ScoreBoard({ onClose }) {
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

  const game = data?.game;
  const bond = data?.bond;

  const pending = game?.pending || {};
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
      eyebrow="Your scores"
      title="How your scores work"
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
          <div className="scoreheros">
            <div className="scorehero">
              <span className="scorehero__brain" aria-hidden="true">🧠</span>
              <span className="scorehero__num">{game.total}</span>
              <span className="scorehero__cap">game score</span>
            </div>
            <div className="scorehero">
              <span className="scorehero__brain" aria-hidden="true">❤️</span>
              <span className="scorehero__num">{bond.total}</span>
              <span className="scorehero__cap">bond score</span>
            </div>
          </div>

          {/* ---------- game score ---------- */}
          <p className="scoresection">🧠 Game score</p>
          <p className="field__label">How points are earned</p>
          <Legend rows={game.legend || []} />

          <p className="field__label">Your games</p>
          {game.entries.length === 0 ? (
            <p className="prose scoreempty">
              No games have scored yet. Finish a This / That or Would You Rather, have your partner guess a Predict, or
              judge a Guess — and points will land here.
            </p>
          ) : (
            <ul className="scorelist">
              {game.entries.map((e) => {
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

          <p className="field__label">Fun &amp; favors</p>
          <ul className="scorelist">
            <Row
              icon="🎟️"
              title="Coupons redeemed"
              meta={game.coupons?.count ? `${game.coupons.count} redeemed` : 'None redeemed yet'}
              pts={game.coupons?.points || 0}
            />
            <Row
              icon="🎉"
              title="Bingo"
              meta={
                game.bingo?.lines || game.bingo?.full
                  ? [
                      game.bingo.lines ? `${game.bingo.lines} line${game.bingo.lines > 1 ? 's' : ''}` : '',
                      game.bingo.full ? `${game.bingo.full} full card${game.bingo.full > 1 ? 's' : ''}` : '',
                    ]
                      .filter(Boolean)
                      .join(' · ')
                  : 'No lines yet'
              }
              pts={game.bingo?.points || 0}
            />
          </ul>

          {pendingNotes.length > 0 && (
            <div className="scorenote">
              {pendingNotes.map((n, i) => (
                <p key={i} className="scorenote__line">⏳ {n}</p>
              ))}
            </div>
          )}

          {/* ---------- bond score ---------- */}
          <p className="scoresection">❤️ Bond score</p>
          <p className="field__label">How points are earned</p>
          <Legend rows={bond.legend || []} />

          <p className="field__label">So far</p>
          <ul className="scorelist">
            <Row
              icon="📮"
              title="Shares"
              meta={bond.shares?.count ? `${bond.shares.count} shared` : 'Nothing shared yet'}
              pts={bond.shares?.points || 0}
            />
            <Row icon="🗓️" title="Daily question" meta={ritualMeta(bond.daily, 'day', 'answer today')} pts={bond.daily?.points || 0} />
            <Row icon="🌷" title="Gratitude" meta={ritualMeta(bond.gratitude, 'day', 'add one today')} pts={bond.gratitude?.points || 0} />
            <Row icon="🫶" title="Weekly check-in" meta={ritualMeta(bond.weekly, 'week', 'finish this week')} pts={bond.weekly?.points || 0} />
          </ul>

          <p className="scorefoot">
            Game score rewards the playful stuff; bond score grows with every share and every ritual you keep up — the
            longer the streak, the more each one is worth.
          </p>
        </>
      )}
    </Modal>
  );
}
