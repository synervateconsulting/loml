// Client-side web push: register the service worker, subscribe, and keep the
// app-icon badge in sync. All of this is a no-op where the platform doesn't
// support it (so it never breaks the app).

export const pushSupported = () =>
  typeof navigator !== 'undefined' &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window;

export const permission = () => (pushSupported() ? Notification.permission : 'unsupported');

export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js');
  } catch {
    return null;
  }
}

function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

// Ask permission, subscribe, and hand the subscription to the server. Returns
// true only if the user is now subscribed.
export async function enablePush() {
  if (!pushSupported()) return false;

  const result = await Notification.requestPermission();
  if (result !== 'granted') return false;

  const reg = (await navigator.serviceWorker.getRegistration()) || (await registerServiceWorker());
  if (!reg) return false;
  await navigator.serviceWorker.ready;

  const { key } = await fetch('/api/push/key', { credentials: 'same-origin' }).then((r) => r.json());
  if (!key) return false;

  const sub =
    (await reg.pushManager.getSubscription()) ||
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key),
    }));

  const res = await fetch('/api/push/subscribe', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sub),
  });
  return res.ok;
}

// Reflect the current "waiting on you" count on the app icon.
export async function syncBadge(count) {
  if (typeof navigator === 'undefined' || !('setAppBadge' in navigator)) return;
  try {
    if (count > 0) await navigator.setAppBadge(count);
    else await navigator.clearAppBadge();
  } catch {
    /* unsupported */
  }
}

// Close any notifications still sitting in the tray. On iOS a lingering
// delivered notification can keep the icon badge pinned even after you've dealt
// with the item, so clearing them is part of getting the badge back in sync.
export async function clearDeliveredNotifications() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg?.getNotifications) {
      const notes = await reg.getNotifications();
      notes.forEach((n) => n.close());
    }
  } catch {
    /* ignore */
  }
}
