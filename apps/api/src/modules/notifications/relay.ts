/**
 * The provider-relay channel: hand every notice to somebody else's push gateway.
 *
 * ## What this is for, and what it is not
 *
 * Research into the Iranian market (see docs/PUSH-NOTIFICATIONS-FA.md) says the
 * same thing about every local "Firebase alternative" — پوشه، نجوا، چشمک and the
 * rest — that their own operators say: they *send through FCM*. They add a
 * dashboard, segmentation, campaigns and a server outside Iran; they do not
 * bypass Google on the device, because on Android the delivery socket belongs to
 * Google Play services and no third-party SDK can replace it on a stock phone.
 * Huawei devices without Play services are the real exception, and those need
 * the vendor's own SDK (HMS Push) in the app.
 *
 * So this channel exists for the office that buys one of those platforms (or runs
 * its own gateway, e.g. ntfy, or a corporate SMS-to-push bridge) and wants its
 * marketing/segmentation power while Pishkan keeps being the source of truth for
 * what happened. It is a **single outbound webhook**: one POST per notification,
 * to a URL the office configures, carrying the same title/body/link plus the
 * recipient ids. The device-side SDK is the provider's; the server side is
 * finished here, and the retry/ack rules treat it as one more channel.
 *
 * ## Why it never blocks or fails a business flow
 *
 * A third-party gateway is the least reliable thing in this pipeline, so it gets
 * a short timeout, no retries from this call (the sweeper retries the *notice*,
 * which is the same thing with better information), and a swallowed failure that
 * still lands in the delivery log for the admin panel to show.
 */
import { getBool, getSecret, getString } from '../settings/service.js';
import { logDelivery } from './fcm.js';

export interface RelayInput {
  title: string;
  body: string;
  link?: string;
  notificationId?: string;
  tag?: string;
  kind?: string;
}

export interface RelayConfig {
  enabled: boolean;
  url: string;
  key: string;
  problem: string;
}

export async function relayConfig(): Promise<RelayConfig> {
  const enabled = await getBool('push.relay_enabled');
  const url = (await getString('push.relay_url').catch(() => '')).trim();
  if (!enabled) return { enabled: false, url: '', key: '', problem: 'وب‌هوک سرویس اعلان خاموش است.' };
  if (!/^https?:\/\//i.test(url)) {
    return { enabled: false, url, key: '', problem: 'نشانی وب‌هوک سرویس اعلان تنظیم نشده است.' };
  }
  const key = (await getSecret('push.relay_key').catch(() => '')) || '';
  return { enabled: true, url, key, problem: '' };
}

/**
 * Fire one notice at the configured gateway.
 *
 * Returns `skipped` with a reason rather than throwing, so `notifyUser` can call
 * it in the same best-effort way it calls every other channel.
 */
export async function relayToUsers(
  userIds: string[],
  input: RelayInput,
): Promise<{ sent: boolean; skipped: string; status: number }> {
  const config = await relayConfig();
  if (!config.enabled) return { sent: false, skipped: config.problem, status: 0 };
  const users = [...new Set(userIds.filter(Boolean))];
  if (!users.length) return { sent: false, skipped: 'no-users', status: 0 };

  // The body a provider's documentation asks for is never quite the body the
  // next one asks for, so the payload is deliberately broad and flat: every field
  // is a plain string and the ids are a string array. A gateway can ignore what
  // it does not use, and no mapping table has to be maintained here.
  const payload = {
    title: input.title,
    body: input.body,
    link: input.link ?? '',
    tag: input.tag ?? '',
    kind: input.kind ?? 'info',
    notificationId: input.notificationId ?? '',
    userIds: users,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(config.url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        // Most gateways accept a bearer token; those that want a header with
        // another name can read the same value from `X-Pishkan-Key`.
        ...(config.key ? { authorization: `Bearer ${config.key}`, 'x-pishkan-key': config.key } : {}),
      },
      body: JSON.stringify(payload),
    });
    for (const userId of users) {
      await logDelivery({
        userId,
        notificationId: input.notificationId,
        channel: 'relay',
        ok: response.ok,
        errorCode: response.ok ? undefined : `HTTP_${response.status}`,
        errorText: response.ok ? undefined : 'relay gateway rejected the notice',
      });
    }
    return { sent: response.ok, skipped: '', status: response.status };
  } catch (error: any) {
    const aborted = String(error?.name ?? '') === 'AbortError';
    for (const userId of users) {
      await logDelivery({
        userId,
        notificationId: input.notificationId,
        channel: 'relay',
        ok: false,
        errorCode: aborted ? 'TIMEOUT' : 'NETWORK',
        errorText: String(error?.message ?? error).slice(0, 200),
      });
    }
    return { sent: false, skipped: aborted ? 'وب‌هوک سرویس اعلان جواب نداد (۸ ثانیه).' : 'وب‌هوک سرویس اعلان از دسترس خارج است.', status: 0 };
  } finally {
    clearTimeout(timer);
  }
}
