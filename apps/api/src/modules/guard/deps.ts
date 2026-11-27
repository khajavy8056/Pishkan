/**
 * Dependency vulnerability check via `npm audit --json`.
 *
 * Runs the real npm audit against the lockfile (no invented data), stores the
 * report, and raises an event when high/critical advisories affect installed
 * packages. It NEVER updates anything automatically: the report names a safe
 * target version and the admin decides (mission §5.5).
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { run, nowIso, jsonStringify } from '../../db/index.js';
import { id } from '../../lib/crypto.js';
import { getBool, getNumber } from '../settings/service.js';
import { recordEvent, setState, getState } from './service.js';
import { REPO_ROOT } from './integrity.js';

const exec = promisify(execFile);

export interface DepVulnerability {
  name: string;
  severity: 'info' | 'low' | 'moderate' | 'high' | 'critical';
  isDirect: boolean;
  range: string;
  advisories: { title: string; url: string; severity: string }[];
  fixAvailable: { name: string; version: string; isSemVerMajor: boolean } | boolean;
}

export interface DepsReport {
  checkedAt: string;
  ok: boolean;
  error?: string;
  total: number;
  counts: Record<string, number>;
  vulnerabilities: DepVulnerability[];
}

/** Pure parser — unit-tested with a real `npm audit --json` fixture. */
export function parseAuditReport(raw: unknown): Omit<DepsReport, 'checkedAt' | 'ok' | 'error'> {
  const report = (raw ?? {}) as Record<string, any>;
  const vulns = report.vulnerabilities ?? {};
  const list: DepVulnerability[] = [];
  for (const [name, entry] of Object.entries<any>(vulns)) {
    const advisories = (Array.isArray(entry.via) ? entry.via : [])
      .filter((v: any) => typeof v === 'object' && v !== null)
      .map((v: any) => ({ title: String(v.title ?? '').slice(0, 200), url: String(v.url ?? ''), severity: String(v.severity ?? '') }));
    list.push({
      name,
      severity: entry.severity ?? 'moderate',
      isDirect: Boolean(entry.isDirect),
      range: String(entry.range ?? ''),
      advisories,
      fixAvailable: entry.fixAvailable ?? false,
    });
  }
  const counts: Record<string, number> = { info: 0, low: 0, moderate: 0, high: 0, critical: 0 };
  const meta = report.metadata?.vulnerabilities;
  if (meta && typeof meta === 'object') {
    for (const key of Object.keys(counts)) counts[key] = Number(meta[key] ?? 0);
  } else {
    for (const v of list) counts[v.severity] = (counts[v.severity] ?? 0) + 1;
  }
  const order = { critical: 0, high: 1, moderate: 2, low: 3, info: 4 } as Record<string, number>;
  list.sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9));
  return { total: list.length, counts, vulnerabilities: list };
}

export async function checkDependencies(triggeredBy: string): Promise<{ id: string; status: string; report: DepsReport }> {
  const scanId = id('gsc');
  await run('INSERT INTO guard_scans (id, kind, status, started_at, triggered_by) VALUES (?, ?, ?, ?, ?)', [scanId, 'deps', 'running', nowIso(), triggeredBy]);
  let report: DepsReport;
  try {
    const lockfile = path.join(REPO_ROOT, 'package-lock.json');
    if (!fs.existsSync(lockfile)) throw new Error('package-lock.json در ریشهٔ استقرار پیدا نشد.');
    // npm audit exits 1 when vulnerabilities exist — that is a successful scan.
    let stdout = '';
    try {
      const result = await exec('npm', ['audit', '--json', '--no-fund'], { cwd: REPO_ROOT, timeout: 180_000, maxBuffer: 16 * 1024 * 1024 });
      stdout = result.stdout;
    } catch (error: any) {
      if (typeof error?.stdout === 'string' && error.stdout.trim().startsWith('{')) stdout = error.stdout;
      else throw new Error(`اجرای npm audit ناموفق بود: ${String(error?.message ?? error).slice(0, 200)}`);
    }
    const parsed = parseAuditReport(JSON.parse(stdout));
    report = { checkedAt: nowIso(), ok: true, ...parsed };
  } catch (error) {
    report = {
      checkedAt: nowIso(), ok: false,
      error: error instanceof Error ? error.message.slice(0, 300) : 'خطای نامشخص',
      total: 0, counts: {}, vulnerabilities: [],
    };
  }
  const vulnerable = report.vulnerabilities.filter((v) => v.severity === 'high' || v.severity === 'critical');
  const summary = { ok: report.ok, total: report.total, vulnerable: vulnerable.length, counts: report.counts, error: report.error };
  await run(
    'UPDATE guard_scans SET status = ?, finished_at = ?, summary = ?, findings = ? WHERE id = ?',
    [report.ok ? 'ok' : 'failed', nowIso(), jsonStringify(summary), jsonStringify(report.vulnerabilities.slice(0, 100)), scanId],
  );
  await setState('deps_report', report);
  if (report.ok && vulnerable.length > 0) {
    await recordEvent({
      severity: 'critical', kind: 'deps_vulnerable',
      message: `${vulnerable.length} وابستگی با آسیب‌پذیری بالا/بحرانی شناسایی شد — به‌روزرسانی کنترل‌شده لازم است.`,
      details: { packages: vulnerable.map((v) => ({ name: v.name, severity: v.severity, fix: v.fixAvailable })) },
    });
  }
  return { id: scanId, status: report.ok ? 'ok' : 'failed', report };
}

export async function lastDepsReport(): Promise<DepsReport | null> {
  return getState<DepsReport | null>('deps_report', null);
}

export async function maybeAutoDepsCheck(): Promise<boolean> {
  if (!(await getBool('guard.enabled')) || !(await getBool('guard.deps_check_enabled'))) return false;
  const hours = await getNumber('guard.deps_check_interval_hours');
  const report = await lastDepsReport();
  if (report?.checkedAt && Date.now() - new Date(report.checkedAt).getTime() < hours * 3_600_000) return false;
  await checkDependencies('scheduler');
  return true;
}
