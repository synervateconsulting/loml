import { useState } from 'react';
import DecksView from './DecksView.jsx';
import { THISTHAT_TEMPLATES } from '../thisthat.js';
import { templateToItems } from './ThisThat.jsx';

// "Games" groups the playful, low-stakes ways to start a share. It nests its
// own sub-tabs (Decks, This / That) beneath the top nav, mirroring how the
// calendar nests Calendar / Upcoming / Notifications.
export default function GamesView({ onUsePrompt, onStartThisThat, usedGames = [] }) {
  const [pane, setPane] = useState('decks');
  const used = new Set(usedGames);

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

      {pane === 'decks' && <DecksView onUsePrompt={onUsePrompt} used={used} />}

      {pane === 'thisthat' && (
        <div className="thisthat">
          <p className="decks__hint">
            Pick a set, choose your own sides, and send it — you’ll both see where you match once they answer.
          </p>
          <div className="ttsets">
            {THISTHAT_TEMPLATES.map((t) => {
              const played = used.has(`tt:${t.id}`);
              return (
                <button
                  key={t.id}
                  type="button"
                  className={`ttset ${played ? 'is-played' : ''}`}
                  onClick={() => onStartThisThat?.({ title: t.name, items: templateToItems(t), usedKey: `tt:${t.id}` })}
                >
                  <span className="ttset__icon" aria-hidden="true">{t.icon}</span>
                  <span className="ttset__text">
                    <span className="ttset__name">
                      {t.name}
                      {played && <span className="playedtag">Played</span>}
                    </span>
                    <span className="ttset__blurb">{t.blurb}</span>
                  </span>
                  <span className="ttset__count">{t.items.length}</span>
                </button>
              );
            })}
          </div>
          <button
            type="button"
            className="ttset ttset--build"
            onClick={() => onStartThisThat?.({ title: '', items: null })}
          >
            <span className="ttset__icon" aria-hidden="true">＋</span>
            <span className="ttset__text">
              <span className="ttset__name">Build your own</span>
              <span className="ttset__blurb">Start from scratch — at least 3 this-or-thats.</span>
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
