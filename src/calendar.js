// Calendar event types — the type picks the icon shown on the grid.
export const EVENT_TYPES = [
  { key: 'vacation', label: 'Vacation', icon: '🌴' },
  { key: 'appointment', label: 'Appointment', icon: '📝' },
  { key: 'work_trip', label: 'Work trip', icon: '✈️' },
  { key: 'date_night', label: 'Date night', icon: '💕' },
  { key: 'other', label: 'Other', icon: '📌' },
];

const byKey = (kind) => EVENT_TYPES.find((t) => t.key === kind) || EVENT_TYPES[EVENT_TYPES.length - 1];
export const eventIcon = (kind) => byKey(kind).icon;
export const eventLabel = (kind) => byKey(kind).label;

// startsAt is a naive 'YYYY-MM-DDTHH:MM' wall-clock string.
export const dayKeyOf = (startsAt) => (startsAt || '').slice(0, 10); // 'YYYY-MM-DD'

export const formatEventWhen = (startsAt) => {
  if (!startsAt) return '';
  const [d, t] = startsAt.split('T');
  const [y, m, day] = d.split('-').map(Number);
  const [hh, mm] = (t || '0:0').split(':').map(Number);
  const dt = new Date(y, m - 1, day, hh, mm);
  return dt.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
};

export const formatStamp = (iso) => {
  if (!iso) return '';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
};
