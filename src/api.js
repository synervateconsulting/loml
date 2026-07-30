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

export const api = {
  me: () => request('GET', '/me'),
  login: (accessKey) => request('POST', '/login', { accessKey }),
  logout: () => request('POST', '/logout'),
  questions: () => request('GET', '/questions'),
  ask: (title, detail) => request('POST', '/questions', { title, detail }),
  editQuestion: (id, title, detail) => request('PATCH', `/questions/${id}`, { title, detail }),
  removeQuestion: (id) => request('POST', `/questions/${id}/remove`),
  answer: (questionId, body) => request('POST', `/questions/${questionId}/response`, { body }),
  editAnswer: (id, body) => request('PATCH', `/responses/${id}`, { body }),
  removeAttachment: (id) => request('POST', `/attachments/${id}/remove`),
  history: (questionId) => request('GET', `/questions/${questionId}/history`),
};

export const attachmentUrl = (id) => `/api/attachments/${id}`;
