import { AttachmentBadge } from './Media.jsx';

const shortDate = (value) =>
  new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

function QuestionCard({ question, actionLabel, onAction, seal }) {
  return (
    <article className={`card card--${seal}`}>
      <span className={`seal seal--${seal}`} aria-hidden="true" />
      <h3 className="card__title">{question.title}</h3>
      {question.detail && <p className="card__detail">{question.detail}</p>}
      <div className="card__foot">
        <span className="card__meta">
          {shortDate(question.createdAt)}
          <AttachmentBadge count={question.attachments.length} />
        </span>
        <button type="button" className="btn btn--small" onClick={() => onAction(question)}>
          {actionLabel}
        </button>
      </div>
    </article>
  );
}

export default function QuestionSection({ heading, count, empty, questions, actionLabel, onAction, seal }) {
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
          />
        ))
      )}
    </section>
  );
}
