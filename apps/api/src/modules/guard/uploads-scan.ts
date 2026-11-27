/**
 * Upload-folder malware/heuristic scanner.
 *
 * Every file under UPLOAD_DIR is classified:
 *   - registered: its storage key exists in `files` (display/original/preview);
 *   - in-flight: a fresh .part in incoming/ (younger than an hour);
 *   - unknown: anything else.
 *
 * Executable/script signatures (MZ, ELF, shebang, <?php, JSP…) are always
 * reported. An UNKNOWN file with such a signature is quarantined automatically
 * when guard.quarantine_enabled — moved, never deleted, chmod 0600, fully
 * restorable. A REGISTERED customer file is only flagged: quarantining it
 * needs an explicit admin action, so a false positive can never take a
 * customer's document away.
 *
 * Honest limit: this is signature/heuristic screening, not a full antivirus;
 * it cannot guarantee detection of novel malware. Defense stays layered
 * (strict ingest validation + this scan + integrity baseline).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { q, one, run, nowIso } from '../../db/index.js';
import { id } from '../../lib/crypto.js';
import { env } from '../../env.js';
import { badRequest, notFound } from '../../http/errors.js';
import { getBool } from '../settings/service.js';
import { recordEvent, setState, getState } from './service.js';
import { writeAudit } from '../audit/service.js';

const MAX_SCAN_FILES = 20_000;
const MAX_FINDINGS = 300;
const INFLIGHT_GRACE_MS = 60 * 60_000;

export interface UploadFinding {
  path: string;
  classification: 'registered' | 'unknown' | 'inflight';
  signature: string;
  suspicious: boolean;
  action: 'none' | 'quarantined' | 'needs_admin';
  quarantineId?: string;
}

/** Executable / server-side script signatures that must never sit in uploads. */
export function dangerousSignature(filePath: string): string | null {
  let fd: number;
  try { fd = fs.openSync(filePath, 'r'); } catch { return null; }
  try {
    const buffer = Buffer.alloc(512);
    const read = fs.readSync(fd, buffer, 0, buffer.length, 0);
    const bytes = buffer.subarray(0, read);
    const head = bytes.toString('latin1');
    if (bytes.length >= 2 && bytes[0] === 0x4d && bytes[1] === 0x5a) return 'EXE/DLL (MZ)';
    if (bytes.length >= 4 && bytes[0] === 0x7f && head.slice(1, 4) === 'ELF') return 'ELF executable';
    if (bytes.length >= 2 && head.startsWith('#!')) return 'shell/script (shebang)';
    if (/<\?php/i.test(head)) return 'PHP script';
    if (/<%[@!=\s]/.test(head) || /<jsp:/i.test(head)) return 'JSP/ASP script';
    if (/<\s*script[\s>]/i.test(head) && /\.(html?|svg|xhtml)$/i.test(filePath)) return 'HTML with script';
    if (bytes.length >= 4 && bytes[0] === 0xca && bytes[1] === 0xfe && bytes[2] === 0xba && bytes[3] === 0xbe) return 'Java class/Mach-O fat';
    if (bytes.length >= 8 && head.startsWith('PK') && /\.(jar|war|apk)$/i.test(filePath)) return 'Java archive';
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

function quarantineDir(): string {
  const dir = path.join(path.dirname(path.resolve(env.uploadDir)), 'quarantine');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

function walkUploads(dir: string, out: string[]): void {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (out.length >= MAX_SCAN_FILES) return;
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) walkUploads(full, out);
    else if (entry.isFile()) out.push(full);
  }
}

async function registeredKeys(): Promise<Set<string>> {
  const rows = await q<{ storage_key: string | null; original_storage_key: string | null; preview_storage_key: string | null }>(
    'SELECT storage_key, original_storage_key, preview_storage_key FROM files',
  );
  const keys = new Set<string>();
  for (const row of rows) {
    for (const key of [row.storage_key, row.original_storage_key, row.preview_storage_key]) {
      if (key) keys.add(path.normalize(key));
    }
  }
  return keys;
}

async function quarantineFile(absolute: string, relative: string, signature: string, actor: string): Promise<string> {
  const qid = id('gq');
  const data = fs.readFileSync(absolute);
  const digest = crypto.createHash('sha256').update(data).digest('hex');
  const target = path.join(quarantineDir(), `${qid}.bin`);
  fs.writeFileSync(target, data, { mode: 0o600 });
  fs.rmSync(absolute, { force: true });
  const eventId = (await recordEvent({
    severity: 'critical', kind: 'suspicious_upload',
    message: `فایل مشکوک «${relative}» با امضای ${signature} قرنطینه شد (قابل بازگردانی).`,
    details: { path: relative, signature, quarantineId: qid, sha256: digest },
    actionTaken: 'quarantined',
  })).id;
  await run(
    `INSERT INTO guard_quarantine (id, original_path, quarantine_path, sha256, size, reason, event_id, created_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [qid, relative, target, digest, data.length, `امضای ${signature}`, eventId, nowIso(), actor],
  );
  return qid;
}

export async function scanUploads(triggeredBy: string): Promise<{ id: string; status: string; summary: Record<string, unknown>; findings: UploadFinding[] }> {
  const scanId = id('gsc');
  await run('INSERT INTO guard_scans (id, kind, status, started_at, triggered_by) VALUES (?, ?, ?, ?, ?)', [scanId, 'uploads', 'running', nowIso(), triggeredBy]);
  try {
    const root = path.resolve(env.uploadDir);
    const files: string[] = [];
    walkUploads(root, files);
    const registered = await registeredKeys();
    const autoQuarantine = await getBool('guard.quarantine_enabled');
    const findings: UploadFinding[] = [];
    let quarantined = 0;
    let suspicious = 0;
    for (const absolute of files) {
      const relative = path.relative(root, absolute);
      const normalized = path.normalize(relative);
      const isRegistered = registered.has(normalized);
      const isIncomingPart = normalized.startsWith(`incoming${path.sep}`) && normalized.endsWith('.part');
      let inflight = false;
      if (isIncomingPart && !isRegistered) {
        try { inflight = Date.now() - fs.statSync(absolute).mtimeMs < INFLIGHT_GRACE_MS; } catch { /* ignore */ }
      }
      const signature = dangerousSignature(absolute);
      const classification: UploadFinding['classification'] = isRegistered ? 'registered' : inflight ? 'inflight' : 'unknown';
      if (!signature) continue; // clean files are not findings
      suspicious += 1;
      let action: UploadFinding['action'] = 'none';
      let quarantineId: string | undefined;
      if (classification === 'unknown' && autoQuarantine) {
        quarantineId = await quarantineFile(absolute, relative, signature, triggeredBy);
        action = 'quarantined';
        quarantined += 1;
      } else if (classification === 'registered') {
        action = 'needs_admin';
        await recordEvent({
          severity: 'critical', kind: 'suspicious_upload',
          message: `فایل ثبت‌شدهٔ «${relative}» امضای ${signature} دارد؛ برای قرنطینه تصمیم مدیر لازم است.`,
          details: { path: relative, signature, registered: true },
        });
      } else {
        await recordEvent({
          severity: 'warning', kind: 'suspicious_upload',
          message: `فایل در حال آپلود «${relative}» امضای ${signature} دارد؛ زیر نظر گرفته شد.`,
          details: { path: relative, signature, inflight: true },
        });
      }
      findings.push({ path: relative, classification, signature, suspicious: true, action, quarantineId });
    }
    const summary = { scanned: files.length, suspicious, quarantined, findings: findings.length };
    await run(
      'UPDATE guard_scans SET status = ?, finished_at = ?, summary = ?, findings = ? WHERE id = ?',
      ['ok', nowIso(), JSON.stringify(summary), JSON.stringify(findings.slice(0, MAX_FINDINGS)), scanId],
    );
    await setState('last_uploads_scan', nowIso());
    return { id: scanId, status: 'ok', summary, findings: findings.slice(0, MAX_FINDINGS) };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 300) : 'نامشخص';
    await run('UPDATE guard_scans SET status = ?, finished_at = ?, summary = ? WHERE id = ?', ['failed', nowIso(), JSON.stringify({ error: message }), scanId]);
    return { id: scanId, status: 'failed', summary: { error: message }, findings: [] };
  }
}

export async function maybeAutoUploadsScan(): Promise<boolean> {
  if (!(await getBool('guard.enabled')) || !(await getBool('guard.uploads_scan_enabled'))) return false;
  const last = await getState<string>('last_uploads_scan', '');
  const hours = 6; // uploads change often; a fixed 6h cadence keeps cost bounded
  if (last && Date.now() - new Date(last).getTime() < hours * 3_600_000) return false;
  await scanUploads('scheduler');
  return true;
}

export async function listQuarantine(includeRestored = false) {
  const where = includeRestored ? '' : 'WHERE restored_at IS NULL';
  return q(`SELECT id, original_path, sha256, size, reason, event_id, created_at, created_by, restored_at, restored_by FROM guard_quarantine ${where} ORDER BY created_at DESC LIMIT 200`);
}

/** Move a quarantined file back to its original place. Explicit admin action. */
export async function restoreQuarantine(qid: string, actor: { id: string; name: string; ip?: string }) {
  const row = await one<any>('SELECT * FROM guard_quarantine WHERE id = ?', [qid]);
  if (!row) throw notFound('مورد قرنطینه یافت نشد.');
  if (row.restored_at) throw badRequest('این مورد قبلاً بازگردانی شده است.');
  if (!fs.existsSync(row.quarantine_path)) throw badRequest('فایل قرنطینه روی دیسک موجود نیست.');
  const root = path.resolve(env.uploadDir);
  const target = path.resolve(root, row.original_path);
  if (!target.startsWith(`${root}${path.sep}`)) throw badRequest('مسیر اصلی نامعتبر است.');
  const digest = crypto.createHash('sha256').update(fs.readFileSync(row.quarantine_path)).digest('hex');
  if (digest !== row.sha256) throw badRequest('هش فایل قرنطینه مطابقت ندارد؛ بازگردانی انجام نشد.');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (fs.existsSync(target)) throw badRequest('فایلی در مسیر اصلی وجود دارد؛ ابتدا آن را بررسی کنید.');
  fs.renameSync(row.quarantine_path, target);
  await run('UPDATE guard_quarantine SET restored_at = ?, restored_by = ? WHERE id = ?', [nowIso(), actor.id, qid]);
  await writeAudit({ actorId: actor.id, actorName: actor.name, action: 'guard.quarantine.restore', entityType: 'guard_quarantine', entityId: qid, after: { path: row.original_path }, ip: actor.ip });
  await recordEvent({
    severity: 'info', kind: 'quarantine_restored', userId: actor.id,
    message: `فایل «${row.original_path}» توسط ${actor.name} از قرنطینه بازگردانی شد.`,
    details: { quarantineId: qid },
  });
  return { id: qid, restored: true };
}

/** Admin-confirmed quarantine of a REGISTERED suspicious file. */
export async function quarantineRegistered(relativePath: string, actor: { id: string; name: string; ip?: string }) {
  const root = path.resolve(env.uploadDir);
  const absolute = path.resolve(root, relativePath);
  if (!absolute.startsWith(`${root}${path.sep}`)) throw badRequest('مسیر فایل نامعتبر است.');
  if (!fs.existsSync(absolute)) throw notFound('فایل یافت نشد.');
  const signature = dangerousSignature(absolute);
  if (!signature) throw badRequest('این فایل امضای اجرایی/اسکریپت ندارد؛ قرنطینه خودکار فقط برای فایل مشکوک است.');
  const qid = await quarantineFile(absolute, path.relative(root, absolute), signature, actor.id);
  await writeAudit({ actorId: actor.id, actorName: actor.name, action: 'guard.quarantine.manual', entityType: 'guard_quarantine', entityId: qid, after: { path: relativePath, signature }, ip: actor.ip });
  return { id: qid, quarantined: true };
}
