/**
 * The live bell: the browser's notification channel that does not need Google.
 *
 * ## Why a second path when Web Push already exists
 *
 * Web Push is the right channel for a *closed* browser, and it stays in place.
 * But it needs the VAPID keys, an https origin, and a subscription the user
 * granted once — and in an office LAN install (http on a PC at 192.168.x.x) the
 * push service simply does not exist, so a staff member's only notices are the
 * ones the 25-second poll happens to catch, in a tab that is not focused.
 *
 * The live stream is one plain same-origin `EventSource` to the office's own
 * server. It works over http, needs no permission, no vendor, and no restart; it
 * delivers within milliseconds; and it is exactly the channel that survives a
 * Google geo-restriction, because there is no Google in it. When the connection
 * drops — a laptop asleep, a Wi-Fi hiccup, a server restart — the browser
 * reconnects with a growing delay, and the server replays whatever it missed
 * from `notification_acks`, so a gap costs late notices, never lost ones.
 *
 * ## How this avoids double-notifying
 *
 * Two rules, both cheap: the caller's `seen` set is shared with the poll (so a
 * notice that arrived live is not toasted again 20 seconds later), and every
 * rendered notice is acked to the server with the channel that delivered it,
 * which is what stops the server's retries and other channels for that notice.
 */
import { api } from './api';

export interface LiveNotice {
  id: string;
  title: string;
  body?: string;
  kind?: string;
  link?: string;
  eventType?: string | null;
  revision?: number;
  createdAt?: string;
}

export interface LiveBellOptions {
  /** Called for a notice the client has not shown yet. */
  onNotice: (notice: LiveNotice) => void;
  /** Ids the caller has already displayed — the poll and the stream share it. */
  seen?: () => Set<string>;
  /** Injectable for tests; the browser has EventSource natively. */
  source?: (url: string) => EventSourceLike;
  /** The service worker registration, when the page has one. */
  registration?: () => Promise<ServiceWorkerRegistration | null>;
  ack?: (ids: string[], channel: string) => Promise<unknown>;
}

export interface EventSourceLike {
  addEventListener(type: string, listener: (event: any) => void): void;
  close(): void;
  onerror?: ((event: any) => void) | null;
  readyState?: number;
}

/** Backoff bounds. The floor is not smaller because a restart of the API is a
 *  normal event, and hammering it makes a bad minute worse for everyone. */
const MIN_DELAY = 2_000;
const MAX_DELAY = 30_000;

export function connectLiveBell(options: LiveBellOptions): () => void {
  const makeSource = options.source ?? (typeof EventSource === 'function'
    ? (url: string) => new EventSource(url, { withCredentials: true }) as EventSourceLike
    : null);
  // No `EventSource` means no live channel — an embedded browser, a jsdom test, an
  // old WebKit build. Saying so and returning is the whole fix: the poll in
  // shell.tsx keeps working on its own, and a bell that throws on mount would take
  // the panel down to save a second of latency nobody asked for.
  if (!makeSource) return () => undefined;
  const registration = options.registration ?? (typeof navigator !== 'undefined' && 'serviceWorker' in navigator
    ? async () => (await navigator.serviceWorker.getRegistration()) ?? null
    : async () => null);
  const ack = options.ack ?? ((ids: string[], channel: string) => api.post('/api/notifications/ack', { ids, channel }).catch(() => undefined));

  let source: EventSourceLike | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let delay = MIN_DELAY;
  let closed = false;

  const open = () => {
    if (closed || !makeSource) return;
    try {
      source = makeSource('/api/notifications/stream');
    } catch {
      schedule();          // a refused socket is a retry, never a crash
      return;
    }
    source.addEventListener('notification', (event) => {
      delay = MIN_DELAY; // a delivery proves the path is healthy
      const notice = parseNotice(event?.data);
      if (!notice) return;
      const seen = options.seen?.();
      if (seen?.has(notice.id)) return;
      seen?.add(notice.id);
      options.onNotice(notice);
      // Rendered here ⇒ the server may stop chasing this notice on every other
      // channel. Acks are idempotent, so the app's own ack for the same notice
      // (from a push it received first) is not disturbed by this one.
      void ack([notice.id], 'web').catch(() => undefined);
    });
    source.addEventListener('ready', () => {
      delay = MIN_DELAY;
    });
    source.onerror = () => {
      source?.close();
      source = null;
      schedule();
    };
  };

  const schedule = () => {
    if (closed || timer) return;
    const wait = delay;
    delay = Math.min(MAX_DELAY, delay * 2);
    timer = setTimeout(() => { timer = null; open(); }, wait);
  };

  // A browser tab that was hidden may have had its socket frozen rather than
  // closed; on the way back, reconnect now instead of waiting out the backoff.
  const onVisibility = () => {
    if (typeof document === 'undefined' || document.hidden) return;
    if (!source || source.readyState === 2) {
      if (timer) { clearTimeout(timer); timer = null; }
      delay = MIN_DELAY;
      open();
    }
  };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);

  open();

  return () => {
    closed = true;
    if (timer) clearTimeout(timer);
    source?.close();
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
  };
}

function parseNotice(raw: unknown): LiveNotice | null {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const parsed = JSON.parse(raw) as LiveNotice;
    return parsed && typeof parsed.id === 'string' && parsed.id ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Ask the service worker to raise an OS notification.
 *
 * Only worth trying when the page is not the thing the user is looking at: an
 * in-tab toast already covers the focused case, and a second copy of the same
 * message — one in the tab, one in the tray — is exactly the duplicate the
 * office complained about.
 */
export async function raiseSystemNotice(notice: LiveNotice, options: { tag?: string } = {}): Promise<boolean> {
  if (typeof document !== 'undefined' && !document.hidden) return false;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return false;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration?.active) return false;
    registration.active.postMessage({
      type: 'pishkan:notify',
      title: notice.title,
      body: notice.body ?? '',
      url: notice.link && notice.link.startsWith('/') ? notice.link : undefined,
      // The tag is the dedupe key the OS itself honours: a notice that also
      // arrived over Web Push replaces itself instead of stacking.
      tag: options.tag ?? notice.id,
      notificationId: notice.id,
    });
    return true;
  } catch {
    return false;
  }
}
