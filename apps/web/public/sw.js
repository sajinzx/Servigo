/* ServiGo service worker: web push for new offers and booking updates. No offline caching of API data. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    /* plain-text payload */
  }
  const n = data.notification || {};
  event.waitUntil(
    self.registration.showNotification(n.title || 'ServiGo', {
      body: n.body || '',
      icon: '/favicon.svg',
      tag: (data.data && data.data.ref) || 'servigo',
      data: data.data || {},
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow('/'));
});
