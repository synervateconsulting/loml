import { useState } from 'react';
import { api } from '../api.js';
import { EVENT_TYPES, eventIcon, eventLabel, dayKeyOf, formatEventWhen, formatStamp } from '../calendar.js';
import { Modal, WhenFields } from './Modals.jsx';
import { Reactions } from './Reactions.jsx';
import Confirm from './Confirm.jsx';
import Countdown from './Countdown.jsx';

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

export function EventEditor({ event, defaultDate, partner, isCountdown, asCountdown, onClose, onSaved, onRemoved, onChanged }) {
  const isNew = !event;
  const [kind, setKind] = useState(event?.kind || 'date_night');
  const [title, setTitle] = useState(event?.title || '');
  const [allDay, setAllDay] = useState(event?.allDay ?? false);
  const [startsAt, setStartsAt] = useState(event?.startsAt || (defaultDate ? `${defaultDate}T19:00` : ''));
  const [location, setLocation] = useState(event?.location || '');
  const [description, setDescription] = useState(event?.description || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [confirmCountdown, setConfirmCountdown] = useState(false);

  const canSave = kind && title.trim() && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(startsAt) && !busy;

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const fields = {
        kind,
        title: title.trim(),
        startsAt,
        allDay,
        location: location.trim(),
        description: description.trim(),
      };
      if (isNew) {
        const { id } = await api.createEvent(fields);
        // Creating the countdown from the banner: make the new event the countdown.
        if (asCountdown && id) await api.selectCountdown(id);
      } else {
        await api.editEvent(event.id, fields);
      }
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

  const setAsCountdown = async () => {
    setBusy(true);
    setError('');
    try {
      await api.selectCountdown(event.id);
      await onChanged();
      onClose();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  return (
    <>
      <Modal
        onScrimClick={onClose}
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
        <WhenFields allDay={allDay} setAllDay={setAllDay} startsAt={startsAt} setStartsAt={setStartsAt} />
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
          <div className="editoractions">
            {isCountdown ? (
              <span className="hint">★ This is your current countdown.</span>
            ) : (
              <button type="button" className="linkbtn" onClick={() => setConfirmCountdown(true)}>
                ★ Set as our countdown
              </button>
            )}
            <button type="button" className="linkbtn linkbtn--danger" onClick={() => setConfirmRemove(true)}>
              Remove this event
            </button>
          </div>
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
      {confirmCountdown && (
        <Confirm
          steps={[
            {
              title: 'Set as your countdown?',
              body: `This will change the countdown for ${partner} too.`,
              confirm: 'Set it',
            },
          ]}
          onResolve={(ok) => {
            setConfirmCountdown(false);
            if (ok) setAsCountdown();
          }}
        />
      )}
    </>
  );
}

/* -------------------------------------------------------------- event viewer */

function EventViewer({ event, meId, partner, isCountdown, onEdit, onClose, onChanged }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmCountdown, setConfirmCountdown] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');
  const [confirmEdit, setConfirmEdit] = useState(null); // { action }

  if (!event) {
    return (
      <Modal onScrimClick={onClose} title="Event" footer={<button type="button" className="btn btn--ghost" onClick={onClose}>Close</button>}>
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

  const startEdit = (c) => {
    setEditingId(c.id);
    setEditText(c.body);
  };
  const cancelEdit = () => {
    setEditingId(null);
    setEditText('');
  };
  const saveEdit = (c) =>
    setConfirmEdit({
      action: async () => {
        const body = editText.trim();
        if (!body) return;
        setBusy(true);
        try {
          await api.editEventComment(c.id, body);
          cancelEdit();
          await onChanged();
        } finally {
          setBusy(false);
        }
      },
    });

  const setAsCountdown = async () => {
    try {
      await api.selectCountdown(event.id);
      await onChanged();
    } catch {
      /* nothing destructive happened; leave the viewer open */
    }
  };

  const edited = event.updatedAt !== event.createdAt || event.updatedBy.id !== event.createdBy.id;

  return (
    <>
    <Modal
      onScrimClick={onClose}
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
      <p className="prose">{formatEventWhen(event.startsAt, event.allDay)}</p>
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
      <div className="editoractions">
        {isCountdown ? (
          <span className="hint">★ This is your current countdown.</span>
        ) : (
          <button type="button" className="linkbtn" onClick={() => setConfirmCountdown(true)}>
            ★ Set as our countdown
          </button>
        )}
      </div>
      <Reactions targetKind="event" targetId={event.id} reactions={event.reactions} meId={meId} canReact />
      <hr className="rule" />
      <p className="eyebrow">Comments</p>
      {event.comments.length === 0 ? (
        <p className="hint">No comments yet.</p>
      ) : (
        <ul className="comments">
          {event.comments.map((c) => {
            const mine = c.userId === meId;
            const editing = editingId === c.id;
            return (
              <li key={c.id} className="comment">
                <span className="comment__who">
                  {mine ? 'You' : c.userName}
                  {mine && !editing && (
                    <button type="button" className="linkbtn comment__edit" onClick={() => startEdit(c)}>
                      Edit
                    </button>
                  )}
                </span>
                {editing ? (
                  <span className="comment__editrow">
                    <input
                      className="field__input"
                      value={editText}
                      maxLength={500}
                      autoFocus
                      onChange={(e) => setEditText(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && saveEdit(c)}
                    />
                    <button type="button" className="btn btn--small" disabled={!editText.trim() || busy} onClick={() => saveEdit(c)}>
                      Save
                    </button>
                    <button type="button" className="linkbtn" onClick={cancelEdit}>
                      Cancel
                    </button>
                  </span>
                ) : (
                  <span className="comment__body">{c.body}</span>
                )}
                <span className="comment__at">
                  {formatStamp(c.createdAt)}
                  {c.editedAt ? ` · edited ${formatStamp(c.editedAt)}` : ''}
                </span>
              </li>
            );
          })}
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
    {confirmCountdown && (
      <Confirm
        steps={[
          {
            title: 'Set as your countdown?',
            body: `This will change the countdown for ${partner} too.`,
            confirm: 'Set it',
          },
        ]}
        onResolve={(ok) => {
          setConfirmCountdown(false);
          if (ok) setAsCountdown();
        }}
      />
    )}
    {confirmEdit && (
      <Confirm
        steps={[{ title: 'Save this edit?', body: 'Your comment will be updated.', confirm: 'Save' }]}
        onResolve={(ok) => {
          const { action } = confirmEdit;
          setConfirmEdit(null);
          if (ok) action();
        }}
      />
    )}
    </>
  );
}

/* ---------------------------------------------------------------- main view */

export default function CalendarView({ events, dateRequests = [], notifications, countdownEventId, meId, partner, onChanged }) {
  const now = new Date();
  const [cursor, setCursor] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [pane, setPane] = useState('month');
  const [dayKey, setDayKey] = useState(null);
  const [viewId, setViewId] = useState(null);
  const [edit, setEdit] = useState(null); // { id } | { isNew: true, date }
  const [reqTab, setReqTab] = useState('theirs');
  const [compose, setCompose] = useState(false); // new date request
  const [accepting, setAccepting] = useState(null); // date request being accepted
  const [reqConfirm, setReqConfirm] = useState(null); // { steps, action }

  const needsAck = notifications?.needsAck || [];
  const acknowledged = notifications?.acknowledged || [];
  const pendingOnMe = dateRequests.filter((r) => r.recipientId === meId && r.status === 'pending').length;
  const today = todayKey();
  const upcoming = events
    .filter((e) => dayKeyOf(e.startsAt) >= today)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));

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

  // Always show the day (even an empty one); you add from there.
  const openDay = (key) => setDayKey(key);

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

  const afterRequest = async () => {
    await onChanged();
    setCompose(false);
    setAccepting(null);
  };
  const declineRequest = (r) =>
    setReqConfirm({
      steps: [
        {
          title: 'Decline this date request?',
          body: `“${r.title}” will be declined and ${r.requesterName} will be notified.`,
          confirm: 'Decline',
          tone: 'danger',
        },
      ],
      action: async () => {
        await api.declineDateRequest(r.id);
        await onChanged();
      },
    });
  const cancelRequest = (r) =>
    setReqConfirm({
      steps: [
        {
          title: 'Withdraw this date request?',
          body: `“${r.title}” will be cancelled.`,
          confirm: 'Withdraw',
          tone: 'danger',
        },
      ],
      action: async () => {
        await api.cancelDateRequest(r.id);
        await onChanged();
      },
    });

  return (
    <div className="calendar">
      <div className="calbar">
        <div className="calpanes" role="group" aria-label="Calendar panes">
          <button
            type="button"
            className={`topnav__item ${pane === 'month' ? 'is-active' : ''}`}
            onClick={() => setPane('month')}
          >
            Calendar
          </button>
          <button
            type="button"
            className={`topnav__item ${pane === 'upcoming' ? 'is-active' : ''}`}
            onClick={() => setPane('upcoming')}
          >
            Upcoming
          </button>
          <button
            type="button"
            className={`topnav__item ${pane === 'requests' ? 'is-active' : ''}`}
            onClick={() => setPane('requests')}
          >
            Date Requests
            {pendingOnMe > 0 && <span className="pill">{pendingOnMe}</span>}
          </button>
          <button
            type="button"
            className={`topnav__item ${pane === 'notifications' ? 'is-active' : ''}`}
            onClick={() => setPane('notifications')}
          >
            Notifications
            {needsAck.length > 0 && <span className="pill">{needsAck.length}</span>}
          </button>
        </div>
      </div>
      {(pane === 'month' || pane === 'upcoming' || pane === 'requests') && (
        <div className="calactions">
          {pane === 'requests' ? (
            <button type="button" className="btn btn--small btn--primary" onClick={() => setCompose(true)}>
              + Date Request
            </button>
          ) : (
            <button
              type="button"
              className="btn btn--small btn--primary"
              onClick={() => setEdit({ isNew: true, date: todayKey() })}
            >
              + Event
            </button>
          )}
        </div>
      )}

      {pane === 'month' && (
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
      )}

      {pane === 'upcoming' && (
        <div className="upcoming">
          {upcoming.length === 0 ? (
            <p className="empty">Nothing upcoming. Add an event from the calendar.</p>
          ) : (
            upcoming.map((e) => (
              <Countdown
                key={e.id}
                title={e.title}
                startsAt={e.startsAt}
                allDay={e.allDay}
                icon={eventIcon(e.kind)}
                tag={e.id === countdownEventId ? 'Countdown' : null}
                onClick={() => openEvent(e.id)}
              />
            ))
          )}
        </div>
      )}

      {pane === 'notifications' && (
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

      {pane === 'requests' && (
        <DateRequestsPane
          requests={dateRequests}
          meId={meId}
          partnerName={partner}
          reqTab={reqTab}
          setReqTab={setReqTab}
          onAccept={(r) => setAccepting(r)}
          onDecline={declineRequest}
          onCancel={cancelRequest}
          onOpenEvent={openEvent}
        />
      )}

      {dayKey && (
        <Modal
          onScrimClick={() => setDayKey(null)}
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
          {eventsOn(dayKey).length === 0 ? (
            <p className="empty">Nothing on this day yet. Add something below.</p>
          ) : (
            <ul className="evlist">
              {eventsOn(dayKey).map((e) => (
                <li key={e.id}>
                  <button type="button" className="evrow" onClick={() => openEvent(e.id)}>
                    <span className="evrow__icon">{eventIcon(e.kind)}</span>
                    <span className="evrow__body">
                      <span className="evrow__title">{e.title}</span>
                      <span className="evrow__time">{formatEventWhen(e.startsAt, e.allDay)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Modal>
      )}

      {viewId && (
        <EventViewer
          event={viewingEvent}
          meId={meId}
          partner={partner}
          isCountdown={Boolean(viewingEvent && viewingEvent.id === countdownEventId)}
          onEdit={() => setEdit({ id: viewId })}
          onClose={() => setViewId(null)}
          onChanged={onChanged}
        />
      )}

      {edit && (
        <EventEditor
          event={editingEvent}
          defaultDate={edit.date}
          partner={partner}
          isCountdown={Boolean(editingEvent && editingEvent.id === countdownEventId)}
          onClose={() => setEdit(null)}
          onSaved={afterSave}
          onRemoved={afterRemove}
          onChanged={onChanged}
        />
      )}

      {compose && <DateRequestCompose partnerName={partner} onClose={() => setCompose(false)} onDone={afterRequest} />}

      {accepting && (
        <DateRequestAccept
          request={accepting}
          defaultDate={todayKey()}
          onClose={() => setAccepting(null)}
          onDone={afterRequest}
        />
      )}

      {reqConfirm && (
        <Confirm
          steps={reqConfirm.steps}
          onResolve={(ok) => {
            const { action } = reqConfirm;
            setReqConfirm(null);
            if (ok) action();
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------ date requests */

function DateReqRow({ r, mine, onAccept, onDecline, onCancel, onOpenEvent }) {
  const pending = r.status === 'pending';
  return (
    <div className="reqcard">
      <div className="reqcard__main">
        <p className="reqcard__title">{r.title}</p>
        {r.location && <p className="reqcard__loc">📍 {r.location}</p>}
        {r.description && <p className="reqcard__desc">{r.description}</p>}
        {!pending && r.eventStartsAt && (
          <button type="button" className="linkbtn reqcard__when" onClick={() => onOpenEvent(r.eventId)}>
            {eventIcon(r.eventKind)} {formatEventWhen(r.eventStartsAt, r.eventAllDay)} · view event
          </button>
        )}
      </div>
      {pending && (
        <div className="reqcard__actions">
          {mine ? (
            <button type="button" className="btn btn--small btn--danger" onClick={() => onCancel(r)}>
              Cancel
            </button>
          ) : (
            <>
              <button type="button" className="btn btn--small btn--primary" onClick={() => onAccept(r)}>
                Accept
              </button>
              <button type="button" className="btn btn--small btn--ghost" onClick={() => onDecline(r)}>
                Decline
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function DateRequestsPane({ requests, meId, partnerName, reqTab, setReqTab, onAccept, onDecline, onCancel, onOpenEvent }) {
  const theirs = requests.filter((r) => r.recipientId === meId); // sent to me
  const mine = requests.filter((r) => r.requesterId === meId); // I sent
  const isMine = reqTab === 'mine';
  const list = isMine ? mine : theirs;
  const waiting = list.filter((r) => r.status === 'pending');
  const done = list.filter((r) => r.status === 'accepted');
  const waitingHeading = isMine ? `Waiting on ${partnerName}` : 'Waiting on you';

  return (
    <div className="reqpane">
      <nav className="tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={reqTab === 'theirs'}
          className={`tab ${reqTab === 'theirs' ? 'is-active' : ''}`}
          onClick={() => setReqTab('theirs')}
        >
          {partnerName}’s requests
          {theirs.some((r) => r.status === 'pending') && <span className="dot" aria-label="waiting on you" />}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={reqTab === 'mine'}
          className={`tab ${reqTab === 'mine' ? 'is-active' : ''}`}
          onClick={() => setReqTab('mine')}
        >
          My requests
        </button>
      </nav>

      <section className="section">
        <header className="section__head">
          <h2 className="section__title">{waitingHeading}</h2>
          <span className="section__count">{waiting.length}</span>
        </header>
        {waiting.length === 0 ? (
          <p className="empty">{isMine ? 'Nothing waiting on them.' : 'Nothing waiting on you.'}</p>
        ) : (
          waiting.map((r) => (
            <DateReqRow
              key={r.id}
              r={r}
              mine={isMine}
              onAccept={onAccept}
              onDecline={onDecline}
              onCancel={onCancel}
              onOpenEvent={onOpenEvent}
            />
          ))
        )}
      </section>

      <section className="section">
        <header className="section__head">
          <h2 className="section__title">Acknowledged</h2>
          <span className="section__count">{done.length}</span>
        </header>
        {done.length === 0 ? (
          <p className="empty">Accepted requests land here as calendar events.</p>
        ) : (
          done.map((r) => <DateReqRow key={r.id} r={r} mine={isMine} onOpenEvent={onOpenEvent} />)
        )}
      </section>
    </div>
  );
}

function DateRequestCompose({ partnerName, onClose, onDone }) {
  const [title, setTitle] = useState('');
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const send = async () => {
    if (!title.trim()) return;
    setBusy(true);
    setError('');
    try {
      await api.createDateRequest({ title: title.trim(), location: location.trim(), description: description.trim() });
      await onDone();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  return (
    <Modal
      onScrimClick={onClose}
      eyebrow="Ask for a date"
      title="New date request"
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" onClick={send} disabled={!title.trim() || busy}>
            Send request
          </button>
        </>
      }
    >
      <p className="hint">Suggest the date — {partnerName} picks a day and time to make it happen.</p>
      <label className="field">
        <span className="field__label">Title</span>
        <input
          className="field__input"
          value={title}
          maxLength={160}
          placeholder="Dinner at that new place?"
          onChange={(e) => setTitle(e.target.value)}
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
      {error && <p className="notice notice--error">{error}</p>}
    </Modal>
  );
}

function DateRequestAccept({ request, defaultDate, onClose, onDone }) {
  const [kind, setKind] = useState('date_night');
  const [title, setTitle] = useState(request.title || '');
  const [allDay, setAllDay] = useState(false);
  const [startsAt, setStartsAt] = useState(defaultDate ? `${defaultDate}T19:00` : '');
  const [location, setLocation] = useState(request.location || '');
  const [description, setDescription] = useState(request.description || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const canSave = title.trim() && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(startsAt) && !busy;

  const accept = async () => {
    setBusy(true);
    setError('');
    try {
      await api.acceptDateRequest(request.id, {
        kind,
        title: title.trim(),
        startsAt,
        allDay,
        location: location.trim(),
        description: description.trim(),
      });
      await onDone();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  return (
    <Modal
      onScrimClick={onClose}
      eyebrow={`${request.requesterName}’s date request`}
      title="Set a date & time"
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" onClick={accept} disabled={!canSave}>
            Add to calendar
          </button>
        </>
      }
    >
      <p className="hint">Pick when — this adds it to the calendar and lets {request.requesterName} know.</p>
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
        <input className="field__input" value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <WhenFields allDay={allDay} setAllDay={setAllDay} startsAt={startsAt} setStartsAt={setStartsAt} />
      <label className="field">
        <span className="field__label">Location (optional)</span>
        <input className="field__input" value={location} maxLength={200} onChange={(e) => setLocation(e.target.value)} />
      </label>
      <label className="field">
        <span className="field__label">Description (optional)</span>
        <textarea
          className="field__input field__input--area"
          rows={4}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>
      {error && <p className="notice notice--error">{error}</p>}
    </Modal>
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
