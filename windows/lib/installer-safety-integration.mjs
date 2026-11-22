#!/usr/bin/env node
// Real installer/server/SQLite safety checks in temporary isolated installations.
// Needs a built project and node_modules. May stop other running Pishkan APIs,
// just like the real installer: run only on an isolated test machine.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { controlPipePath, findFreePort } from './common.mjs';
import { upsertEnvFile } from './envfile.mjs';
import { listPishkanServers } from './owned-servers.mjs';

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
assert.ok(fs.existsSync(path.join(source, 'apps/api/dist/index.js')), 'Run npm run build first');
assert.ok(fs.existsSync(path.join(source, 'node_modules')), 'Install dependencies first');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pishkan-safety-'));
const roots = [path.join(temp, 'first install'), path.join(temp, 'second install'), path.join(temp, 'corrupt install')];
const ports = [await findFreePort(46300), await findFreePort(46310)];
assert.ok(ports.every(Boolean));
let unrelated;
function exec(command, args, options = {}) {
  return spawnSync(command, args, { cwd: source, encoding: 'utf8', timeout: 10 * 60_000, maxBuffer: 20 * 1024 * 1024, ...options });
}
function installer(root, port, job = {}, shellEnv = {}) {
  const result = exec(process.execPath, [path.join(root, 'windows/lib/installer.mjs'), '--root', root, '--skip-checks', '--skip-network', '--skip-deps', ...(job.cleanInstall ? [] : ['--skip-build']), '--json-lines', '--job-stdin'], {
    input: JSON.stringify({ port, admin: { username: 'testadmin', fullName: 'Test Admin', password: 'TestPassword123!' }, ...job }),
    env: { ...process.env, ...shellEnv },
  });
  const events = result.stdout.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const final = events.findLast((e) => e.type === 'result');
  assert.ok(final, result.stderr || String(result.error));
  return { result, events, final };
}
function manager(root, command, extra = []) {
  const result = exec(process.execPath, [path.join(root, 'windows/lib/manager.mjs'), command, '--root', root, '--json', ...extra]);
  const line = result.stdout.split('\n').find((l) => l.startsWith('RESULT_JSON:'));
  assert.ok(line, result.stderr || String(result.error));
  return JSON.parse(line.slice(12));
}
function fixture(root) {
  const exclude = new Set(['.git', 'node_modules', '.data', 'coverage', '.next', '.dart_tool', '.gradle', 'build']);
  fs.cpSync(source, root, { recursive: true, verbatimSymlinks: true, filter: (src) => src === source || (!exclude.has(path.basename(src)) && !path.basename(src).startsWith('.env')) });
  fs.symlinkSync(path.join(source, 'node_modules'), path.join(root, 'node_modules'), 'junction');
}
try {
  roots.forEach(fixture);
  const foreignDb = path.join(temp, 'unrelated.sqlite');
  fs.writeFileSync(foreignDb, 'do not touch');
  let run = installer(roots[0], ports[0], {}, { NODE_ENV: 'production', DB_DRIVER: 'postgres', SQLITE_FILE: foreignDb });
  assert.equal(run.final.ok, true, JSON.stringify(run.final));
  assert.equal(fs.readFileSync(foreignDb, 'utf8'), 'do not touch');
  assert.ok(fs.existsSync(path.join(roots[0], '.data', 'pishkan-windows.sqlite')));
  console.log('PASS: inherited database and production variables cannot redirect the local install');
  const oldFirst = manager(roots[0], 'status').pid;
  assert.ok(oldFirst);

  // A second actual API, on a different port and in a different installation.
  const config = fs.readFileSync(path.join(roots[0], '.env.windows.local'), 'utf8');
  fs.writeFileSync(path.join(roots[1], '.env.windows.local'), config);
  upsertEnvFile(path.join(roots[1], '.env.windows.local'), {
    PORT: ports[1], SQLITE_FILE: path.join(roots[1], '.data', 'pishkan-windows.sqlite'),
    UPLOAD_DIR: path.join(roots[1], '.data', 'uploads'), BACKUP_DIR: path.join(roots[1], '.data', 'backups'),
    PISHKAN_CONTROL_PIPE: controlPipePath(roots[1]),
  });
  const second = manager(roots[1], 'start');
  assert.equal(second.ok, true, second.message);
  assert.ok(second.pid && second.pid !== oldFirst);
  unrelated = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  assert.ok(unrelated.pid);
  const before = listPishkanServers();
  assert.ok(before.some((p) => p.pid === oldFirst));
  assert.ok(before.some((p) => p.pid === second.pid));

  run = installer(roots[0], ports[0]);
  assert.equal(run.final.ok, true, JSON.stringify(run.final));
  assert.equal(run.final.report.port, ports[0], 'same installation port changed');
  assert.ok(run.events.some((e) => e.type === 'log' && e.message.includes(`PID ${oldFirst}`)));
  assert.ok(run.events.some((e) => e.type === 'log' && e.message.includes(`PID ${second.pid}`)));
  const after = listPishkanServers();
  assert.ok(!after.some((p) => p.pid === oldFirst || p.pid === second.pid));
  assert.ok(after.some((p) => p.root === roots[0] && p.pid !== oldFirst));
  process.kill(unrelated.pid, 0); // No unrelated node processes must be stopped.
  console.log('PASS: two real installations stopped gracefully; new server uses original port; unrelated Node survives');
  assert.equal(manager(roots[0], 'stop').ok, true);

  // PID reuse/stale state must never terminate an unrelated Node process.
  fs.mkdirSync(path.join(roots[2], '.data'), { recursive: true });
  fs.writeFileSync(path.join(roots[2], '.data', 'pishkan-manager.json'), JSON.stringify({ root: roots[2], pid: unrelated.pid }));
  const stale = manager(roots[2], 'stop');
  assert.equal(stale.ok, false, JSON.stringify(stale));
  const refusedRestore = manager(roots[2], 'restore', ['--file', path.join(roots[0], '.data/pishkan-windows.sqlite')]);
  assert.equal(refusedRestore.ok, false, JSON.stringify(refusedRestore));
  assert.ok(!fs.existsSync(path.join(roots[2], '.data/pishkan-windows.sqlite')));
  process.kill(unrelated.pid, 0);
  fs.rmSync(path.join(roots[2], '.data', 'pishkan-manager.json'));
  console.log('PASS: stale recorded PID cannot stop an unrelated Node process or allow unsafe restore');

  // Generate a real SQLite file and truncate its interior to reproduce corruption.
  const db = path.join(roots[2], '.data', 'pishkan-windows.sqlite');
  fs.mkdirSync(path.dirname(db), { recursive: true });
  const create = exec(process.execPath, ['--experimental-sqlite', '-e', `const d=new (require('node:sqlite').DatabaseSync)(process.argv[1]);d.exec('CREATE TABLE t(v TEXT);');let s=d.prepare('INSERT INTO t VALUES (?)');for(let i=0;i<200;i++)s.run('x'.repeat(2000));d.close();`, db]);
  assert.equal(create.status, 0, create.stderr);
  const original = fs.readFileSync(db);
  fs.writeFileSync(db, original.subarray(0, original.length - 2048));
  const damaged = fs.readFileSync(db);
  fs.writeFileSync(`${db}-wal`, 'retain-wal');
  fs.writeFileSync(`${db}-shm`, 'retain-shm');
  run = installer(roots[2], ports[1]);
  assert.equal(run.final.ok, false);
  assert.equal(run.final.error.step, 'database');
  assert.match(run.final.error.message, /پایگاه داده موجود قابل تأیید نیست/);
  assert.deepEqual(fs.readFileSync(db), damaged);
  assert.equal(fs.readFileSync(`${db}-wal`, 'utf8'), 'retain-wal');
  assert.equal(fs.readFileSync(`${db}-shm`, 'utf8'), 'retain-shm');
  assert.ok(!fs.existsSync(path.join(roots[2], '.env.windows.local')), 'Corruption must be checked before writing settings');
  console.log('PASS: corrupted real SQLite is detected; DB and sidecars are not discarded or reset');

  // Only an explicit clean install may quarantine the damaged files and start over.
  fs.mkdirSync(path.join(roots[2], '.data/uploads'), { recursive: true });
  fs.mkdirSync(path.join(roots[2], '.data/backups'), { recursive: true });
  fs.writeFileSync(path.join(roots[2], '.data/uploads/old-user-file'), 'old upload');
  fs.writeFileSync(path.join(roots[2], '.data/backups/old-user-backup'), 'old backup');
  run = installer(roots[2], ports[1], { cleanInstall: true });
  assert.equal(run.final.ok, true, JSON.stringify(run.final));
  const quarantine = fs.readdirSync(path.join(roots[2], '.data')).find((n) => n.startsWith('previous-install-'));
  assert.ok(quarantine);
  const saved = path.join(roots[2], '.data', quarantine, 'pishkan-windows.sqlite');
  assert.deepEqual(fs.readFileSync(saved), damaged);
  assert.equal(fs.readFileSync(`${saved}-wal`, 'utf8'), 'retain-wal');
  assert.equal(fs.readFileSync(`${saved}-shm`, 'utf8'), 'retain-shm');
  const oldData = path.join(roots[2], '.data', quarantine, 'previous-data');
  assert.equal(fs.readFileSync(path.join(oldData, 'uploads/old-user-file'), 'utf8'), 'old upload');
  assert.equal(fs.readFileSync(path.join(oldData, 'backups/old-user-backup'), 'utf8'), 'old backup');
  assert.ok(!fs.existsSync(path.join(roots[2], '.data/uploads/old-user-file')));
  assert.ok(!fs.existsSync(path.join(roots[2], '.data/backups/old-user-backup')));
  assert.equal(manager(roots[2], 'stop').ok, true);
  console.log('PASS: explicit clean install quarantines damaged DB and WAL/SHM, then starts and verifies a fresh installation');
} finally {
  if (unrelated?.pid) { try { process.kill(unrelated.pid); } catch { /* already stopped */ } }
  for (const root of roots) {
    try { manager(root, 'stop'); } catch { /* best-effort test cleanup */ }
  }
  fs.rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}
