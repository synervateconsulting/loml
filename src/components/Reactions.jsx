import { useState } from 'react';
import { api } from '../api.js';
import { REACTION_EMOJI } from '../shares.js';

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

// A little comment thread for a completed game or the daily question. Either
// partner can add as many as they like; `onSubmit(body)` posts one and resolves
// with the created comment, which is appended optimistically.
export function CommentThread({ comments = [], meId, onSubmit }) {
  const [list, setList] = useState(comments);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

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

  return (
    <div className="cthread">
      <p className="eyebrow">Comments</p>
      {list.length > 0 && (
        <ul className="cthread__list">
          {list.map((c) => (
            <li key={c.id} className={`cmt ${c.userId === meId ? 'cmt--mine' : ''}`}>
              <span className="cmt__who">{c.userId === meId ? 'You' : c.userName}</span>
              <span className="cmt__body">{c.body}</span>
            </li>
          ))}
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
