import { useState } from 'react';
import DecksView from './DecksView.jsx';

// "Games" groups the playful, low-stakes ways to start a share. It nests its
// own sub-tabs (Decks, This / That) beneath the top nav, mirroring how the
// calendar nests Calendar / Upcoming / Notifications.
export default function GamesView({ onUsePrompt }) {
  const [pane, setPane] = useState('decks');

  return (
    <div className="games">
      <div className="calpanes" role="group" aria-label="Games">
        <button
          type="button"
          className={`topnav__item ${pane === 'decks' ? 'is-active' : ''}`}
          aria-pressed={pane === 'decks'}
          onClick={() => setPane('decks')}
        >
          Decks
        </button>
        <button
          type="button"
          className={`topnav__item ${pane === 'thisthat' ? 'is-active' : ''}`}
          aria-pressed={pane === 'thisthat'}
          onClick={() => setPane('thisthat')}
        >
          This / That
        </button>
      </div>

      {pane === 'decks' && <DecksView onUsePrompt={onUsePrompt} />}

      {pane === 'thisthat' && (
        <div className="thisthat thisthat--soon">
          <p className="empty">This / That is on its way — pick a side on sets like food, music and vacations, then see where you match. Coming next.</p>
        </div>
      )}
    </div>
  );
}
