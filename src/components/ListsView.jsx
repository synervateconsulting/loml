import { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function ListsView() {
  const [lists, setLists] = useState(null);
  const [newTitle, setNewTitle] = useState('');
  const [drafts, setDrafts] = useState({});
  const [busy, setBusy] = useState(false);

  const load = async () => setLists(await api.lists());
  useEffect(() => {
    load();
  }, []);

  const addList = async () => {
    const t = newTitle.trim();
    if (!t) return;
    setBusy(true);
    try {
      await api.createList(t);
      setNewTitle('');
      await load();
    } finally {
      setBusy(false);
    }
  };
  const addItem = async (listId) => {
    const t = (drafts[listId] || '').trim();
    if (!t) return;
    await api.addListItem(listId, t);
    setDrafts((d) => ({ ...d, [listId]: '' }));
    await load();
  };
  const toggle = async (id) => {
    await api.toggleListItem(id);
    await load();
  };
  const removeItem = async (id) => {
    await api.removeListItem(id);
    await load();
  };
  const removeList = async (id) => {
    await api.removeList(id);
    await load();
  };

  if (!lists) return <p className="empty">…</p>;

  return (
    <div className="lists">
      <div className="lists__new">
        <input
          className="field__input"
          placeholder="New list — bucket list, watchlist, places…"
          value={newTitle}
          maxLength={80}
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addList()}
        />
        <button
          type="button"
          className="btn btn--small btn--primary"
          disabled={!newTitle.trim() || busy}
          onClick={addList}
        >
          Add list
        </button>
      </div>

      {lists.length === 0 && <p className="empty">No lists yet. Start one above.</p>}

      {lists.map((l) => {
        const done = l.items.filter((i) => i.checkedBy).length;
        return (
          <section key={l.id} className="listcard">
            <header className="listcard__head">
              <h3 className="listcard__title">{l.title}</h3>
              <span className="listcard__count">
                {done}/{l.items.length}
              </span>
              <button type="button" className="linkbtn linkbtn--danger" onClick={() => removeList(l.id)}>
                Remove
              </button>
            </header>
            <ul className="listcard__items">
              {l.items.map((it) => (
                <li key={it.id} className={`listitem ${it.checkedBy ? 'is-checked' : ''}`}>
                  <button
                    type="button"
                    className="listitem__check"
                    aria-pressed={!!it.checkedBy}
                    onClick={() => toggle(it.id)}
                  >
                    {it.checkedBy ? '✓' : ''}
                  </button>
                  <span className="listitem__text">{it.text}</span>
                  <button
                    type="button"
                    className="linkbtn listitem__x"
                    aria-label="Remove item"
                    onClick={() => removeItem(it.id)}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
            <div className="listcard__add">
              <input
                className="field__input"
                placeholder="Add an item"
                value={drafts[l.id] || ''}
                onChange={(e) => setDrafts((d) => ({ ...d, [l.id]: e.target.value }))}
                onKeyDown={(e) => e.key === 'Enter' && addItem(l.id)}
              />
              <button
                type="button"
                className="btn btn--small"
                disabled={!(drafts[l.id] || '').trim()}
                onClick={() => addItem(l.id)}
              >
                Add
              </button>
            </div>
          </section>
        );
      })}
    </div>
  );
}
