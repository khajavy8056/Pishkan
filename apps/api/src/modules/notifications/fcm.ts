/**
 * Firebase Cloud Messaging (HTTP v1) — sending side.
 *
 * ## Why this file exists at all
 *
 * The app already polls the notification feed (WorkManager, every ~3 minutes).
 * That works when Android lets the app run, and it is why notifications arrive
 * on some phones and not others: Doze, vendor battery managers and the
 * "restricted" app state throttle or stop background work entirely. A push
 * message is delivered by the *system*, over a connection the app does not own,
 * so it does not depend on the app being allowed to wake up. That is the
 * difference between "arrives while the app is closed" and "arrives when I open
 * the app".
 *
 * ## Why raw HTTP and not the firebase-admin SDK
 *
 * Sending one notification needs exactly two things: a signed JWT (Mint: RS256,
 * from the service-account private key) exchanged for an access token, and one
 * POST to the v1 endpoint. firebase-admin pulls in gRPC, a large dependency
 * tree and a second connection type, to do the same two calls. Node's own
 * crypto and fetch do it in this file, which also means it can be unit-tested
 * offline by pointing the token URL at a local server.
 *
 * ## What is deliberately NOT here
 *
 * - No Firebase Auth, no Firestore, no Analytics: only messaging is used. That
 *   matters in Iran, where the Firebase *service* is geo-restricted and account
 *   signup itself is blocked; sending with an existing service account works,
 *   and the mobile network issue is documented in docs/PUSH-NOTIFICATIONS-FA.md.
 * - No token in logs, ever. Only the last six characters, and only in the
 *   delivery log table, so a support call can match a device without the log
 *   being a credential dump.
 */
import crypto from 'node:crypto';
import { one, q, run, nowIso } from '../../db/index.js';
import { id } from '../../lib/crypto.js';
import { getBool, getSecret, getString } from '../settings/service.js';

export interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri?: string;
}

export interface PushPayload {
  title: string;
  body: string;
  /** Deep link the app opens on tap, e.g. `/app/requests/abc`. */
  link?: string;
  /** Pishkan notification id, so a tap can mark exactly that row read. */
  notificationId?: string;
  /**
   * Stable key. Android collapses a new notification with the same tag, which
   * is what makes "your case moved to stage 4" replace "stage 3" instead of
   * stacking five stale rows in the shade.
   */
  tag?: string;
  kind?: string;
  /** 0..1 — drawn as a progress bar on the notification, like a delivery app. */
  progress?: number | null;
  stageLabel?: string;
}

/**
 * Kinds that may be delivered on the next Doze window instead of waking the
 * device. Deliberately small and allow-by-exception: a kind that is not listed
 * here wakes the phone, so a new, genuinely urgent event is never accidentally
 * downgraded to "arrives whenever Android feels like it".
 *
 * These are routine, non-time-critical notices: an informational feed entry, a
 * monthly statement, a settled invoice and a bank/waiting-room status change
 * do not justify lighting up a screen at 3am. Everything else — a case stage
 * move, a chat reply, a staff action, an error — keeps `high`.
 */
const NOTIFY_LOW_PRIORITY_KINDS = new Set([
  'info',
  'monthly',
  'settlement',
  'waiting_organization',
]);

export interface SendResult {
  ok: boolean;
  /** FCM error code when it failed: UNREGISTERED is the important one. */
  errorCode?: string;
  errorText?: string;
  /** FCM message name on success. */
  name?: string;
}

/* -------------------------------------------------------------------------- */
/*  service account + access token                                            */
/* -------------------------------------------------------------------------- */

/**
 * Parse the service-account JSON the operator pastes into settings.
 *
 * Accepts the raw file contents. Validates only the three fields that are
 * actually used, because a wrong private key fails later with a much less
 * friendly message ("invalid_grant") than a clear error here.
 */
export function parseServiceAccount(raw: string): ServiceAccount | null {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const projectId = String(parsed?.project_id ?? '').trim();
  const clientEmail = String(parsed?.client_email ?? '').trim();
  // The private key arrives with literal "\n" sequences when it has travelled
  // through an env var or a single-line settings field.
  const privateKey = String(parsed?.private_key ?? '').replace(/\\n/g, '\n').trim();
  if (!projectId || !clientEmail || !privateKey.includes('BEGIN PRIVATE KEY')) return null;
  return {
    project_id: projectId,
    client_email: clientEmail,
    private_key: privateKey,
    token_uri: String(parsed?.token_uri ?? 'https://oauth2.googleapis.com/token'),
  };
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * The JWT assertion Google exchanges for an access token.
 *
 * Split out and exported so the test suite can verify the signature offline
 * with the matching public key — the one part of this flow that is easy to get
 * subtly wrong (audience, scope, claim names) and impossible to eyeball.
 */
export function signJwtAssertion(account: ServiceAccount, nowSeconds = Math.floor(Date.now() / 1000)) {
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: account.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: account.token_uri ?? 'https://oauth2.googleapis.com/token',
    iat: nowSeconds,
    // One hour is the maximum Google accepts; a shorter value only causes more
    // round trips because the token is cached anyway.
    exp: nowSeconds + 3600,
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const signature = crypto.createSign('RSA-SHA256').update(unsigned).sign(account.private_key);
  return `${unsigned}.${base64url(signature)}`;
}

let tokenCache: { key: string; token: string; expiresAt: number } | null = null;

/** Exchange the assertion for an access token. Cached until ~5 min before expiry. */
export async function accessToken(account: ServiceAccount, { force = false } = {}): Promise<string> {
  const cacheKey = `${account.client_email}:${account.project_id}`;
  if (!force && tokenCache && tokenCache.key === cacheKey && tokenCache.expiresAt > Date.now() + 5 * 60_000) {
    return tokenCache.token;
  }
  const assertion = signJwtAssertion(account);
  const response = await fetch(account.token_uri ?? 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  const payload: any = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.access_token) {
    // Never surface the assertion or the private key in the message.
    throw new Error(`FCM token exchange failed (${response.status}): ${payload?.error ?? 'unknown'}`);
  }
  tokenCache = {
    key: cacheKey,
    token: String(payload.access_token),
    expiresAt: Date.now() + (Number(payload.expires_in) || 3600) * 1000,
  };
  return tokenCache.token;
}

/** Only for tests: forget the cached token. */
export function resetAccessTokenCache() {
  tokenCache = null;
}

/* -------------------------------------------------------------------------- */
/*  message shape                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Build the v1 message.
 *
 * Everything goes in `data` rather than `notification`, on purpose. A
 * `notification` block is rendered by the system while the app is closed, which
 * sounds ideal — but it also means Flutter never runs, so the app cannot decide
 * the icon, the progress bar, the channel or the deep link, and a tap goes to
 * the launcher activity with a generic payload we then have to re-parse. A
 * `data` message plus a small native service (in the app) keeps full control.
 *
 * All values must be strings: FCM rejects numbers and nested objects in `data`.
 */
export function buildMessage(
  token: string,
  payload: PushPayload,
): Record<string, unknown> {
  const progress = typeof payload.progress === 'number' && payload.progress >= 0
    ? String(Math.round(payload.progress * 100))
    : '';
  return {
    message: {
      token,
      data: {
        title: payload.title ?? '',
        body: payload.body ?? '',
        link: payload.link ?? '',
        notificationId: payload.notificationId ?? '',
        tag: payload.tag ?? '',
        kind: payload.kind ?? 'info',
        progress,
        stageLabel: payload.stageLabel ?? '',
      },
      android: {
        // Collapse per tag so a case update replaces its predecessor.
        collapse_key: payload.tag ? `pishkan:${payload.tag}` : undefined,
        // `normal` is delivered at the next Doze maintenance window; `high`
        // wakes the device. Only genuinely urgent events should wake a phone
        // that is asleep in a pocket, so the choice keys off the *kind*.
        //
        // This used to read `kind === 'info' && !tag`, which was dead code:
        // notifications/service.ts always supplies a tag, so the second half
        // was never true and every notice — including a routine `info` one —
        // was sent as `high`. A `normal` message still arrives, just possibly
        // batched; a wrongly-`high` one is what makes an app feel spammy and
        // is exactly what Android's notification guidance warns about.
        priority: NOTIFY_LOW_PRIORITY_KINDS.has(payload.kind ?? '') ? 'normal' : 'high',
        ttl: '86400s',
      },
    },
  };
}

/* -------------------------------------------------------------------------- */
/*  sending                                                                   */
/* -------------------------------------------------------------------------- */

export interface PushConfig {
  enabled: boolean;
  account: ServiceAccount | null;
  /** Set when the operator has filled something in but it cannot be used. */
  problem: string;
}

/** Read the push settings once per send batch. */
export async function pushConfig(): Promise<PushConfig> {
  const enabled = await getBool('push.fcm_enabled');
  // A secret setting is encrypted at rest; getSecret decrypts it.
  const raw = (await getSecret('push.fcm_service_account').catch(() => '')) || '';
  if (!enabled) return { enabled: false, account: null, problem: 'ارسال اعلان لحظه‌ای خاموش است.' };
  if (!raw.trim()) return { enabled: false, account: null, problem: 'کلید حساب سرویس Firebase وارد نشده است.' };
  const account = parseServiceAccount(raw);
  if (!account) {
    return {
      enabled: false,
      account: null,
      problem: 'کلید حساب سرویس Firebase معتبر نیست (باید فایل JSON کامل باشد).',
    };
  }
  return { enabled: true, account, problem: '' };
}

/** The v1 endpoint. Exported so tests can point it at a stub. */
export function sendEndpoint(account: ServiceAccount, override = ''): string {
  const base = override.trim() || 'https://fcm.googleapis.com';
  return `${base.replace(/\/+$/, '')}/v1/projects/${encodeURIComponent(account.project_id)}/messages:send`;
}

/**
 * Send one message. Never throws: the caller is a business flow (a case moved
 * a stage) that must not fail because a phone cannot be reached.
 */
export async function sendToToken(
  account: ServiceAccount,
  token: string,
  payload: PushPayload,
  options: { endpoint?: string } = {},
): Promise<SendResult> {
  try {
    const bearer = await accessToken(account);
    const response = await fetch(sendEndpoint(account, options.endpoint), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${bearer}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(buildMessage(token, payload)),
    });
    if (response.ok) {
      const body: any = await response.json().catch(() => ({}));
      return { ok: true, name: String(body?.name ?? '') };
    }
    const error: any = await response.json().catch(() => ({}));
    // FCM v1 wraps the useful part in error.details[].errorCode. UNREGISTERED
    // means the install is gone and the token must be deleted, not retried.
    const details = Array.isArray(error?.error?.details) ? error.error.details : [];
    const code = String(
      details.find((d: any) => d?.errorCode)?.errorCode
      ?? error?.error?.status
      ?? `HTTP_${response.status}`,
    );
    return {
      ok: false,
      errorCode: code,
      errorText: String(error?.error?.message ?? '').slice(0, 300),
    };
  } catch (failure: any) {
    return { ok: false, errorCode: 'NETWORK', errorText: String(failure?.message ?? failure).slice(0, 300) };
  }
}

/* -------------------------------------------------------------------------- */
/*  devices                                                                   */
/* -------------------------------------------------------------------------- */

export interface DeviceRow {
  id: string;
  user_id: string;
  token: string;
  platform: string;
  failure_count: number;
}

/**
 * Register (or refresh) one installation.
 *
 * The token is the identity, so an upsert on it handles every real case:
 * reinstall (new token, old row pruned later), sign-in by a second account on
 * the same phone (row reassigned), and the same account on a new phone (extra
 * row). `user_id` is reassigned deliberately — leaving the old owner attached
 * would push one customer's case updates to another customer's phone.
 */
export async function registerDevice(
  userId: string,
  input: { token: string; platform?: string; appVersion?: string; deviceName?: string; deviceMaker?: string },
): Promise<{ ok: boolean }> {
  const token = String(input.token ?? '').trim();
  if (token.length < 20) return { ok: false }; // refuse junk that would only produce INVALID_ARGUMENT
  const now = nowIso();
  await run(
    `INSERT INTO customer_devices (id, user_id, token, platform, app_version, device_name, device_maker, failure_count, last_seen_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
     ON CONFLICT(token) DO UPDATE SET
       user_id = excluded.user_id,
       app_version = excluded.app_version,
       device_name = excluded.device_name,
       device_maker = excluded.device_maker,
       failure_count = 0,
       last_seen_at = excluded.last_seen_at`,
    [
      id('dev'), userId, token,
      String(input.platform ?? 'android').slice(0, 20),
      String(input.appVersion ?? '').slice(0, 40),
      String(input.deviceName ?? '').slice(0, 80),
      String(input.deviceMaker ?? '').slice(0, 40),
      now, now,
    ],
  );
  return { ok: true };
}

export async function unregisterDevice(userId: string, token: string): Promise<{ ok: boolean }> {
  await run('DELETE FROM customer_devices WHERE user_id = ? AND token = ?', [userId, String(token ?? '')]);
  return { ok: true };
}

export async function devicesFor(userId: string): Promise<DeviceRow[]> {
  return q<DeviceRow>('SELECT * FROM customer_devices WHERE user_id = ? ORDER BY last_seen_at DESC', [userId]);
}

export async function deviceCount(userId: string): Promise<number> {
  const row = await one<{ c: number }>('SELECT COUNT(*) AS c FROM customer_devices WHERE user_id = ?', [userId]);
  return Number(row?.c ?? 0);
}

const tail = (token: string) => (token.length > 6 ? token.slice(-6) : token);

async function logDelivery(entry: {
  userId: string;
  notificationId?: string;
  token?: string;
  platform?: string;
  channel: string;
  ok: boolean;
  errorCode?: string;
  errorText?: string;
}): Promise<void> {
  try {
    await run(
      `INSERT INTO push_delivery_log (id, user_id, notification_id, device_token_tail, platform, channel, ok, error_code, error_text, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id('pdl'), entry.userId, entry.notificationId ?? null,
        entry.token ? tail(entry.token) : null, entry.platform ?? null,
        entry.channel, entry.ok ? 1 : 0,
        entry.errorCode ?? null, (entry.errorText ?? '').slice(0, 300) || null,
        nowIso(),
      ],
    );
  } catch {
    // Diagnostics must never break delivery.
  }
}

/** A token is dead when Google says so explicitly. */
function tokenIsDead(result: SendResult): boolean {
  return result.errorCode === 'UNREGISTERED' || result.errorCode === 'NOT_FOUND' || result.errorCode === 'INVALID_ARGUMENT';
}

/**
 * Push one notification to every device of every given user.
 *
 * Per-device failure bookkeeping matters: retrying a dead token forever is how
 * a push bill (and a log) grows with no deliveries, and deleting a token on the
 * first transient network error is how a working phone silently stops getting
 * notifications.
 */
export async function pushToUsers(
  userIds: string[],
  payload: PushPayload,
  options: { endpoint?: string } = {},
): Promise<{ sent: number; failed: number; withoutDevice: number; skipped: string }> {
  const unique = [...new Set(userIds.filter(Boolean))];
  if (!unique.length) return { sent: 0, failed: 0, withoutDevice: 0, skipped: 'no-users' };
  const config = await pushConfig();
  if (!config.enabled || !config.account) {
    return { sent: 0, failed: 0, withoutDevice: 0, skipped: config.problem || 'disabled' };
  }
  const account = config.account;
  // Resolve the endpoint here, not from the caller. The operator sets it in the
  // admin panel, and a caller that forgot to pass it (every call site does)
  // would otherwise talk to Google directly — which is exactly the request that
  // fails behind a filtered network, while the settings screen cheerfully shows
  // the proxy the operator configured.
  const endpoint = options.endpoint || (await getString('push.fcm_endpoint').catch(() => ''));
  let sent = 0;
  let failed = 0;
  // Users for whom there was nothing to send *to*, as opposed to a send that
  // failed. The distinction is what lets the admin panel say "this account has
  // no registered phone" instead of "sending failed" — two problems with
  // completely different fixes, and guessing wrong sends the operator looking
  // at the Firebase key when the real issue is that the app never registered.
  let withoutDevice = 0;
  for (const userId of unique) {
    const devices = await devicesFor(userId);
    if (!devices.length) {
      withoutDevice += 1;
      await logDelivery({ userId, notificationId: payload.notificationId, channel: 'none', ok: false, errorCode: 'NO_DEVICE' });
      continue;
    }
    for (const device of devices) {
      const result = await sendToToken(account, device.token, payload, { endpoint });
      if (result.ok) {
        sent += 1;
        await run('UPDATE customer_devices SET failure_count = 0, last_pushed_at = ? WHERE id = ?', [nowIso(), device.id]);
      } else {
        failed += 1;
        if (tokenIsDead(result)) {
          await run('DELETE FROM customer_devices WHERE id = ?', [device.id]);
        } else {
          await run('UPDATE customer_devices SET failure_count = failure_count + 1 WHERE id = ?', [device.id]);
          // Three consecutive hard failures on a token that is not explicitly
          // reported dead usually means it was rotated while the app was
          // uninstalled. Drop it so it stops consuming quota; the app
          // re-registers its current token at next sign-in.
          await run('DELETE FROM customer_devices WHERE id = ? AND failure_count >= 3', [device.id]);
        }
      }
      await logDelivery({
        userId,
        notificationId: payload.notificationId,
        token: device.token,
        platform: device.platform,
        channel: 'fcm',
        ok: result.ok,
        errorCode: result.errorCode,
        errorText: result.errorText,
      });
    }
  }
  return { sent, failed, withoutDevice, skipped: '' };
}

/** Recent deliveries, for the admin diagnostics screen. */
export async function recentDeliveries(limit = 50) {
  const cap = Math.min(200, Math.max(1, limit));
  return q<any>(
    `SELECT * FROM push_delivery_log ORDER BY created_at DESC LIMIT ?`,
    [cap],
  );
}

/**
 * Can push actually work right now? Answers the question an operator asks:
 * "I turned it on, why is nothing arriving?" — separately from the token
 * registration question ("is the phone registered at all?").
 */
export async function pushDiagnostics(): Promise<Record<string, unknown>> {
  const config = await pushConfig();
  const enabledWeb = await getBool('sms.push_enabled');
  const endpoint = await getString('push.fcm_endpoint').catch(() => '');
  let tokenOk = false;
  let tokenError = '';
  if (config.enabled && config.account) {
    try {
      await accessToken(config.account, { force: true });
      tokenOk = true;
    } catch (error: any) {
      tokenError = String(error?.message ?? error).slice(0, 200);
    }
  }
  const counts = await one<{ devices: number; active: number; users: number }>(
    `SELECT COUNT(*) AS devices,
            SUM(CASE WHEN last_seen_at > ? THEN 1 ELSE 0 END) AS active,
            COUNT(DISTINCT user_id) AS users
     FROM customer_devices`,
    [new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString()],
  );
  return {
    enabled: config.enabled,
    problem: config.problem,
    project: config.account?.project_id ?? '',
    clientEmail: config.account?.client_email ?? '',
    // Proves the private key is accepted by Google without sending anything.
    credentialsOk: tokenOk,
    credentialsError: tokenError,
    webPushEnabled: enabledWeb,
    endpointOverride: endpoint,
    devices: Number(counts?.devices ?? 0),
    activeDevices: Number(counts?.active ?? 0),
    users: Number(counts?.users ?? 0),
  };
}
