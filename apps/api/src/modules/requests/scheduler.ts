/**
 * Forced-assignment scheduler.
 *
 * Runs the same `forceAssignSweep()` the HTTP endpoint uses, once a minute, so
 * a request that nobody accepted is handed to a free employee even when no
 * manager is looking at the screen. The timer is unref'd so it never blocks
 * shutdown, and a running guard prevents overlapping sweeps.
 */
import { forceAssignSweep } from './service.js';
import { logEvent } from '../logging/service.js';

const INTERVAL_MS = () => {
  const configured = Number(process.env.ASSIGNMENT_SWEEP_SECONDS ?? 60);
  return Number.isFinite(configured) && configured >= 10 ? configured * 1000 : 60_000;
};

let timer: NodeJS.Timeout | null = null;
let initial: NodeJS.Timeout | null = null;
let running = false;
let lastResult: { at: string; assigned: number; checked: number } | null = null;

export function startAssignmentScheduler() {
  if (timer) return;
  const tick = () => {
    if (running) return;
    running = true;
    forceAssignSweep()
      .then((result) => {
        lastResult = { at: new Date().toISOString(), assigned: result.assigned.length, checked: result.checked };
      })
      .catch((error) => logEvent({
        level: 'WARNING', category: 'background', action: 'request.force_assign', result: 'failure',
        message: 'واگذاری خودکار پرونده‌های پذیرفته‌نشده ناموفق بود.',
        details: { error: error instanceof Error ? error.message : String(error) },
      }))
      .finally(() => { running = false; });
  };
  initial = setTimeout(tick, 20_000);
  initial.unref?.();
  timer = setInterval(tick, INTERVAL_MS());
  timer.unref?.();
}

export function stopAssignmentScheduler() {
  if (initial) clearTimeout(initial);
  if (timer) clearInterval(timer);
  initial = null;
  timer = null;
}

export function assignmentSchedulerState() {
  return { running: Boolean(timer), intervalMs: INTERVAL_MS(), lastResult };
}
