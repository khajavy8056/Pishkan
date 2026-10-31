/**
 * Structured system logger.
 *
 * Every operational event lands in `system_logs` with a category, level and the
 * technical identifiers needed to follow it (request id, correlation id,
 * request/transaction id). Business-critical mutations additionally keep their
 * own audit trail; this table is the searchable operational view.
 *
 * Rules:
 *   - never throws into the request path (logging must not break a request);
 *   - never stores passwords, OTP codes, tokens, API keys, card data or raw
 *     gateway payloads (key-based redaction + `sanitizeLogText`);
 *   - writes are bounded (details are truncated, message length capped).
 */
import { one, q, run, nowIso } from '../../db/index.js';
import { id } from '../../lib/crypto.js';
import { sanitizeLogText } from '../../lib/safe-log.js';

export const LOG_LEVELS = ['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL', 'SECURITY'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  DEBUG: 10, INFO: 20, WARNING: 30, ERROR: 40, CRITICAL: 50, SECURITY: 60,
};

export const LOG_CATEGORIES = [
  'auth', 'admin', 'staff', 'request', 'document', 'payment', 'wallet',
  'api', 'server', 'database', 'gateway', 'file', 'settings', 'security',
  'network', 'background', 'backup',
] as const;
export type LogCategory = (typeof LOG_CATEGORIES)[number];

export interface LogInput {
  level: LogLevel;
  category: LogCategory;
  action: string;
  message?: string;
  actorId?: string | null;
  actorName?: string | null;
  actorRole?: string | null;
  ip?: string | null;
  requestId?: string | null;
  correlationId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  transactionId?: string | null;
  result?: 'success' | 'failure' | 'denied';
  errorCode?: string | null;
  details?: Record<string, unknown> | null;
  durationMs?: number | null;
  source?: string;
}

/** Simple runtime threshold; the monitoring module syncs it from settings. */
let minimum: LogLevel = 'INFO';
export function setMinimumLevel(level: string | null | undefined) {
  const candidate = String(level ?? '').toUpperCase() as LogLevel;
  if (LOG_LEVELS.includes(candidate)) minimum = candidate;
}
export function minimumLevel(): LogLevel { return minimum; }

const SENSITIVE_KEY = /pass|secret|token|authorization|cookie|otp|code$|card|cvv|merchant|api[_-]?key|authority|private[_-]?key/i;
const MAX_DETAILS = 4000;

/** Key-based redaction for structured details. */
export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return null;
  if (depth > 4) return '[depth]';
  if (typeof value === 'string') return sanitizeLogText(value, 500);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((entry) => redact(entry, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>).slice(0, 60)) {
      out[key] = SENSITIVE_KEY.test(key) ? '[redacted]' : redact(entry, depth + 1);
    }
    return out;
  }
  return '[unsupported]';
}

function serialiseDetails(details: Record<string, unknown> | null | undefined): string | null {
  if (!details) return null;
  try {
    const json = JSON.stringify(redact(details));
    if (json === '{}') return null;
    return json.length > MAX_DETAILS ? `${json.slice(0, MAX_DETAILS)}…` : json;
  } catch {
    return null;
  }
}

/** Persist one log line. Never throws. */
export async function logEvent(input: LogInput): Promise<void> {
  try {
    if (LEVEL_WEIGHT[input.level] < LEVEL_WEIGHT[minimum]) return;
    // Every event carries a correlation id, even when it happens outside an
    // HTTP request (scheduler, boot, background job), so related lines can be
    // traced together in the monitoring search.
    const correlationId = input.correlationId
      ? String(input.correlationId).slice(0, 100)
      : input.requestId ? String(input.requestId).slice(0, 100) : id('corr');
    await run(
      `INSERT INTO system_logs (id, created_at, level, category, action, actor_id, actor_name, actor_role, ip,
        request_id, correlation_id, entity_type, entity_id, transaction_id, result, message, error_code, details,
        duration_ms, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id('log'), nowIso(), input.level, input.category, input.action,
        input.actorId ?? null, input.actorName ? sanitizeLogText(input.actorName, 120) : null, input.actorRole ?? null,
        input.ip ? String(input.ip).slice(0, 60) : null,
        input.requestId ? String(input.requestId).slice(0, 100) : null,
        correlationId,
        input.entityType ?? null, input.entityId ?? null, input.transactionId ?? null,
        input.result ?? 'success',
        input.message ? sanitizeLogText(input.message, 2000) : null,
        input.errorCode ? String(input.errorCode).slice(0, 120) : null,
        serialiseDetails(input.details),
        input.durationMs === undefined || input.durationMs === null ? null : Math.max(0, Math.round(input.durationMs)),
        input.source ?? 'api',
      ],
    );
  } catch (error) {
    // Logging failure must never break the caller; keep a bounded console note.
    console.error('[log] persist failed:', sanitizeLogText(error instanceof Error ? error.message : error, 200));
  }
}

/** Fire-and-forget variant for hot paths. */
export function logAsync(input: LogInput): void {
  void logEvent(input);
}

/* --------------------------------- reading -------------------------------- */

export interface LogFilter {
  page?: number;
  pageSize?: number;
  level?: string;
  levels?: string[];
  category?: string;
  action?: string;
  actorId?: string;
  actorRole?: string;
  requestId?: string;
  transactionId?: string;
  entityId?: string;
  result?: string;
  search?: string;
  from?: string;
  to?: string;
}

/** Immutable-column guard used for audit/search exports. */
const SAFE_COLUMN: Record<string, string> = {
  level: 'level', category: 'category', action: 'action', actor_id: 'actor_id',
  actor_role: 'actor_role', request_id: 'request_id', transaction_id: 'transaction_id',
  entity_id: 'entity_id', result: 'result',
};

export async function listLogs(filter: LogFilter) {
  const page = Math.max(1, Number(filter.page ?? 1) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(filter.pageSize ?? 50) || 50));
  const where: string[] = [];
  const args: any[] = [];
  for (const [key, column] of Object.entries(SAFE_COLUMN)) {
    const value = (filter as any)[key];
    if (value) { where.push(`${column} = ?`); args.push(String(value)); }
  }
  if (filter.levels?.length) {
    const levels = filter.levels.map((l) => String(l).toUpperCase()).filter((l) => LOG_LEVELS.includes(l as LogLevel));
    if (levels.length) { where.push(`level IN (${levels.map(() => '?').join(',')})`); args.push(...levels); }
  }
  if (filter.from) { where.push('created_at >= ?'); args.push(filter.from); }
  if (filter.to) {
    where.push('created_at <= ?');
    const to = String(filter.to);
    args.push(/^\d{4}-\d{2}-\d{2}$/.test(to) ? `${to}T23:59:59.999Z` : to);
  }
  if (filter.search) {
    where.push('(message LIKE ? OR action LIKE ? OR entity_id LIKE ? OR error_code LIKE ?)');
    const needle = `%${filter.search.slice(0, 80)}%`;
    args.push(needle, needle, needle, needle);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = await one<{ c: number }>(`SELECT COUNT(*) AS c FROM system_logs ${clause}`, args);
  const rows = await q<any>(
    `SELECT * FROM system_logs ${clause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...args, pageSize, (page - 1) * pageSize],
  );
  return {
    items: rows.map(mapLog), total: Number(total?.c ?? 0), page, pageSize,
  };
}

export function mapLog(row: any) {
  let details: unknown = null;
  if (row.details) { try { details = JSON.parse(row.details); } catch { details = null; } }
  return {
    id: row.id, createdAt: row.created_at, level: row.level, category: row.category, action: row.action,
    actorId: row.actor_id, actorName: row.actor_name, actorRole: row.actor_role, ip: row.ip,
    requestId: row.request_id, correlationId: row.correlation_id,
    entityType: row.entity_type, entityId: row.entity_id, transactionId: row.transaction_id,
    result: row.result, message: row.message, errorCode: row.error_code, details,
    durationMs: row.duration_ms === null ? null : Number(row.duration_ms), source: row.source,
  };
}

export async function getLog(logId: string) {
  const row = await one<any>('SELECT * FROM system_logs WHERE id = ?', [logId]);
  return row ? mapLog(row) : null;
}

/** Aggregated counts for the monitoring dashboard. */
export async function logStats(range: { from: string; to: string }) {
  const byLevel = await q<any>(
    'SELECT level, COUNT(*) AS c FROM system_logs WHERE created_at >= ? AND created_at <= ? GROUP BY level',
    [range.from, range.to],
  );
  const byCategory = await q<any>(
    'SELECT category, COUNT(*) AS c FROM system_logs WHERE created_at >= ? AND created_at <= ? GROUP BY category ORDER BY c DESC',
    [range.from, range.to],
  );
  const repeated = await q<any>(
    `SELECT error_code, category, COUNT(*) AS c, MAX(created_at) AS last_seen
     FROM system_logs WHERE level IN ('ERROR','CRITICAL','SECURITY') AND created_at >= ?
     GROUP BY error_code, category ORDER BY c DESC LIMIT 20`,
    [range.from],
  );
  return {
    byLevel: Object.fromEntries(byLevel.map((r) => [r.level, Number(r.c)])),
    byCategory: byCategory.map((r) => ({ category: r.category, count: Number(r.c) })),
    repeatedErrors: repeated.map((r) => ({
      errorCode: r.error_code ?? 'unknown', category: r.category, count: Number(r.c), lastSeenAt: r.last_seen,
    })),
  };
}

export async function pruneLogs(days: number): Promise<number> {
  const cutoff = new Date(Date.now() - Math.max(1, days) * 86_400_000).toISOString();
  const result = await run('DELETE FROM system_logs WHERE created_at < ?', [cutoff]);
  return result.changes;
}
