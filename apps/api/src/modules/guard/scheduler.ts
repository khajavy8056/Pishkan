/**
 * Guard background scheduler: periodic integrity/uploads scans, dependency
 * checks and data retention. Started from index.ts only (never in tests).
 */
import { getBool } from '../settings/service.js';
import { logEvent } from '../logging/service.js';
import { pruneGuardData } from './service.js';
import { maybeAutoIntegrityScan } from './integrity.js';
import { maybeAutoUploadsScan } from './uploads-scan.js';
import { maybeAutoDepsCheck } from './deps.js';

let timer: NodeJS.Timeout | null = null;
let initial: NodeJS.Timeout | null = null;
let running = false;
let lastPrune = 0;

async function tick() {
  if (running) return;
  running = true;
  try {
    if (!(await getBool('guard.enabled'))) return;
    await maybeAutoIntegrityScan();
    await maybeAutoUploadsScan();
    await maybeAutoDepsCheck();
    if (Date.now() - lastPrune > 24 * 3_600_000) {
      lastPrune = Date.now();
      await pruneGuardData();
    }
  } catch (error) {
    void logEvent({
      level: 'WARNING', category: 'security', action: 'guard.scheduler', result: 'failure',
      message: 'اجرای دوره‌ای گارد ناموفق بود.',
      details: { error: error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200) },
    });
  } finally {
    running = false;
  }
}

export function startGuardScheduler() {
  if (timer) return;
  initial = setTimeout(() => { void tick(); }, 20_000);
  initial.unref?.();
  timer = setInterval(() => { void tick(); }, 5 * 60_000);
  timer.unref?.();
}

export function stopGuardScheduler() {
  if (initial) clearTimeout(initial);
  if (timer) clearInterval(timer);
  initial = null;
  timer = null;
}

export function guardSchedulerState() {
  return { running: Boolean(timer) };
}
