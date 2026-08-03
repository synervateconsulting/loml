import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { Modal } from './Modals.jsx';
import { Reactions, CommentThread } from './Reactions.jsx';
import Confirm, { discardSteps, sendSteps } from './Confirm.jsx';

// Types drive both the create/edit picker and the filter chips.
const LIST_TYPES = [
  ['activities', 'Activities'],
  ['couple_goals', 'Couple Goals'],
  ['to_do', 'To-Do'],
  ['other', 'Other'],
];
const typeLabel = (t) => LIST_TYPES.find(([k]) => k === t)?.[1] || 'Other';

const fmtWhen = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
};

// A cute Z / F initial badge in the owner's colour.
function OwnerBadge({ user }) {
  if (!user) return null;
  return (
    <span className={`listbadge listbadge--${user.color}`} title={`Added by ${user.name}`}>
      {user.initial}
    </span>
  );
}

export default function ListsView({ meId, users = {} }) {
  const [lists, setLists] = useState(null);
  const [filters, setFilters] = useState(new Set()); // empty = All
  const [editor, setEditor] = useState(null); // { mode:'create'|'edit', list? }
  const [confirm, setConfirm] = useState(null); // toggle confirmation

  const load = async () => setLists(await api.lists());
  useEffect(() => {
    load();
  }, []);

  const nameOf = (id) => users[id]?.name || 'someone';

  const clickAll = () => setFilters(new Set());
  const clickType = (t) =>
    setFilters((prev) => {
      const next = new Set(prev);
      next.has(t) ? next.delete(t) : next.add(t);
      return next;
    });

  const askToggle = (item) =>
    setConfirm({
      steps: [
        {
          title: item.isDone ? 'Mark this item incomplete?' : 'Mark this item complete?',
          body: `This will mark “${item.text}” ${item.isDone ? 'incomplete' : 'completed'} — are you sure?`,
          confirm: item.isDone ? 'Yes, mark incomplete' : 'Yes, mark complete',
        },
      ],
      action: async () => {
        await api.toggleListItem(item.id);
        await load();
      },
    });

  const finishEditor = async () => {
    setEditor(null);
    await load();
  };

  if (!lists) return <p className="empty">…</p>;

  const shown = filters.size === 0 ? lists : lists.filter((l) => filters.has(l.type));

  const metaText = (it) => {
    if (!it.stateAt) return null; // never toggled
    return `marked ${it.isDone ? 'complete' : 'incomplete'} by ${nameOf(it.stateBy)} · ${fmtWhen(it.stateAt)}`;
  };

  return (
    <div className="lists">
      <div className="lists__head">
        <div className="calpanes" role="group" aria-label="Filter lists">
          <button
            type="button"
            className={`topnav__item ${filters.size === 0 ? 'is-active' : ''}`}
            aria-pressed={filters.size === 0}
            onClick={clickAll}
          >
            All
          </button>
          {LIST_TYPES.map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`topnav__item ${filters.has(key) ? 'is-active' : ''}`}
              aria-pressed={filters.has(key)}
              onClick={() => clickType(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <button type="button" className="btn btn--small btn--primary lists__add" onClick={() => setEditor({ mode: 'create' })}>
          ＋ List
        </button>
      </div>

      {lists.length === 0 && <p className="empty">No lists yet. Tap ＋ List to start one.</p>}
      {lists.length > 0 && shown.length === 0 && <p className="empty">No lists match that filter.</p>}

      {shown.map((l) => {
        const done = l.items.filter((i) => i.isDone).length;
        return (
          <section key={l.id} className="listcard">
            <header className="listcard__head">
              <div className="listcard__titles">
                <h3 className="listcard__title">{l.title}</h3>
                <span className={`listtype listtype--${l.type}`}>{typeLabel(l.type)}</span>
              </div>
              <span className="listcard__count">
                {done}/{l.items.length}
              </span>
              <button type="button" className="btn btn--small" onClick={() => setEditor({ mode: 'edit', list: l })}>
                Edit
              </button>
            </header>

            {l.items.length === 0 ? (
              <p className="hint listcard__empty">No items yet — tap Edit to add some.</p>
            ) : (
              <ul className="listcard__items">
                {l.items.map((it) => (
                  <li key={it.id} className={`listitem ${it.isDone ? 'is-checked' : ''}`}>
                    <button
                      type="button"
                      className="listitem__check"
                      aria-pressed={it.isDone}
                      aria-label={it.isDone ? 'Mark incomplete' : 'Mark complete'}
                      onClick={() => askToggle(it)}
                    >
                      {it.isDone ? '✓' : ''}
                    </button>
                    <div className="listitem__main">
                      <span className="listitem__row">
                        <OwnerBadge user={users[it.ownerId]} />
                        <span className="listitem__text">{it.text}</span>
                      </span>
                      {metaText(it) && <span className="listitem__meta">{metaText(it)}</span>}
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {l.lastEditedBy && (
              <p className="listcard__edited">
                Last edited by {nameOf(l.lastEditedBy)} · {fmtWhen(l.lastEditedAt)}
              </p>
            )}

            <div className="listcard__social">
              <Reactions targetKind="list" targetId={l.id} reactions={l.reactions || []} meId={meId} canReact onChanged={load} />
              <CommentThread
                comments={l.comments || []}
                meId={meId}
                onSubmit={async (body) => {
                  const c = await api.comment('list', l.id, body);
                  load();
                  return c;
                }}
                onEdit={(id, body) => api.editComment(id, body)}
              />
            </div>
          </section>
        );
      })}

      {editor && (
        <ListEditor mode={editor.mode} list={editor.list} onClose={() => setEditor(null)} onDone={finishEditor} />
      )}
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

/* --------------------------------------------- create / edit (staged) editor */

function ListEditor({ mode, list, onClose, onDone }) {
  const isEdit = mode === 'edit';
  const [title, setTitle] = useState(list?.title || '');
  const [type, setType] = useState(list?.type || 'other');
  const [items, setItems] = useState(() =>
    isEdit ? (list.items || []).map((i) => ({ id: i.id, text: i.text, removed: false })) : [{ text: '' }]
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(null);

  // Snapshot for dirty-checking (drives the discard confirmation on cancel).
  const initial = useRef(JSON.stringify({ title: title, type, items }));
  const dirty = JSON.stringify({ title, type, items }) !== initial.current;

  const setItem = (idx, patch) => setItems((its) => its.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  const addItem = () => setItems((its) => [...its, { text: '' }]);
  const removeRow = (idx) =>
    setItems((its) => {
      const it = its[idx];
      if (it.id) return its.map((x, i) => (i === idx ? { ...x, removed: !x.removed } : x)); // stage / unstage
      return its.filter((_, i) => i !== idx); // brand-new row: just drop it
    });

  const save = () =>
    setConfirm({
      steps: sendSteps(
        isEdit ? 'Save changes to this list?' : 'Create this list?',
        isEdit ? 'Your changes will be saved to the list.' : 'It will be added to your lists.'
      ),
      action: async () => {
        setBusy(true);
        setError('');
        try {
          if (isEdit) {
            await api.updateList(list.id, {
              title: title.trim(),
              type,
              items: items.map((it) => ({ id: it.id, text: it.text, removed: it.removed })),
            });
          } else {
            await api.createList({ title: title.trim(), type, items: items.map((it) => it.text) });
          }
          await onDone();
        } catch (err) {
          setError(err.message);
          setBusy(false);
        }
      },
    });

  const del = () =>
    setConfirm({
      steps: [
        {
          title: `Delete “${list.title}”?`,
          body: 'This removes the whole list and all of its items from your lists.',
          confirm: 'Delete list',
          tone: 'danger',
        },
        { title: 'Certain?', body: 'One more tap and the list is gone from view.', confirm: 'Yes, delete it', tone: 'danger' },
      ],
      action: async () => {
        setBusy(true);
        setError('');
        try {
          await api.removeList(list.id);
          await onDone();
        } catch (err) {
          setError(err.message);
          setBusy(false);
        }
      },
    });

  const cancel = () => (dirty ? setConfirm({ steps: discardSteps(isEdit ? 'edit' : 'list'), action: onClose }) : onClose());

  const visibleCount = items.filter((it) => !it.removed).length;

  return (
    <>
      <Modal
        onScrimClick={cancel}
        eyebrow={isEdit ? 'Edit list' : 'New list'}
        title={isEdit ? title || 'Edit list' : 'Create a list'}
        footer={
          <div className="sheet__foot--split">
            {isEdit ? (
              <button type="button" className="btn btn--small btn--danger" disabled={busy} onClick={del}>
                Delete list
              </button>
            ) : (
              <span />
            )}
            <div className="sheet__foot--right">
              <button type="button" className="btn btn--ghost" onClick={cancel}>
                Cancel
              </button>
              <button type="button" className="btn btn--primary" disabled={!title.trim() || busy} onClick={save}>
                {isEdit ? 'Save' : 'Create'}
              </button>
            </div>
          </div>
        }
      >
        <label className="field">
          <span className="field__label">List name</span>
          <input
            className="field__input"
            value={title}
            maxLength={120}
            placeholder="Bucket list, date ideas, watchlist…"
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>

        <div className="field">
          <span className="field__label">Type</span>
          <div className="segmented segmented--wrap" role="group" aria-label="List type">
            {LIST_TYPES.map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={`segmented__opt ${type === key ? 'is-active' : ''}`}
                aria-pressed={type === key}
                onClick={() => setType(key)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span className="field__label">Items{visibleCount ? ` (${visibleCount})` : ''}</span>
          {items.map((it, i) =>
            it.removed ? (
              <div key={it.id || i} className="listedit__row is-removed">
                <span className="listedit__struck">{it.text}</span>
                <button type="button" className="linkbtn" onClick={() => removeRow(i)}>
                  Undo
                </button>
              </div>
            ) : (
              <div key={it.id || i} className="listedit__row">
                <input
                  className="field__input"
                  value={it.text}
                  maxLength={200}
                  placeholder="List item"
                  onChange={(e) => setItem(i, { text: e.target.value })}
                />
                <button
                  type="button"
                  className="linkbtn linkbtn--danger listedit__x"
                  aria-label="Remove item"
                  onClick={() => removeRow(i)}
                >
                  ×
                </button>
              </div>
            )
          )}
          <button type="button" className="btn btn--small listedit__add" onClick={addItem}>
            ＋ Add item
          </button>
        </div>

        {error && <p className="notice notice--error">{error}</p>}
      </Modal>

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
    </>
  );
}
