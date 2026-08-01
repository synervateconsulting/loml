import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Modal } from './Modals.jsx';
import { Reactions } from './Reactions.jsx';
import Confirm, { discardSteps, sendSteps } from './Confirm.jsx';

export const MIN_TT_ITEMS = 3;

const blankItem = () => ({ leftLabel: '', rightLabel: '', leftIcon: '', rightIcon: '', choice: null });

// Map a template's items into the editable builder shape.
export const templateToItems = (tpl) =>
  (tpl?.items || []).map((it) => ({
    leftLabel: it.left,
    rightLabel: it.right,
    leftIcon: it.leftIcon || '',
    rightIcon: it.rightIcon || '',
    choice: null,
  }));

export const itemsAreComplete = (items) =>
  items.length >= MIN_TT_ITEMS &&
  items.every((it) => it.leftLabel.trim() && it.rightLabel.trim() && (it.choice === 'left' || it.choice === 'right'));

/* --------------------------------------------------- builder (create a set) */

// Used inside the share composer. Edit the two sides of each item, pick your
// own side (blind), add or remove rows.
export function ThisThatBuilder({ items, onChange, disabled }) {
  const set = (i, patch) => onChange(items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  const add = () => onChange([...items, blankItem()]);
  const remove = (i) => onChange(items.filter((_, idx) => idx !== i));

  return (
    <div className="ttbuild">
      <p className="hint">
        Pick your own side for each — it stays hidden until they’ve answered too. At least {MIN_TT_ITEMS}.
      </p>
      {items.map((it, i) => (
        <div key={i} className="ttbuild__row">
          <div className="ttbuild__sides">
            <div className={`ttbuild__side ${it.choice === 'left' ? 'is-picked' : ''}`}>
              <input
                className="ttbuild__emoji"
                value={it.leftIcon}
                maxLength={2}
                placeholder="🙂"
                aria-label="Left icon"
                disabled={disabled}
                onChange={(e) => set(i, { leftIcon: e.target.value })}
              />
              <input
                className="ttbuild__label"
                value={it.leftLabel}
                maxLength={60}
                placeholder="This…"
                aria-label="Left option"
                disabled={disabled}
                onChange={(e) => set(i, { leftLabel: e.target.value })}
              />
            </div>
            <span className="ttbuild__or">or</span>
            <div className={`ttbuild__side ${it.choice === 'right' ? 'is-picked' : ''}`}>
              <input
                className="ttbuild__emoji"
                value={it.rightIcon}
                maxLength={2}
                placeholder="🙂"
                aria-label="Right icon"
                disabled={disabled}
                onChange={(e) => set(i, { rightIcon: e.target.value })}
              />
              <input
                className="ttbuild__label"
                value={it.rightLabel}
                maxLength={60}
                placeholder="…that"
                aria-label="Right option"
                disabled={disabled}
                onChange={(e) => set(i, { rightLabel: e.target.value })}
              />
            </div>
          </div>
          <div className="ttbuild__foot">
            <div className="ttpick" role="group" aria-label="Your pick">
              <button
                type="button"
                className={`ttpick__btn ${it.choice === 'left' ? 'is-on' : ''}`}
                disabled={disabled}
                onClick={() => set(i, { choice: 'left' })}
              >
                Pick this
              </button>
              <button
                type="button"
                className={`ttpick__btn ${it.choice === 'right' ? 'is-on' : ''}`}
                disabled={disabled}
                onClick={() => set(i, { choice: 'right' })}
              >
                Pick that
              </button>
            </div>
            <button
              type="button"
              className="linkbtn linkbtn--danger"
              disabled={disabled}
              onClick={() => remove(i)}
            >
              Remove
            </button>
          </div>
        </div>
      ))}
      <button type="button" className="ttbuild__add" disabled={disabled} onClick={add}>
        ＋ Add a this / that
      </button>
    </div>
  );
}

export const emptyBuilderItems = () => [blankItem(), blankItem(), blankItem()];

/* ------------------------------------------------- play / reveal (on board) */

function Chip({ name, who }) {
  return <span className={`ttchip ttchip--${who}`}>{name}</span>;
}

// One modal for the whole lifecycle of a This/That share: answer it, wait, or
// see it revealed and stacked. Routed to from RespondModal / ViewModal.
export function ThisThatView({ question, meId, onClose, onDone }) {
  const tt = question.thisThat;
  const iAmAsker = question.askerId === meId;
  const partnerName = iAmAsker ? question.recipientName : question.askerName;

  const [picks, setPicks] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(null); // { steps, action }

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
      steps: sendSteps('Lock in your answers?', `Once you lock in, ${partnerName} sees it’s their turn — and you’ll both see the results together.`),
      action: async () => {
        setBusy(true);
        setError('');
        try {
          await api.answerThisThat(
            question.id,
            tt.items.map((it) => ({ itemId: it.id, choice: picks[it.id] }))
          );
          onDone();
        } catch (err) {
          setError(err.message);
          setBusy(false);
        }
      },
    });

  const cancelAnswer = () => {
    const dirty = Object.keys(picks).length > 0;
    if (dirty) setConfirm({ steps: discardSteps('answer'), action: onClose });
    else onClose();
  };

  const partnerAnswers = iAmAsker ? tt.recipientAnswers : tt.askerAnswers;
  const myAnswers = tt.myAnswers || {};
  const matches = tt.revealed
    ? tt.items.filter((it) => myAnswers[it.id] && myAnswers[it.id] === partnerAnswers?.[it.id]).length
    : 0;

  const answerFooter = (
    <>
      <button type="button" className="btn btn--ghost" onClick={cancelAnswer}>
        Cancel
      </button>
      <button type="button" className="btn btn--primary" disabled={!allPicked || busy} onClick={submit}>
        Lock in my answers
      </button>
    </>
  );
  const closeFooter = (
    <div className="sheet__foot--split">
      <span className="hint">{mode === 'revealed' ? `${matches} of ${tt.items.length} matched` : ''}</span>
      <button type="button" className="btn btn--ghost" onClick={onClose}>
        Close
      </button>
    </div>
  );

  return (
    <>
      <Modal
        onScrimClick={mode === 'answer' ? cancelAnswer : onClose}
        eyebrow={mode === 'revealed' ? '💞 You both answered' : '🔀 This / That'}
        title={question.title}
        footer={mode === 'answer' ? answerFooter : closeFooter}
      >
        {mode === 'answer' && (
          <p className="hint">Tap a side for each. {partnerName} can’t see your picks until you lock in.</p>
        )}
        {mode === 'waiting' && (
          <p className="hint">Locked in. Waiting on {partnerName} — then you’ll both see the results.</p>
        )}

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
                        {mode !== 'answer' && (
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
                {matched && <span className="ttrow__match">matched ✨</span>}
              </div>
            );
          })}
        </div>

        {mode === 'revealed' && (
          <div className="ttview__react">
            <p className="eyebrow">React</p>
            <Reactions targetKind="thisthat" targetId={question.id} reactions={tt.reactions || []} meId={meId} canReact />
          </div>
        )}
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
