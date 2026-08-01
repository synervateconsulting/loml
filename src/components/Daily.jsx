import { useState } from 'react';
import { api } from '../api.js';
import { Modal } from './Modals.jsx';

// The daily question, shown as a card near the top of the home screen.
export function DailyCard({ daily, onOpen }) {
  if (!daily) return null;
  const { prompt, iAnswered, revealed, streak } = daily;
  const state = revealed ? 'revealed' : iAnswered ? 'waiting' : 'open';
  const tag = revealed ? 'Today · revealed' : iAnswered ? 'Today · answered' : 'Today’s question';

  return (
    <button type="button" className={`daily daily--${state}`} onClick={onOpen}>
      <span className="daily__row">
        <span className="daily__tag">🗓️ {tag}</span>
        {streak > 0 && <span className="daily__streak">🔥 {streak}</span>}
      </span>
      <span className="daily__prompt">{prompt}</span>
      <span className="daily__cta">
        {revealed ? 'See both answers' : iAnswered ? `Waiting on ${daily.partnerName}` : 'Tap to answer'}
      </span>
    </button>
  );
}

export function DailyModal({ daily, onClose, onAnswered }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
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

  // Waiting
  if (!daily.revealed) {
    return (
      <Modal
        onScrimClick={onClose}
        eyebrow="🗓️ Today’s question"
        title={daily.prompt}
        footer={<div className="sheet__foot--split"><span className="hint">{daily.streak > 0 ? `🔥 ${daily.streak}` : ''}</span><button type="button" className="btn btn--ghost" onClick={onClose}>Close</button></div>}
      >
        <p className="eyebrow">Your answer</p>
        <p className="prose prose--answer">{daily.myBody || '—'}</p>
        <p className="hint">Waiting on {daily.partnerName} to answer — then you’ll both see each other’s.</p>
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
