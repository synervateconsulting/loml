import { maybeCompressImage } from './imageCompress.js';

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
  // Send a draft share (created hidden while its attachments upload) for real.
  finalizeShare: (id) => request('POST', `/questions/${id}/finalize`),
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
  editComment: (id, body) => request('PATCH', `/comments/${id}`, { body }),
  dailyReact: (day, emoji) => request('POST', '/daily/react', { day, emoji }),
  dailyComment: (day, body) => request('POST', '/daily/comment', { day, body }),
  editDailyComment: (id, body) => request('PATCH', `/daily/comments/${id}`, { body }),
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
  editListComment: (id, body) => request('PATCH', `/list-comments/${id}`, { body }),
  removeAttachment: (id) => request('POST', `/attachments/${id}/remove`),
  history: (questionId) => request('GET', `/questions/${questionId}/history`),
  calendar: () => request('GET', '/calendar'),
  createEvent: (fields) => request('POST', '/calendar/events', fields),
  editEvent: (id, fields) => request('PATCH', `/calendar/events/${id}`, fields),
  removeEvent: (id) => request('POST', `/calendar/events/${id}/remove`),
  commentEvent: (id, body) => request('POST', `/calendar/events/${id}/comments`, { body }),
  editEventComment: (id, body) => request('PATCH', `/calendar/comments/${id}`, { body }),
  // Date requests
  createDateRequest: (fields) => request('POST', '/date-requests', fields),
  acceptDateRequest: (id, fields) => request('POST', `/date-requests/${id}/accept`, fields),
  declineDateRequest: (id) => request('POST', `/date-requests/${id}/decline`),
  cancelDateRequest: (id) => request('POST', `/date-requests/${id}/cancel`),
  ackEventNotification: (id) => request('POST', `/calendar/notifications/${id}/ack`),
  // Upload one attachment. Oversized photos are downscaled first (capped
  // compression); the file goes DIRECT to R2 via a presigned PUT when object
  // storage is enabled (falling back to a legacy multipart POST otherwise).
  // Real progress is reported via onProgress(pct); transient failures retry with
  // backoff (large files once); `signal` cancels an in-flight upload.
  uploadAttachment: async ({ ownerKind, questionId, responseId, file, fileName, mimeType, durationSecs, onProgress, signal }) => {
    const toSend = await maybeCompressImage(file);
    const name = fileName || toSend.name || file.name || 'recording';
    const type = mimeType || toSend.type || file.type || '';
    const payload = type ? new File([toSend], name, { type }) : toSend;

    // Big files (videos) aren't auto-retried — re-sending the whole thing on a
    // flaky link just burns data; the user can retry manually.
    const LARGE = 15 * 1024 * 1024;
    const attempts = payload.size > LARGE ? 1 : 3;

    const pre = await request('POST', '/attachments/presign', {
      ownerKind,
      questionId,
      responseId,
      byteSize: payload.size,
    });

    // Legacy fallback: object storage not configured → multipart POST to us.
    if (pre?.enabled === false) {
      return withUploadRetry(attempts, onProgress, () => {
        const form = new FormData();
        form.append('ownerKind', ownerKind);
        if (questionId) form.append('questionId', questionId);
        if (responseId) form.append('responseId', responseId);
        if (durationSecs != null) form.append('durationSecs', String(durationSecs));
        form.append('file', payload, name);
        return xhrSend({ method: 'POST', url: '/api/attachments', body: form, credentials: true, onProgress, signal, parse: true });
      });
    }

    // R2: PUT straight to the presigned URL, then record it server-side.
    await withUploadRetry(attempts, onProgress, () =>
      xhrSend({ method: 'PUT', url: pre.url, body: payload, credentials: false, onProgress, signal })
    );
    return request('POST', '/attachments/complete', {
      ownerKind,
      questionId,
      responseId,
      key: pre.key,
      fileName: name,
      mimeType: type,
      durationSecs,
    });
  },
};

async function withUploadRetry(attempts, onProgress, fn) {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (err.cancelled) throw err; // user aborted — stop immediately
      const retriable = !err.status || err.status >= 500; // not a definitive 4xx
      if (!retriable || i >= attempts - 1) throw err;
      onProgress?.(0);
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
}

// XHR (not fetch) so we get upload progress events, which drive the visible
// "Uploading…" indicator. Uses a STALL watchdog (fail only if no progress for a
// while) rather than a total-time limit, so a slow-but-moving upload — the
// normal case for a large video — is never cut off. `signal` aborts it (Cancel).
function xhrSend({ method, url, body, credentials, onProgress, signal, parse }) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const e = new Error('Upload cancelled.');
      e.cancelled = true;
      return reject(e);
    }
    const STALL_MS = 75000; // no progress for this long → treat as dead
    const xhr = new XMLHttpRequest();
    let reason = null; // 'user' | 'stall'
    let stallTimer;
    const bump = () => {
      clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        reason = 'stall';
        xhr.abort();
      }, STALL_MS);
    };
    const onAbort = () => {
      reason = 'user';
      xhr.abort();
    };
    const cleanup = () => {
      clearTimeout(stallTimer);
      signal?.removeEventListener('abort', onAbort);
    };

    xhr.open(method, url);
    xhr.withCredentials = Boolean(credentials);
    xhr.upload.onprogress = (e) => {
      bump();
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      cleanup();
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(100);
        let data = null;
        if (parse) {
          try {
            data = JSON.parse(xhr.responseText);
          } catch {
            /* empty body is fine */
          }
        }
        resolve(data);
      } else {
        let data = null;
        try {
          data = JSON.parse(xhr.responseText);
        } catch {
          /* R2 errors are XML, not JSON */
        }
        const err = new Error(data?.error || 'That file would not upload. Try again.');
        err.status = xhr.status;
        reject(err);
      }
    };
    xhr.onerror = () => {
      cleanup();
      reject(new Error('Upload failed — check your connection and try again.'));
    };
    xhr.onabort = () => {
      cleanup();
      const err = new Error(reason === 'user' ? 'Upload cancelled.' : 'Upload stalled — check your connection and try again.');
      if (reason === 'user') err.cancelled = true;
      reject(err);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    bump(); // start the stall clock even before the first progress event
    xhr.send(body);
  });
}

export const attachmentUrl = (id) => `/api/attachments/${id}`;
