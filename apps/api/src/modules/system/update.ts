import fs from 'node:fs';
import path from 'node:path';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { env } from '../../env.js';
import { conflict } from '../../http/errors.js';

/**
 * The server updating itself from the repository.
 *
 * ## Why this is a thin wrapper and not an implementation
 *
 * The whole lifecycle already lives in `scripts/pishkan` (backup → verified
 * clone of one commit → `npm ci` + build → migrations → atomic `current`
 * symlink swap → health check → automatic rollback). Re-implementing any of that
 * here would create a second path that can be right while the first is wrong, and
 * an updater is exactly the place where a silent divergence is measured in lost
 * data. So this module does three things only: ask the script what is available,
 * start it, and keep the transcript readable for whoever is watching the panel.
 *
 * ## The three rules that make "update from the web panel" defensible
 *
 *  1. **Root comes from a sudoers grant, never from a password the operator
 *     types.** The installer drops a file that allows the service user to run
 *     *exactly* two commands as root — `check-update --json` and `update --json`.
 *     Because the grant enumerates full argument lists, the panel physically
 *     cannot smuggle `--no-backup` (backups are therefore not a checkbox, they
 *     are a property of the install) and cannot pass `--ref` (the server can only
 *     be moved to the tip of the configured branch — pointing production at an
 *     arbitrary commit stays a human decision made on the machine itself).
 *  2. **No URL, no token, nothing to fill in.** The repository address and its
 *     credentials are read from `deploy.conf`/git config by the script. If the
 *     panel ever asks for them, this module is wrong.
 *  3. **The panel survives its own success.** A successful update restarts the
 *     API process, which is the process holding the job. `readJob` therefore
 *     re-derives the outcome from the *release that is live now* rather than
 *     trusting the in-memory state — see `settleAgainstInstall`.
 *
 * On a development checkout (or an install that did not add the sudoers grant)
 * the check still runs — the script is executable without root — but starting is
 * refused with the command to run once by hand. Falling back to a fake "updated"
 * outcome, on the other hand, is the one failure mode worth engineering against: a
 * panel that claims success while nothing moved is worse than a panel that says
 * "not permitted here, run this command".
 */

export type UpdateMode = 'privileged' | 'read-only' | 'unavailable';

export type UpdateCheck = {
  ok: boolean;
  mode: UpdateMode;
  installed?: { version: string; release: string; commit: string };
  target?: { repo: string; branch: string; commit: string; pinnedCommit: string };
  available?: boolean;
  latestVersion?: string;
  safety?: { backupEnabled: boolean; keepReleases: number; freeMb: number; rootRequired: boolean };
  error?: string;
  /** What to do about a non-privileged mode, in one sentence the admin can act on. */
  hint?: string;
};

export type UpdateJob = {
  id: string;
  status: 'running' | 'completed' | 'failed' | 'interrupted';
  startedAt: string;
  finishedAt?: string;
  exitCode?: number | null;
  /** The release we started from — how a restarted server tells success from having been killed. */
  fromCommit: string;
  actor: string;
  lines: string[];
};

/** Where the transcript of a run lives. Deliberately outside the release dirs,
 *  which are replaced on every update. */
const jobDir = () => path.join(path.dirname(env.uploadDir), 'update-jobs');

/** A generous ceiling for `npm ci` + two builds on a small VPS. Killing earlier
 *  would abort a healthy update; the process is a child of the API, so it must
 *  not be allowed to outlive it silently either. */
const UPDATE_TIMEOUT_MS = 20 * 60 * 1000;

let cachedHelper: { bin: string; viaSudo: boolean } | null = null;
const jobs = new Map<string, UpdateJob>();

function runCapture(file: string, args: string[], timeoutMs = 30_000): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      const code = error && typeof (error as { code?: unknown }).code === 'number' ? (error as { code: number }).code : error ? 1 : 0;
      resolve({ code, stdout: stdout ?? '', stderr: stderr ?? '' });
    });
  });
}

/**
 * Find the lifecycle script. Installed servers have `/usr/local/bin/pishkan`;
 * a checkout has `scripts/pishkan` a couple of levels up, which is also what a
 * source install symlinked there points at. Searching upward from the cwd keeps
 * both working without a config key nobody would set correctly.
 */
function findHelper(): string | null {
  const candidates = [process.env.PISHKAN_BIN, '/usr/local/bin/pishkan'].filter(Boolean) as string[];
  for (const candidate of candidates) if (fs.existsSync(candidate)) return candidate;
  let dir = process.cwd();
  for (let depth = 0; depth < 6; depth += 1) {
    const script = path.join(dir, 'scripts', 'pishkan');
    if (fs.existsSync(script)) return script;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** Prefer `sudo -n` (the only mode that can restart the service), fall back to
 *  running the script directly so a developer box still gets a real check. */
async function resolveHelper(): Promise<{ bin: string; viaSudo: boolean } | null> {
  if (cachedHelper) return cachedHelper;
  const bin = findHelper();
  if (!bin) return null;
  const privileged = await runCapture('sudo', ['-n', bin, 'check-update', '--json']);
  if (privileged.code === 0 && privileged.stdout.trim().startsWith('{')) {
    cachedHelper = { bin, viaSudo: true };
    return cachedHelper;
  }
  const direct = bin.endsWith('scripts/pishkan')
    ? await runCapture('bash', [bin, 'check-update', '--json'])
    : { code: 1, stdout: '', stderr: '' };
  if (direct.code === 0 && direct.stdout.trim().startsWith('{')) {
    cachedHelper = { bin, viaSudo: false };
    return cachedHelper;
  }
  // Something is installed but neither route answered (no grant yet): report the
  // privileged path, because that is the one the fix has to be applied to.
  cachedHelper = { bin, viaSudo: false };
  return cachedHelper;
}

export const UPDATE_SUDOERS_LINE =
  (user: string, bin = '/usr/local/bin/pishkan') =>
    `${user} ALL=(root) NOPASSWD: ${bin} check-update --json, ${bin} update --json`;

/** The file the installer writes. Shipped as text so a future agent copies the
 *  same thing instead of improvising a broader grant. */
export const UPDATE_SUDOERS_CONTENT = (user = 'pishkan') => [
  '# Pishkan — allow the API to update the server from the repository, and nothing else.',
  '#',
  '# The argument lists are spelled out on purpose: with `update` and no `--ref`,',
  '# the panel can only move the install to the tip of the configured branch, and',
  '# with no way to pass `--no-backup`, a backup stays mandatory. Do not widen this',
  '# line. If it ever needs to change, change scripts/lib/update-sudoers.sh and',
  '# the check in tools/check_deploy.sh together with it.',
  UPDATE_SUDOERS_LINE(user),
  '',
].join('\n');

function stripAnsi(text: string) {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;]*m/g, '');
}

/** Parse what the script printed, tolerating a leading blank line or a stray warning. */
function parseJson(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  try {
    return JSON.parse(text.slice(start)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function checkForUpdate(): Promise<UpdateCheck> {
  const helper = await resolveHelper();
  if (!helper) {
    return {
      ok: false,
      mode: 'unavailable',
      error: 'not_installed',
      hint: 'این سامانه با اسکریپت نصب استقرار نیافته است، پس به‌روزرسانی از مخزن در دسترس نیست.',
    };
  }
  const result = helper.viaSudo
    ? await runCapture('sudo', ['-n', helper.bin, 'check-update', '--json'])
    : await runCapture('bash', [helper.bin, 'check-update', '--json']);
  const payload = parseJson(result.stdout);
  if (payload?.error === 'not_installed') {
    return {
      ok: false,
      mode: 'unavailable',
      error: 'not_installed',
      hint: 'این سامانه با اسکریپت نصب (scripts/install.sh) استقرار نیافته است، پس مسیر به‌روزرسانی از مخزن وجود ندارد. '
        + 'در یک محیط توسعه، کد را همان‌طور که عادت دارید با git به‌روز کنید.',
    };
  }
  if (!payload || payload.ok !== true) {
    return {
      ok: false,
      mode: 'unavailable',
      error: typeof payload?.error === 'string' ? payload.error : 'check_failed',
      hint: stripAnsi(result.stderr || result.stdout).trim().slice(0, 400)
        || 'اسکریپت pishkan پاسخ داد ولی خروجی قابل خواندن نبود.',
    };
  }
  const check = payload as unknown as UpdateCheck;
  check.mode = helper.viaSudo ? 'privileged' : 'read-only';
  if (!helper.viaSudo) {
    check.hint = 'به‌روزرسانی از پنل روی این سرور هنوز مجوز ندارد: فایل /etc/sudoers.d/pishkan-update نصب نشده است. '
      + 'اسکریپت نصب این فایل را می‌سازد؛ برای افزودنش به سرورِ فعلی این یک خط را اجرا کنید: '
      + `printf '%s\\n' '${UPDATE_SUDOERS_LINE('pishkan')}' | sudo tee /etc/sudoers.d/pishkan-update >/dev/null && sudo visudo -cf /etc/sudoers.d/pishkan-update`
      + ' — تا آن زمان، به‌روزرسانی با `sudo pishkan update` انجام می‌شود و وضعیت اینجا همان‌طور که هست نمایش داده می‌شود.';
    check.mode = 'read-only';
  }
  return check;
}

function jobFile(id: string) {
  return path.join(jobDir(), `${id}.json`);
}

function logFile(id: string) {
  return path.join(jobDir(), `${id}.log`);
}

/**
 * A running job whose process is gone is not necessarily a failure.
 *
 * The update restarts the very service that is watching it, so on a *successful*
 * run the parent dies mid-flight. The only honest way to settle it is to ask what
 * is installed now and compare it with the commit we started from: a different
 * live release means the swap happened.
 */
async function settleAgainstInstall(job: UpdateJob): Promise<UpdateJob> {
  if (job.status !== 'running') return job;
  const alive = (() => {
    const pid = Number(job.actor.match(/^pid:(\d+)/)?.[1] ?? 0);
    if (!pid) return false;
    try { process.kill(pid, 0); return true; } catch { return false; }
  })();
  if (alive) return job;

  const check = await checkForUpdate();
  const nowCommit = check.installed?.commit ?? '';
  const moved = Boolean(nowCommit && job.fromCommit && !nowCommit.startsWith(job.fromCommit.slice(0, 12)));
  const next: UpdateJob = {
    ...job,
    status: moved ? 'completed' : 'interrupted',
    finishedAt: job.finishedAt ?? new Date().toISOString(),
    lines: [
      ...job.lines,
      moved
        ? 'سرویس برای فعال‌سازی نسخهٔ تازه راه‌اندازی شد؛ این پنل هم با آن بازنشست. نسخهٔ نصب‌شده تغییر کرد.'
        : 'فرآیند به‌روزرسانی بدون اینکه نسخهٔ فعال عوض شود پایان یافت. لاگ بالا و `journalctl -u pishkan-api` را ببینید.',
    ],
  };
  void persistJob(next);
  jobs.set(next.id, next);
  return next;
}

function persistJob(job: UpdateJob) {
  try {
    fs.mkdirSync(jobDir(), { recursive: true });
    fs.writeFileSync(jobFile(job.id), JSON.stringify({ ...job, lines: undefined }, null, 2));
  } catch { /* the log file is the record of truth; the JSON is a convenience */ }
}

export function runningJob(): UpdateJob | null {
  for (const job of jobs.values()) if (job.status === 'running') return job;
  try {
    for (const entry of fs.readdirSync(jobDir())) {
      if (!entry.endsWith('.json')) continue;
      const id = entry.slice(0, -5);
      if (jobs.has(id)) continue;
      const raw = parseJson(fs.readFileSync(jobFile(id), 'utf8') ?? '');
      if (raw && raw.status === 'running') {
        const revived: UpdateJob = { ...(raw as unknown as UpdateJob), lines: readLog(id) };
        jobs.set(id, revived);
      }
    }
  } catch { /* no job dir yet */ }
  for (const job of jobs.values()) if (job.status === 'running') return job;
  return null;
}

function readLog(id: string): string[] {
  try {
    return stripAnsi(fs.readFileSync(logFile(id), 'utf8')).split('\n').filter(Boolean).slice(-400);
  } catch {
    return [];
  }
}

/**
 * Start an update. `ref` is intentionally not a parameter — see the sudoers note
 * above. Any in-flight job is returned instead of starting a second one, because
 * two concurrent updates race on the same `current` symlink and lose.
 */
export async function startUpdate(actorName: string): Promise<UpdateJob> {
  const existing = runningJob();
  if (existing) return existing;

  const check = await checkForUpdate();
  if (check.mode !== 'privileged') {
    throw conflict('به‌روزرسانی از پنل روی این سرور فعال نیست. یک‌بار با root مجوز آن را اضافه کنید یا `sudo pishkan update` را اجرا کنید.');
  }
  if (check.safety && check.safety.backupEnabled === false) {
    // The script takes a backup before touching anything regardless of this
    // setting, but an office that switched automatic backups off should see that
    // its usual safety net is off *before* it swaps code underneath itself.
    throw conflict('پشتیبان‌گیری خودکار در تنظیمات استقرار خاموش است. پیش از به‌روزرسانی آن را روشن کنید (docs/BACKUP-RESTORE.md).');
  }
  const helper = await resolveHelper();
  if (!helper) throw conflict('اسکریپت مدیریت نصب پیدا نشد.');

  const id = `update-${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}`;
  fs.mkdirSync(jobDir(), { recursive: true });
  const out = fs.openSync(logFile(id), 'a');
  const child: ChildProcess = spawn('sudo', ['-n', helper.bin, 'update', '--json'], {
    stdio: ['ignore', out, out],
    detached: true,
  });
  const job: UpdateJob = {
    id,
    status: 'running',
    startedAt: new Date().toISOString(),
    fromCommit: check.installed?.commit ?? '',
    // The pid is how `runningJob` tells "still working" from "the service
    // restarted", so it rides along in the actor field rather than in a new column.
    actor: `${actorName} pid:${child.pid ?? 0}`,
    lines: [],
  };
  persistJob(job);
  jobs.set(id, job);
  child.unref();

  const timer = setTimeout(() => {
    try { child.kill('SIGTERM'); } catch { /* already gone */ }
    job.status = 'failed';
    job.finishedAt = new Date().toISOString();
    job.lines = [...readLog(id), 'مهلت زمانی به‌روزرسانی پایان یافت؛ نسخهٔ فعلی فعال باقی می‌ماند.'];
    persistJob(job);
  }, UPDATE_TIMEOUT_MS);
  child.on('exit', (code) => {
    clearTimeout(timer);
    if (job.status !== 'running') return;
    job.status = code === 0 ? 'completed' : 'failed';
    job.exitCode = code;
    job.finishedAt = new Date().toISOString();
    void settleAgainstInstall(job).catch(() => undefined);
  });
  return job;
}

export async function getUpdateJob(id: string): Promise<UpdateJob | null> {
  const known = jobs.get(id) ?? runningJobById(id);
  if (!known) return null;
  return settleAgainstInstall(known);
}

function runningJobById(id: string): UpdateJob | null {
  const raw = parseJson(safeRead(jobFile(id)));
  if (!raw) return null;
  const job: UpdateJob = { ...(raw as unknown as UpdateJob), lines: readLog(id) };
  jobs.set(id, job);
  return job;
}

function safeRead(file: string) {
  try { return fs.readFileSync(file, 'utf8'); } catch { return ''; }
}

export function updateJobDto(job: UpdateJob) {
  return {
    id: job.id,
    status: job.status,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt ?? null,
    exitCode: job.exitCode ?? null,
    lines: job.lines.slice(-200),
  };
}
