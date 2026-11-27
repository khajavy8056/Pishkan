/**
 * File-integrity scanner.
 *
 * A SHA-256 baseline of the application's own code/config files is stored in
 * guard_file_baseline. A scan reports changed / added / removed files. The
 * baseline is rebuilt automatically when the deployed release changes (so a
 * legitimate `pishkan update` does not produce a flood of false positives)
 * and manually by an administrator after an intentional change.
 *
 * Roots default to the repository the process runs from; GUARD_SCAN_ROOTS
 * (comma-separated, relative to the repo root or absolute) overrides this for
 * tests and unusual layouts. node_modules/.git/.data are never scanned.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { q, run, nowIso, jsonStringify, jsonParse } from '../../db/index.js';
import { id, sha256 } from '../../lib/crypto.js';
import { env } from '../../env.js';
import { getBool, getNumber } from '../settings/service.js';
import { recordEvent, getState, setState } from './service.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** …/apps/api/{src|dist}/modules/guard → repo root is four levels up. */
export const REPO_ROOT = path.resolve(HERE, '..', '..', '..', '..');

const DEFAULT_ROOTS = ['apps/api/src', 'apps/api/dist', 'apps/web/src', 'apps/web/dist', 'scripts', 'deploy', 'windows'];
const SKIP_DIRS = new Set(['node_modules', '.git', '.data', '.venv', 'coverage', '__pycache__', '.next', 'dist-ssr']);
const SCAN_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.sql', '.sh', '.ps1', '.cmd',
  '.html', '.css', '.dart', '.kt', '.kts', '.yaml', '.yml', '.conf', '.service', '.timer', '.xml', '.gradle', '.properties',
]);
const MAX_FILES = 8000;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_FINDINGS = 300;

export function scanRoots(): string[] {
  const override = (process.env.GUARD_SCAN_ROOTS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const roots = override.length ? override : DEFAULT_ROOTS;
  return roots.map((r) => (path.isAbsolute(r) ? r : path.resolve(REPO_ROOT, r))).filter((r) => fs.existsSync(r));
}

function walk(dir: string, out: string[]): void {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (out.length >= MAX_FILES) return;
    if (entry.name.startsWith('.') && entry.name !== '.env.example') continue;
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(full, out);
    } else if (entry.isFile() && SCAN_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      out.push(full);
    }
  }
}

function hashFile(file: string): { sha256: string; size: number } | null {
  try {
    const stat = fs.statSync(file);
    if (stat.size > MAX_FILE_BYTES) return null;
    return { sha256: sha256(fs.readFileSync(file, 'utf8')), size: stat.size };
  } catch { return null; }
}

function collect(): Map<string, { sha256: string; size: number }> {
  const files: string[] = [];
  for (const root of scanRoots()) walk(root, files);
  const map = new Map<string, { sha256: string; size: number }>();
  for (const file of files) {
    const hashed = hashFile(file);
    if (hashed) map.set(path.relative(REPO_ROOT, file), hashed);
  }
  return map;
}

async function startScan(kind: string, actor: string) {
  const scanId = id('gsc');
  await run(
    'INSERT INTO guard_scans (id, kind, status, started_at, triggered_by) VALUES (?, ?, ?, ?, ?)',
    [scanId, kind, 'running', nowIso(), actor],
  );
  return scanId;
}

async function finishScan(scanId: string, status: 'ok' | 'failed', summary: Record<string, unknown>, findings: unknown[]) {
  await run(
    'UPDATE guard_scans SET status = ?, finished_at = ?, summary = ?, findings = ? WHERE id = ?',
    [status, nowIso(), jsonStringify(summary), jsonStringify(findings.slice(0, MAX_FINDINGS)), scanId],
  );
  return { id: scanId, status, summary, findings: findings.slice(0, MAX_FINDINGS) };
}

/** Full baseline rebuild — an explicit administrative action. */
export async function rebuildBaseline(actor: { id: string; name: string }): Promise<{ files: number }> {
  const files = collect();
  await run('DELETE FROM guard_file_baseline');
  const ts = nowIso();
  for (const [rel, info] of files) {
    await run(
      'INSERT INTO guard_file_baseline (path, sha256, size, updated_at) VALUES (?, ?, ?, ?)',
      [rel, info.sha256, info.size, ts],
    );
  }
  await setState('baseline_release', env.version);
  await setState('baseline_built_at', ts);
  await recordEvent({
    severity: 'info', kind: 'integrity_baseline', userId: actor.id,
    message: `خط مبنای یکپارچگی با ${files.size} فایل بازسازی شد (${actor.name}).`,
    details: { files: files.size, version: env.version },
  });
  return { files: files.size };
}

export interface IntegrityFinding { type: 'changed' | 'added' | 'removed'; path: string }

export async function scanIntegrity(triggeredBy: string): Promise<{ id: string; status: string; summary: Record<string, unknown>; findings: IntegrityFinding[] }> {
  const scanId = await startScan('integrity', triggeredBy);
  try {
    const baselineRows = await q<{ path: string; sha256: string; size: number }>('SELECT * FROM guard_file_baseline');
    if (baselineRows.length === 0) {
      const built = await rebuildBaseline({ id: triggeredBy, name: triggeredBy === 'scheduler' ? 'زمان‌بند گارد' : triggeredBy });
      return await finishScan(scanId, 'ok', { baselineCreated: true, files: built.files, findings: 0 }, []) as any;
    }
    // A new release legitimately rewrites the code: rebuild instead of crying wolf.
    const baselineRelease = await getState<string>('baseline_release', '');
    if (baselineRelease && baselineRelease !== env.version) {
      const built = await rebuildBaseline({ id: 'system', name: 'به‌روزرسانی نسخه' });
      await recordEvent({
        severity: 'info', kind: 'integrity_baseline',
        message: `نسخهٔ برنامه از ${baselineRelease} به ${env.version} تغییر کرد؛ خط مبنا خودکار بازسازی شد (${built.files} فایل).`,
        details: { from: baselineRelease, to: env.version },
      });
      return await finishScan(scanId, 'ok', { releaseChanged: true, files: built.files, findings: 0 }, []) as any;
    }
    const baseline = new Map(baselineRows.map((r) => [r.path, r]));
    const current = collect();
    const findings: IntegrityFinding[] = [];
    for (const [rel, info] of current) {
      const base = baseline.get(rel);
      if (!base) findings.push({ type: 'added', path: rel });
      else if (base.sha256 !== info.sha256) findings.push({ type: 'changed', path: rel });
    }
    for (const rel of baseline.keys()) {
      if (!current.has(rel)) findings.push({ type: 'removed', path: rel });
    }
    const summary = {
      files: current.size,
      baselineFiles: baseline.size,
      findings: findings.length,
      changed: findings.filter((f) => f.type === 'changed').length,
      added: findings.filter((f) => f.type === 'added').length,
      removed: findings.filter((f) => f.type === 'removed').length,
    };
    if (findings.length > 0) {
      await recordEvent({
        severity: 'critical', kind: 'integrity_change',
        message: `${findings.length} فایل برنامه بدون مجوز تغییر/اضافه/حذف شده است — احتمال دستکاری کد.`,
        details: { ...summary, sample: findings.slice(0, 20) },
      });
    }
    await setState('last_integrity_scan', nowIso());
    return await finishScan(scanId, 'ok', summary, findings) as any;
  } catch (error) {
    return await finishScan(scanId, 'failed', { error: error instanceof Error ? error.message.slice(0, 300) : 'نامشخص' }, []) as any;
  }
}

export async function maybeAutoIntegrityScan(): Promise<boolean> {
  if (!(await getBool('guard.enabled')) || !(await getBool('guard.integrity_auto_scan'))) return false;
  const hours = await getNumber('guard.integrity_interval_hours');
  const last = await getState<string>('last_integrity_scan', '');
  if (last && Date.now() - new Date(last).getTime() < hours * 3_600_000) return false;
  await scanIntegrity('scheduler');
  return true;
}
