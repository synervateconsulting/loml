import { useRef, useState } from 'react';
import { api } from '../api.js';
import Confirm, { discardSteps, sendSteps } from './Confirm.jsx';
import { Attachments } from './Media.jsx';
import MediaCapture from './MediaCapture.jsx';

// Upload each staged item in turn. Successful ones are dropped from the list so
// a retry after a mid-way failure only re-sends what is left. Throws on the
// first failure, after recording progress.
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
  { title: 'Certain?', body: 'One more tap and it comes off this question.', confirm: 'Yes, remove', tone: 'danger' },
];

/* ------------------------------------------------------------- ask a question */

export function AskModal({ partnerName, onClose, onDone }) {
  const [title, setTitle] = useState('');
  const [detail, setDetail] = useState('');
  const [staged, setStaged] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [ask, confirmNode] = useConfirm();
  const createdId = useRef(null); // set once the question exists, so a retry never re-asks

  const dirty = Boolean(title.trim() || detail.trim()) || staged.length > 0;

  const cancel = () => (dirty ? ask(discardSteps('question'), onClose) : onClose());

  const send = () =>
    ask(sendSteps(`Send this to ${partnerName}?`, 'They will see it the next time they open loml.'), async () => {
      setBusy(true);
      setError('');
      try {
        if (!createdId.current) {
          const { id } = await api.ask(title, detail);
          createdId.current = id;
        }
        await uploadStaged({
          staged,
          setStaged,
          ownerKind: 'question',
          questionId: createdId.current,
        });
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
        title="Ask a question"
        footer={
          <>
            <button type="button" className="btn btn--ghost" onClick={cancel}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={send}
              disabled={!title.trim() || busy}
            >
              Send question
            </button>
          </>
        }
      >
        <label className="field">
          <span className="field__label">Question</span>
          <input
            className="field__input"
            value={title}
            maxLength={160}
            placeholder="What do you want to ask?"
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="field">
          <span className="field__label">More about it</span>
          <textarea
            className="field__input field__input--area"
            rows={6}
            value={detail}
            placeholder="Context, why you're asking, anything else."
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

/* ------------------------------------------------------------------- answer */

export function RespondModal({ question, onClose, onDone }) {
  const [body, setBody] = useState('');
  const [staged, setStaged] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [ask, confirmNode] = useConfirm();
  const createdId = useRef(null); // response id once created, so a retry never re-answers

  const dirty = Boolean(body.trim()) || staged.length > 0;
  const cancel = () => (dirty ? ask(discardSteps('answer'), onClose) : onClose());

  const send = () =>
    ask(sendSteps('Send this answer?', `${question.askerName} will be able to read it right away.`), async () => {
      setBusy(true);
      setError('');
      try {
        if (!createdId.current) {
          const { id } = await api.answer(question.id, body);
          createdId.current = id;
        }
        await uploadStaged({
          staged,
          setStaged,
          ownerKind: 'response',
          responseId: createdId.current,
        });
        onDone();
      } catch (err) {
        setError(err.message);
        setBusy(false);
      }
    });

  return (
    <>
      <Modal
        eyebrow={`${question.askerName} asked`}
        title={question.title}
        footer={
          <>
            <button type="button" className="btn btn--ghost" onClick={cancel}>
              Cancel
            </button>
            <button type="button" className="btn btn--primary" onClick={send} disabled={!dirty || busy}>
              Send answer
            </button>
          </>
        }
      >
        {question.detail && <p className="prose">{question.detail}</p>}
        <Attachments items={question.attachments} />
        <hr className="rule" />
        <label className="field">
          <span className="field__label">Your answer</span>
          <textarea
            className="field__input field__input--area"
            rows={8}
            value={body}
            placeholder="Take your time."
            onChange={(e) => setBody(e.target.value)}
          />
        </label>
        <div className="field">
          <span className="field__label">Answer with voice, video or a file</span>
          <MediaCapture items={staged} onChange={setStaged} disabled={busy} />
        </div>
        {error && <p className="notice notice--error">{error}</p>}
      </Modal>
      {confirmNode}
    </>
  );
}

/* --------------------------------------------- edit a question you have asked */

export function EditQuestionModal({ question, onClose, onDone }) {
  const [title, setTitle] = useState(question.title);
  const [detail, setDetail] = useState(question.detail);
  const [staged, setStaged] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [ask, confirmNode] = useConfirm();
  const savedText = useRef(false); // once the text edit lands, a retry only re-uploads

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
        await uploadStaged({
          staged,
          setStaged,
          ownerKind: 'question',
          questionId: question.id,
        });
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
        title="Edit your question"
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
          <span className="field__label">Question</span>
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

/* --------------------------------------------------- view an answered question */

export function ViewModal({ question, canEditAnswer, onClose, onDone }) {
  const original = question.response?.body ?? '';
  const [body, setBody] = useState(original);
  const [staged, setStaged] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [ask, confirmNode] = useConfirm();
  const savedText = useRef(false); // once the text edit lands, a retry only re-uploads

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
        await uploadStaged({
          staged,
          setStaged,
          ownerKind: 'response',
          responseId: question.response.id,
        });
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
        eyebrow={canEditAnswer ? `${question.askerName} asked` : 'You asked'}
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
        <p className="eyebrow">
          {canEditAnswer ? 'Your answer' : `${question.recipientName} answered`}
        </p>
        {canEditAnswer ? (
          <textarea
            className="field__input field__input--area"
            rows={8}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        ) : (
          <p className="prose prose--answer">{original || 'No words with this one.'}</p>
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
          <p className="hint">Answer edited {question.response.version - 1}×. Every version is kept.</p>
        )}
        {error && <p className="notice notice--error">{error}</p>}
      </Modal>
      {confirmNode}
    </>
  );
}
