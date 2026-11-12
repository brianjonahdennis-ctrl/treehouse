// treehouse home-screen app: background worker for push notifications.
// Notifications are private on purpose: they say what happened, never who or what was said,
// so people open the app to see it.

const TEXT = {
  message: ['💌 New anonymous message', 'Someone sent you an anonymous message. Open treehouse to read it.'],
  chat: ['💬 New message', 'You have a new message. Open treehouse to read it.'],
  request: ['📩 New message request', 'Someone wants to chat. Open treehouse to see it.'],
  like: ['💘 Someone liked you', 'Open treehouse to see who’s interested.'],
  match: ['✨ It’s a match!', 'You have a new match. Open treehouse to say hi.'],
};

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch {}
  const [title, body] = TEXT[data.kind] || ['treehouse', 'You have something new. Open treehouse to see it.'];
  const url = typeof data.url === 'string' && data.url.startsWith('/home') ? data.url : '/home';
  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon: '/icon-192.png',
    badge: '/notif-badge.png',
    tag: `treehouse-${data.kind || 'update'}`,   // newer notifications of the same kind replace older ones
    renotify: true,
    data: { url },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/home', self.location.origin).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (new URL(w.url).pathname.startsWith('/home')) {
        await w.focus();
        // The app shell listens for this and opens the right screen without reloading.
        w.postMessage({ type: 'treehouse-open', url });
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});
