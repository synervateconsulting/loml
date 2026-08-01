import { useState } from 'react';
import { api } from '../api.js';
import { REACTION_EMOJI } from '../shares.js';

// Interactive reaction bar. Optimistic: your pick updates instantly; the server
// toggles it off if you tap the same one again. When `canReact` is false (it's
// your own share/reply) the bar is hidden — you just see their reaction.
export function Reactions({ targetKind, targetId, reactions = [], meId, canReact = true }) {
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
      await api.react(targetKind, targetId, emoji);
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
