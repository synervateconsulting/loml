async function request(method, path, body) {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* empty body is fine */
  }
  if (!res.ok) throw new Error(data?.error || 'Something went wrong. Try again.');
  return data;
}

export const admin = {
  me: () => request('GET', '/admin/me'),
  login: (key) => request('POST', '/admin/login', { key }),
  logout: () => request('POST', '/admin/logout'),
  overview: () => request('GET', '/admin/overview'),
  sharePreview: (id) => request('GET', `/admin/share/${id}`),
  eventPreview: (id) => request('GET', `/admin/event/${id}`),
  deleteShare: (id) => request('DELETE', `/admin/share/${id}`),
  deleteDaily: (day, userId) => request('DELETE', `/admin/daily?day=${day}${userId ? `&userId=${userId}` : ''}`),
  deleteEvent: (id) => request('DELETE', `/admin/event/${id}`),
  resetGames: (opts) => request('POST', '/admin/games/reset', opts),
};

export const api = {
  me: () => request('GET', '/me'),
  login: (accessKey) => request('POST', '/login', { accessKey }),
  logout: () => request('POST', '/logout'),
  questions: () => request('GET', '/questions'),
  // fields: { title, detail, kind, link?, answer? }
  ask: (fields) => request('POST', '/questions', fields),
  editQuestion: (id, title, detail, extra = {}) =>
    request('PATCH', `/questions/${id}`, { title, detail, ...extra }),
  removeQuestion: (id) => request('POST', `/questions/${id}/remove`),
  answer: (questionId, body) => request('POST', `/questions/${questionId}/response`, { body }),
  editAnswer: (id, body) => request('PATCH', `/responses/${id}`, { body }),
  revealAnswer: (id, body) => request('POST', `/questions/${id}/reveal`, { body }),
  // answers: [{ itemId, choice: 'left' | 'right', note? }] — covers this_that, predict, wyr
  answerThisThat: (id, answers) => request('POST', `/questions/${id}/thisthat`, { answers }),
  // guess: partner submits their guess via the reveal endpoint (revealAnswer); author judges here
  judgeGuess: (id, verdict) => request('POST', `/questions/${id}/verdict`, { verdict }),
  toggleKeepsake: (id) => request('POST', `/questions/${id}/keepsake`),
  react: (targetKind, targetId, emoji) => request('POST', '/reactions', { targetKind, targetId, emoji }),
  // Free-form comment on a completed game; returns the created comment.
  commentShare: (id, body) => request('POST', `/questions/${id}/comments`, { body }),
  dailyReact: (day, emoji) => request('POST', '/daily/react', { day, emoji }),
  dailyComment: (day, body) => request('POST', '/daily/comment', { day, body }),
  markSeen: (kind, id) => request('POST', '/seen', { kind, id }),
  couple: () => request('GET', '/couple'),
  gamesUsed: () => request('GET', '/games/used'),
  gamesScore: () => request('GET', '/games/score'),
  markPlayed: (keys) => request('POST', '/games/used', { keys }),
  daily: () => request('GET', '/daily'),
  dailyHistory: () => request('GET', '/daily/history'),
  answerDaily: (body) => request('POST', '/daily', { body }),
  editDaily: (body) => request('PATCH', '/daily', { body }),
  selectCountdown: (eventId) => request('POST', '/couple/countdown/select', { eventId }),
  thinkingOfYou: () => request('POST', '/nudge'),
  nudges: () => request('GET', '/nudges'),
  lists: () => request('GET', '/lists'),
  // fields: { title, type, items:[text] }
  createList: (fields) => request('POST', '/lists', fields),
  // fields: { title, type, items:[{ id?, text, removed? }] }
  updateList: (id, fields) => request('PATCH', `/lists/${id}`, fields),
  toggleListItem: (id) => request('POST', `/list-items/${id}/toggle`),
  removeList: (id) => request('POST', `/lists/${id}/remove`),
  commentList: (id, body) => request('POST', `/lists/${id}/comments`, { body }),
  removeAttachment: (id) => request('POST', `/attachments/${id}/remove`),
  history: (questionId) => request('GET', `/questions/${questionId}/history`),
  calendar: () => request('GET', '/calendar'),
  createEvent: (fields) => request('POST', '/calendar/events', fields),
  editEvent: (id, fields) => request('PATCH', `/calendar/events/${id}`, fields),
  removeEvent: (id) => request('POST', `/calendar/events/${id}/remove`),
  commentEvent: (id, body) => request('POST', `/calendar/events/${id}/comments`, { body }),
  ackEventNotification: (id) => request('POST', `/calendar/notifications/${id}/ack`),
  uploadAttachment: async ({ ownerKind, questionId, responseId, file, fileName, mimeType, durationSecs }) => {
    const form = new FormData();
    form.append('ownerKind', ownerKind);
    if (questionId) form.append('questionId', questionId);
    if (responseId) form.append('responseId', responseId);
    if (durationSecs != null) form.append('durationSecs', String(durationSecs));
    // Pin the Content-Type onto the multipart part. A recorded Blob's type can
    // otherwise be dropped, and the server would receive a generic mime.
    const name = fileName || file.name || 'recording';
    const type = mimeType || file.type || '';
    const payload = type ? new File([file], name, { type }) : file;
    form.append('file', payload, name);

    const res = await fetch('/api/attachments', {
      method: 'POST',
      credentials: 'same-origin',
      body: form,
    });
    let data = null;
    try {
      data = await res.json();
    } catch {
      /* empty body is fine */
    }
    if (!res.ok) throw new Error(data?.error || 'That file would not upload. Try again.');
    return data;
  },
};

export const attachmentUrl = (id) => `/api/attachments/${id}`;
