import { useState } from 'react';
import { api } from '../api.js';
import { AttachmentBadge } from './Media.jsx';
import { ReactionSummary } from './Reactions.jsx';
import { kindLabel, kindOf } from '../shares.js';

const shortDate = (value) =>
  new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

// "Seen" only where it's meaningful: your open share they've opened, or your
// reply they've read.
function seenNote(question, meId) {
  if (question.askerId === meId && question.status === 'open' && question.seenAt) return 'Seen';
  if (question.recipientId === meId && question.response?.seenAt) return 'Seen';
  return null;
}

// A keep toggle right on the card, for any share in any section.
function CardStar({ question, onReload }) {
  const [kept, setKept] = useState(Boolean(question.keptByMe));
  const [busy, setBusy] = useState(false);
  const toggle = async (e) => {
    e.stopPropagation();
    if (busy) return;
    const next = !kept;
    setKept(next);
    setBusy(true);
    try {
      await api.toggleKeepsake(question.id);
      onReload?.();
    } catch {
      setKept(!next);
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      type="button"
      className={`card__keep ${kept ? 'is-kept' : ''}`}
      onClick={toggle}
      aria-pressed={kept}
      title={kept ? 'Kept' : 'Keep'}
    >
      {kept ? '★' : '☆'}
    </button>
  );
}

function QuestionCard({ question, actionLabel, onAction, seal, meId, onReload }) {
  const label = typeof actionLabel === 'function' ? actionLabel(question) : actionLabel;
  const seen = seenNote(question, meId);
  const allReactions = [...(question.reactions || []), ...(question.response?.reactions || [])];
  return (
    <article className={`card card--${seal}`}>
      <span className={`seal seal--${seal}`} aria-hidden="true" />
      <CardStar question={question} onReload={onReload} />
      <span className={`kindtag kindtag--${kindOf(question)}`}>{kindLabel(question)}</span>
      <h3 className="card__title">{question.title}</h3>
      {kindOf(question) === 'song' && question.artist && (
        <p className="card__artist">{question.artist}</p>
      )}
      {question.detail && <p className="card__detail">{question.detail}</p>}
      <div className="card__foot">
        <span className="card__meta">
          {shortDate(question.createdAt)}
          <AttachmentBadge count={question.attachments.length} />
          <ReactionSummary reactions={allReactions} />
          {seen && <span className="seenmark">{seen}</span>}
        </span>
        <button type="button" className="btn btn--small" onClick={() => onAction(question)}>
          {label}
        </button>
      </div>
    </article>
  );
}

export default function QuestionSection({
  heading,
  count,
  empty,
  questions,
  actionLabel,
  onAction,
  seal,
  meId,
  onReload,
}) {
  return (
    <section className="section">
      <header className="section__head">
        <h2 className="section__title">{heading}</h2>
        <span className="section__count">{count}</span>
      </header>
      {questions.length === 0 ? (
        <p className="empty">{empty}</p>
      ) : (
        questions.map((q) => (
          <QuestionCard
            key={q.id}
            question={q}
            actionLabel={actionLabel}
            onAction={onAction}
            seal={seal}
            meId={meId}
            onReload={onReload}
          />
        ))
      )}
    </section>
  );
}
