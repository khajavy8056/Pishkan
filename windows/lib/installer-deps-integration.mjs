#!/usr/bin/env node
// Slow integration regression: copies the repository AND node_modules to an
// isolated temp directory, runs the real installer/npm/build/SQLite/server, and
// stops the server afterwards. Requires Node 22, an installed tree, and npm
// registry access (or a warm cache). Run: node windows/lib/installer-deps-integration.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findFreePort } from './common.mjs';

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
assert.ok(fs.existsSync(path.join(source, 'node_modules/adm-zip/package.json')), 'Install dependencies before running this test');
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'pishkan-deps-integration-'));
const port = await findFreePort(45170);
assert.ok(port, 'No free test port');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
function execute(command, args, options = {}) {
  return spawnSync(command, args, { cwd: fixture, encoding: 'utf8', timeout: 20 * 60_000, maxBuffer: 20 * 1024 * 1024,
    shell: process.platform === 'win32' && command === npm, ...options });
}
function installer(extra = [], env = {}) {
  const result = execute(process.execPath, ['windows/lib/installer.mjs', '--root', fixture, '--skip-checks', '--skip-network', '--json-lines', '--job-stdin', ...extra], {
    input: JSON.stringify({ port, admin: { username: 'integrationadmin', password: 'TestPass1234!', fullName: 'Test Admin' } }),
    env: { ...process.env, ...env },
  });
  const events = (result.stdout || '').split('\n').filter(Boolean).map((line) => JSON.parse(line));
  const final = events.findLast((event) => event.type === 'result');
  assert.ok(final, `Installer did not report a result: ${result.error || result.stderr}`);
  return { result, events, final };
}
function assertSuccess(run) {
  assert.equal(run.result.status, 0, JSON.stringify(run.final));
  assert.equal(run.final.ok, true, JSON.stringify(run.final));
  for (const id of ['deps', 'build', 'database', 'start', 'verify']) {
    assert.ok(run.events.some((event) => event.type === 'step' && event.id === id && event.status === 'ok'), `Missing successful ${id} step`);
  }
}
function stop() {
  const result = execute(process.execPath, ['windows/lib/manager.mjs', 'stop', '--root', fixture, '--json']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
}
function packagePath(name) { return path.join(fixture, 'node_modules', name); }
try {
  const exclude = new Set(['.git', 'node_modules', '.data', 'dist', 'build', 'coverage', '.next', '.dart_tool', '.gradle']);
  fs.cpSync(source, fixture, { recursive: true, verbatimSymlinks: true, filter: (src) => {
    if (src === source) return true;
    const name = path.basename(src);
    return !exclude.has(name) && !name.startsWith('.env');
  } });
  fs.cpSync(path.join(source, 'node_modules'), path.join(fixture, 'node_modules'), { recursive: true, verbatimSymlinks: true });
  fs.mkdirSync(path.join(fixture, '.data/uploads/public'), { recursive: true });
  fs.mkdirSync(path.join(fixture, '.data/backups'), { recursive: true });
  fs.writeFileSync(path.join(fixture, '.data/uploads/public/user-sentinel.txt'), 'keep upload');
  fs.writeFileSync(path.join(fixture, '.data/backups/user-sentinel.txt'), 'keep backup');
  fs.writeFileSync(path.join(fixture, '.env.windows.local'), 'CUSTOM_SENTINEL=keep-setting\n');
  fs.rmSync(packagePath('adm-zip'), { recursive: true });
  fs.rmSync(packagePath('@types/adm-zip'), { recursive: true });
  assert.ok(fs.readdirSync(path.join(fixture, 'node_modules')).length > 500, 'Fixture must contain a large but incomplete tree');
  let run = installer();
  assertSuccess(run);
  assert.ok(run.events.some((e) => e.id === 'deps' && e.status === 'running' && /npm install/.test(e.message)));
  assert.ok(fs.existsSync(packagePath('adm-zip/adm-zip.js')));
  assert.ok(fs.existsSync(packagePath('@types/adm-zip/index.d.ts')));
  assert.ok(fs.existsSync(path.join(fixture, 'apps/api/dist/index.js')));
  assert.ok(fs.existsSync(path.join(fixture, 'apps/web/dist/index.html')));
  stop();
  console.log('PASS: incomplete large tree repaired; both workspaces built and real server verified');
  const seedDb = execute(process.execPath, ['--experimental-sqlite', '-e', `const db = new (require('node:sqlite').DatabaseSync)('.data/pishkan-windows.sqlite'); db.exec("CREATE TABLE integration_sentinel(value TEXT); INSERT INTO integration_sentinel VALUES ('keep row')"); db.close();`]);
  assert.equal(seedDb.status, 0, seedDb.stderr);

  // A present package.json can fool both npm install and npm ls even though its
  // declaration file is gone. The build must trigger one clean npm ci recovery.
  fs.rmSync(packagePath('@types/adm-zip/index.d.ts'));
  const skipped = installer(['--skip-deps', '--no-start']);
  assert.equal(skipped.final.ok, false);
  assert.equal(skipped.final.error.step, 'build');
  assert.ok(skipped.events.some((e) => e.id === 'deps' && e.status === 'skip'));
  assert.ok(!fs.existsSync(packagePath('@types/adm-zip/index.d.ts')), '--skip-deps must not repair the tree');
  console.log('PASS: explicit --skip-deps does not trigger automatic recovery');
  run = installer();
  assertSuccess(run);
  assert.ok(run.events.some((e) => e.id === 'deps' && e.status === 'running' && /بازسازی.*npm ci/.test(e.message)), 'Missing clean recovery');
  assert.ok(fs.existsSync(packagePath('@types/adm-zip/index.d.ts')));
  stop();
  console.log('PASS: damaged file triggers one clean dependency rebuild and successful retry');

  // NODE_ENV=production must not omit build dependencies. A changed manifest is
  // reconciled with the lockfile for an existing tree. Verification is expected
  // is outside the scope of this npm check; the run is stopped before starting a server.
  const manifestFile = path.join(fixture, 'apps/api/package.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  manifest.dependencies['adm-zip'] = '0.5.16';
  fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  fs.rmSync(packagePath('@types/adm-zip'), { recursive: true });
  run = installer(['--skip-build', '--no-start'], { NODE_ENV: 'production' });
  assert.ok(run.events.some((e) => e.id === 'deps' && e.status === 'ok'), JSON.stringify(run.final));
  assert.ok(fs.existsSync(packagePath('@types/adm-zip/index.d.ts')), 'dev dependency omitted in production environment');
  const lock = JSON.parse(fs.readFileSync(path.join(fixture, 'package-lock.json'), 'utf8'));
  assert.equal(lock.packages['apps/api'].dependencies['adm-zip'], '0.5.16');
  assert.equal(run.final.ok, false);
  assert.notEqual(run.final.error.step, 'deps');
  console.log(`PASS: production environment includes dev dependencies; changed manifest and lock reconciled (later ${run.final.error.step} step failed as SQLite rejects production mode)`);

  // Exercise the fresh-tree npm ci path using the real lockfile as well.
  fs.rmSync(path.join(fixture, 'node_modules'), { recursive: true, force: true });
  run = installer(['--skip-build', '--no-start']);
  assert.ok(run.events.some((e) => e.id === 'deps' && e.status === 'running' && /npm ci/.test(e.message)));
  assert.ok(run.events.some((e) => e.id === 'deps' && e.status === 'ok'), JSON.stringify(run.final));
  assert.equal(run.final.ok, false);
  assert.equal(run.final.error.step, 'verify'); // --no-start deliberately leaves the service down
  assert.ok(fs.existsSync(packagePath('adm-zip/adm-zip.js')));
  console.log('PASS: fresh tree is installed and validated with npm ci');

  assert.equal(fs.readFileSync(path.join(fixture, '.data/uploads/public/user-sentinel.txt'), 'utf8'), 'keep upload');
  assert.equal(fs.readFileSync(path.join(fixture, '.data/backups/user-sentinel.txt'), 'utf8'), 'keep backup');
  assert.match(fs.readFileSync(path.join(fixture, '.env.windows.local'), 'utf8'), /CUSTOM_SENTINEL=keep-setting/);
  const checkDb = execute(process.execPath, ['--experimental-sqlite', '-e', `const db = new (require('node:sqlite').DatabaseSync)('.data/pishkan-windows.sqlite'); console.log(db.prepare('SELECT value FROM integration_sentinel').get().value); db.close();`]);
  assert.equal(checkDb.status, 0, checkDb.stderr);
  assert.equal(checkDb.stdout.trim(), 'keep row');
  console.log('PASS: existing database row, upload, backup and custom setting preserved');
} finally {
  // Never leave the test server running, even if an assertion fails.
  execute(process.execPath, ['windows/lib/manager.mjs', 'stop', '--root', fixture, '--json']);
  fs.rmSync(fixture, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}
