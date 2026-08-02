import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Modal } from './Modals.jsx';
import { Reactions, CommentThread } from './Reactions.jsx';
import Confirm, { discardSteps, sendSteps } from './Confirm.jsx';

export const MIN_TT_ITEMS = 3;

const blankItem = () => ({ leftLabel: '', rightLabel: '', leftIcon: '', rightIcon: '', choice: null, note: '' });

// Map a template's items into the editable builder shape.
export const templateToItems = (tpl) =>
  (tpl?.items || []).map((it) => ({
    leftLabel: it.left,
    rightLabel: it.right,
    leftIcon: it.leftIcon || '',
    rightIcon: it.rightIcon || '',
    choice: null,
    note: '',
  }));

export const itemsAreComplete = (items) =>
  items.length >= MIN_TT_ITEMS &&
  items.every((it) => it.leftLabel.trim() && it.rightLabel.trim() && (it.choice === 'left' || it.choice === 'right'));

export const emptyBuilderItems = () => [blankItem(), blankItem(), blankItem()];

const BUILD_HINT = {
  this_that: 'Pick your own side for each — it stays hidden until they’ve answered too.',
  wyr: 'Pick a side for each (add a “why” if you like) — hidden until they’ve answered too.',
  predict: 'Lock in your real picks — they’ll try to guess each one.',
};

/* --------------------------------------------------- builder (create a set) */

export function ThisThatBuilder({ items, onChange, disabled, kind = 'this_that' }) {
  const set = (i, patch) => onChange(items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  const add = () => onChange([...items, blankItem()]);
  const remove = (i) => onChange(items.filter((_, idx) => idx !== i));

  return (
    <div className="ttbuild">
      <p className="hint">
        {BUILD_HINT[kind] || BUILD_HINT.this_that} At least {MIN_TT_ITEMS}.
      </p>
      {items.map((it, i) => (
        <div key={i} className="ttbuild__row">
          <div className="ttbuild__sides">
            <div className={`ttbuild__side ${it.choice === 'left' ? 'is-picked' : ''}`}>
              <input className="ttbuild__emoji" value={it.leftIcon} maxLength={2} placeholder="🙂" aria-label="Left icon" disabled={disabled} onChange={(e) => set(i, { leftIcon: e.target.value })} />
              <input className="ttbuild__label" value={it.leftLabel} maxLength={60} placeholder="This…" aria-label="Left option" disabled={disabled} onChange={(e) => set(i, { leftLabel: e.target.value })} />
            </div>
            <span className="ttbuild__or">or</span>
            <div className={`ttbuild__side ${it.choice === 'right' ? 'is-picked' : ''}`}>
              <input className="ttbuild__emoji" value={it.rightIcon} maxLength={2} placeholder="🙂" aria-label="Right icon" disabled={disabled} onChange={(e) => set(i, { rightIcon: e.target.value })} />
              <input className="ttbuild__label" value={it.rightLabel} maxLength={60} placeholder="…that" aria-label="Right option" disabled={disabled} onChange={(e) => set(i, { rightLabel: e.target.value })} />
            </div>
          </div>
          <div className="ttbuild__foot">
            <div className="ttpick" role="group" aria-label="Your pick">
              <button type="button" className={`ttpick__btn ${it.choice === 'left' ? 'is-on' : ''}`} disabled={disabled} onClick={() => set(i, { choice: 'left' })}>
                Pick this
              </button>
              <button type="button" className={`ttpick__btn ${it.choice === 'right' ? 'is-on' : ''}`} disabled={disabled} onClick={() => set(i, { choice: 'right' })}>
                Pick that
              </button>
            </div>
            <button type="button" className="linkbtn linkbtn--danger" disabled={disabled} onClick={() => remove(i)}>
              Remove
            </button>
          </div>
          {kind === 'wyr' && it.choice && (
            <input className="ttbuild__why" value={it.note} maxLength={200} placeholder="why? (optional)" disabled={disabled} onChange={(e) => set(i, { note: e.target.value })} />
          )}
        </div>
      ))}
      <button type="button" className="ttbuild__add" disabled={disabled} onClick={add}>
        ＋ Add a this / that
      </button>
    </div>
  );
}

/* ------------------------------------------------- play / reveal (on board) */

function Chip({ name, who }) {
  return <span className={`ttchip ttchip--${who}`}>{name}</span>;
}

const VIEW_COPY = {
  this_that: { answerEye: '🔀 This / That', revealEye: '💞 You both answered', answerBtn: 'Lock in my answers', matchWord: 'matched ✨', scoreWord: 'matched' },
  wyr: { answerEye: '⚖️ Would You Rather', revealEye: '💞 You both answered', answerBtn: 'Lock in my answers', matchWord: 'matched ✨', scoreWord: 'matched' },
  predict: { answerEye: '🔮 Guess their picks', revealEye: '🔮 The reveal', answerBtn: 'Lock in my guesses', matchWord: 'nailed it ✓', scoreWord: 'right' },
};

// One modal for the lifecycle of a pick game (this_that / wyr / predict).
export function ThisThatView({ question, meId, onClose, onDone, onRefresh }) {
  const tt = question.thisThat;
  const kind = question.kind === 'wyr' || question.kind === 'predict' ? question.kind : 'this_that';
  const copy = VIEW_COPY[kind];
  const isPredict = kind === 'predict';
  const isWyr = kind === 'wyr';
  const iAmAsker = question.askerId === meId;
  const partnerName = iAmAsker ? question.recipientName : question.askerName;

  const [picks, setPicks] = useState({});
  const [notes, setNotes] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(null);

  useEffect(() => {
    if (question.recipientId === meId) api.markSeen('question', question.id).catch(() => {});
  }, [question.id, question.recipientId, meId]);

  if (!tt || !tt.items?.length) {
    return (
      <Modal onScrimClick={onClose} title="This / That" footer={<button type="button" className="btn btn--ghost" onClick={onClose}>Close</button>}>
        <p className="prose">This set is empty.</p>
      </Modal>
    );
  }

  const mode = tt.revealed ? 'revealed' : tt.iAnswered ? 'waiting' : 'answer';
  const allPicked = tt.items.every((it) => picks[it.id] === 'left' || picks[it.id] === 'right');

  const submit = () =>
    setConfirm({
      steps: sendSteps(
        isPredict ? 'Lock in your guesses?' : 'Lock in your answers?',
        isPredict
          ? `You’ll see how many you got right about ${partnerName}.`
          : `Once you lock in, ${partnerName} sees it’s their turn — and you’ll both see the results together.`
      ),
      action: async () => {
        setBusy(true);
        setError('');
        try {
          await api.answerThisThat(
            question.id,
            tt.items.map((it) => ({ itemId: it.id, choice: picks[it.id], ...(isWyr ? { note: notes[it.id] || '' } : {}) }))
          );
          onDone();
        } catch (err) {
          setError(err.message);
          setBusy(false);
        }
      },
    });

  const cancelAnswer = () => {
    if (Object.keys(picks).length > 0) setConfirm({ steps: discardSteps(isPredict ? 'guess' : 'answer'), action: onClose });
    else onClose();
  };

  const partnerAnswers = iAmAsker ? tt.recipientAnswers : tt.askerAnswers;
  const partnerNotes = iAmAsker ? tt.recipientNotes : tt.askerNotes;
  const myAnswers = tt.myAnswers || {};
  const myNotes = tt.myNotes || {};
  const score = tt.matches ?? 0;

  const answerFooter = (
    <>
      <button type="button" className="btn btn--ghost" onClick={cancelAnswer}>Cancel</button>
      <button type="button" className="btn btn--primary" disabled={!allPicked || busy} onClick={submit}>{copy.answerBtn}</button>
    </>
  );
  const closeFooter = (
    <div className="sheet__foot--split">
      <span className="hint">
        {mode === 'revealed' ? `${score} of ${tt.items.length} ${copy.scoreWord}${tt.points ? ` · +${tt.points}` : ''}` : ''}
      </span>
      <button type="button" className="btn btn--ghost" onClick={onClose}>Close</button>
    </div>
  );

  const waitingHint = isPredict
    ? `Waiting on ${partnerName} to guess your picks.`
    : `Locked in. Waiting on ${partnerName} — then you’ll both see the results.`;
  const answerHint = isPredict
    ? `Tap the side you think ${partnerName} chose for each.`
    : `Tap a side for each. ${partnerName} can’t see your picks until you lock in.`;

  return (
    <>
      <Modal
        onScrimClick={mode === 'answer' ? cancelAnswer : onClose}
        eyebrow={mode === 'revealed' ? copy.revealEye : copy.answerEye}
        title={question.title}
        footer={mode === 'answer' ? answerFooter : closeFooter}
      >
        {mode === 'answer' && <p className="hint">{answerHint}</p>}
        {mode === 'waiting' && <p className="hint">{waitingHint}</p>}

        <div className="ttgrid">
          {tt.items.map((it) => {
            const mine = mode === 'answer' ? picks[it.id] : myAnswers[it.id];
            const theirs = mode === 'revealed' ? partnerAnswers?.[it.id] : null;
            const matched = mode === 'revealed' && mine && mine === theirs;
            return (
              <div key={it.id} className={`ttrow ${matched ? 'is-match' : ''}`}>
                <div className="ttrow__sides">
                  {['left', 'right'].map((side) => {
                    const label = side === 'left' ? it.leftLabel : it.rightLabel;
                    const icon = side === 'left' ? it.leftIcon : it.rightIcon;
                    const picked = mine === side;
                    const pickers = [];
                    if (mine === side) pickers.push({ who: 'me', name: 'You' });
                    if (mode === 'revealed' && theirs === side) pickers.push({ who: 'them', name: partnerName });
                    const clickable = mode === 'answer';
                    return (
                      <button
                        key={side}
                        type="button"
                        className={`ttopt ${picked ? 'is-picked' : ''} ${side === 'right' ? 'ttopt--right' : ''}`}
                        aria-pressed={picked}
                        disabled={!clickable}
                        onClick={clickable ? () => setPicks((p) => ({ ...p, [it.id]: side })) : undefined}
                      >
                        {icon && <span className="ttopt__emo">{icon}</span>}
                        <span className="ttopt__label">{label}</span>
                        {mode !== 'answer' && pickers.length > 0 && (
                          <span className="ttopt__who">
                            {pickers.map((p) => (
                              <Chip key={p.who} name={p.name} who={p.who} />
                            ))}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
                {matched && <span className="ttrow__match">{copy.matchWord}</span>}
                {isWyr && mode === 'answer' && picks[it.id] && (
                  <input
                    className="ttbuild__why"
                    value={notes[it.id] || ''}
                    maxLength={200}
                    placeholder="why? (optional)"
                    onChange={(e) => setNotes((n) => ({ ...n, [it.id]: e.target.value }))}
                  />
                )}
                {isWyr && mode === 'revealed' && (myNotes[it.id] || partnerNotes?.[it.id]) && (
                  <div className="ttwhy">
                    {myNotes[it.id] && <p className="ttwhy__line"><b>You:</b> {myNotes[it.id]}</p>}
                    {partnerNotes?.[it.id] && <p className="ttwhy__line"><b>{partnerName}:</b> {partnerNotes[it.id]}</p>}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {mode === 'revealed' && (
          <div className="ttview__react">
            <p className="eyebrow">React</p>
            <Reactions targetKind="thisthat" targetId={question.id} reactions={tt.reactions || []} meId={meId} canReact />
            <CommentThread
              comments={question.comments || []}
              meId={meId}
              onSubmit={async (body) => {
                const c = await api.commentShare(question.id, body);
                onRefresh?.();
                return c;
              }}
              onEdit={(id, body) => api.editComment(id, body)}
            />
          </div>
        )}
        {error && <p className="notice notice--error">{error}</p>}
      </Modal>
      {confirm && (
        <Confirm steps={confirm.steps} onResolve={(ok) => { const { action } = confirm; setConfirm(null); if (ok) action(); }} />
      )}
    </>
  );
}

/* ---------------------------------------------- Guess My Answer (free-text) */

const VERDICTS = [
  { key: 'got_it', label: 'Got it 🎯', pts: 2 },
  { key: 'close', label: 'Close 🤏', pts: 1 },
  { key: 'missed', label: 'Missed 🙈', pts: 0 },
];

export function GuessView({ question, meId, onClose, onDone, onRefresh }) {
  const g = question.guess || {};
  const iAmAsker = question.askerId === meId;
  const partnerName = iAmAsker ? question.recipientName : question.askerName;

  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(null);

  useEffect(() => {
    if (question.recipientId === meId) api.markSeen('question', question.id).catch(() => {});
  }, [question.id, question.recipientId, meId]);

  const needsGuess = !iAmAsker && !g.revealed;

  const submitGuess = () =>
    setConfirm({
      steps: sendSteps('Lock in your guess?', `${partnerName} will then see your guess and their real answer.`),
      action: async () => {
        setBusy(true);
        setError('');
        try {
          await api.revealAnswer(question.id, text.trim());
          onDone();
        } catch (err) {
          setError(err.message);
          setBusy(false);
        }
      },
    });

  const judge = async (verdict) => {
    setBusy(true);
    setError('');
    try {
      await api.judgeGuess(question.id, verdict);
      onDone();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const cancelGuess = () => {
    if (text.trim()) setConfirm({ steps: discardSteps('guess'), action: onClose });
    else onClose();
  };

  // Guessing screen (partner, before revealing)
  if (needsGuess) {
    return (
      <>
        <Modal
          onScrimClick={cancelGuess}
          eyebrow="🔮 Guess their answer"
          title={g.prompt || question.title}
          footer={
            <>
              <button type="button" className="btn btn--ghost" onClick={cancelGuess}>Cancel</button>
              <button type="button" className="btn btn--primary" disabled={!text.trim() || busy} onClick={submitGuess}>Lock in my guess</button>
            </>
          }
        >
          <p className="hint">What do you think {partnerName} answered? No peeking — you’ll both see it after.</p>
          <label className="field">
            <span className="field__label">Your guess</span>
            <textarea className="field__input field__input--area" rows={4} value={text} placeholder="Take your best shot." onChange={(e) => setText(e.target.value)} />
          </label>
          {error && <p className="notice notice--error">{error}</p>}
        </Modal>
        {confirm && <Confirm steps={confirm.steps} onResolve={(ok) => { const { action } = confirm; setConfirm(null); if (ok) action(); }} />}
      </>
    );
  }

  // Waiting (asker, before partner guesses)
  if (!g.revealed) {
    return (
      <Modal
        onScrimClick={onClose}
        eyebrow="🔮 Guess My Answer"
        title={g.prompt || question.title}
        footer={<div className="sheet__foot--split"><span className="hint">Waiting on {partnerName}</span><button type="button" className="btn btn--ghost" onClick={onClose}>Close</button></div>}
      >
        <p className="eyebrow">Your answer (hidden until they guess)</p>
        <p className="prose prose--answer">{g.myBody || '—'}</p>
        <p className="hint">Waiting on {partnerName} to take a guess.</p>
      </Modal>
    );
  }

  // Revealed
  const verdictLabel = VERDICTS.find((v) => v.key === g.verdict)?.label;
  return (
    <Modal
      onScrimClick={onClose}
      eyebrow="🔮 The reveal"
      title={g.prompt || question.title}
      footer={
        <div className="sheet__foot--split">
          <span className="hint">{g.verdict ? `${verdictLabel}${g.points != null ? ` · +${g.points}` : ''}` : ''}</span>
          <button type="button" className="btn btn--ghost" onClick={onClose}>Close</button>
        </div>
      }
    >
      <div className="reveal__pair">
        <p className="eyebrow">{iAmAsker ? 'Your real answer' : `${partnerName}’s real answer`}</p>
        <p className="prose prose--answer">{g.truthBody || '—'}</p>
      </div>
      <div className="reveal__pair">
        <p className="eyebrow">{iAmAsker ? `${partnerName}’s guess` : 'Your guess'}</p>
        <p className="prose prose--answer">{g.guessBody || '—'}</p>
      </div>

      {g.canJudge ? (
        <div className="guessjudge">
          <p className="eyebrow">How’d they do?</p>
          <div className="guessjudge__opts">
            {VERDICTS.map((v) => (
              <button key={v.key} type="button" className="btn btn--small" disabled={busy} onClick={() => judge(v.key)}>{v.label}</button>
            ))}
          </div>
        </div>
      ) : g.verdict ? (
        <p className="guessverdict">{verdictLabel}</p>
      ) : (
        <p className="hint">Waiting on {partnerName} to score it.</p>
      )}

      <hr className="rule" />
      <p className="eyebrow">React</p>
      <Reactions targetKind="reveal" targetId={question.id} reactions={g.reactions || []} meId={meId} canReact />
      <CommentThread
        comments={question.comments || []}
        meId={meId}
        onSubmit={async (body) => {
          const c = await api.commentShare(question.id, body);
          onRefresh?.();
          return c;
        }}
        onEdit={(id, body) => api.editComment(id, body)}
      />
      {error && <p className="notice notice--error">{error}</p>}
    </Modal>
  );
}
