import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { SHARE_KINDS, kindOf, isQuestion, isReveal, isSong, kindLabel } from '../shares.js';
import Confirm, { discardSteps, sendSteps } from './Confirm.jsx';
import { Attachments } from './Media.jsx';
import { Reactions } from './Reactions.jsx';
import MediaCapture from './MediaCapture.jsx';

const COMPOSE = {
  question: { title: 'Ask a question', label: 'Question', placeholder: 'What do you want to ask?', send: 'Send question' },
  memory: { title: 'Share a memory', label: 'Memory', placeholder: 'What do you want to remember together?', send: 'Share memory' },
  note: { title: 'Leave a note', label: 'Note', placeholder: "What's on your mind?", send: 'Send note' },
  song: { title: 'Share a song', label: 'Song', placeholder: 'Song title', send: 'Send song' },
  reveal: { title: 'Answer together', label: 'The prompt', placeholder: 'Something you’ll both answer', send: 'Send prompt' },
};

const respondCopy = (share) => {
  if (isReveal(share))
    return {
      heading: `${share.askerName} wants to answer together`,
      replyLabel: 'Your answer — they can’t see it until you both have',
      placeholder: 'No peeking at theirs first.',
      send: 'Lock in my answer',
      discardNoun: 'answer',
    };
  if (isQuestion(share))
    return {
      heading: `${share.askerName} asked`,
      replyLabel: 'Your answer',
      placeholder: 'Take your time.',
      mediaLabel: 'Answer with voice, video or a file',
      send: 'Send answer',
      required: true,
      confirmTitle: 'Send this answer?',
      confirmBody: `${share.askerName} will be able to read it right away.`,
      discardNoun: 'answer',
    };
  return {
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
};

const settledWord = (share) => (isQuestion(share) || isReveal(share) ? 'answered' : 'acknowledged');

const hostOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'link';
  }
};

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

// Lock the page behind an open sheet so you don't get its scrollbar on top of
// the sheet's own. Reference-counted so a stacked Confirm doesn't unlock early.
let scrollLockCount = 0;
function setLocked(on) {
  // The page scroller is <html> in some browsers and <body> in others — lock both.
  document.documentElement.classList.toggle('scroll-locked', on);
  document.body.classList.toggle('scroll-locked', on);
}
function useScrollLock() {
  useEffect(() => {
    if (scrollLockCount === 0) setLocked(true);
    scrollLockCount += 1;
    return () => {
      scrollLockCount = Math.max(0, scrollLockCount - 1);
      if (scrollLockCount === 0) setLocked(false);
    };
  }, []);
}

function Modal({ title, eyebrow, children, footer, onScrimClick }) {
  useScrollLock();
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
  { title: 'Remove this attachment?', body: 'It stops showing here. It is kept in the record and can be brought back.', confirm: 'Remove it', tone: 'danger' },
  { title: 'Certain?', body: 'One more tap and it comes off this share.', confirm: 'Yes, remove', tone: 'danger' },
];

function SongLink({ link, artist }) {
  if (!link) return null;
  return (
    <a className="songlink" href={link} target="_blank" rel="noreferrer">
      <span className="songlink__icon" aria-hidden="true">♪</span>
      <span className="songlink__meta">
        {artist && <span className="songlink__artist">{artist}</span>}
        <span className="songlink__host">Open on {hostOf(link)}</span>
      </span>
    </a>
  );
}

/* --------------------------------------------------------- share something */

export function ShareModal({
  partnerName,
  onClose,
  onDone,
  initialKind = 'question',
  initialTitle = '',
  initialSpicy = false,
  lockKind = false,
}) {
  const [kind, setKind] = useState(initialKind);
  const [title, setTitle] = useState(initialTitle);
  const [detail, setDetail] = useState('');
  const [link, setLink] = useState('');
  const [artist, setArtist] = useState('');
  const [answer, setAnswer] = useState(''); // asker's blind answer for a reveal
  const [spicy, setSpicy] = useState(initialSpicy);
  const [staged, setStaged] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [ask, confirmNode] = useConfirm();
  const createdId = useRef(null);

  const copy = COMPOSE[kind];
  const song = kind === 'song';
  const reveal = kind === 'reveal';
  const linkOk = !song || /^https?:\/\//i.test(link.trim());
  const canSend = Boolean(title.trim()) && linkOk && (!reveal || answer.trim()) && !busy;
  const dirty =
    Boolean(title.trim() || detail.trim() || link.trim() || artist.trim() || answer.trim()) || staged.length > 0;
  const cancel = () => (dirty ? ask(discardSteps(kind), onClose) : onClose());

  const confirmBody = reveal
    ? 'They answer blind too — you both see each other only once they’ve replied.'
    : song
      ? 'They’ll find it in your shares.'
      : kind === 'question'
        ? 'They will see it the next time they open loml.'
        : 'They will find it under your shares.';

  const send = () =>
    ask(sendSteps(`Send this to ${partnerName}?`, confirmBody), async () => {
      setBusy(true);
      setError('');
      try {
        if (!createdId.current) {
          const { id } = await api.ask({
            title,
            detail,
            kind,
            spicy,
            ...(song ? { link: link.trim(), artist: artist.trim() } : {}),
            ...(reveal ? { answer } : {}),
          });
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
            <button type="button" className="btn btn--primary" onClick={send} disabled={!canSend}>
              {copy.send}
            </button>
          </>
        }
      >
        {!lockKind && (
          <div className="field">
            <span className="field__label">What kind of share?</span>
            <div className="segmented segmented--wrap" role="group" aria-label="Share type">
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
        )}

        <button
          type="button"
          className={`spicytoggle ${spicy ? 'is-on' : ''}`}
          aria-pressed={spicy}
          disabled={busy}
          onClick={() => setSpicy((s) => !s)}
        >
          <span className="spicytoggle__label">🔥😈🔥 Spicy</span>
          <span className="spicytoggle__hint">{spicy ? 'Only shows in the spicy tab' : 'Tap to make it spicy'}</span>
        </button>

        <label className="field">
          <span className="field__label">{copy.label}</span>
          <input
            className="field__input"
            value={title}
            maxLength={200}
            placeholder={copy.placeholder}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>

        {song && (
          <>
            <label className="field">
              <span className="field__label">Artist</span>
              <input
                className="field__input"
                value={artist}
                maxLength={200}
                placeholder="Who's it by?"
                onChange={(e) => setArtist(e.target.value)}
              />
            </label>
            <label className="field">
              <span className="field__label">Link</span>
              <input
                className="field__input"
                value={link}
                placeholder="https://…  (Spotify, Apple Music, YouTube…)"
                inputMode="url"
                onChange={(e) => setLink(e.target.value)}
              />
            </label>
          </>
        )}

        {reveal ? (
          <label className="field">
            <span className="field__label">Your answer (locked in now, hidden until they reply)</span>
            <textarea
              className="field__input field__input--area"
              rows={5}
              value={answer}
              placeholder="Answer it yourself first."
              onChange={(e) => setAnswer(e.target.value)}
            />
          </label>
        ) : (
          <label className="field">
            <span className="field__label">{song ? 'Why this one' : 'More about it'}</span>
            <textarea
              className="field__input field__input--area"
              rows={song ? 3 : 6}
              value={detail}
              placeholder={song ? 'What it makes you think of.' : 'Context, anything else you want to add.'}
              onChange={(e) => setDetail(e.target.value)}
            />
          </label>
        )}

        {!reveal && (
          <div className="field">
            <span className="field__label">Voice, video or a file</span>
            <MediaCapture items={staged} onChange={setStaged} disabled={busy} />
          </div>
        )}
        {error && <p className="notice notice--error">{error}</p>}
      </Modal>
      {confirmNode}
    </>
  );
}

/* ------------------------------------------------- respond / acknowledge / answer */

export function RespondModal({ question, meId, onClose, onDone }) {
  const reveal = isReveal(question);
  const copy = respondCopy(question);
  const [body, setBody] = useState('');
  const [staged, setStaged] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [ask, confirmNode] = useConfirm();
  const createdId = useRef(null);

  // Mark the share as seen the moment the recipient opens it.
  useEffect(() => {
    if (question.recipientId === meId) api.markSeen('question', question.id).catch(() => {});
  }, [question.id, question.recipientId, meId]);

  const hasContent = Boolean(body.trim()) || staged.length > 0;
  const dirty = hasContent;
  const canSend = reveal ? Boolean(body.trim()) : copy.required ? hasContent : true;
  const cancel = () => (dirty ? ask(discardSteps(copy.discardNoun), onClose) : onClose());

  const doReveal = async () => {
    setBusy(true);
    setError('');
    try {
      await api.revealAnswer(question.id, body);
      onDone();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const send = () =>
    reveal
      ? ask(
          sendSteps('Lock in your answer?', `Once ${question.askerName} answers too, you'll both see them.`),
          doReveal
        )
      : ask(sendSteps(copy.confirmTitle, copy.confirmBody), async () => {
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
          <div className="sheet__foot--split">
            <KeepsakeStar question={question} />
            <div className="sheet__foot--right">
              <button type="button" className="btn btn--ghost" onClick={cancel}>
                Cancel
              </button>
              <button type="button" className="btn btn--primary" onClick={send} disabled={!canSend || busy}>
                {copy.send}
              </button>
            </div>
          </div>
        }
      >
        {question.detail && <p className="prose">{question.detail}</p>}
        {isSong(question) && <SongLink link={question.link} artist={question.artist} />}
        <Attachments items={question.attachments} />
        <Reactions
          targetKind="question"
          targetId={question.id}
          reactions={question.reactions}
          meId={meId}
          canReact={question.askerId !== meId}
        />
        <hr className="rule" />
        <label className="field">
          <span className="field__label">{copy.replyLabel}</span>
          <textarea
            className="field__input field__input--area"
            rows={reveal ? 6 : 8}
            value={body}
            placeholder={copy.placeholder}
            onChange={(e) => setBody(e.target.value)}
          />
        </label>
        {!reveal && (
          <div className="field">
            <span className="field__label">{copy.mediaLabel}</span>
            <MediaCapture items={staged} onChange={setStaged} disabled={busy} />
          </div>
        )}
        {error && <p className="notice notice--error">{error}</p>}
      </Modal>
      {confirmNode}
    </>
  );
}

/* --------------------------------------------- edit a share you have sent */

export function EditQuestionModal({ question, onClose, onDone }) {
  const noun = kindOf(question);
  const reveal = isReveal(question);
  const song = isSong(question);
  const [title, setTitle] = useState(question.title);
  const [detail, setDetail] = useState(question.detail);
  const [link, setLink] = useState(question.link || '');
  const [artist, setArtist] = useState(question.artist || '');
  const [answer, setAnswer] = useState(question.reveal?.myBody || ''); // reveal: your blind answer
  const [staged, setStaged] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [ask, confirmNode] = useConfirm();
  const savedText = useRef(false);

  const linkOk = !song || /^https?:\/\//i.test(link.trim());
  const textDirty =
    title !== question.title ||
    detail !== question.detail ||
    (song && (link.trim() !== (question.link || '') || artist.trim() !== (question.artist || ''))) ||
    (reveal && answer !== (question.reveal?.myBody || ''));
  const dirty = textDirty || staged.length > 0;
  const cancel = () => (dirty ? ask(discardSteps('edit'), onClose) : onClose());

  const save = () =>
    ask(sendSteps('Save these changes?', 'The earlier version is kept in the history.'), async () => {
      setBusy(true);
      setError('');
      try {
        if (textDirty && !savedText.current) {
          await api.editQuestion(question.id, title, detail, {
            ...(song ? { link: link.trim(), artist: artist.trim() } : {}),
            ...(reveal ? { answer } : {}),
          });
          savedText.current = true;
        }
        if (!reveal) await uploadStaged({ staged, setStaged, ownerKind: 'question', questionId: question.id });
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
        title={reveal ? 'Edit your prompt' : `Edit your ${noun}`}
        footer={
          <>
            <button type="button" className="btn btn--ghost" onClick={cancel}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={save}
              disabled={!dirty || !title.trim() || !linkOk || busy}
            >
              Save changes
            </button>
          </>
        }
      >
        {question.seenAt && <p className="seenline">Seen by {question.recipientName}</p>}
        <label className="field">
          <span className="field__label">{COMPOSE[noun].label}</span>
          <input className="field__input" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
        </label>

        {song && (
          <>
            <label className="field">
              <span className="field__label">Artist</span>
              <input
                className="field__input"
                value={artist}
                maxLength={200}
                placeholder="Who's it by?"
                onChange={(e) => setArtist(e.target.value)}
              />
            </label>
            <label className="field">
              <span className="field__label">Link</span>
              <input
                className="field__input"
                value={link}
                inputMode="url"
                placeholder="https://…"
                onChange={(e) => setLink(e.target.value)}
              />
            </label>
          </>
        )}

        <label className="field">
          <span className="field__label">{song ? 'Why this one' : 'More about it'}</span>
          <textarea
            className="field__input field__input--area"
            rows={6}
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
          />
        </label>

        {reveal ? (
          <label className="field">
            <span className="field__label">Your answer (still hidden until they reply)</span>
            <textarea
              className="field__input field__input--area"
              rows={5}
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
            />
          </label>
        ) : (
          <>
            <Attachments items={question.attachments} onRemove={removeAttachment} />
            <div className="field">
              <span className="field__label">Add voice, video or a file</span>
              <MediaCapture items={staged} onChange={setStaged} disabled={busy} />
            </div>
          </>
        )}

        {question.version > 1 && <p className="hint">Edited {question.version - 1}×. Every version is kept.</p>}
        {error && <p className="notice notice--error">{error}</p>}
      </Modal>
      {confirmNode}
    </>
  );
}

/* ---------------------------------------- reveal: view / waiting (no editing) */

function RevealView({ question, meId, onClose }) {
  const r = question.reveal || {};
  const iAmAsker = question.askerId === meId;
  const mineName = 'You';
  const theirName = iAmAsker ? question.recipientName : question.askerName;
  const myBody = r.myBody;
  const theirBody = iAmAsker ? r.recipientBody : r.askerBody;

  return (
    <Modal
      eyebrow="Answer together"
      title={question.title}
      footer={
        <div className="sheet__foot--split">
          <KeepsakeStar question={question} />
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Close
          </button>
        </div>
      }
    >
      {question.detail && <p className="prose">{question.detail}</p>}
      {r.revealed ? (
        <>
          <div className="reveal__pair">
            <p className="eyebrow">{mineName}</p>
            <p className="prose prose--answer">{myBody || '—'}</p>
            {/* their reaction to your answer (read-only) */}
            <Reactions
              targetKind="reveal"
              targetId={question.id}
              reactions={(r.reactions || []).filter((x) => x.userId !== meId)}
              meId={meId}
              canReact={false}
            />
          </div>
          <div className="reveal__pair">
            <p className="eyebrow">{theirName}</p>
            <p className="prose prose--answer">{theirBody || '—'}</p>
            {/* your reaction to their answer */}
            <Reactions
              targetKind="reveal"
              targetId={question.id}
              reactions={(r.reactions || []).filter((x) => x.userId === meId)}
              meId={meId}
              canReact
            />
          </div>
        </>
      ) : (
        <>
          <p className="eyebrow">Your answer (locked)</p>
          <p className="prose prose--answer">{myBody || '—'}</p>
          <p className="hint">Waiting on {theirName} to answer — then you’ll both see each other’s.</p>
        </>
      )}
    </Modal>
  );
}

function KeepsakeStar({ question, onKeep }) {
  const [kept, setKept] = useState(Boolean(question.keptByMe));
  const toggle = async () => {
    const next = !kept;
    setKept(next);
    try {
      await api.toggleKeepsake(question.id);
      onKeep?.();
    } catch {
      setKept(!next);
    }
  };
  return (
    <button type="button" className={`keepstar ${kept ? 'is-kept' : ''}`} onClick={toggle} aria-pressed={kept}>
      {kept ? '★ Kept' : '☆ Keep'}
    </button>
  );
}

/* ------------------------------------------------ view a settled share */

export function ViewModal({ question, canEditAnswer, meId, onClose, onDone }) {
  // Reveal prompts get their own view (blind pairs, no editable reply).
  if (isReveal(question)) {
    return <RevealView question={question} meId={meId} onClose={onClose} />;
  }

  const original = question.response?.body ?? '';
  const [body, setBody] = useState(original);
  const [staged, setStaged] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [ask, confirmNode] = useConfirm();
  const savedText = useRef(false);

  // When the asker opens an answered share, mark the reply as seen.
  useEffect(() => {
    if (!canEditAnswer && question.response) api.markSeen('response', question.response.id).catch(() => {});
  }, [canEditAnswer, question.response]);

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
          <div className="sheet__foot--split">
            <KeepsakeStar question={question} />
            <div className="sheet__foot--right">
              <button type="button" className="btn btn--ghost" onClick={cancel}>
                {dirty ? 'Cancel' : 'Close'}
              </button>
              {canEditAnswer && (
                <button type="button" className="btn btn--primary" onClick={save} disabled={!dirty || busy}>
                  Save changes
                </button>
              )}
            </div>
          </div>
        }
      >
        {question.detail && <p className="prose">{question.detail}</p>}
        {isSong(question) && <SongLink link={question.link} artist={question.artist} />}
        <Attachments items={question.attachments} />
        <Reactions
          targetKind="question"
          targetId={question.id}
          reactions={question.reactions}
          meId={meId}
          canReact={question.askerId !== meId}
        />
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
        <Attachments items={question.response?.attachments} onRemove={canEditAnswer ? removeAttachment : undefined} />
        {question.response && (
          <Reactions
            targetKind="response"
            targetId={question.response.id}
            reactions={question.response.reactions}
            meId={meId}
            canReact={question.response.responderId !== meId}
          />
        )}
        {canEditAnswer && question.response?.seenAt && (
          <p className="seenline">Seen by {question.askerName}</p>
        )}
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

/* ---------------------------------------------------------- countdown editor */

export function CountdownModal({ countdown, onClose, onDone }) {
  const [title, setTitle] = useState(countdown?.countdownTitle || '');
  const [date, setDate] = useState((countdown?.countdownDate || '').slice(0, 10));
  const [time, setTime] = useState(countdown?.countdownTime || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async (clear = false) => {
    setBusy(true);
    setError('');
    try {
      await api.setCountdown(clear ? '' : title, clear ? '' : date, clear ? '' : time);
      onDone();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Modal
      eyebrow="The two of you"
      title="Set a countdown"
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" onClick={() => save(false)} disabled={!date || busy}>
            Save
          </button>
        </>
      }
    >
      <label className="field">
        <span className="field__label">What is it?</span>
        <input
          className="field__input"
          value={title}
          maxLength={80}
          placeholder="Freddie visits, our anniversary…"
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <label className="field">
        <span className="field__label">The day</span>
        <input className="field__input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <label className="field">
        <span className="field__label">Time (optional)</span>
        <input
          className="field__input"
          type="time"
          value={time}
          disabled={!date}
          onChange={(e) => setTime(e.target.value)}
        />
      </label>
      {countdown?.countdownDate && (
        <button type="button" className="linkbtn linkbtn--danger" onClick={() => save(true)} disabled={busy}>
          Clear the countdown
        </button>
      )}
      {error && <p className="notice notice--error">{error}</p>}
    </Modal>
  );
}
