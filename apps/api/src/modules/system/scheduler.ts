/**
 * Scheduled (automatic) backups.
 *
 * Until now `backup.schedule_cron` was only a stored setting with no runner:
 * the admin panel claimed automatic backups were configured while nothing ever
 * executed them. This scheduler closes that gap:
 *
 *   - evaluates the 5-field cron expression against the Tehran wall clock
 *     (the office timezone used everywhere else in the product);
 *   - runs at most once per matched minute, even across interval ticks;
 *   - records the last run / last error / next run for the admin panel;
 *   - notifies super admins once per day when an automatic backup fails, so a
 *     silently broken schedule cannot go unnoticed for weeks.
 */
import { getBool, getString } from '../settings/service.js';
import { logEvent } from '../logging/service.js';
import { notifyRole } from '../notifications/service.js';
import { createBackup } from './backup.js';
import { tehranNow } from '../../lib/tehran-time.js';

interface CronField { any: boolean; values: Set<number> }

function parseField(raw: string, min: number, max: number): CronField | null {
  const values = new Set<number>();
  for (const part of raw.split(',')) {
    const stepMatch = part.match(/^(.+?)(?:\/(\d+))?$/);
    if (!stepMatch) return null;
    const [, base, stepRaw] = stepMatch;
    const step = stepRaw ? Number(stepRaw) : 1;
    if (!Number.isInteger(step) || step < 1) return null;
    let from = min;
    let to = max;
    if (base === '*') {
      // keep full range
    } else if (/^\d+$/.test(base!)) {
      from = to = Number(base);
    } else {
      const range = base!.match(/^(\d+)-(\d+)$/);
      if (!range) return null;
      from = Number(range[1]);
      to = Number(range[2]);
    }
    if (from < min || to > max || from > to) return null;
    for (let value = from; value <= to; value += step) values.add(value);
  }
  return { any: raw.trim() === '*', values };
}

export interface ParsedCron {
  minute: CronField;
  hour: CronField;
  dayOfMonth: CronField;
  month: CronField;
  dayOfWeek: CronField; // 0 = Sunday … 6 = Saturday (7 also accepted as Sunday)
}

export function parseCron(expression: string): ParsedCron | null {
  const parts = String(expression ?? '').trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const minute = parseField(parts[0]!, 0, 59);
  const hour = parseField(parts[1]!, 0, 23);
  const dayOfMonth = parseField(parts[2]!, 1, 31);
  const month = parseField(parts[3]!, 1, 12);
  const dayOfWeek = parseField(parts[4]!, 0, 7);
  if (!minute || !hour || !dayOfMonth || !month || !dayOfWeek) return null;
  if (dayOfWeek.values.has(7)) { dayOfWeek.values.delete(7); dayOfWeek.values.add(0); }
  return { minute, hour, dayOfMonth, month, dayOfWeek };
}

interface TehranParts { year: number; month: number; day: number; hour: number; minute: number; weekday: number }

function tehranParts(date: Date): TehranParts {
  const { date: ymd, time } = tehranNow(date);
  const [year, month, day] = ymd.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  // Weekday of the Tehran calendar day; computed in UTC to avoid host TZ drift.
  const weekday = new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay();
  return { year: year!, month: month!, day: day!, hour: hour!, minute: minute!, weekday };
}

export function cronMatches(cron: ParsedCron, date: Date): boolean {
  const p = tehranParts(date);
  if (!cron.minute.values.has(p.minute)) return false;
  if (!cron.hour.values.has(p.hour)) return false;
  if (!cron.month.values.has(p.month)) return false;
  // Standard cron semantics: when both day fields are restricted, either may match.
  const domMatch = cron.dayOfMonth.values.has(p.day);
  const dowMatch = cron.dayOfWeek.values.has(p.weekday);
  if (!cron.dayOfMonth.any && !cron.dayOfWeek.any) return domMatch || dowMatch;
  return domMatch && dowMatch;
}

/** Next instant (minute precision) at which the expression fires, or null. */
export function nextCronRun(expression: string, from = new Date()): Date | null {
  const cron = parseCron(expression);
  if (!cron) return null;
  const cursor = new Date(from);
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);
  // A year + a few days of minutes is a generous upper bound for any 5-field cron.
  const LIMIT = 372 * 24 * 60;
  for (let i = 0; i < LIMIT; i += 1) {
    if (cronMatches(cron, cursor)) return new Date(cursor);
    cursor.setMinutes(cursor.getMinutes() + 1);
  }
  return null;
}

/* -------------------------------- scheduler ------------------------------- */

const SYSTEM_ACTOR = { id: 'system:backup-scheduler', name: 'پشتیبان‌گیری خودکار' };

let timer: NodeJS.Timeout | null = null;
let running = false;
let lastFiredMinute = '';
let lastRunAt: string | null = null;
let lastSuccessAt: string | null = null;
let lastError: string | null = null;
let lastBackupId: string | null = null;

async function tick() {
  if (running) return;
  running = true;
  try {
    if (!(await getBool('backup.enabled'))) return;
    const expression = await getString('backup.schedule_cron');
    const cron = parseCron(expression);
    if (!cron) {
      lastError = `عبارت زمان‌بندی «${expression}» معتبر نیست.`;
      return;
    }
    const now = new Date();
    const parts = tehranParts(now);
    const minuteKey = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
    if (minuteKey === lastFiredMinute) return;
    if (!cronMatches(cron, now)) return;
    lastFiredMinute = minuteKey;
    lastRunAt = now.toISOString();
    const backup = await createBackup(SYSTEM_ACTOR, 'پشتیبان خودکار زمان‌بندی‌شده');
    lastBackupId = backup.id;
    lastSuccessAt = new Date().toISOString();
    lastError = null;
    await logEvent({
      level: 'INFO', category: 'background', action: 'backup.auto', result: 'success',
      actorId: SYSTEM_ACTOR.id, actorName: SYSTEM_ACTOR.name,
      entityType: 'backup', entityId: backup.id,
      message: 'نسخه پشتیبان خودکار ایجاد شد.',
      details: { filename: backup.filename, schedule: expression },
    });
  } catch (error) {
    lastError = error instanceof Error ? error.message : 'خطای ناشناخته در پشتیبان‌گیری خودکار';
    await logEvent({
      level: 'ERROR', category: 'background', action: 'backup.auto', result: 'failure',
      actorId: SYSTEM_ACTOR.id, actorName: SYSTEM_ACTOR.name,
      message: 'پشتیبان‌گیری خودکار ناموفق بود.',
      details: { error: lastError },
    }).catch(() => undefined);
    // One alert per Tehran calendar day is enough to surface a broken schedule.
    const today = tehranNow().date;
    await notifyRole(['super_admin'], {
      title: 'پشتیبان‌گیری خودکار ناموفق بود',
      body: `نسخه پشتیبان زمان‌بندی‌شده ساخته نشد: ${lastError}`,
      kind: 'error', link: '/admin/system',
      idempotencyKey: `backup-auto-failed:${today}`,
    }).catch(() => undefined);
  } finally {
    running = false;
  }
}

export function startBackupScheduler() {
  if (timer) return;
  timer = setInterval(() => { void tick(); }, 30_000);
  timer.unref?.();
  // First check shortly after boot so a schedule missed during downtime is
  // picked up at its next occurrence without waiting a full minute.
  const initial = setTimeout(() => { void tick(); }, 15_000);
  initial.unref?.();
}

export function stopBackupScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}

export async function backupSchedulerState() {
  const expression = await getString('backup.schedule_cron').catch(() => '');
  const enabled = await getBool('backup.enabled').catch(() => false);
  const nextRun = enabled ? nextCronRun(expression) : null;
  return {
    running: Boolean(timer),
    enabled,
    schedule: expression,
    scheduleValid: Boolean(parseCron(expression)),
    nextRunAt: nextRun ? nextRun.toISOString() : null,
    lastRunAt,
    lastSuccessAt,
    lastError,
    lastBackupId,
  };
}

/** Exposed for tests: run one scheduler evaluation immediately. */
export async function runBackupSchedulerTick() {
  await tick();
}
