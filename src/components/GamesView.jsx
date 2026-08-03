import { useState, useEffect } from 'react';
import DecksView from './DecksView.jsx';
import { THISTHAT_TEMPLATES, PREDICT_TEMPLATES, WYR_TEMPLATES, GUESS_PROMPTS } from '../thisthat.js';
import { templateToItems } from './ThisThat.jsx';
import { Modal } from './Modals.jsx';
import { Reactions, CommentThread } from './Reactions.jsx';
import Confirm, { sendSteps, discardSteps } from './Confirm.jsx';
import { api } from '../api.js';

// How each scored game shows up in the breakdown window.
const SOURCE_META = {
  predict: { icon: '🔮', label: 'Predict My Pick' },
  guess: { icon: '💬', label: 'Guess My Answer' },
  this_that: { icon: '⚖️', label: 'This / That' },
  wyr: { icon: '🤔', label: 'Would You Rather' },
  reveal: { icon: '🃏', label: 'Decks' },
  daily: { icon: '📅', label: 'Daily question' },
  coupon: { icon: '🎟️', label: 'Coupons' },
  bingo: { icon: '🎉', label: 'Bingo' },
};

// Ready-made bingo boards (couple activities). 3×3 = 9 squares, 5×5 = 25.
const BINGO_TEMPLATES = [
  {
    id: 'cozy',
    name: 'Cozy season',
    icon: '🧣',
    size: 3,
    squares: ['Movie night in', 'Cook something new', 'Long walk', 'Sleep in together', 'Hot drinks', 'Board game', 'Read side by side', 'Order takeout', 'Afternoon nap'],
  },
  {
    id: 'adventure',
    name: 'Little adventures',
    icon: '🧭',
    size: 3,
    squares: ['New restaurant', 'Watch a sunrise', 'Day trip', 'New hobby together', 'Dance in the kitchen', 'Picnic', 'Stargaze', 'Explore a new spot', 'Silly photos'],
  },
];

// Ready-made coupons to give (pick one or write your own).
const COUPON_TEMPLATES = [
  { icon: '💆', title: 'One back rub' },
  { icon: '🍳', title: 'Breakfast in bed' },
  { icon: '🎬', title: 'You pick the movie' },
  { icon: '🧹', title: 'A chore pass' },
  { icon: '✅', title: 'One yes, no questions asked' },
  { icon: '🚗', title: 'I’ll drive' },
  { icon: '🍽️', title: 'I’ll plan the date' },
  { icon: '😴', title: 'Sleep in — I’ve got the morning' },
];
const VERDICT_LABEL = { got_it: 'Got it', close: 'Close', missed: 'Missed' };

// "Games" groups the playful, low-stakes ways to start a share, nesting its own
// sub-tabs (Decks, This / That, Would You Rather, Guessing) beneath the top nav.
export default function GamesView({
  meId,
  partner,
  onUsePrompt,
  onStartThisThat,
  onStartPredict,
  onStartWyr,
  onStartGuess,
  usedGames = [],
  knowingPoints = 0,
  onChanged,
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
    ['coupons', 'Coupons', '🎟️'],
    ['bingo', 'Bingo', '🎉'],
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

      {pane === 'coupons' && <CouponsView meId={meId} partner={partner} onChanged={onChanged} />}

      {pane === 'bingo' && <BingoView meId={meId} partner={partner} used={used} onChanged={onChanged} />}
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
            <li className="scorerow">
              <span className="scorerow__icon" aria-hidden="true">🎟️</span>
              <span className="scorerow__body">
                <span className="scorerow__title">Coupons redeemed</span>
                <span className="scorerow__meta">
                  {data.coupons?.count ? `${data.coupons.count} redeemed` : 'None redeemed yet'}
                </span>
              </span>
              <span className="scorerow__pts">+{data.coupons?.points || 0}</span>
            </li>
            <li className="scorerow">
              <span className="scorerow__icon" aria-hidden="true">🎉</span>
              <span className="scorerow__body">
                <span className="scorerow__title">Bingo</span>
                <span className="scorerow__meta">
                  {data.bingo?.lines || data.bingo?.full
                    ? [
                        data.bingo.lines ? `${data.bingo.lines} line${data.bingo.lines > 1 ? 's' : ''}` : '',
                        data.bingo.full ? `${data.bingo.full} full card${data.bingo.full > 1 ? 's' : ''}` : '',
                      ]
                        .filter(Boolean)
                        .join(' · ')
                    : 'No lines yet'}
                </span>
              </span>
              <span className="scorerow__pts">+{data.bingo?.points || 0}</span>
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

/* ------------------------------------------------------------- coupons */

const fmtCouponWhen = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

function CouponCard({ c, meId, onRedeem, onRevoke, onChanged }) {
  const mine = c.fromId === meId; // I gave it
  return (
    <div className={`coupon ${c.status !== 'active' ? 'is-spent' : ''}`}>
      <div className="coupon__stub" aria-hidden="true">{c.icon || '🎟️'}</div>
      <div className="coupon__body">
        <p className="coupon__title">{c.title}</p>
        {c.note && <p className="coupon__note">{c.note}</p>}
        <p className="coupon__meta">
          {mine ? `To ${c.toName}` : `From ${c.fromName}`}
          {c.status === 'redeemed' ? ` · redeemed ${fmtCouponWhen(c.redeemedAt)}` : ''}
          {c.status === 'revoked' ? ' · taken back' : ''}
        </p>
        <div className="coupon__social">
          <Reactions targetKind="coupon" targetId={c.id} reactions={c.reactions || []} meId={meId} canReact onChanged={onChanged} />
          <CommentThread
            comments={c.comments || []}
            meId={meId}
            onSubmit={async (body) => {
              const cm = await api.comment('coupon', c.id, body);
              onChanged?.();
              return cm;
            }}
            onEdit={(id, body) => api.editComment(id, body)}
          />
        </div>
      </div>
      {c.status === 'active' && (
        <div className="coupon__actions">
          {!mine ? (
            <button type="button" className="btn btn--small btn--primary" onClick={() => onRedeem(c)}>
              Redeem
            </button>
          ) : (
            <button type="button" className="btn btn--small btn--ghost" onClick={() => onRevoke(c)}>
              Take back
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function CouponsView({ meId, partner, onChanged }) {
  const [coupons, setCoupons] = useState(null);
  const [compose, setCompose] = useState(false);
  const [confirm, setConfirm] = useState(null);

  const load = () => api.coupons().then(setCoupons).catch(() => setCoupons([]));
  useEffect(() => {
    load();
  }, []);

  const refresh = async () => {
    await load();
    onChanged?.(); // update the 🧠 meter (redeeming scores)
  };

  const redeem = (c) =>
    setConfirm({
      steps: sendSteps('Redeem this coupon?', `“${c.title}” — ${c.fromName} will be notified, and it earns you both points.`),
      action: async () => {
        await api.redeemCoupon(c.id);
        await refresh();
      },
    });
  const revoke = (c) =>
    setConfirm({
      steps: [{ title: 'Take back this coupon?', body: `“${c.title}” will be removed.`, confirm: 'Take it back', tone: 'danger' }],
      action: async () => {
        await api.revokeCoupon(c.id);
        await refresh();
      },
    });

  if (!coupons) return <p className="empty">…</p>;

  const forMe = coupons.filter((c) => c.toId === meId && c.status === 'active');
  const iGave = coupons.filter((c) => c.fromId === meId);
  const redeemedForMe = coupons.filter((c) => c.toId === meId && c.status === 'redeemed');

  return (
    <div className="coupons">
      <div className="coupons__bar">
        <p className="decks__hint">Give {partner} a little favor to redeem whenever they like.</p>
        <button type="button" className="btn btn--small btn--primary" onClick={() => setCompose(true)}>
          ＋ New coupon
        </button>
      </div>

      <p className="games__sub">🎟️ To redeem</p>
      {forMe.length === 0 ? (
        <p className="empty">Nothing to redeem right now.</p>
      ) : (
        forMe.map((c) => (
          <CouponCard key={c.id} c={c} meId={meId} onRedeem={redeem} onRevoke={revoke} onChanged={refresh} />
        ))
      )}

      <p className="games__sub games__sub--gap">🎁 You gave</p>
      {iGave.length === 0 ? (
        <p className="empty">You haven’t given any yet.</p>
      ) : (
        iGave.map((c) => (
          <CouponCard key={c.id} c={c} meId={meId} onRedeem={redeem} onRevoke={revoke} onChanged={refresh} />
        ))
      )}

      {redeemedForMe.length > 0 && (
        <>
          <p className="games__sub games__sub--gap">✓ Redeemed</p>
          {redeemedForMe.map((c) => (
            <CouponCard key={c.id} c={c} meId={meId} onRedeem={redeem} onRevoke={revoke} onChanged={refresh} />
          ))}
        </>
      )}

      {compose && (
        <CouponCompose
          partner={partner}
          onClose={() => setCompose(false)}
          onDone={async () => {
            setCompose(false);
            await refresh();
          }}
        />
      )}
      {confirm && (
        <Confirm
          steps={confirm.steps}
          onResolve={(ok) => {
            const { action } = confirm;
            setConfirm(null);
            if (ok) action();
          }}
        />
      )}
    </div>
  );
}

/* --------------------------------------------------------------- bingo */

// Every square that sits on a completed line (row / col / diagonal), for the
// glow. Mirrors the server's award logic so the highlight matches the points.
function winningCells(size, doneSet) {
  const at = (r, c) => r * size + c;
  const win = new Set();
  const mark = (line) => line.every((p) => doneSet.has(p)) && line.forEach((p) => win.add(p));
  for (let r = 0; r < size; r++) mark([...Array(size).keys()].map((c) => at(r, c)));
  for (let c = 0; c < size; c++) mark([...Array(size).keys()].map((r) => at(r, c)));
  mark([...Array(size).keys()].map((i) => at(i, i)));
  mark([...Array(size).keys()].map((i) => at(i, size - 1 - i)));
  return win;
}

function BingoBoard({ board, meId, onToggle, onRemove, onChanged }) {
  const doneSet = new Set(board.squares.filter((s) => s.doneAt).map((s) => s.position));
  const win = winningCells(board.size, doneSet);
  return (
    <div className="bingo">
      <div className="bingo__head">
        <p className="bingo__title">{board.title}</p>
        <div className="bingo__badges">
          {board.awardedRow && <span className="bingo__badge">Bingo! +5</span>}
          {board.awardedFull && <span className="bingo__badge bingo__badge--full">Full card +25</span>}
          <button type="button" className="linkbtn linkbtn--danger" onClick={() => onRemove(board)}>
            Remove
          </button>
        </div>
      </div>
      <div className={`bingo__grid bingo__grid--${board.size}`}>
        {board.squares.map((s) => {
          const done = Boolean(s.doneAt);
          return (
            <button
              key={s.id}
              type="button"
              className={`bingo__cell ${done ? 'is-done' : ''} ${win.has(s.position) ? 'is-win' : ''}`}
              onClick={() => onToggle(s)}
            >
              <span className="bingo__cellText">{s.text}</span>
              {done && <span className="bingo__check" aria-hidden="true">✓</span>}
            </button>
          );
        })}
      </div>
      <div className="bingo__social">
        <Reactions targetKind="bingo" targetId={board.id} reactions={board.reactions || []} meId={meId} canReact onChanged={onChanged} />
        <CommentThread
          comments={board.comments || []}
          meId={meId}
          onSubmit={async (body) => {
            const cm = await api.comment('bingo', board.id, body);
            onChanged?.();
            return cm;
          }}
          onEdit={(id, body) => api.editComment(id, body)}
        />
      </div>
    </div>
  );
}

function BingoView({ meId, partner, used, onChanged }) {
  const [boards, setBoards] = useState(null);
  const [compose, setCompose] = useState(false);
  const [flash, setFlash] = useState('');
  const [confirm, setConfirm] = useState(null);
  const [error, setError] = useState('');

  const load = () => api.bingo().then(setBoards).catch(() => setBoards([]));
  useEffect(() => {
    load();
  }, []);

  const refresh = async () => {
    await load();
    onChanged?.(); // bingo lines feed the 🧠 meter
  };

  const fromTemplate = async (t) => {
    setError('');
    try {
      await api.createBingo({ title: t.name, size: t.size, squares: t.squares, usedKey: `bingo:${t.id}` });
      await refresh();
    } catch (e) {
      setError(e.message);
    }
  };

  const toggle = async (sq) => {
    // Optimistic flip so the grid feels instant; reconcile on the response.
    setBoards((bs) =>
      bs.map((b) => ({
        ...b,
        squares: b.squares.map((s) => (s.id === sq.id ? { ...s, doneAt: s.doneAt ? null : new Date().toISOString() } : s)),
      }))
    );
    try {
      const res = await api.toggleBingoSquare(sq.id);
      if (res.newFull) setFlash('🎉 Full card! +25');
      else if (res.newLine) setFlash('🎉 Bingo! +5');
      await refresh();
    } catch (e) {
      setError(e.message);
      await load();
    }
  };

  const remove = (board) =>
    setConfirm({
      steps: [{ title: 'Remove this board?', body: `“${board.title}” will be removed for both of you.`, confirm: 'Remove', tone: 'danger' }],
      action: async () => {
        await api.removeBingo(board.id);
        await refresh();
      },
    });

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(''), 2600);
    return () => clearTimeout(t);
  }, [flash]);

  if (!boards) return <p className="empty">…</p>;

  return (
    <div className="bingos">
      {flash && <div className="bingoflash">{flash}</div>}
      <div className="coupons__bar">
        <p className="decks__hint">Make a shared board of little things to do together — tap a square when you’ve done it.</p>
        <button type="button" className="btn btn--small btn--primary" onClick={() => setCompose(true)}>
          ＋ New board
        </button>
      </div>

      {boards.length === 0 && (
        <>
          <p className="games__sub">Start from a set</p>
          <div className="ttsets">
            {BINGO_TEMPLATES.map((t) => {
              const played = used.has(`bingo:${t.id}`);
              return (
                <button key={t.id} type="button" className={`ttset ${played ? 'is-played' : ''}`} onClick={() => fromTemplate(t)}>
                  <span className="ttset__icon" aria-hidden="true">{t.icon}</span>
                  <span className="ttset__text">
                    <span className="ttset__name">
                      {t.name}
                      {played && <span className="playedtag">Made</span>}
                    </span>
                    <span className="ttset__blurb">{t.size}×{t.size} board</span>
                  </span>
                  <span className="ttset__count">{t.size * t.size}</span>
                </button>
              );
            })}
          </div>
        </>
      )}

      {error && <p className="notice notice--error">{error}</p>}

      {boards.map((b) => (
        <BingoBoard key={b.id} board={b} meId={meId} onToggle={toggle} onRemove={remove} onChanged={refresh} />
      ))}

      {compose && (
        <BingoCompose
          onClose={() => setCompose(false)}
          onDone={async () => {
            setCompose(false);
            await refresh();
          }}
        />
      )}
      {confirm && (
        <Confirm
          steps={confirm.steps}
          onResolve={(ok) => {
            const { action } = confirm;
            setConfirm(null);
            if (ok) action();
          }}
        />
      )}
    </div>
  );
}

function BingoCompose({ onClose, onDone }) {
  const [title, setTitle] = useState('');
  const [size, setSize] = useState(3);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(null);

  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const need = size * size;
  const ready = Boolean(title.trim()) && lines.length === need;
  const dirty = Boolean(title.trim() || text.trim());
  const cancel = () => (dirty ? setConfirm({ steps: discardSteps('board'), action: onClose }) : onClose());

  const save = () =>
    setConfirm({
      steps: sendSteps('Make this board?', 'You’ll both see it and can tap squares as you go.'),
      action: async () => {
        setBusy(true);
        setError('');
        try {
          await api.createBingo({ title: title.trim(), size, squares: lines });
          await onDone();
        } catch (e) {
          setError(e.message);
          setBusy(false);
        }
      },
    });

  return (
    <>
      <Modal
        onScrimClick={cancel}
        eyebrow="🎉 Bingo"
        title="New board"
        footer={
          <>
            <button type="button" className="btn btn--ghost" onClick={cancel}>
              Cancel
            </button>
            <button type="button" className="btn btn--primary" onClick={save} disabled={!ready || busy}>
              Make it
            </button>
          </>
        }
      >
        <label className="field">
          <span className="field__label">Board name</span>
          <input className="field__input" value={title} maxLength={120} placeholder="Summer together" onChange={(e) => setTitle(e.target.value)} />
        </label>
        <div className="field">
          <span className="field__label">Size</span>
          <div className="segmented">
            {[3, 5].map((n) => (
              <button key={n} type="button" className={`segmented__opt ${size === n ? 'is-active' : ''}`} onClick={() => setSize(n)}>
                {n}×{n}
              </button>
            ))}
          </div>
        </div>
        <label className="field">
          <span className="field__label">
            Squares — one per line ({lines.length}/{need})
          </span>
          <textarea
            className="field__input field__input--area"
            rows={8}
            value={text}
            placeholder={'Movie night in\nCook something new\nLong walk…'}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        {lines.length > need && <p className="hint">That’s {lines.length - need} too many — a {size}×{size} board needs exactly {need}.</p>}
        {error && <p className="notice notice--error">{error}</p>}
      </Modal>
      {confirm && (
        <Confirm
          steps={confirm.steps}
          onResolve={(ok) => {
            const { action } = confirm;
            setConfirm(null);
            if (ok) action();
          }}
        />
      )}
    </>
  );
}

function CouponCompose({ partner, onClose, onDone }) {
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [icon, setIcon] = useState('🎟️');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(null);

  const dirty = Boolean(title.trim() || note.trim());
  const cancel = () => (dirty ? setConfirm({ steps: discardSteps('coupon'), action: onClose }) : onClose());

  const pick = (t) => {
    setIcon(t.icon);
    setTitle(t.title);
  };

  const save = () =>
    setConfirm({
      steps: sendSteps(`Give this to ${partner}?`, 'They can redeem it whenever they like.'),
      action: async () => {
        setBusy(true);
        setError('');
        try {
          await api.createCoupon({ title: title.trim(), note: note.trim(), icon });
          await onDone();
        } catch (e) {
          setError(e.message);
          setBusy(false);
        }
      },
    });

  return (
    <>
      <Modal
        onScrimClick={cancel}
        eyebrow={`A favor for ${partner}`}
        title="New coupon"
        footer={
          <>
            <button type="button" className="btn btn--ghost" onClick={cancel}>
              Cancel
            </button>
            <button type="button" className="btn btn--primary" onClick={save} disabled={!title.trim() || busy}>
              Give it
            </button>
          </>
        }
      >
        <div className="field">
          <span className="field__label">Pick one, or write your own</span>
          <div className="couponpick">
            {COUPON_TEMPLATES.map((t) => (
              <button
                key={t.title}
                type="button"
                className={`couponpick__opt ${title === t.title ? 'is-active' : ''}`}
                onClick={() => pick(t)}
              >
                <span aria-hidden="true">{t.icon}</span> {t.title}
              </button>
            ))}
          </div>
        </div>
        <label className="field">
          <span className="field__label">Coupon</span>
          <div className="couponform">
            <input
              className="field__input couponform__icon"
              value={icon}
              maxLength={2}
              aria-label="Icon"
              onChange={(e) => setIcon(e.target.value)}
            />
            <input
              className="field__input"
              value={title}
              maxLength={120}
              placeholder="One back rub"
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
        </label>
        <label className="field">
          <span className="field__label">Note (optional)</span>
          <textarea
            className="field__input field__input--area"
            rows={3}
            value={note}
            placeholder="Anything to add?"
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        {error && <p className="notice notice--error">{error}</p>}
      </Modal>
      {confirm && (
        <Confirm
          steps={confirm.steps}
          onResolve={(ok) => {
            const { action } = confirm;
            setConfirm(null);
            if (ok) action();
          }}
        />
      )}
    </>
  );
}
