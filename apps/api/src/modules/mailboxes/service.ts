/**
 * Organizational mailboxes on the office's own domain.
 *
 * The real mail server (docker-mailserver) is provisioned on the VPS during the
 * install phase by the root-only `pishkan-mail` CLI. This module is the
 * product-side bridge: the admin UI manages a registry here, and each change is
 * applied to the mail server through a single scoped sudo rule
 * (`pishkan ALL=(root) NOPASSWD: /usr/local/bin/pishkan-mail`).
 *
 * Passwords are NEVER stored in the product database — they live only in the
 * mail server's own account store. The CLI adapter is injectable so the whole
 * flow is testable without docker or root.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { q, one, run, nowIso } from '../../db/index.js';
import { id } from '../../lib/crypto.js';
import { getString } from '../settings/service.js';
import { badRequest, conflict, notFound, unavailable } from '../../http/errors.js';
import { writeAudit } from '../audit/service.js';

const execFileAsync = promisify(execFile);

export interface MailCliResult { code: number; stdout: string; stderr: string; }
export type MailCli = (args: string[]) => Promise<MailCliResult>;

/** Real adapter: run the root-only CLI through a tightly scoped sudo rule. */
export const realMailCli: MailCli = async (args) => {
  try {
    const { stdout, stderr } = await execFileAsync('sudo', ['-n', '/usr/local/bin/pishkan-mail', ...args], { timeout: 180000 });
    return { code: 0, stdout: String(stdout), stderr: String(stderr) };
  } catch (err: any) {
    return {
      code: typeof err.code === 'number' ? err.code : 1,
      stdout: String(err.stdout ?? ''),
      stderr: String(err.stderr ?? err.message ?? 'خطای نامشخص در اجرای pishkan-mail'),
    };
  }
};

let cli: MailCli = realMailCli;
/** Test seam: swap the CLI adapter for a fake. */
export function setMailCli(fn: MailCli): void { cli = fn; }
export function resetMailCli(): void { cli = realMailCli; }

const LOCAL_PART = /^[a-z0-9](?:[a-z0-9._-]{0,29}[a-z0-9])?$/;
const DOMAIN = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

export interface MailboxRow {
  id: string; address: string; local_part: string; domain: string;
  display_name: string | null; active: number; created_by: string | null;
  created_at: string; updated_at: string;
}

export async function mailDomain(): Promise<string> {
  return (await getString('mail.domain')).trim().toLowerCase();
}

function cliFailure(res: MailCliResult, fallback: string): never {
  const detail = (res.stderr || res.stdout || '').trim().slice(0, 400);
  if (/not installed|not found|no such file|command not found|sudo:/i.test(detail)) {
    throw unavailable('سرویس ایمیل سازمانی هنوز روی سرور نصب نشده است. در فاز نصب، «pishkan-mail install» آن را راه‌اندازی می‌کند.');
  }
  throw badRequest(detail || fallback);
}

export interface MailServerStatus {
  installed: boolean; running: boolean; domain: string; hostname: string; detail?: string;
}

export async function mailServerStatus(): Promise<MailServerStatus> {
  const domain = await mailDomain();
  const res = await cli(['status', '--json']);
  if (res.code !== 0) {
    return { installed: false, running: false, domain, hostname: 'mail', detail: (res.stderr || '').trim().slice(0, 200) };
  }
  try {
    const parsed = JSON.parse(res.stdout);
    return {
      installed: Boolean(parsed.installed),
      running: Boolean(parsed.running),
      domain: String(parsed.domain || domain),
      hostname: String(parsed.hostname || 'mail'),
    };
  } catch {
    return { installed: false, running: false, domain, hostname: 'mail', detail: 'پاسخ نامعتبر از سرویس ایمیل' };
  }
}

export async function listBoxboxes(): Promise<MailboxRow[]> {
  return q<MailboxRow>('SELECT * FROM mailboxes ORDER BY created_at DESC');
}

export interface CreateMailboxInput {
  localPart: string; password: string; displayName?: string;
  actorId?: string | null; actorName?: string | null; ip?: string;
}

export async function createMailbox(input: CreateMailboxInput): Promise<MailboxRow> {
  const domain = await mailDomain();
  if (!domain || !DOMAIN.test(domain)) {
    throw badRequest('دامنهٔ ایمیل سازمانی تنظیم نشده است. ابتدا در تنظیمات ایمیل، «دامنهٔ ایمیل سازمانی» را وارد کنید.');
  }
  const localPart = input.localPart.trim().toLowerCase();
  if (!LOCAL_PART.test(localPart)) {
    throw badRequest('نام صندوق نامعتبر است. فقط حروف کوچک انگلیسی، رقم، نقطه، خط تیره و زیرخط (۲ تا ۳۱ نویسه) مجاز است.');
  }
  if (!input.password || input.password.length < 8) {
    throw badRequest('رمز صندوق باید حداقل ۸ نویسه باشد.');
  }
  const address = `${localPart}@${domain}`;
  const existing = await one<MailboxRow>('SELECT * FROM mailboxes WHERE address = ?', [address]);
  if (existing) throw conflict(`صندوق ${address} قبلاً ساخته شده است.`);

  const res = await cli(['add', address, input.password]);
  if (res.code !== 0) cliFailure(res, `ساخت صندوق ${address} ناموفق بود.`);

  const now = nowIso();
  const row: MailboxRow = {
    id: id('mbx'), address, local_part: localPart, domain,
    display_name: input.displayName?.trim() || null, active: 1,
    created_by: input.actorId ?? null, created_at: now, updated_at: now,
  };
  await run(
    `INSERT INTO mailboxes (id, address, local_part, domain, display_name, active, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [row.id, row.address, row.local_part, row.domain, row.display_name, row.active, row.created_by, row.created_at, row.updated_at],
  );
  await writeAudit({
    actorId: input.actorId, actorName: input.actorName, action: 'mailbox.create',
    entityType: 'mailbox', entityId: row.id, after: { address, displayName: row.display_name }, ip: input.ip,
  });
  return row;
}

export async function setMailboxPassword(address: string, password: string, actor?: { id?: string | null; name?: string | null; ip?: string }): Promise<void> {
  if (!password || password.length < 8) throw badRequest('رمز صندوق باید حداقل ۸ نویسه باشد.');
  const row = await one<MailboxRow>('SELECT * FROM mailboxes WHERE address = ?', [address.toLowerCase()]);
  if (!row) throw notFound('این صندوق یافت نشد.');
  const res = await cli(['passwd', row.address, password]);
  if (res.code !== 0) cliFailure(res, 'تغییر رمز صندوق ناموفق بود.');
  await run('UPDATE mailboxes SET updated_at = ? WHERE id = ?', [nowIso(), row.id]);
  await writeAudit({ actorId: actor?.id, actorName: actor?.name, action: 'mailbox.password', entityType: 'mailbox', entityId: row.id, ip: actor?.ip });
}

export async function setMailboxActive(address: string, active: boolean, actor?: { id?: string | null; name?: string | null; ip?: string }): Promise<MailboxRow> {
  const row = await one<MailboxRow>('SELECT * FROM mailboxes WHERE address = ?', [address.toLowerCase()]);
  if (!row) throw notFound('این صندوق یافت نشد.');
  const res = await cli([active ? 'enable' : 'disable', row.address]);
  if (res.code !== 0) cliFailure(res, 'تغییر وضعیت صندوق ناموفق بود.');
  await run('UPDATE mailboxes SET active = ?, updated_at = ? WHERE id = ?', [active ? 1 : 0, nowIso(), row.id]);
  await writeAudit({ actorId: actor?.id, actorName: actor?.name, action: active ? 'mailbox.enable' : 'mailbox.disable', entityType: 'mailbox', entityId: row.id, ip: actor?.ip });
  return { ...row, active: active ? 1 : 0 };
}

export async function deleteMailbox(address: string, actor?: { id?: string | null; name?: string | null; ip?: string }): Promise<void> {
  const row = await one<MailboxRow>('SELECT * FROM mailboxes WHERE address = ?', [address.toLowerCase()]);
  if (!row) throw notFound('این صندوق یافت نشد.');
  const res = await cli(['del', row.address]);
  if (res.code !== 0) cliFailure(res, 'حذف صندوق ناموفق بود.');
  await run('DELETE FROM mailboxes WHERE id = ?', [row.id]);
  await writeAudit({ actorId: actor?.id, actorName: actor?.name, action: 'mailbox.delete', entityType: 'mailbox', entityId: row.id, before: { address: row.address }, ip: actor?.ip });
}

export interface GmailConnectionInfo {
  domain: string; incoming: { host: string; port: number; security: string };
  outgoing: { host: string; port: number; security: string }; username: string;
}

export async function gmailConnectionInfo(): Promise<GmailConnectionInfo> {
  const status = await mailServerStatus();
  const host = `${status.hostname || 'mail'}.${status.domain || await mailDomain()}`;
  return {
    domain: status.domain || await mailDomain(),
    incoming: { host, port: 993, security: 'SSL/TLS' },
    outgoing: { host, port: 465, security: 'SSL/TLS' },
    username: 'نشانی کامل صندوق (مثلاً admin@دامنه)',
  };
}
