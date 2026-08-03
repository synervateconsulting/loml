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
  // One reaction + comment API for everything (share, daily, list, event, …).
  react: (targetKind, targetId, emoji) => request('POST', '/reactions', { targetKind, targetId, emoji }),
  comment: (targetType, targetId, body) => request('POST', '/comments', { targetType, targetId, body }),
  editComment: (id, body) => request('PATCH', `/comments/${id}`, { body }),
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
  removeAttachment: (id) => request('POST', `/attachments/${id}/remove`),
  history: (questionId) => request('GET', `/questions/${questionId}/history`),
  calendar: () => request('GET', '/calendar'),
  createEvent: (fields) => request('POST', '/calendar/events', fields),
  editEvent: (id, fields) => request('PATCH', `/calendar/events/${id}`, fields),
  removeEvent: (id) => request('POST', `/calendar/events/${id}/remove`),
  // Date requests
  createDateRequest: (fields) => request('POST', '/date-requests', fields),
  acceptDateRequest: (id, fields) => request('POST', `/date-requests/${id}/accept`, fields),
  declineDateRequest: (id) => request('POST', `/date-requests/${id}/decline`),
  cancelDateRequest: (id) => request('POST', `/date-requests/${id}/cancel`),
  ackEventNotification: (id) => request('POST', `/calendar/notifications/${id}/ack`),
  // Upload one attachment. Oversized photos are downscaled first (capped
  // compression). Large files (> MULTIPART) go up as a RESUMABLE R2 multipart
  // upload (a dropped part retries without restarting the whole file); smaller
  // files use a single presigned PUT. Both fall back to a legacy multipart POST
  // when object storage is off. Progress via onProgress(pct); `signal` cancels.
  uploadAttachment: async ({ ownerKind, questionId, responseId, file, fileName, mimeType, durationSecs, onProgress, signal }) => {
    const toSend = await maybeCompressImage(file);
    const name = fileName || toSend.name || file.name || 'recording';
    const type = mimeType || toSend.type || file.type || '';
    const payload = type ? new File([toSend], name, { type }) : toSend;
    const meta = { ownerKind, questionId, responseId, fileName: name, mimeType: type, durationSecs };
    const MULTIPART = 20 * 1024 * 1024;

    const legacy = () => {
      // Big files aren't auto-retried on the legacy path (re-buffering wastes
      // data); small files retry through transient failures.
      const attempts = payload.size > 15 * 1024 * 1024 ? 1 : 3;
      return withUploadRetry(attempts, onProgress, () => {
        const form = new FormData();
        form.append('ownerKind', ownerKind);
        if (questionId) form.append('questionId', questionId);
        if (responseId) form.append('responseId', responseId);
        if (durationSecs != null) form.append('durationSecs', String(durationSecs));
        form.append('file', payload, name);
        return xhrSend({ method: 'POST', url: '/api/attachments', body: form, credentials: true, onProgress, signal, parse: true });
      }).then((r) => r.data);
    };

    if (payload.size > MULTIPART) {
      const init = await request('POST', '/attachments/multipart/init', { ...meta, byteSize: payload.size });
      if (init?.enabled === false) return legacy();
      return multipartUpload(payload, init, meta, onProgress, signal);
    }

    const pre = await request('POST', '/attachments/presign', { ownerKind, questionId, responseId, byteSize: payload.size });
    if (pre?.enabled === false) return legacy();
    // Single presigned PUT straight to R2, then record it.
    const attempts = payload.size > 15 * 1024 * 1024 ? 1 : 3;
    await withUploadRetry(attempts, onProgress, () =>
      xhrSend({ method: 'PUT', url: pre.url, body: payload, credentials: false, onProgress, signal })
    );
    return request('POST', '/attachments/complete', { ...meta, key: pre.key });
  },
};

// Resumable multipart to R2: slice the file into parts; each part is presigned,
// PUT directly to R2, and retried on its own — so a mid-upload drop resumes from
// the last good part instead of restarting. Progress aggregates across parts.
async function multipartUpload(payload, init, meta, onProgress, signal) {
  const { key, uploadId, partSize } = init;
  const partCount = Math.ceil(payload.size / partSize);
  const parts = [];
  let uploadedBytes = 0;
  try {
    for (let n = 1; n <= partCount; n++) {
      if (signal?.aborted) {
        const e = new Error('Upload cancelled.');
        e.cancelled = true;
        throw e;
      }
      const start = (n - 1) * partSize;
      const end = Math.min(payload.size, start + partSize);
      const chunk = payload.slice(start, end);
      const base = uploadedBytes;
      const { etag } = await withUploadRetry(3, null, async () => {
        const { url } = await request('POST', '/attachments/multipart/part', { key, uploadId, partNumber: n });
        return xhrSend({
          method: 'PUT',
          url,
          body: chunk,
          credentials: false,
          signal,
          onProgress: (pct) => {
            const loaded = base + (pct / 100) * (end - start);
            onProgress?.(Math.round((loaded / payload.size) * 100));
          },
        });
      });
      if (!etag) throw new Error('Upload failed (missing part ETag — check R2 CORS ExposeHeaders).');
      parts.push({ partNumber: n, etag });
      uploadedBytes = end;
      onProgress?.(Math.round((uploadedBytes / payload.size) * 100));
    }
  } catch (err) {
    // Best-effort: don't leave orphan parts in R2.
    request('POST', '/attachments/multipart/abort', { key, uploadId }).catch(() => {});
    throw err;
  }
  return request('POST', '/attachments/multipart/complete', { ...meta, key, uploadId, parts });
}

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
        resolve({ data, etag: xhr.getResponseHeader('ETag') });
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
