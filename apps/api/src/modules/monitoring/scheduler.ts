/**
 * Background monitoring scheduler.
 *
 * Alerts are evaluated on a fixed interval (default: once a minute) so that a
 * database outage or a burst of failed payments is raised even when nobody is
 * looking at the dashboard. The timer is unref'd so it never blocks shutdown.
 */
import { evaluateAlerts } from './alerts.js';
import { logEvent } from '../logging/service.js';

const INTERVAL_MS = () => {
  const configured = Number(process.env.MONITORING_INTERVAL_SECONDS ?? 60);
  return Number.isFinite(configured) && configured >= 10 ? configured * 1000 : 60_000;
};

let timer: NodeJS.Timeout | null = null;
let initial: NodeJS.Timeout | null = null;
let running = false;

export function startAlertScheduler() {
  if (timer) return;
  const tick = () => {
    if (running) return;
    running = true;
    evaluateAlerts({ notify: true })
      .catch((error) => logEvent({
        level: 'WARNING', category: 'background', action: 'alerts.evaluate', result: 'failure',
        message: 'ارزیابی خودکار هشدارها ناموفق بود.',
        details: { error: error instanceof Error ? error.message : String(error) },
      }))
      .finally(() => { running = false; });
  };
  initial = setTimeout(tick, 10_000);
  initial.unref?.();
  timer = setInterval(tick, INTERVAL_MS());
  timer.unref?.();
}

export function stopAlertScheduler() {
  if (initial) clearTimeout(initial);
  if (timer) clearInterval(timer);
  initial = null;
  timer = null;
}

export function schedulerState() {
  return { running: Boolean(timer), intervalMs: INTERVAL_MS() };
}
