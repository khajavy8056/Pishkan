#!/usr/bin/env node
/**
 * The Windows updater's ordering, proved on a throwaway git repo.
 *
 * Run: node windows/lib/update-integration.mjs   (also `npm run test:windows:update`)
 *
 * A real `npm ci` and a real service can't run in CI, and the ordering is the part
 * that needs proving anyway — the four properties below are the whole safety story,
 * and each one has a plausible implementation that breaks it:
 *
 *  1. **No backup, no move.** An updater that fetches first and backs up "later if
 *     needed" loses data the moment the migration step is what fails.
 *  2. **A dirty tree is refused without touching it.** Anything else throws away
 *     the tester's local work, which on a test machine is the norm, not the edge case.
 *  3. **A failed verification puts the code back.** Otherwise "it didn't come up"
 *     becomes "we're now running half a new version".
 *  4. **Nothing to do is reported as nothing to do.** An updater that "succeeds"
 *     when already current teaches people not to read its output.
 *
 * `git` and the filesystem are the real ones — only the machine-specific heavy
 * steps (backup, start/stop, health, install) are stubbed, and the stubs record the
 * order they were called in, which is how assertion 1 is actually checked.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { checkForUpdate, runUpdate } from './update.mjs';

const results = [];
const ok = (name) => { results.push(name); process.stdout.write(`  ok   ${name}\n`); };
const fail = (name, error) => { results.push(`FAIL ${name}`); process.stdout.write(`  FAIL ${name}\n       ${error?.stack ?? error}\n`); };

function sh(file, args, cwd) {
  return execFileSync(file, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/** origin.git ← install (clean, at commit A) ← origin also holds commit B. */
function makeFixture({ dirty = false, behind = true, fresh = false } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'pishkan-update-'));
  const origin = path.join(base, 'origin.git');
  const install = path.join(base, 'install');
  // `-b main` matters: a bare repo created without it has HEAD on refs/heads/master,
  // so a clone of a pushed `main` arrives with an empty worktree and every
  // assertion below reads a unborn HEAD instead of the fixture's problem.
  sh('git', ['init', '--bare', '-q', '-b', 'main', origin]);
  if (fresh) return { base, origin, install: base };

  const seed = path.join(base, 'seed');
  fs.mkdirSync(seed, { recursive: true });
  sh('git', ['init', '-q', seed]);
  sh('git', ['-c', 'user.email=t@e', '-c', 'user.name=t', 'config', 'commit.gpgsign', 'false'], seed);
  fs.writeFileSync(path.join(seed, 'package.json'), JSON.stringify({ version: '1.0.1217' }));
  fs.mkdirSync(path.join(seed, 'apps', 'api'), { recursive: true });
  fs.writeFileSync(path.join(seed, 'README.md'), 'a\n');
  sh('git', ['add', '-A'], seed);
  sh('git', ['-c', 'user.email=t@e', '-c', 'user.name=t', 'commit', '-qm', 'A'], seed);
  sh('git', ['branch', '-M', 'main'], seed);
  sh('git', ['remote', 'add', 'origin', origin], seed);
  sh('git', ['push', '-q', 'origin', 'main'], seed);

  sh('git', ['clone', '-q', origin, install]);
  sh('git', ['-c', 'user.email=t@e', '-c', 'user.name=t', 'config', 'commit.gpgsign', 'false'], install);
  if (dirty) fs.writeFileSync(path.join(install, 'scratch-notes.txt'), 'کار محلی من\n');
  if (behind) {
    fs.writeFileSync(path.join(seed, 'README.md'), 'b\n');
    sh('git', ['add', '-A'], seed);
    sh('git', ['-c', 'user.email=t@e', '-c', 'user.name=t', 'commit', '-qm', 'B'], seed);
    sh('git', ['push', '-q', 'origin', 'main'], seed);
  }
  return { base, origin, install, head: () => sh('git', ['rev-parse', 'HEAD'], install).trim() };
}

const stubs = (calls, { backup = true, healthy = true } = {}) => ({
  backup: async () => {
    calls.push('backup');
    if (!backup) return { ok: false, message: 'پشتیبان‌گیری ناموفق' };
    const file = path.join(os.tmpdir(), `pishkan-test-backup-${Date.now()}.sqlite`);
    fs.writeFileSync(file, 'x');
    return { ok: true, file };
  },
  stop: async () => { calls.push('stop'); return { ok: true }; },
  start: async () => { calls.push('start'); return { ok: true }; },
  migrate: async () => { calls.push('migrate'); return { ok: true }; },
  install: async () => { calls.push('install'); return { ok: true }; },
  verify: async () => { calls.push('health'); return healthy ? { ok: true } : { ok: false, message: 'unhealthy' }; },
});

// 1 ────────────────────────────────────────────────────────────── clean update
{
  const fx = makeFixture();
  const calls = [];
  const check = await checkForUpdate({ root: fx.install });
  try {
    assert.equal(check.ok, true, `check should pass: ${JSON.stringify(check.problems)}`);
    assert.equal(check.available, true);
    assert.equal(check.reason, 'update-available');
    assert.equal(check.current.version, '1.0.1217', 'the installed version is read from the tree');
    const result = await runUpdate({ root: fx.install, deps: stubs(calls) });
    assert.equal(result.ok, true, result.message);
    assert.equal(result.rolledBack, undefined);
    // The order is the guarantee, not a detail.
    assert.deepEqual(calls, ['backup', 'stop', 'migrate', 'start', 'health']);
    assert.notEqual(fx.head(), check.current.commit, 'HEAD moved');
    assert.equal(fs.readFileSync(path.join(fx.install, 'README.md'), 'utf8').trim(), 'b');
    const state = JSON.parse(fs.readFileSync(path.join(fx.install, '.data', 'last-update.json'), 'utf8'));
    assert.equal(state.to, result.to);
    assert.ok(fs.existsSync(state.backupFile), 'the backup file the state points at exists');
    ok('clean install updates forward, after a verified backup');
  } catch (error) { fail('clean install updates forward, after a verified backup', error); } finally {
    fs.rmSync(fx.base, { recursive: true, force: true });
  }
}

// 2 ──────────────────────────────────────────────────────── local edits refused
{
  const fx = makeFixture({ dirty: true });
  const calls = [];
  const before = fx.head();
  try {
    const check = await checkForUpdate({ root: fx.install });
    assert.equal(check.ok, false);
    assert.ok(check.problems.some((problem) => problem.includes('scratch-notes.txt')),
      `the blocking file should be named: ${JSON.stringify(check.problems)}`);
    const result = await runUpdate({ root: fx.install, deps: stubs(calls) });
    assert.equal(result.ok, false);
    assert.equal(result.stage, 'check');
    assert.deepEqual(calls, [], 'a refused update must not have touched anything, not even a backup');
    assert.equal(fx.head(), before);
    ok('a dirty checkout is refused by name, and nothing runs');
  } catch (error) { fail('a dirty checkout is refused by name, and nothing runs', error); } finally {
    fs.rmSync(fx.base, { recursive: true, force: true });
  }
}

// 3 ───────────────────────────────────────────── backup failure stops everything
{
  const fx = makeFixture();
  const calls = [];
  const before = fx.head();
  try {
    const result = await runUpdate({ root: fx.install, deps: stubs(calls, { backup: false }) });
    assert.equal(result.ok, false);
    assert.equal(result.stage, 'backup');
    assert.deepEqual(calls, ['backup'], 'no fetch, no stop, no migrate after a failed backup');
    assert.equal(fx.head(), before, 'code untouched');
    ok('a failed backup aborts before any code moves');
  } catch (error) { fail('a failed backup aborts before any code moves', error); } finally {
    fs.rmSync(fx.base, { recursive: true, force: true });
  }
}

// 4 ────────────────────────────────────────────────── unhealthy → code goes back
{
  const fx = makeFixture();
  const calls = [];
  const before = fx.head();
  try {
    const result = await runUpdate({ root: fx.install, deps: stubs(calls, { healthy: false }) });
    assert.equal(result.ok, false);
    assert.equal(result.stage, 'health');
    assert.equal(result.rolledBack, true, result.message);
    assert.equal(fx.head(), before, 'the tree is back on the commit it started from');
    assert.ok(calls.indexOf('start') > calls.indexOf('health') || calls.lastIndexOf('start') > calls.indexOf('health'),
      'the old code is started again after the rollback');
    assert.ok(fs.existsSync(result.backupFile), 'the backup taken before the attempt is still there to restore');
    ok('a service that does not come healthy is rolled back, with the backup kept');
  } catch (error) { fail('a service that does not come healthy is rolled back, with the backup kept', error); } finally {
    fs.rmSync(fx.base, { recursive: true, force: true });
  }
}

// 5 ─────────────────────────────────────────────────────────── nothing to do
{
  const fx = makeFixture({ behind: false });
  try {
    const check = await checkForUpdate({ root: fx.install });
    assert.equal(check.available, false);
    assert.equal(check.reason, 'current');
    const result = await runUpdate({ root: fx.install, deps: stubs([]) });
    assert.equal(result.ok, false);
    assert.match(result.message, /چیزی برای به‌روزرسانی نیست|current/);
    ok('an install already at the tip says so instead of "succeeding"');
  } catch (error) { fail('an install already at the tip says so instead of "succeeding"', error); } finally {
    fs.rmSync(fx.base, { recursive: true, force: true });
  }
}

// 6 ─────────────────────────────────────────────────── a non-git install is honest
{
  const fx = makeFixture({ fresh: true });
  try {
    const check = await checkForUpdate({ root: path.join(fx.base, 'not-there') });
    assert.equal(check.ok, false);
    assert.equal(check.reason, 'no-source');
    assert.match(check.message, /update-source\.json|نسخهٔ git/);
    // …and the configured-source escape hatch works without a git dir at all.
    const target = path.join(fx.base, 'packaged');
    fs.mkdirSync(path.join(target, '.data'), { recursive: true });
    fs.writeFileSync(path.join(target, '.data', 'update-source.json'), JSON.stringify({ repo: 'git@github.com:acme/pishkan.git', branch: 'main' }));
    const source = await (await import('./update.mjs')).readUpdateSource(target);
    assert.equal(source.repo, 'git@github.com:acme/pishkan.git');
    assert.equal(source.origin, 'config');
    ok('an archive install names its source file instead of pretending');
  } catch (error) { fail('an archive install names its source file instead of pretending', error); } finally {
    fs.rmSync(fx.base, { recursive: true, force: true });
  }
}

const failed = results.filter((name) => name.startsWith('FAIL'));
process.stdout.write(`\nupdate-integration: ${results.length - failed.length} passed, ${failed.length} failed\n`);
if (failed.length) {
  process.stdout.write(`failed: ${failed.map((line) => line.replace('FAIL ', '')).join('; ')}\n`);
  process.exit(1);
}