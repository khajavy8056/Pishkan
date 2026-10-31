/**
 * Runtime metrics: in-process counters plus periodic samples persisted in
 * `metric_samples` so the dashboard can draw real history (not fabricated data).
 *
 * Percentages are stored as integers ×100 (e.g. 42.53% → 4253) to keep a single
 * portable column type across SQLite and PostgreSQL.
 */
import fs from 'node:fs';
import os from 'node:os';
import { one, q, run, nowIso } from '../../db/index.js';
import { id } from '../../lib/crypto.js';
import { getBool, getNumber } from '../settings/service.js';
import { logEvent } from '../logging/service.js';

interface RequestSample { at: number; durationMs: number; status: number; path: string }

const state = {
  startedAt: Date.now(),
  requests: 0,
  serverErrors: 0,
  clientErrors: 0,
  recent: [] as RequestSample[],
  lastCpu: { at: Date.now(), usage: process.cpuUsage() },
  lastSampleAt: 0,
  lastDbLatencyMs: 0,
  lastSampleError: null as string | null,
};

const RECENT_LIMIT = 4000;
const RECENT_WINDOW_MS = 5 * 60_000;

export function recordRequest(input: { durationMs: number; status: number; path: string }) {
  state.requests += 1;
  if (input.status >= 500) state.serverErrors += 1;
  else if (input.status >= 400) state.clientErrors += 1;
  state.recent.push({ at: Date.now(), durationMs: input.durationMs, status: input.status, path: input.path });
  if (state.recent.length > RECENT_LIMIT) state.recent.splice(0, state.recent.length - RECENT_LIMIT);
  const cutoff = Date.now() - RECENT_WINDOW_MS;
  while (state.recent.length && state.recent[0]!.at < cutoff) state.recent.shift();
}

function percentile(values: number[], p: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index]!;
}

export function requestStats(windowMs = RECENT_WINDOW_MS) {
  const cutoff = Date.now() - windowMs;
  const rows = state.recent.filter((row) => row.at >= cutoff);
  const durations = rows.map((row) => row.durationMs);
  const failed = rows.filter((row) => row.status >= 400).length;
  return {
    total: state.requests,
    serverErrors: state.serverErrors,
    clientErrors: state.clientErrors,
    window: {
      windowMs,
      requests: rows.length,
      failed,
      errorRatePercent: rows.length ? Math.round((failed / rows.length) * 10000) / 100 : 0,
      avgMs: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0,
      p95Ms: percentile(durations, 95),
      p99Ms: percentile(durations, 99),
    },
    recent: rows.slice(-50).reverse(),
  };
}

/** CPU usage of this process since the previous call (percent of one core). */
export function cpuPercent(): number {
  const now = Date.now();
  const usage = process.cpuUsage(state.lastCpu.usage);
  const elapsedMs = Math.max(1, now - state.lastCpu.at);
  state.lastCpu = { at: now, usage: process.cpuUsage() };
  const percent = ((usage.user + usage.system) / 1000 / elapsedMs) * 100;
  return Math.round(Math.min(percent, 100 * os.cpus().length) * 100) / 100;
}

export function memorySnapshot() {
  const usage = process.memoryUsage();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  return {
    rssMb: Math.round((usage.rss / 1024 / 1024) * 10) / 10,
    heapUsedMb: Math.round((usage.heapUsed / 1024 / 1024) * 10) / 10,
    heapTotalMb: Math.round((usage.heapTotal / 1024 / 1024) * 10) / 10,
    heapPercent: usage.heapTotal ? Math.round((usage.heapUsed / usage.heapTotal) * 10000) / 100 : 0,
    /** Share of the whole machine's RAM used by this process. */
    systemPercent: Math.round((usage.rss / totalMem) * 10000) / 100,
    system: {
      totalMb: Math.round(totalMem / 1024 / 1024),
      freeMb: Math.round(freeMem / 1024 / 1024),
      usedPercent: Math.round(((totalMem - freeMem) / totalMem) * 10000) / 100,
    },
    loadAverage: os.loadavg(),
  };
}

export function diskSnapshot(path = process.cwd()) {
  try {
    const stat = fs.statfsSync(path);
    const total = Number(stat.blocks) * Number(stat.bsize);
    const free = Number(stat.bfree) * Number(stat.bsize);
    const available = Number(stat.bavail) * Number(stat.bsize);
    return {
      totalBytes: total,
      freeBytes: free,
      availableBytes: available,
      usedPercent: total ? Math.round(((total - free) / total) * 10000) / 100 : 0,
      freeGb: Math.round((free / 1e9) * 10) / 10,
      totalGb: Math.round((total / 1e9) * 10) / 10,
      path,
    };
  } catch {
    return null;
  }
}

export async function dbLatency(): Promise<{ ok: boolean; ms: number }> {
  const started = Date.now();
  try {
    await one('SELECT 1 AS ok');
    const ms = Date.now() - started;
    state.lastDbLatencyMs = ms;
    return { ok: true, ms };
  } catch {
    state.lastDbLatencyMs = -1;
    return { ok: false, ms: Date.now() - started };
  }
}

async function insertSample(metric: string, value: number) {
  await run('INSERT INTO metric_samples (id, metric, value, captured_at) VALUES (?, ?, ?, ?)',
    [id('met'), metric, Math.round(value), nowIso()]);
}

/** One sampling tick. Also used by the alert evaluator and by tests. */
export async function sampleMetrics() {
  const cpu = cpuPercent();
  const mem = memorySnapshot();
  const disk = diskSnapshot(process.env.UPLOAD_DIR || process.cwd());
  const db = await dbLatency();
  const requests = requestStats();
  const sessions = await one<{ online: number; active: number }>(
    `SELECT
       COALESCE(SUM(CASE WHEN last_seen_at >= ? THEN 1 ELSE 0 END),0) AS online,
       COUNT(*) AS active
     FROM sessions WHERE revoked_at IS NULL AND expires_at > ?`,
    [new Date(Date.now() - 15 * 60_000).toISOString(), nowIso()],
  );
  const media = await one<{ pending: number; failed: number }>(
    `SELECT COALESCE(SUM(CASE WHEN processing_status='pending' THEN 1 ELSE 0 END),0) AS pending,
            COALESCE(SUM(CASE WHEN processing_status='failed' THEN 1 ELSE 0 END),0) AS failed FROM files`,
  );

  const samples: [string, number][] = [
    ['cpu_percent_x100', cpu * 100],
    ['memory_rss_mb', mem.rssMb],
    ['memory_heap_percent_x100', mem.heapPercent * 100],
    ['memory_system_percent_x100', mem.systemPercent * 100],
    ['disk_used_percent_x100', (disk?.usedPercent ?? 0) * 100],
    ['disk_free_gb', disk?.freeGb ?? 0],
    ['db_latency_ms', db.ms],
    ['api_requests_5m', requests.window.requests],
    ['api_errors_5m', requests.window.failed],
    ['api_error_rate_x100', requests.window.errorRatePercent * 100],
    ['api_avg_ms', requests.window.avgMs],
    ['api_p95_ms', requests.window.p95Ms],
    ['active_sessions', Number(sessions?.active ?? 0)],
    ['online_users', Number(sessions?.online ?? 0)],
    ['media_queue_pending', Number(media?.pending ?? 0)],
    ['media_queue_failed', Number(media?.failed ?? 0)],
  ];
  for (const [metric, value] of samples) await insertSample(metric, value);
  state.lastSampleAt = Date.now();
  state.lastSampleError = db.ok ? null : 'database probe failed';
  return { sampledAt: nowIso(), cpu, db, requests: requests.window };
}

export function collectorState() {
  return {
    startedAt: new Date(state.startedAt).toISOString(),
    lastSampleAt: state.lastSampleAt ? new Date(state.lastSampleAt).toISOString() : null,
    lastSampleError: state.lastSampleError,
    lastDbLatencyMs: state.lastDbLatencyMs,
  };
}

let timer: NodeJS.Timeout | null = null;

/** Start the background sampler (idempotent). */
export async function startMetricsCollector() {
  if (timer) return;
  const enabled = await getBool('monitoring.enabled').catch(() => true);
  if (!enabled) return;
  const intervalSeconds = Math.max(10, Math.min(600, await getNumber('monitoring.sample_interval_seconds').catch(() => 30)));
  const tick = () => {
    void sampleMetrics().catch((error) => {
      state.lastSampleError = error instanceof Error ? error.message : 'sample failed';
    });
    void pruneMetrics().catch(() => undefined);
  };
  timer = setInterval(tick, intervalSeconds * 1000);
  timer.unref?.();
  // One immediate sample so a freshly started server has a data point.
  setTimeout(tick, 1500).unref?.();
}

export function stopMetricsCollector() {
  if (timer) clearInterval(timer);
  timer = null;
}

export async function pruneMetrics() {
  const days = Math.max(1, await getNumber('monitoring.retain_metrics_days').catch(() => 30));
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  await run('DELETE FROM metric_samples WHERE captured_at < ?', [cutoff]);
}

/* --------------------------------- series --------------------------------- */

export type Bucket = 'hour' | 'day' | 'week' | 'month';

export function bucketKey(iso: string, bucket: Bucket): string {
  const date = new Date(iso);
  if (bucket === 'hour') return iso.slice(0, 13);
  if (bucket === 'month') return iso.slice(0, 7);
  if (bucket === 'day') return iso.slice(0, 10);
  // ISO week (Monday based)
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNumber = (day.getUTCDay() + 6) % 7;
  day.setUTCDate(day.getUTCDate() - dayNumber + 3);
  const firstThursday = new Date(Date.UTC(day.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((day.getTime() - firstThursday.getTime()) / 86_400_000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${day.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/**
 * Metric history. Raw samples are bounded so a large range cannot exhaust
 * memory; hourly buckets cover the last 30 days, other buckets up to 2 years.
 */
export async function series(params: {
  metric: string; from?: string; to?: string; bucket?: Bucket;
}) {
  const bucket: Bucket = params.bucket ?? 'hour';
  const to = params.to ?? nowIso();
  const defaultWindowDays = bucket === 'hour' ? 7 : bucket === 'day' ? 90 : 730;
  const from = params.from ?? new Date(Date.now() - defaultWindowDays * 86_400_000).toISOString();
  const limit = bucket === 'hour' ? 2880 : 20000;
  const rows = await q<{ value: number; captured_at: string }>(
    `SELECT value, captured_at FROM metric_samples WHERE metric = ? AND captured_at >= ? AND captured_at <= ?
     ORDER BY captured_at ASC LIMIT ?`,
    [params.metric, from, to, limit],
  );
  const buckets = new Map<string, { sum: number; count: number; min: number; max: number; last: number }>();
  for (const row of rows) {
    const key = bucketKey(row.captured_at, bucket);
    const entry = buckets.get(key) ?? { sum: 0, count: 0, min: Number(row.value), max: Number(row.value), last: 0 };
    entry.sum += Number(row.value);
    entry.count += 1;
    entry.min = Math.min(entry.min, Number(row.value));
    entry.max = Math.max(entry.max, Number(row.value));
    entry.last = Number(row.value);
    buckets.set(key, entry);
  }
  return {
    metric: params.metric,
    bucket,
    from, to,
    points: [...buckets.entries()].map(([key, entry]) => ({
      key,
      avg: Math.round(entry.sum / entry.count),
      min: entry.min,
      max: entry.max,
      last: entry.last,
      count: entry.count,
    })),
  };
}

/** Latest value of one metric (for the health cards). */
export async function latestMetric(metric: string): Promise<{ value: number; capturedAt: string } | null> {
  const row = await one<any>(
    'SELECT value, captured_at FROM metric_samples WHERE metric = ? ORDER BY captured_at DESC LIMIT 1', [metric],
  );
  return row ? { value: Number(row.value), capturedAt: row.captured_at } : null;
}

export async function latestMetrics(metrics: string[]) {
  const result: Record<string, { value: number; capturedAt: string } | null> = {};
  for (const metric of metrics) result[metric] = await latestMetric(metric);
  return result;
}
