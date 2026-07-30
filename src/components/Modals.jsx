import { useRef, useState } from 'react';
import { api } from '../api.js';
import { SHARE_KINDS, kindOf, isQuestion, kindLabel } from '../shares.js';
import Confirm, { discardSteps, sendSteps } from './Confirm.jsx';
import { Attachments } from './Media.jsx';
import MediaCapture from './MediaCapture.jsx';

// Copy that changes with the kind of share.
const COMPOSE = {
  question: {
    title: 'Ask a question',
    label: 'Question',
    placeholder: 'What do you want to ask?',
    send: 'Send question',
  },
  memory: {
    title: 'Share a memory',
    label: 'Memory',
    placeholder: 'What do you want to remember together?',
    send: 'Share memory',
  },
  note: {
    title: 'Leave a note',
    label: 'Note',
    placeholder: "What's on your mind?",
    send: 'Send note',
  },
};

// The recipient answers a question; they acknowledge a memory or note, and the
// reply is optional.
const respondCopy = (share) =>
  isQuestion(share)
    ? {
        heading: `${share.askerName} asked`,
        replyLabel: 'Your answer',
        placeholder: 'Take your time.',
        mediaLabel: 'Answer with voice, video or a file',
        send: 'Send answer',
        required: true,
        confirmTitle: 'Send this answer?',
        confirmBody: `${share.askerName} will be able to read it right away.`,
        discardNoun: 'answer',
      }
    : {
        heading: `${share.askerName} shared a ${kindOf(share)}`,
        replyLabel: 'Add a note back (optional)',
        placeholder: 'Say something, or just let them know you saw it.',
        mediaLabel: 'Add voice, video or a file',
        send: 'Acknowledge',
        required: false,
        confirmTitle: 'Acknowledge this?',
        confirmBody: `${share.askerName} will see that you've seen it.`,
        discardNoun: 'reply',
      };

// Verbs used on the acknowledged side.
const settledWord = (share) => (isQuestion(share) ? 'answered' : 'acknowledged');

async function uploadStaged({ staged, setStaged, ownerKind, questionId, responseId }) {
  const remaining = [...staged];
  try {
    while (remaining.length) {
      const it = remaining[0];
      await api.uploadAttachment({
        ownerKind,
        questionId,
        responseId,
        file: it.file,
        fileName: it.fileName,
        mimeType: it.mimeType,
        durationSecs: it.durationSecs,
      });
      if (it.url) URL.revokeObjectURL(it.url);
      remaining.shift();
    }
  } finally {
    setStaged(remaining);
  }
}

function Modal({ title, eyebrow, children, footer, onScrimClick }) {
  return (
    <div className="scrim" role="dialog" aria-modal="true" onMouseDown={onScrimClick}>
      <div className="sheet" onMouseDown={(e) => e.stopPropagation()}>
        <header className="sheet__head">
          {eyebrow && <p className="eyebrow">{eyebrow}</p>}
          <h2 className="sheet__title">{title}</h2>
        </header>
        <div className="sheet__body">{children}</div>
        <footer className="sheet__foot">{footer}</footer>
      </div>
    </div>
  );
}

function useConfirm() {
  const [pending, setPending] = useState(null);
  const ask = (steps, action) => setPending({ steps, action });
  const node = pending ? (
    <Confirm
      steps={pending.steps}
      onResolve={(ok) => {
        const { action } = pending;
        setPending(null);
        if (ok) action();
      }}
    />
  ) : null;
  return [ask, node];
}

const removeAttachmentSteps = [
  {
    title: 'Remove this attachment?',
    body: 'It stops showing here. It is kept in the record and can be brought back.',
    confirm: 'Remove it',
    tone: 'danger',
  },
  { title: 'Certain?', body: 'One more tap and it comes off this share.', confirm: 'Yes, remove', tone: 'danger' },
];

/* --------------------------------------------------------- share something */

export function ShareModal({ partnerName, onClose, onDone }) {
  const [kind, setKind] = useState('question');
  const [title, setTitle] = useState('');
  const [detail, setDetail] = useState('');
  const [staged, setStaged] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [ask, confirmNode] = useConfirm();
  const createdId = useRef(null); // set once the share exists, so a retry never re-sends it

  const copy = COMPOSE[kind];
  const dirty = Boolean(title.trim() || detail.trim()) || staged.length > 0;
  const cancel = () => (dirty ? ask(discardSteps(kind), onClose) : onClose());

  const confirmBody =
    kind === 'question'
      ? 'They will see it the next time they open loml.'
      : 'They will find it under your shares.';

  const send = () =>
    ask(sendSteps(`Send this to ${partnerName}?`, confirmBody), async () => {
      setBusy(true);
      setError('');
      try {
        if (!createdId.current) {
          const { id } = await api.ask(title, detail, kind);
          createdId.current = id;
        }
        await uploadStaged({ staged, setStaged, ownerKind: 'question', questionId: createdId.current });
        onDone();
      } catch (err) {
        setError(err.message);
        setBusy(false);
      }
    });

  return (
    <>
      <Modal
        eyebrow={`For ${partnerName}`}
        title={copy.title}
        footer={
          <>
            <button type="button" className="btn btn--ghost" onClick={cancel}>
              Cancel
            </button>
            <button type="button" className="btn btn--primary" onClick={send} disabled={!title.trim() || busy}>
              {copy.send}
            </button>
          </>
        }
      >
        <div className="field">
          <span className="field__label">What kind of share?</span>
          <div className="segmented" role="group" aria-label="Share type">
            {SHARE_KINDS.map((k) => (
              <button
                key={k}
                type="button"
                className={`segmented__opt ${kind === k ? 'is-active' : ''}`}
                aria-pressed={kind === k}
                disabled={busy}
                onClick={() => setKind(k)}
              >
                {kindLabel({ kind: k })}
              </button>
            ))}
          </div>
        </div>
        <label className="field">
          <span className="field__label">{copy.label}</span>
          <input
            className="field__input"
            value={title}
            maxLength={160}
            placeholder={copy.placeholder}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="field">
          <span className="field__label">More about it</span>
          <textarea
            className="field__input field__input--area"
            rows={6}
            value={detail}
            placeholder="Context, anything else you want to add."
            onChange={(e) => setDetail(e.target.value)}
          />
        </label>
        <div className="field">
          <span className="field__label">Voice, video or a file</span>
          <MediaCapture items={staged} onChange={setStaged} disabled={busy} />
        </div>
        {error && <p className="notice notice--error">{error}</p>}
      </Modal>
      {confirmNode}
    </>
  );
}

/* ------------------------------------------------- respond / acknowledge */

export function RespondModal({ question, onClose, onDone }) {
  const copy = respondCopy(question);
  const [body, setBody] = useState('');
  const [staged, setStaged] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [ask, confirmNode] = useConfirm();
  const createdId = useRef(null); // response id once created, so a retry never re-sends

  const hasContent = Boolean(body.trim()) || staged.length > 0;
  const dirty = hasContent;
  const canSend = copy.required ? hasContent : true; // a memory/note can be acknowledged with nothing
  const cancel = () => (dirty ? ask(discardSteps(copy.discardNoun), onClose) : onClose());

  const send = () =>
    ask(sendSteps(copy.confirmTitle, copy.confirmBody), async () => {
      setBusy(true);
      setError('');
      try {
        if (!createdId.current) {
          const { id } = await api.answer(question.id, body);
          createdId.current = id;
        }
        await uploadStaged({ staged, setStaged, ownerKind: 'response', responseId: createdId.current });
        onDone();
      } catch (err) {
        setError(err.message);
        setBusy(false);
      }
    });

  return (
    <>
      <Modal
        eyebrow={copy.heading}
        title={question.title}
        footer={
          <>
            <button type="button" className="btn btn--ghost" onClick={cancel}>
              Cancel
            </button>
            <button type="button" className="btn btn--primary" onClick={send} disabled={!canSend || busy}>
              {copy.send}
            </button>
          </>
        }
      >
        {question.detail && <p className="prose">{question.detail}</p>}
        <Attachments items={question.attachments} />
        <hr className="rule" />
        <label className="field">
          <span className="field__label">{copy.replyLabel}</span>
          <textarea
            className="field__input field__input--area"
            rows={8}
            value={body}
            placeholder={copy.placeholder}
            onChange={(e) => setBody(e.target.value)}
          />
        </label>
        <div className="field">
          <span className="field__label">{copy.mediaLabel}</span>
          <MediaCapture items={staged} onChange={setStaged} disabled={busy} />
        </div>
        {error && <p className="notice notice--error">{error}</p>}
      </Modal>
      {confirmNode}
    </>
  );
}

/* --------------------------------------------- edit a share you have sent */

export function EditQuestionModal({ question, onClose, onDone }) {
  const [title, setTitle] = useState(question.title);
  const [detail, setDetail] = useState(question.detail);
  const [staged, setStaged] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [ask, confirmNode] = useConfirm();
  const savedText = useRef(false); // once the text edit lands, a retry only re-uploads

  const noun = kindOf(question);
  const textDirty = title !== question.title || detail !== question.detail;
  const dirty = textDirty || staged.length > 0;
  const cancel = () => (dirty ? ask(discardSteps('edit'), onClose) : onClose());

  const save = () =>
    ask(sendSteps('Save these changes?', 'The earlier version is kept in the history.'), async () => {
      setBusy(true);
      setError('');
      try {
        if (textDirty && !savedText.current) {
          await api.editQuestion(question.id, title, detail);
          savedText.current = true;
        }
        await uploadStaged({ staged, setStaged, ownerKind: 'question', questionId: question.id });
        onDone();
      } catch (err) {
        setError(err.message);
        setBusy(false);
      }
    });

  const removeAttachment = (item) =>
    ask(removeAttachmentSteps, async () => {
      try {
        await api.removeAttachment(item.id);
        onDone();
      } catch (err) {
        setError(err.message);
      }
    });

  return (
    <>
      <Modal
        eyebrow={`Waiting on ${question.recipientName}`}
        title={`Edit your ${noun}`}
        footer={
          <>
            <button type="button" className="btn btn--ghost" onClick={cancel}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={save}
              disabled={!dirty || !title.trim() || busy}
            >
              Save changes
            </button>
          </>
        }
      >
        <label className="field">
          <span className="field__label">{COMPOSE[noun].label}</span>
          <input
            className="field__input"
            value={title}
            maxLength={160}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="field">
          <span className="field__label">More about it</span>
          <textarea
            className="field__input field__input--area"
            rows={6}
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
          />
        </label>
        <Attachments items={question.attachments} onRemove={removeAttachment} />
        <div className="field">
          <span className="field__label">Add voice, video or a file</span>
          <MediaCapture items={staged} onChange={setStaged} disabled={busy} />
        </div>
        {question.version > 1 && <p className="hint">Edited {question.version - 1}×. Every version is kept.</p>}
        {error && <p className="notice notice--error">{error}</p>}
      </Modal>
      {confirmNode}
    </>
  );
}

/* ------------------------------------------------ view a settled share */

export function ViewModal({ question, canEditAnswer, onClose, onDone }) {
  const original = question.response?.body ?? '';
  const [body, setBody] = useState(original);
  const [staged, setStaged] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [ask, confirmNode] = useConfirm();
  const savedText = useRef(false); // once the text edit lands, a retry only re-uploads

  const question_ = isQuestion(question);
  const yourReplyLabel = question_ ? 'Your answer' : 'Your note';
  const theirReplyLabel = `${question.recipientName} ${settledWord(question)}`;
  const emptyReply = question_ ? 'No words with this one.' : 'Acknowledged — no note added.';

  const textDirty = canEditAnswer && body !== original;
  const dirty = textDirty || (canEditAnswer && staged.length > 0);
  const cancel = () => (dirty ? ask(discardSteps('edit'), onClose) : onClose());

  const save = () =>
    ask(sendSteps('Save these changes?', 'The earlier version is kept in the history.'), async () => {
      setBusy(true);
      setError('');
      try {
        if (textDirty && !savedText.current) {
          await api.editAnswer(question.response.id, body);
          savedText.current = true;
        }
        await uploadStaged({ staged, setStaged, ownerKind: 'response', responseId: question.response.id });
        onDone();
      } catch (err) {
        setError(err.message);
        setBusy(false);
      }
    });

  const removeAttachment = (item) =>
    ask(removeAttachmentSteps, async () => {
      try {
        await api.removeAttachment(item.id);
        onDone();
      } catch (err) {
        setError(err.message);
      }
    });

  return (
    <>
      <Modal
        eyebrow={
          canEditAnswer
            ? question_
              ? `${question.askerName} asked`
              : `${question.askerName} shared a ${kindOf(question)}`
            : question_
              ? 'You asked'
              : 'You shared'
        }
        title={question.title}
        footer={
          <>
            <button type="button" className="btn btn--ghost" onClick={cancel}>
              {dirty ? 'Cancel' : 'Close'}
            </button>
            {canEditAnswer && (
              <button type="button" className="btn btn--primary" onClick={save} disabled={!dirty || busy}>
                Save changes
              </button>
            )}
          </>
        }
      >
        {question.detail && <p className="prose">{question.detail}</p>}
        <Attachments items={question.attachments} />
        <hr className="rule" />
        <p className="eyebrow">{canEditAnswer ? yourReplyLabel : theirReplyLabel}</p>
        {canEditAnswer ? (
          <textarea
            className="field__input field__input--area"
            rows={8}
            value={body}
            placeholder={question_ ? 'Take your time.' : 'Add a note, or leave it as just acknowledged.'}
            onChange={(e) => setBody(e.target.value)}
          />
        ) : (
          <p className="prose prose--answer">{original || emptyReply}</p>
        )}
        <Attachments
          items={question.response?.attachments}
          onRemove={canEditAnswer ? removeAttachment : undefined}
        />
        {canEditAnswer && (
          <div className="field">
            <span className="field__label">Add voice, video or a file</span>
            <MediaCapture items={staged} onChange={setStaged} disabled={busy} />
          </div>
        )}
        {question.response?.version > 1 && (
          <p className="hint">
            {question_ ? 'Answer' : 'Note'} edited {question.response.version - 1}×. Every version is kept.
          </p>
        )}
        {error && <p className="notice notice--error">{error}</p>}
      </Modal>
      {confirmNode}
    </>
  );
}
