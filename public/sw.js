/* loml service worker: receives web push, shows a banner, and drives the app
   icon badge. Kept tiny on purpose — no offline caching. */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'loml', body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'loml';
  const body = data.body || '';
  const url = data.url || '/';
  const badge = typeof data.badge === 'number' ? data.badge : null;

  event.waitUntil(
    (async () => {
      await self.registration.showNotification(title, {
        body,
        icon: '/icons/icon-192.png',
        tag: data.tag || 'loml',
        renotify: true,
        data: { url },
      });
      if (badge != null && self.navigator.setAppBadge) {
        try {
          if (badge > 0) await self.navigator.setAppBadge(badge);
          else await self.navigator.clearAppBadge();
        } catch {
          /* badge unsupported on this device */
        }
      }
    })()
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    (async () => {
      const clientsArr = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const open = clientsArr.find((c) => 'focus' in c);
      if (open) {
        await open.focus();
        if ('navigate' in open) open.navigate(url).catch(() => {});
      } else {
        await self.clients.openWindow(url);
      }
    })()
  );
});
