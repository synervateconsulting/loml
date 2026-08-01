import { useEffect, useState } from 'react';

// Days until the shared "next time", with the full date/time shown. When a
// specific time is set it ticks live down to the second. Tapping opens the
// editor.

// Build a local Date from 'YYYY-MM-DD' (+ optional 'HH:MM'), avoiding the
// timezone drift you'd get from `new Date('2026-09-01')` (parsed as UTC).
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

// Live remaining string down to the second.
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

export default function Countdown({ countdown, onEdit }) {
  const date = countdown?.countdownDate || null;
  const time = countdown?.countdownTime || null;

  // Tick every second only when a time is set (otherwise a day count is enough).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!date || !time) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [date, time]);

  if (!date) {
    return (
      <button type="button" className="countdown countdown--empty" onClick={onEdit}>
        + Set a countdown
      </button>
    );
  }

  const target = toLocal(date, time);
  const title = countdown.countdownTitle || 'Countdown';
  const when = formatWhen(target, Boolean(time));

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
    <button type="button" className="countdown" onClick={onEdit}>
      <span className="countdown__num">{num}</span>
      <span className="countdown__body">
        <span className="countdown__title">{title}</span>
        <span className="countdown__when">{when}</span>
        <span className={`countdown__sub ${time ? 'countdown__sub--live' : ''}`}>{sub}</span>
      </span>
    </button>
  );
}
