self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  const payload = event.data?.json() || {};
  event.waitUntil(self.registration.showNotification(payload.title || 'JONO', {
    body: payload.body || 'Jonotilanne on muuttunut.',
    tag: payload.tag || 'jono-update',
    renotify: Boolean(payload.renotify),
    requireInteraction: true,
    silent: false,
    icon: '/icon.svg',
    badge: '/icon.svg',
    vibrate: [500, 140, 500, 140, 700],
    timestamp: payload.timestamp || Date.now(),
    actions: payload.ackUrl ? [
      { action: 'open-shop', title: 'Avaa liikkeen sivu' },
      { action: 'ack', title: 'Kuittaa' }
    ] : [],
    data: {
      url: payload.url || '/',
      shopUrl: payload.shopUrl,
      ackUrl: payload.ackUrl
    }
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const acknowledge = data.ackUrl
    ? fetch(new URL(data.ackUrl, self.location.origin), { method: 'POST' }).catch(() => null)
    : Promise.resolve();

  if (event.action === 'ack') {
    event.waitUntil(acknowledge);
    return;
  }

  const target = event.action === 'open-shop' && data.shopUrl
    ? data.shopUrl
    : new URL(data.url || '/', self.location.origin).href;
  event.waitUntil((async () => {
    await acknowledge;
    if (!target.startsWith(self.location.origin)) return self.clients.openWindow(target);
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find((client) => client.url.startsWith(self.location.origin));
    if (existing) {
      await existing.navigate(target);
      return existing.focus();
    }
    return self.clients.openWindow(target);
  })());
});
