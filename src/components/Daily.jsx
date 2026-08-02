import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Modal } from './Modals.jsx';

const dayLabel = (day, today) => {
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const [ty, tm, td] = today.split('-').map(Number);
  const diff = Math.round((new Date(ty, tm - 1, td) - dt) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return dt.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
};

// The "Today's ?" archive tab under Games: every day back to your first answer,
// most recent first. Tap a row to see the answers / who answered.
export function DailyHistory() {
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(null);
  useEffect(() => {
    api.dailyHistory().then(setData).catch(() => setData({ days: [], partnerName: 'them' }));
  }, []);

  if (!data) return <p className="empty">Loading…</p>;
  const { days, partnerName, today } = data;
  if (!days.length) return <p className="empty">No daily questions yet — answer today’s to get started.</p>;

  return (
    <div className="dailytab">
      {days.map((d) => {
        const state = d.iAnswered && d.partnerAnswered ? 'both' : d.iAnswered ? 'you' : d.partnerAnswered ? 'them' : 'none';
        const chip = { both: 'Both', you: 'You only', them: `${partnerName} only`, none: 'Missed' }[state];
        const isOpen = open === d.day;
        return (
          <div key={d.day} className={`dhrow ${isOpen ? 'is-open' : ''}`}>
            <button type="button" className="dhrow__head" onClick={() => setOpen(isOpen ? null : d.day)}>
              <span className="dhrow__top">
                <span className="dhrow__date">{dayLabel(d.day, today)}</span>
                <span className={`dhchip dhchip--${state}`}>{chip}</span>
              </span>
              <span className="dhrow__q">{d.prompt}</span>
            </button>
            {isOpen && (
              <div className="dhrow__body">
                {state === 'none' && <p className="hint">Neither of you answered this one.</p>}
                {d.mine != null && <p className="dhans"><b>You:</b> {d.mine}</p>}
                {d.theirs != null && <p className="dhans"><b>{partnerName}:</b> {d.theirs}</p>}
                {state === 'you' && <p className="hint">{partnerName} didn’t answer.</p>}
                {state === 'them' && d.theirs == null && (
                  <p className="hint">Answer today’s question to reveal {partnerName}’s.</p>
                )}
                {state === 'them' && <p className="hint">You didn’t answer that day.</p>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// The daily question as a slim status pill near the top of the home screen.
// Collapsed shows just the state (a colored dot + a word); tap opens the full
// prompt / answers.
export function DailyCard({ daily, onOpen }) {
  if (!daily) return null;
  const { iAnswered, revealed, streak, partnerName } = daily;
  const dot = revealed ? 'done' : iAnswered ? 'wait' : 'new';
  const label = revealed ? 'Today’s answers' : iAnswered ? 'Answered' : 'Today’s question';
  const right = revealed
    ? streak > 0
      ? `🔥 ${streak}`
      : 'tap to see'
    : iAnswered
      ? `waiting on ${partnerName}`
      : 'tap to answer';

  return (
    <button type="button" className="daily" onClick={onOpen}>
      <span className={`daily__dot daily__dot--${dot}`} aria-hidden="true" />
      <span className="daily__t">{label}</span>
      <span className={`daily__r ${revealed && streak > 0 ? 'daily__r--streak' : ''}`}>{right}</span>
    </button>
  );
}

export function DailyModal({ daily, onClose, onAnswered }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  if (!daily) return null;

  const submit = async () => {
    const body = text.trim();
    if (!body) return;
    setBusy(true);
    setError('');
    try {
      await api.answerDaily(body);
      await onAnswered();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const saveEdit = async () => {
    const body = text.trim();
    if (!body) return;
    setBusy(true);
    setError('');
    try {
      await api.editDaily(body);
      await onAnswered();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  // Answering
  if (!daily.iAnswered) {
    return (
      <Modal
        onScrimClick={onClose}
        eyebrow="🗓️ Today’s question"
        title={daily.prompt}
        footer={
          <>
            <button type="button" className="btn btn--ghost" onClick={onClose}>Later</button>
            <button type="button" className="btn btn--primary" disabled={!text.trim() || busy} onClick={submit}>Answer</button>
          </>
        }
      >
        <p className="hint">You’ll both see each other’s once {daily.partnerName} has answered too.</p>
        <label className="field">
          <span className="field__label">Your answer</span>
          <textarea className="field__input field__input--area" rows={4} value={text} placeholder="However much or little you like." onChange={(e) => setText(e.target.value)} />
        </label>
        {daily.streak > 0 && <p className="hint">🔥 {daily.streak}-day streak — keep it going.</p>}
        {error && <p className="notice notice--error">{error}</p>}
      </Modal>
    );
  }

  // Answered, still blind — editable until the partner answers.
  if (!daily.revealed) {
    if (editing) {
      return (
        <Modal
          onScrimClick={() => setEditing(false)}
          eyebrow="🗓️ Today’s question"
          title={daily.prompt}
          footer={
            <>
              <button type="button" className="btn btn--ghost" onClick={() => setEditing(false)}>Cancel</button>
              <button type="button" className="btn btn--primary" disabled={!text.trim() || busy} onClick={saveEdit}>Save</button>
            </>
          }
        >
          <p className="hint">You can edit until {daily.partnerName} answers.</p>
          <label className="field">
            <span className="field__label">Your answer</span>
            <textarea className="field__input field__input--area" rows={4} value={text} onChange={(e) => setText(e.target.value)} />
          </label>
          {error && <p className="notice notice--error">{error}</p>}
        </Modal>
      );
    }
    return (
      <Modal
        onScrimClick={onClose}
        eyebrow="🗓️ Today’s question"
        title={daily.prompt}
        footer={
          <div className="sheet__foot--split">
            <button type="button" className="linkbtn" onClick={() => { setText(daily.myBody || ''); setError(''); setEditing(true); }}>
              Edit answer
            </button>
            <button type="button" className="btn btn--ghost" onClick={onClose}>Close</button>
          </div>
        }
      >
        <p className="eyebrow">Your answer</p>
        <p className="prose prose--answer">{daily.myBody || '—'}</p>
        <p className="hint">
          Waiting on {daily.partnerName} to answer — you can still edit yours until they do.
          {daily.streak > 0 ? ` · 🔥 ${daily.streak}` : ''}
        </p>
      </Modal>
    );
  }

  // Revealed (+ a little history)
  return (
    <Modal
      onScrimClick={onClose}
      eyebrow="🗓️ Today · revealed"
      title={daily.prompt}
      footer={<div className="sheet__foot--split"><span className="hint">{daily.streak > 0 ? `🔥 ${daily.streak}-day streak` : ''}</span><button type="button" className="btn btn--ghost" onClick={onClose}>Close</button></div>}
    >
      <div className="reveal__pair">
        <p className="eyebrow">You</p>
        <p className="prose prose--answer">{daily.myBody || '—'}</p>
      </div>
      <div className="reveal__pair">
        <p className="eyebrow">{daily.partnerName}</p>
        <p className="prose prose--answer">{daily.partnerBody || '—'}</p>
      </div>

      {daily.recent?.length > 0 && (
        <>
          <hr className="rule" />
          <p className="eyebrow">Past days</p>
          <ul className="dailyhist">
            {daily.recent.map((d) => (
              <li key={d.day} className="dailyhist__item">
                <p className="dailyhist__q">{d.prompt}</p>
                <p className="dailyhist__a"><b>You:</b> {d.mine}</p>
                <p className="dailyhist__a"><b>{daily.partnerName}:</b> {d.theirs}</p>
              </li>
            ))}
          </ul>
        </>
      )}
    </Modal>
  );
}
