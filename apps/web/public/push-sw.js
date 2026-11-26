/* Web Push handlers, imported into the generated Workbox service worker. */

/*
 * Which window a notification tap belongs to.
 *
 * `matchMedia`-level detail, but it is the difference between a notice that
 * opens the screen it announced and one that hijacks whatever tab happened to
 * be focused: an office employee keeps the staff panel, the admin panel and
 * sometimes their customer PWA open at once. The panel prefix is taken from the
 * link itself, so nothing has to be threaded through the payload.
 */
const PANELS = ['/app', '/staff', '/admin'];

function panelOf(url) {
  const text = String(url || '');
  for (const panel of PANELS) if (text.startsWith(panel)) return panel;
  return null;
}

function pathOf(url) {
  const text = String(url || '/');
  return text.split('?')[0].replace(/\/+$/, '') || '/';
}

/*
 * Show one notice and report that it was shown.
 *
 * Two callers: the `push` event (a notice that arrived while no tab was open)
 * and the `pishkan:notify` message (the live stream in a background tab, which
 * is the only path available on a LAN install without a push service). Both end
 * here, so the tray never looks different depending on how the notice travelled,
 * and so the *ack* is never forgotten — an ack is what tells the server to stop
 * pushing this same notice over the other channels.
 */
function deliver(data) {
  const title = String(data.title || 'پیشخوان');
  const shown = self.registration.showNotification(title, {
    body: String(data.body || ''),
    tag: data.tag || (data.notificationId ? `pishkan:${data.notificationId}` : undefined),
    dir: 'rtl',
    lang: 'fa-IR',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { url: data.url || '/staff/queue', notificationId: data.notificationId || null },
  });
  return Promise.resolve(shown).then(() => ack(data.notificationId));
}

/*
 * The session cookie rides along (same origin), and the write is deliberately
 * fire-and-forget: a browser cannot fail a notification because the server was
 * unreachable a moment ago.
 */
function ack(notificationId) {
  if (!notificationId) return undefined;
  return fetch('/api/notifications/ack', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ids: [notificationId], channel: 'web' }),
  }).catch(() => undefined);
}

self.addEventListener('push', (event) => {
  let data = { title: 'پیشخوان', body: '', url: '/staff/queue', tag: undefined };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    /* keep defaults */
  }
  event.waitUntil(deliver(data));
});

/*
 * The page forwards a notice it received on the live stream but cannot show
 * itself, because the tab is in the background. `tag` is the notification id, so
 * a notice that also came over Web Push is replaced rather than duplicated.
 */
self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type !== 'pishkan:notify') return;
  event.waitUntil(deliver(data));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/staff/queue';
  const panel = panelOf(target);
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      // 1. a window of the same panel that is already on the exact page → focus it;
      // 2. else a window of the same panel → navigate it;
      // 3. else any window → navigate it; 4. else open a new one.
      const wanted = pathOf(target);
      const onTarget = windows.find((c) => panel && new URL(c.url).pathname.replace(/\/+$/, '') === wanted);
      if (onTarget) return onTarget.focus();
      const samePanel = windows.find((c) => panel && new URL(c.url).pathname.startsWith(panel));
      const client = samePanel || windows[0];
      if (client && 'focus' in client) {
        // Navigating an already-correct URL would reload it and lose state, so
        // only pages that differ are pushed.
        if (pathOf(client.url) !== wanted) client.navigate(target).catch(() => undefined);
        return client.focus();
      }
      return self.clients.openWindow(target);
    }),
  );
});
