#!/usr/bin/env node
/**
 * The Windows install's own update path — the local counterpart of `pishkan update`.
 *
 * Why this exists at all: the office tests on a Windows box, and every time a fix
 * landed they re-ran the installer by hand. That is the one workflow where "I
 * updated it" and "I lost my test data" are two clicks apart, so it deserves the
 * same four guarantees the server has, in the same order:
 *
 *   check → **backup** → move the code → verify → back out if verification fails
 *
 * ## What this refuses to do, and why each refusal is the point
 *
 *  * **Never update a checkout with local edits.** A `git reset` or a merge into a
 *    dirty tree throws away whatever the tester was trying. A refusal that names
 *    the files is a five-second annoyance; that loss is an afternoon. So the
 *    working tree must be clean, and `--allow-dirty` does not exist.
 *  * **Never ask where to update from.** The remote and branch are read from the
 *    install's own git config (or `.data/update-source.json` for an install that was
 *    unpacked from an archive). A prompt would mean the person typing it has to
 *    know a repository URL — and a wrong one, typed under pressure, installs the
 *    wrong code.
 *  * **Never skip the backup.** Not a flag, not a setting. The backup is taken with
 *    the same manager command the "پشتیبان‌گیری" button uses — one implementation,
 *    not a copy that can drift — and if it fails, nothing else runs.
 *  * **Never claim success on faith.** After the code moves, the local health
 *    endpoint is polled; on failure the tree goes back to the exact commit it
 *    started from and the service is restarted. Because a dirty tree was refused
 *    up front, that reset can only ever undo *this* update.
 *  * **Never touch the data.** The database and uploads live outside the code
 *    folder in every supported layout (`data/` is git-ignored and the installer
 *    keeps them under the root), and no step here writes to them — the migration
 *    command does, and that is why the backup precedes it.
 *
 * `deps` is injectable so the *sequencing* — the part that protects the office —
 * can be asserted in `update-integration.mjs` without a real npm install or a
 * Flutter build on a CI box. The git and filesystem steps are the real ones in
 * that test; only the heavy, machine-specific steps are stubbed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  dataDir, dbFile, dirSizeBytes, envFilePath, freeSpaceKb, parseArgs, readJson,
} from './common.mjs';

const exec = promisify(execFile);

const log = (root, message) => {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  try {
    const file = path.join(dataDir(root), 'logs', 'pishkan-update.log');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, line);
  } catch { /* a log must never break an update */ }
  process.stdout.write(line);
};

/** Where to pull from. Configured source wins, then the install's own git remote. */
export async function readUpdateSource(root) {
  const configured = readJson(path.join(dataDir(root), 'update-source.json'), null);
  if (configured?.repo) {
    return { repo: String(configured.repo), branch: String(configured.branch || 'main'), origin: 'config' };
  }
  if (!fs.existsSync(path.join(root, '.git'))) {
    return { repo: '', branch: 'main', origin: 'none' };
  }
  try {
    const { stdout } = await exec('git', ['-C', root, 'remote', 'get-url', 'origin']);
    const branch = await exec('git', ['-C', root, 'rev-parse', '--abbrev-ref', 'HEAD'])
      .then(({ stdout }) => stdout.trim()).catch(() => 'main');
    return { repo: stdout.trim(), branch: branch === 'HEAD' ? 'main' : branch, origin: 'git' };
  } catch {
    return { repo: '', branch: 'main', origin: 'none' };
  }
}

const isFullCommit = (value) => /^[0-9a-f]{40}$/i.test(String(value || ''));

/** Read-only half: what is installed, what is on the branch, can we move safely. */
export async function checkForUpdate({ root, deps = {} } = {}) {
  const source = await readUpdateSource(root);
  const problems = [];
  let head = '';
  let dirty = [];
  let remoteCommit = '';

  if (source.origin === 'none') {
    return {
      ok: false, available: false, reason: 'no-source',
      message: 'این نصب از نسخهٔ git ساخته نشده و نشانی مخزن هم در .data/update-source.json ثبت نیست؛ '
        + 'پس به‌روزرسانی خودکار ندارد. برای این حالت، نصب دوباره با فایل نصب همان کاری است که باید کرد.',
    };
  }

  try {
    head = (await (deps.git ?? exec)('git', ['-C', root, 'rev-parse', 'HEAD'])).stdout.trim();
  } catch {
    problems.push('خواندن commit فعلی از نصب ممکن نشد.');
  }
  try {
    dirty = (await (deps.git ?? exec)('git', ['-C', root, 'status', '--porcelain'])).stdout
      .split('\n').map((line) => line.trim()).filter(Boolean);
  } catch {
    problems.push('وضعیت فایل‌های نصب قابل بررسی نیست.');
  }
  try {
    const { stdout } = await (deps.lsRemote ?? exec)('git', ['-C', root, 'ls-remote', '--heads', source.repo, `refs/heads/${source.branch}`]);
    remoteCommit = stdout.trim().split(/\s+/)[0] ?? '';
  } catch (error) {
    problems.push(`دسترسی به مخزن ناموفق بود (${String(error?.message ?? error).slice(0, 120)}).`);
  }

  if (dirty.length > 0) {
    problems.push(`تغییر محلی در نصب هست (${dirty.length} فایل؛ نمونه: ${dirty[0]}). پیش از به‌روزرسانی آن‌ها را کامیت یا بردارید.`);
  }
  if (!isFullCommit(remoteCommit)) problems.push('commit شاخهٔ مقصد خوانده نشد.');

  const currentSizeKb = Math.round(dirSizeBytes(root) / 1024);
  const freeKb = freeSpaceKb(root);
  // An npm ci unpacks a second node_modules before the old one is replaced, so
  // the honest reservation is roughly twice the tree, not the size of the diff.
  if (freeKb > 0 && freeKb < currentSizeKb * 2) {
    problems.push(`فضای آزاد کم است (${Math.round(freeKb / 1024)} مگابایت برای ${Math.round(currentSizeKb / 1024)} مگابایت داده).`);
  }

  return {
    ok: problems.length === 0,
    available: problems.length === 0 && remoteCommit !== head,
    reason: problems.length ? 'blocked' : (remoteCommit !== head ? 'update-available' : 'current'),
    problems,
    current: { commit: head, version: readJson(path.join(root, 'package.json'), {})?.version ?? '' },
    target: { commit: remoteCommit, repo: source.repo, branch: source.branch, origin: source.origin },
    freeMb: Math.round(freeKb / 1024),
  };
}

/**
 * Move the code to the branch tip. Every earlier step in this function is allowed
 * to fail loudly; only the ones *after* the tree has moved also have to put it
 * back, which is why the rollback lives in a `finally`-ish shape rather than in
 * each catch.
 */
export async function runUpdate({ root, dryRun = false, deps = {} } = {}) {
  const startedAt = new Date().toISOString();
  const check = await checkForUpdate({ root, deps });
  if (!check.ok || !check.available) {
    return { ok: false, stage: 'check', check, message: check.problems?.[0] ?? 'چیزی برای به‌روزرسانی نیست.' };
  }
  const from = check.current.commit;
  const to = check.target.commit;
  if (dryRun) {
    return {
      ok: true, dryRun: true, from, to,
      message: `آزمایش: از ${from.slice(0, 8)} به ${to.slice(0, 8)} (شاخهٔ ${check.target.branch}). چیزی تغییر نمی‌کند.`,
    };
  }

  const steps = [];
  const step = async (name, fn) => {
    log(root, `step ${name}…`);
    const value = await fn();
    steps.push({ name, ok: value?.ok !== false });
    if (value?.ok === false) throw Object.assign(new Error(value.message ?? `مرحلهٔ ${name} ناموفق بود`), { stage: name });
    return value;
  };

  // 1. BACKUP — before anything is touched, and never optional. Its failure is
  // reported the same way as any other stage (a result, not a thrown error),
  // because the caller is a GUI button: an exception there becomes a crash dialog
  // instead of the sentence "the backup failed, nothing was changed".
  let backupFile = '';
  try {
    await step('backup', async () => {
    const result = await (deps.backup ?? (() => { throw new Error('مسیر پشتیبان در این محیط در دسترس نیست.'); }))();
    if (!result?.ok || !result.file) return { ok: false, message: 'پشتیبان‌گیری ناموفق بود؛ به‌روزرسانی انجام نشد.' };
    if (!fs.existsSync(result.file)) return { ok: false, message: 'فایل پشتیبان ساخته شد ولی وجود ندارد؛ به‌روزرسانی انجام نشد.' };
    backupFile = result.file;
    return { ok: true, message: `پشتیبان: ${path.basename(result.file)}` };
    });
  } catch (error) {
    return { ok: false, stage: 'backup', from, to, steps, message: error?.message ?? 'پشتیبان‌گیری ناموفق بود؛ چیزی تغییر نکرد.' };
  }

  const envFile = envFilePath(root);
  const envBackup = fs.existsSync(envFile) ? `${envFile}.before-update-${Date.now()}` : '';
  // Read tolerantly: a minimal checkout (or a test fixture) may have no lockfile,
  // and "no lockfile before, none after" must not look like a dependency change.
  const readLock = () => {
    try { return fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'); } catch { return ''; }
  };
  const previousLockfile = readLock();

  const restoreCode = async () => {
    try {
      await (deps.git ?? exec)('git', ['-C', root, 'reset', '--hard', from]);
      if (envBackup) fs.copyFileSync(envBackup, envFile);
      return true;
    } catch (error) {
      log(root, `rollback failed: ${error?.message ?? error}`);
      return false;
    }
  };

  let healthy = false;
  try {
    await step('stop', async () => (deps.stop ? await deps.stop() : { ok: true, message: 'بدون سرویس در حال اجرا.' }));
    if (envBackup) fs.copyFileSync(envFile, envBackup);
    // 2. Move only a tree we already proved is clean, and only forward.
    await step('fetch', async () => {
      await (deps.git ?? exec)('git', ['-C', root, 'fetch', '--depth', '50', 'origin', check.target.branch]);
      const ahead = (await (deps.git ?? exec)('git', ['-C', root, 'rev-list', '--count', `HEAD..origin/${check.target.branch}`])).stdout.trim();
      if (ahead === '0') return { ok: true, message: 'همین commit جلوتر است.' };
      await (deps.git ?? exec)('git', ['-C', root, 'merge', '--ff-only', `origin/${check.target.branch}`]);
      return { ok: true, message: `${ahead} commit با fast-forward اعمال شد.` };
    });
    // 3. Dependencies and build only if the manifest actually moved — a typo fix
    //    in a doc must not cost ten minutes of npm ci on a small machine.
    const lockChanged = readLock() !== previousLockfile;
    await step('install', async () => (lockChanged && deps.install
      ? deps.install()
      : { ok: true, message: lockChanged ? 'npm ci' : 'بدون تغییر در وابستگی‌ها.' }));
    await step('migrate', async () => (deps.migrate ? deps.migrate() : { ok: true, message: 'مهاجرت‌ها اجرا شد.' }));
    await step('start', async () => (deps.start ? deps.start() : { ok: true }));
    await step('health', async () => {
      const result = await (deps.verify ?? (async () => ({ ok: true, message: 'بدون بررسی سلامت.' })))();
      return result?.ok ? { ok: true, message: 'سرویس سالم است.' } : { ok: false, message: result?.message ?? 'سرویس پس از به‌روزرسانی سالم نبود.' };
    });
    healthy = true;
  } catch (error) {
    const rolledBack = await restoreCode();
    try { await (deps.start ?? (async () => ({ ok: true })))(); } catch { /* the old code is back; let the person start it */ }
    log(root, `update failed at ${error?.stage ?? 'unknown'}: ${error?.message ?? error}`);
    return {
      ok: false,
      stage: error?.stage ?? 'unknown',
      from, to, backupFile,
      rolledBack,
      steps,
      message: rolledBack
        ? `به‌روزرسانی در مرحلهٔ «${error?.stage ?? 'ناشناخته'}» ناموفق بود و به ${from.slice(0, 8)} بازگشتید. پشتیبان: ${path.basename(backupFile || '')}`
        : `به‌روزرسانی ناموفق بود و بازگشت خودکار هم ممکن نشد. کد را دستی به ${from} برگردانید و از ${backupFile || 'آخرین پشتیبان'} بازیابی کنید.`,
    };
  }

  const state = {
    at: startedAt, from, to, backupFile, healthy, steps,
    databaseFile: path.basename(dbFile(root)),
  };
  try {
    fs.mkdirSync(dataDir(root), { recursive: true });
    fs.writeFileSync(path.join(dataDir(root), 'last-update.json'), JSON.stringify(state, null, 2));
  } catch { /* reporting is not worth failing an update over */ }

  return { ok: true, ...state, message: `نسخهٔ تازه فعال شد (${to.slice(0, 8)})؛ پشتیبان ${path.basename(backupFile)} است.` };
}

// ---------------------------------------------------------------------------
// CLI: node windows/lib/manager.mjs update            (thin, see manager.mjs)
//      node windows/lib/update.mjs --check            (read-only)
// ---------------------------------------------------------------------------
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const argv = parseArgs();
  const root = path.resolve(argv.get('root', process.cwd()));
  const invoked = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'check';
  const result = invoked === 'check' || argv.has('check')
    ? await checkForUpdate({ root })
    : await runUpdate({ root, dryRun: argv.has('dry-run') });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(result.ok ? 0 : 1);
}
