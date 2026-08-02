import { useState } from 'react';
import { api } from '../api.js';
import { REACTION_EMOJI } from '../shares.js';
import Confirm from './Confirm.jsx';

const fmtStamp = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
};

// Interactive reaction bar. Optimistic: your pick updates instantly; the server
// toggles it off if you tap the same one again. When `canReact` is false (it's
// your own share/reply) the bar is hidden — you just see their reaction.
// Pass `onReact(emoji)` to override where the reaction is sent (e.g. the daily
// question, which isn't a question row); otherwise it posts to /reactions.
export function Reactions({ targetKind, targetId, reactions = [], meId, canReact = true, onReact }) {
  const initialMine = reactions.find((r) => r.userId === meId)?.emoji || null;
  const [mine, setMine] = useState(initialMine);
  const theirs = reactions.filter((r) => r.userId !== meId);

  if (!canReact) {
    if (!theirs.length) return null;
    return (
      <div className="reactions reactions--readonly">
        <span className="reactions__label">Their reaction</span>
        <span className="reactions__theirs">
          {theirs.map((r, i) => (
            <span key={i} className="reactions__badge">
              {r.emoji}
            </span>
          ))}
        </span>
      </div>
    );
  }

  const tap = async (emoji) => {
    const next = mine === emoji ? null : emoji;
    setMine(next);
    try {
      if (onReact) await onReact(emoji);
      else await api.react(targetKind, targetId, emoji);
    } catch {
      setMine(initialMine);
    }
  };

  return (
    <div className="reactions">
      <div className="reactions__bar">
        {REACTION_EMOJI.map((e) => (
          <button
            key={e}
            type="button"
            className={`reactions__opt ${mine === e ? 'is-mine' : ''}`}
            aria-pressed={mine === e}
            onClick={() => tap(e)}
          >
            {e}
          </button>
        ))}
      </div>
      {theirs.length > 0 && (
        <span className="reactions__theirs">
          {theirs.map((r, i) => (
            <span key={i} className="reactions__badge" title="from them">
              {r.emoji}
            </span>
          ))}
        </span>
      )}
    </div>
  );
}

// A little comment thread for a completed game, the daily question, or a list.
// Either partner can add as many as they like; `onSubmit(body)` posts one and
// resolves with the created comment (appended optimistically). Pass
// `onEdit(id, body)` to allow in-line editing of your own comments — it resolves
// with the updated comment ({ editedAt }) and the change is confirmed first.
export function CommentThread({ comments = [], meId, onSubmit, onEdit }) {
  const [list, setList] = useState(comments);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');
  const [confirm, setConfirm] = useState(null);

  const send = async () => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    setError('');
    try {
      const created = await onSubmit(body);
      if (created) setList((l) => [...l, created]);
      setText('');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (c) => {
    setEditingId(c.id);
    setEditText(c.body);
    setError('');
  };
  const cancelEdit = () => {
    setEditingId(null);
    setEditText('');
  };
  const saveEdit = (c) => {
    const body = editText.trim();
    if (!body) return;
    setConfirm({
      steps: [{ title: 'Save this edit?', body: 'Your comment will be updated.', confirm: 'Save' }],
      action: async () => {
        setBusy(true);
        setError('');
        try {
          const updated = await onEdit(c.id, body);
          setList((l) => l.map((x) => (x.id === c.id ? { ...x, body, editedAt: updated?.editedAt || new Date().toISOString() } : x)));
          cancelEdit();
        } catch (e) {
          setError(e.message);
        } finally {
          setBusy(false);
        }
      },
    });
  };

  return (
    <div className="cthread">
      <p className="eyebrow">Comments</p>
      {list.length > 0 && (
        <ul className="cthread__list">
          {list.map((c) => {
            const mine = c.userId === meId;
            const editing = editingId === c.id;
            return (
              <li key={c.id} className={`cmt ${mine ? 'cmt--mine' : ''}`}>
                <span className="cmt__head">
                  <span className="cmt__who">{mine ? 'You' : c.userName}</span>
                  {mine && onEdit && !editing && (
                    <button type="button" className="linkbtn cmt__edit" onClick={() => startEdit(c)}>
                      Edit
                    </button>
                  )}
                </span>
                {editing ? (
                  <div className="cmt__editrow">
                    <input
                      className="field__input"
                      value={editText}
                      maxLength={500}
                      autoFocus
                      onChange={(e) => setEditText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          saveEdit(c);
                        }
                      }}
                    />
                    <button type="button" className="btn btn--small" disabled={!editText.trim() || busy} onClick={() => saveEdit(c)}>
                      Save
                    </button>
                    <button type="button" className="linkbtn" onClick={cancelEdit}>
                      Cancel
                    </button>
                  </div>
                ) : (
                  <span className="cmt__body">{c.body}</span>
                )}
                <span className="cmt__at">
                  {fmtStamp(c.createdAt)}
                  {c.editedAt ? ` · edited ${fmtStamp(c.editedAt)}` : ''}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <div className="cthread__compose">
        <input
          className="field__input"
          value={text}
          maxLength={500}
          placeholder="Add a comment…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button type="button" className="btn btn--small" disabled={!text.trim() || busy} onClick={send}>
          Post
        </button>
      </div>
      {error && <p className="notice notice--error">{error}</p>}
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

// Read-only cluster for cards.
export function ReactionSummary({ reactions = [] }) {
  if (!reactions.length) return null;
  return (
    <span className="reactsum">
      {reactions.map((r, i) => (
        <span key={i} className="reactsum__badge">
          {r.emoji}
        </span>
      ))}
    </span>
  );
}
