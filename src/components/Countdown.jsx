import { useEffect, useState } from 'react';

// A countdown banner for a single dated thing (the selected countdown, or any
// upcoming event). Ticks live to the second when a time is set; an all-day one
// just shows a day count. `empty` renders the "set a countdown" call to action.

const toLocal = (dateStr, timeStr) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (timeStr) {
    const [hh, mm] = timeStr.split(':').map(Number);
    return new Date(y, m - 1, d, hh, mm);
  }
  return new Date(y, m - 1, d);
};

const daysBetween = (target) => {
  const now = new Date();
  const a = new Date(target.getFullYear(), target.getMonth(), target.getDate());
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((a - b) / 86400000);
};

const formatWhen = (target, hasTime) => {
  const datePart = target.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  if (!hasTime) return datePart;
  const timePart = target.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${datePart} · ${timePart}`;
};

const pad = (n) => String(n).padStart(2, '0');
const liveRemaining = (ms) => {
  const s = Math.floor(ms / 1000);
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  if (days > 0) return `${days}d ${pad(hours)}h ${pad(mins)}m ${pad(secs)}s`;
  if (hours > 0) return `${hours}h ${pad(mins)}m ${pad(secs)}s`;
  if (mins > 0) return `${mins}m ${pad(secs)}s`;
  return `${secs}s`;
};

// Small golden value beneath the compact title: the live to-the-second count
// when a time is set, otherwise a day count.
const compactValue = (target, time, now) => {
  if (time) {
    const ms = target.getTime() - now;
    return ms > 0 ? liveRemaining(ms) : '♥ the moment is here';
  }
  const days = daysBetween(target);
  if (days > 1) return `${days} days to go`;
  if (days === 1) return 'tomorrow';
  if (days === 0) return 'today';
  return `${Math.abs(days)} days ago`;
};

export default function Countdown({ empty, emptyLabel = '+ Set a countdown', title, startsAt, allDay, icon, tag, compact, onClick }) {
  const date = empty ? null : (startsAt || '').slice(0, 10);
  const time = !empty && !allDay ? (startsAt || '').slice(11, 16) : null;

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (empty || !time) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [empty, time]);

  if (empty || !date) {
    return (
      <button type="button" className={`countdown countdown--empty ${compact ? 'countdown--compact' : ''}`} onClick={onClick}>
        {emptyLabel}
      </button>
    );
  }

  const target = toLocal(date, time);
  const when = formatWhen(target, Boolean(time));

  // Compact: one slim line — title on the left, live/day count on the right.
  if (compact) {
    return (
      <button type="button" className="countdown countdown--compact" onClick={onClick}>
        <span className="countdown__ctitle">
          {icon ? `${icon} ` : '⏳ '}
          {title || 'Countdown'}
          {tag && <span className="countdown__tag">{tag}</span>}
        </span>
        <span className={`countdown__cval ${time ? 'countdown__cval--live' : ''}`}>{compactValue(target, time, now)}</span>
      </button>
    );
  }

  let num;
  let sub;
  if (time) {
    const ms = target.getTime() - now;
    if (ms > 0) {
      num = Math.floor(ms / 86400000);
      sub = liveRemaining(ms);
    } else {
      num = '♥';
      sub = 'the moment is here';
    }
  } else {
    const days = daysBetween(target);
    num = days >= 0 ? days : '♥';
    sub =
      days > 1 ? `${days} days to go` : days === 1 ? 'tomorrow' : days === 0 ? 'today' : `${Math.abs(days)} days ago`;
  }

  return (
    <button type="button" className="countdown" onClick={onClick}>
      <span className="countdown__num">{num}</span>
      <span className="countdown__body">
        <span className="countdown__title">
          {icon ? `${icon} ` : ''}
          {title || 'Countdown'}
          {tag && <span className="countdown__tag">{tag}</span>}
        </span>
        <span className="countdown__when">{when}</span>
        <span className={`countdown__sub ${time ? 'countdown__sub--live' : ''}`}>{sub}</span>
      </span>
    </button>
  );
}
