import { useState } from 'react';
import { api } from '../api.js';
import { EVENT_TYPES, eventIcon, eventLabel, dayKeyOf, formatEventWhen, formatStamp } from '../calendar.js';
import { Modal } from './Modals.jsx';
import { Reactions } from './Reactions.jsx';
import Confirm from './Confirm.jsx';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const NOTE_VERB = { created: 'added', edited: 'updated', commented: 'commented on', reacted: 'reacted to' };
const pad2 = (n) => String(n).padStart(2, '0');
const keyFor = (y, m, d) => `${y}-${pad2(m + 1)}-${pad2(d)}`;
const todayKey = () => {
  const d = new Date();
  return keyFor(d.getFullYear(), d.getMonth(), d.getDate());
};
const prettyDay = (dayKey) => {
  const [y, m, d] = dayKey.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
};

/* ------------------------------------------------------------- event editor */

function EventEditor({ event, defaultDate, onClose, onSaved, onRemoved }) {
  const isNew = !event;
  const [kind, setKind] = useState(event?.kind || 'date_night');
  const [title, setTitle] = useState(event?.title || '');
  const [startsAt, setStartsAt] = useState(event?.startsAt || (defaultDate ? `${defaultDate}T19:00` : ''));
  const [location, setLocation] = useState(event?.location || '');
  const [description, setDescription] = useState(event?.description || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(false);

  const canSave = kind && title.trim() && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(startsAt) && !busy;

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const fields = {
        kind,
        title: title.trim(),
        startsAt,
        location: location.trim(),
        description: description.trim(),
      };
      if (isNew) await api.createEvent(fields);
      else await api.editEvent(event.id, fields);
      await onSaved();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api.removeEvent(event.id);
      await onRemoved();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  return (
    <>
      <Modal
        eyebrow="For the two of you"
        title={isNew ? 'Add to the calendar' : 'Edit event'}
        footer={
          <>
            <button type="button" className="btn btn--ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn btn--primary" onClick={save} disabled={!canSave}>
              {isNew ? 'Add event' : 'Save changes'}
            </button>
          </>
        }
      >
        <div className="field">
          <span className="field__label">Type</span>
          <div className="segmented segmented--wrap" role="group" aria-label="Event type">
            {EVENT_TYPES.map((t) => (
              <button
                key={t.key}
                type="button"
                className={`segmented__opt ${kind === t.key ? 'is-active' : ''}`}
                aria-pressed={kind === t.key}
                onClick={() => setKind(t.key)}
              >
                {t.icon} {t.label}
              </button>
            ))}
          </div>
        </div>
        <label className="field">
          <span className="field__label">Title</span>
          <input
            className="field__input"
            value={title}
            maxLength={160}
            placeholder="What is it?"
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="field">
          <span className="field__label">When</span>
          <input
            className="field__input"
            type="datetime-local"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
          />
        </label>
        <label className="field">
          <span className="field__label">Location (optional)</span>
          <input
            className="field__input"
            value={location}
            maxLength={200}
            placeholder="Where?"
            onChange={(e) => setLocation(e.target.value)}
          />
        </label>
        <label className="field">
          <span className="field__label">Description (optional)</span>
          <textarea
            className="field__input field__input--area"
            rows={4}
            value={description}
            placeholder="Anything else."
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        {!isNew && (
          <button type="button" className="linkbtn linkbtn--danger" onClick={() => setConfirmRemove(true)}>
            Remove this event
          </button>
        )}
        {error && <p className="notice notice--error">{error}</p>}
      </Modal>
      {confirmRemove && (
        <Confirm
          steps={[
            { title: 'Remove this event?', body: 'It comes off the calendar for both of you.', confirm: 'Remove it', tone: 'danger' },
            { title: 'Certain?', body: 'One more tap and it is gone from the calendar.', confirm: 'Yes, remove', tone: 'danger' },
          ]}
          onResolve={(ok) => {
            setConfirmRemove(false);
            if (ok) remove();
          }}
        />
      )}
    </>
  );
}

/* -------------------------------------------------------------- event viewer */

function EventViewer({ event, meId, onEdit, onClose, onChanged }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  if (!event) {
    return (
      <Modal title="Event" footer={<button type="button" className="btn btn--ghost" onClick={onClose}>Close</button>}>
        <p className="prose">This event was removed.</p>
      </Modal>
    );
  }

  const addComment = async () => {
    const body = text.trim();
    if (!body) return;
    setBusy(true);
    try {
      await api.commentEvent(event.id, body);
      setText('');
      await onChanged();
    } finally {
      setBusy(false);
    }
  };

  const edited = event.updatedAt !== event.createdAt || event.updatedBy.id !== event.createdBy.id;

  return (
    <Modal
      eyebrow={`${eventIcon(event.kind)} ${eventLabel(event.kind)}`}
      title={event.title}
      footer={
        <div className="sheet__foot--split">
          <button type="button" className="linkbtn" onClick={onEdit}>
            Edit
          </button>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Close
          </button>
        </div>
      }
    >
      <p className="prose">{formatEventWhen(event.startsAt)}</p>
      {event.location && <p className="calloc">📍 {event.location}</p>}
      {event.description && <p className="prose">{event.description}</p>}
      <p className="calmeta">
        Added by {event.createdBy.name} · {formatStamp(event.createdAt)}
        {edited && (
          <>
            <br />
            Last updated by {event.updatedBy.name} · {formatStamp(event.updatedAt)}
          </>
        )}
      </p>
      <Reactions targetKind="event" targetId={event.id} reactions={event.reactions} meId={meId} canReact />
      <hr className="rule" />
      <p className="eyebrow">Comments</p>
      {event.comments.length === 0 ? (
        <p className="hint">No comments yet.</p>
      ) : (
        <ul className="comments">
          {event.comments.map((c) => (
            <li key={c.id} className="comment">
              <span className="comment__who">{c.userName}</span>
              <span className="comment__body">{c.body}</span>
              <span className="comment__at">{formatStamp(c.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="commentadd">
        <input
          className="field__input"
          value={text}
          placeholder="Add a comment"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addComment()}
        />
        <button type="button" className="btn btn--small" onClick={addComment} disabled={!text.trim() || busy}>
          Send
        </button>
      </div>
    </Modal>
  );
}

/* ---------------------------------------------------------------- main view */

export default function CalendarView({ events, notifications, meId, partner, onChanged }) {
  const now = new Date();
  const [cursor, setCursor] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [pane, setPane] = useState('month');
  const [dayKey, setDayKey] = useState(null);
  const [viewId, setViewId] = useState(null);
  const [edit, setEdit] = useState(null); // { id } | { isNew: true, date }

  const needsAck = notifications?.needsAck || [];
  const acknowledged = notifications?.acknowledged || [];

  const eventsOn = (key) => events.filter((e) => dayKeyOf(e.startsAt) === key);
  const viewingEvent = viewId ? events.find((e) => e.id === viewId) : null;
  const editingEvent = edit?.id ? events.find((e) => e.id === edit.id) : null;

  const step = (delta) => {
    setCursor((c) => {
      const m = c.m + delta;
      if (m < 0) return { y: c.y - 1, m: 11 };
      if (m > 11) return { y: c.y + 1, m: 0 };
      return { y: c.y, m };
    });
  };

  const firstWeekday = new Date(cursor.y, cursor.m, 1).getDay();
  const daysInMonth = new Date(cursor.y, cursor.m + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const openDay = (key) => {
    if (eventsOn(key).length) setDayKey(key);
    else setEdit({ isNew: true, date: key });
  };

  const openEvent = (id) => {
    setDayKey(null);
    setViewId(id);
  };

  const ack = async (id) => {
    await api.ackEventNotification(id);
    await onChanged();
  };

  const afterSave = async () => {
    await onChanged();
    setEdit(null);
  };
  const afterRemove = async () => {
    await onChanged();
    setEdit(null);
    setViewId(null);
  };

  return (
    <div className="calendar">
      <div className="calbar">
        <button
          type="button"
          className="topnav__item"
          onClick={() => setPane(pane === 'month' ? 'notifications' : 'month')}
        >
          {pane === 'month' ? (
            <>
              Notifications
              {needsAck.length > 0 && <span className="pill">{needsAck.length}</span>}
            </>
          ) : (
            '← Back to calendar'
          )}
        </button>
        {pane === 'month' && (
          <button
            type="button"
            className="btn btn--small btn--primary"
            onClick={() => setEdit({ isNew: true, date: todayKey() })}
          >
            + Add event
          </button>
        )}
      </div>

      {pane === 'month' ? (
        <>
          <div className="calhead">
            <button type="button" className="calnav" aria-label="Previous month" onClick={() => step(-1)}>
              ‹
            </button>
            <h2 className="calhead__title">
              {MONTHS[cursor.m]} {cursor.y}
            </h2>
            <button type="button" className="calnav" aria-label="Next month" onClick={() => step(1)}>
              ›
            </button>
          </div>
          <div className="calgrid">
            {WEEKDAYS.map((w, i) => (
              <div key={i} className="calgrid__wd">
                {w}
              </div>
            ))}
            {cells.map((d, i) => {
              if (d === null) return <div key={`b${i}`} className="calcell calcell--empty" />;
              const key = keyFor(cursor.y, cursor.m, d);
              const dayEvents = eventsOn(key);
              return (
                <button
                  key={key}
                  type="button"
                  className={`calcell ${key === todayKey() ? 'is-today' : ''} ${dayEvents.length ? 'has-events' : ''}`}
                  onClick={() => openDay(key)}
                >
                  <span className="calcell__num">{d}</span>
                  <span className="calcell__icons">
                    {dayEvents.slice(0, 3).map((e) => (
                      <span key={e.id}>{eventIcon(e.kind)}</span>
                    ))}
                    {dayEvents.length > 3 && <span className="calcell__more">+{dayEvents.length - 3}</span>}
                  </span>
                </button>
              );
            })}
          </div>
        </>
      ) : (
        <div className="notiflist">
          <NoteSection
            heading="Needs acknowledgment"
            notes={needsAck}
            empty="Nothing new from your partner."
            onOpen={openEvent}
            onAck={ack}
          />
          <NoteSection
            heading="Acknowledged"
            notes={acknowledged}
            empty="Handled notifications collect here."
            onOpen={openEvent}
          />
        </div>
      )}

      {dayKey && (
        <Modal
          eyebrow="On this day"
          title={prettyDay(dayKey)}
          footer={
            <div className="sheet__foot--split">
              <button
                type="button"
                className="linkbtn"
                onClick={() => {
                  const d = dayKey;
                  setDayKey(null);
                  setEdit({ isNew: true, date: d });
                }}
              >
                + Add on this day
              </button>
              <button type="button" className="btn btn--ghost" onClick={() => setDayKey(null)}>
                Close
              </button>
            </div>
          }
        >
          <ul className="evlist">
            {eventsOn(dayKey).map((e) => (
              <li key={e.id}>
                <button type="button" className="evrow" onClick={() => openEvent(e.id)}>
                  <span className="evrow__icon">{eventIcon(e.kind)}</span>
                  <span className="evrow__body">
                    <span className="evrow__title">{e.title}</span>
                    <span className="evrow__time">{formatEventWhen(e.startsAt)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Modal>
      )}

      {viewId && (
        <EventViewer
          event={viewingEvent}
          meId={meId}
          onEdit={() => setEdit({ id: viewId })}
          onClose={() => setViewId(null)}
          onChanged={onChanged}
        />
      )}

      {edit && (
        <EventEditor
          event={editingEvent}
          defaultDate={edit.date}
          onClose={() => setEdit(null)}
          onSaved={afterSave}
          onRemoved={afterRemove}
        />
      )}
    </div>
  );
}

function NoteSection({ heading, notes, empty, onOpen, onAck }) {
  return (
    <section className="section">
      <header className="section__head">
        <h2 className="section__title">{heading}</h2>
        <span className="section__count">{notes.length}</span>
      </header>
      {notes.length === 0 ? (
        <p className="empty">{empty}</p>
      ) : (
        notes.map((n) => (
          <div key={n.id} className="notif">
            <button type="button" className="notif__body" onClick={() => onOpen(n.event.id)}>
              <span className="notif__icon">{eventIcon(n.event.kind)}</span>
              <span className="notif__text">
                <span className="notif__line">
                  {n.fromName} {NOTE_VERB[n.action] || 'updated'} “{n.event.title}”
                </span>
                <span className="notif__at">{formatStamp(n.createdAt)}</span>
              </span>
            </button>
            {onAck && (
              <button type="button" className="btn btn--small btn--primary" onClick={() => onAck(n.id)}>
                Got it
              </button>
            )}
          </div>
        ))
      )}
    </section>
  );
}
