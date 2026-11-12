#!/usr/bin/env node
/**
 * End-to-end test of the public-tunnel path (Microsoft Dev Tunnels).
 *
 * The real `devtunnel.exe` only exists on Windows, but the parts that can break
 * silently are all plain Node: capturing the URL out of the CLI's stdout,
 * flipping COOKIE_SECURE / CORS_ORIGINS / APP_URL, adopting an already-running
 * host instead of spawning a second one, and restoring loopback on shutdown.
 *
 * This replaces the CLI with a fake that honours the same contract (documented
 * in docs/DEV-TUNNELS-ROADMAP-FA.md and in the official CLI reference), then
 * drives the same functions the installer and the manager call:
 *
 *   node windows/lib/tunnel-integration.mjs
 *
 * Exit code 0 = every check passed.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { tunnelEnvOverrides, tunnelIsConfigured } from './devtunnel.mjs';
import { loginDeviceCode, startHosting, stopHosting, tunnelStatus } from './devtunnel-control.mjs';
import { readEnvFile, upsertEnvFile } from './envfile.mjs';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

/** A stand-in for devtunnel.exe that behaves like the real one where it counts. */
const FAKE_CLI = `#!/usr/bin/env node
const argv = process.argv.slice(2);
if (argv[0] === '--version') { console.log('Tunnels CLI 3.0.0 (fake)'); process.exit(0); }
if (argv[0] === 'user' && argv[1] === 'show') { console.log('Logged in as demo@example.com'); process.exit(0); }
if (argv[0] === 'show') { console.log('Tunnel ID: ' + argv[1]); process.exit(0); }
if (argv[0] === 'port' && argv[1] === 'list') { console.log('Port: 3000'); process.exit(0); }
if (argv[0] === 'host') {
  // The real CLI prints the URL, then stays connected to the relay forever.
  console.log('Hosting port 3000 at https://fake1234-3000.usw2.devtunnels.ms/');
  console.log('Connect via browser: https://fake1234-3000.usw2.devtunnels.ms');
  setInterval(function () {}, 60000);
} else {
  process.exit(0);
}
`;

const PORT = 3210;
const ORIGIN = 'https://fake1234-3000.usw2.devtunnels.ms';
const results = [];
function check(label, ok, detail = '') {
  results.push({ label, ok: Boolean(ok), detail });
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}: ${label}${ok ? '' : ` — ${detail}`}\n`);
}

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pishkan-tunnel-e2e-'));
  fs.mkdirSync(path.join(root, 'windows', 'bin'), { recursive: true });
  fs.mkdirSync(path.join(root, '.data', 'logs'), { recursive: true });
  const bin = path.join(root, 'windows', 'bin', 'devtunnel');
  fs.writeFileSync(bin, FAKE_CLI, { mode: 0o755 });
  fs.writeFileSync(path.join(root, '.env.windows.local'), [
    'NODE_ENV="development"',
    'DB_DRIVER="sqlite"',
    'HOST="127.0.0.1"',
    'LAN_ACCESS="false"',
    `PORT="${PORT}"`,
    `APP_URL="http://127.0.0.1:${PORT}"`,
    `API_URL="http://127.0.0.1:${PORT}"`,
    // A custom domain is present on purpose: enabling the tunnel must not drop
    // origins the operator added themselves.
    `CORS_ORIGINS="http://127.0.0.1:${PORT},https://erp.example.ir"`,
    'COOKIE_SECURE="false"',
    'APP_ENCRYPTION_KEY="0123456789abcdef0123456789abcdef"',
  ].join('\n') + '\n');
  return root;
}

const root = makeRoot();
const envFile = path.join(root, '.env.windows.local');

try {
  // ---------------------------------------------------------------- status
  const before = tunnelStatus(root);
  check('CLI is detected as installed', before.installed === true, JSON.stringify(before));
  check('signed-in account is read', before.loggedIn && before.account.includes('@'), before.account);
  check('reports not running before host', before.running === false);

  // ------------------------------------------------------------------ host
  const hosted = await startHosting(root, { port: PORT, log: () => {} });
  check('public URL captured from CLI output', hosted.publicUrl === ORIGIN, JSON.stringify(hosted));
  check('inspect URL is derived separately', hosted.inspectUrl === ORIGIN.replace('-3000.', '-3000-inspect.'), hosted.inspectUrl);

  // -------------------------------------------------------------- settings
  const existing = readEnvFile(envFile);
  upsertEnvFile(envFile, tunnelEnvOverrides({
    publicUrl: hosted.publicUrl,
    port: PORT,
    lanAccess: false,
    enabled: true,
    extraOrigins: String(existing.CORS_ORIGINS).split(','),
  }));
  const on = readEnvFile(envFile);
  check('COOKIE_SECURE flips to true for HTTPS', on.COOKIE_SECURE === 'true', on.COOKIE_SECURE);
  check('APP_URL points at the tunnel', on.APP_URL === ORIGIN, on.APP_URL);
  check('tunnel origin added to CORS_ORIGINS', on.CORS_ORIGINS.includes(ORIGIN), on.CORS_ORIGINS);
  check('operator custom origin preserved', on.CORS_ORIGINS.includes('https://erp.example.ir'), on.CORS_ORIGINS);
  check('loopback origin still allowed', on.CORS_ORIGINS.includes(`http://127.0.0.1:${PORT}`), on.CORS_ORIGINS);
  check('tunnelIsConfigured() agrees', tunnelIsConfigured(on) === true);
  check('unrelated settings untouched', on.PORT === String(PORT) && on.APP_ENCRYPTION_KEY.length === 32);

  // --------------------------------------------------------------- running
  const running = tunnelStatus(root);
  check('status sees the tunnel running', running.running === true && running.publicUrl === ORIGIN, JSON.stringify(running));

  // A second start must adopt, not spawn: two hosts on one tunnel is the
  // documented cause of intermittent 502s.
  const again = await startHosting(root, { port: PORT, log: () => {} });
  check('second start adopts the live host', again.alreadyRunning === true && again.pid === hosted.pid, JSON.stringify(again));

  // ------------------------------------------------------------- shutdown
  const remaining = String(on.CORS_ORIGINS).split(',').filter((origin) => origin && !/devtunnels\.ms/i.test(origin));
  upsertEnvFile(envFile, tunnelEnvOverrides({
    publicUrl: '', port: PORT, lanAccess: false, enabled: false, extraOrigins: remaining,
  }));
  stopHosting(root, { log: () => {} });
  const off = readEnvFile(envFile);
  check('COOKIE_SECURE restored to false', off.COOKIE_SECURE === 'false', off.COOKIE_SECURE);
  check('APP_URL restored to loopback', off.APP_URL === `http://127.0.0.1:${PORT}`, off.APP_URL);
  check('no devtunnels origin left behind', !/devtunnels/.test(off.CORS_ORIGINS), off.CORS_ORIGINS);
  check('custom origin survives disabling', off.CORS_ORIGINS.includes('https://erp.example.ir'), off.CORS_ORIGINS);
  check('status reports stopped', tunnelStatus(root).running === false);

  // ------------------------------------------------------- device-code login
  // The one flow where output must be streamed, not captured: a code printed
  // and shown only after the process exits would already be expired.
  const codeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pishkan-tunnel-code-'));
  fs.mkdirSync(path.join(codeRoot, 'windows', 'bin'), { recursive: true });
  fs.mkdirSync(path.join(codeRoot, '.data', 'logs'), { recursive: true });
  const codeBin = path.join(codeRoot, 'windows', 'bin', 'devtunnel');
  fs.writeFileSync(codeBin, `#!/usr/bin/env node
if (process.argv[2] === 'user' && process.argv[3] === 'login') {
  console.log('open https://microsoft.com/devicelogin and enter ABCD-1234');
  setTimeout(function () { console.log('Logged in as dev@example.com'); process.exit(0); }, 600);
} else if (process.argv[2] === 'user' && process.argv[3] === 'show') {
  console.log('Logged in as dev@example.com');
} else { process.exit(0); }
`, { mode: 0o755 });
  const lines = [];
  const startedAt = Date.now();
  const login = await loginDeviceCode(codeRoot, {
    log: (line) => lines.push({ at: Date.now() - startedAt, line }),
    timeoutMs: 5_000,
  });
  const code = lines.find((entry) => entry.line.includes('ABCD-1234'));
  check('device code is streamed before the wait ends', Boolean(code && code.at < 400), JSON.stringify(lines));
  check('device-code login reports success', login.ok === true, JSON.stringify(login));
  fs.rmSync(codeRoot, { recursive: true, force: true });

  // ---------------------------------------------------------------- secrets
  const stateText = fs.readFileSync(path.join(root, '.data', 'devtunnel.json'), 'utf8');
  check('state file contains no token or password', !/token|password|secret/i.test(stateText), stateText);
  check('module dir resolves', fs.existsSync(path.join(MODULE_DIR, 'devtunnel.mjs')));
} finally {
  // Never leave a fake host process behind, even when a check throws.
  try { stopHosting(root, { log: () => {} }); } catch { /* best effort */ }
  fs.rmSync(root, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
process.stdout.write(`\n${results.length - failed.length}/${results.length} بررسی تونل عمومی موفق بود.\n`);
process.exit(failed.length ? 1 : 0);
