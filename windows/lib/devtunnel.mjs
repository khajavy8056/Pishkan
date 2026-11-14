/**
 * Microsoft Dev Tunnels — the pieces the installer and the manager share.
 *
 * This file is deliberately dependency-free and side-effect-free at import
 * time: every function takes what it needs as an argument. That is what lets
 * `selftest.mjs` exercise the parsers and the config maths on Linux, where
 * `devtunnel.exe` does not exist.
 *
 * ## What a dev tunnel is
 *
 * An outbound-only relay. `devtunnel.exe` dials Microsoft's relay in Azure and
 * keeps a WebSocket open; requests that arrive at
 * `https://<id>-<port>.<region>.devtunnels.ms` are pushed down that socket to
 * `http://127.0.0.1:<port>` on this machine. Nothing listens on a public
 * interface and no firewall rule is involved, which is exactly why this works
 * from a home or office network behind NAT.
 *
 * ## Why the CLI is used and not the .NET SDK
 *
 * The Windows CLI is a single self-contained `devtunnel.exe`. There is no
 * installer, no MSI, no Administrator prompt and no runtime to add. It is
 * dropped next to the project and updated in place.
 *
 * ## What this module does NOT do
 *
 * It never stores a token. `devtunnel` caches the login in the Windows
 * credential store; the state file written here contains only the tunnel id,
 * the public URL and the account label that the CLI itself reports.
 */
import fs from 'node:fs';
import path from 'node:path';

/** Microsoft's stable "latest version" redirects, per platform. */
export const DEV_TUNNEL_DOWNLOADS = {
  'win32-x64': 'https://aka.ms/TunnelsCliDownload/win-x64',
  'win32-arm64': 'https://aka.ms/TunnelsCliDownload/win-arm64',
  'linux-x64': 'https://aka.ms/TunnelsCliDownload/linux-x64',
  'darwin-arm64': 'https://aka.ms/TunnelsCliDownload/osx-arm64-zip',
  'darwin-x64': 'https://aka.ms/TunnelsCliDownload/osx-x64-zip',
};

/**
 * Where the exe is kept: inside the project, next to the other Windows
 * helpers. Deliberately *not* %LOCALAPPDATA%: the state must travel with the
 * installation folder so a copied/moved install keeps working, and so
 * uninstalling is "delete the folder".
 */
export function tunnelBinPath(root) {
  const name = process.platform === 'win32' ? 'devtunnel.exe' : 'devtunnel';
  return path.join(root, 'windows', 'bin', name);
}

export function tunnelStatePath(root) {
  return path.join(root, '.data', 'devtunnel.json');
}

/** Installer/manager log of tunnel actions, separate from the server log. */
export function tunnelLogPath(root) {
  return path.join(root, '.data', 'logs', 'devtunnel.log');
}

export function downloadUrl(platform = process.platform, arch = process.arch) {
  return DEV_TUNNEL_DOWNLOADS[`${platform}-${arch}`] ?? null;
}

/**
 * The tunnel id this installation owns.
 *
 * Derived from the install path rather than random, so a reinstall over the
 * same folder reuses the same tunnel (and therefore the same public URL) even
 * if the state file was lost. The hash keeps two Pishkan installs on one
 * machine from fighting over one tunnel.
 */
export function tunnelName(root, crypto) {
  const normalized = path.resolve(String(root ?? '.')).replace(/\\/g, '/').toLowerCase();
  const digest = crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 8);
  // Dev tunnel ids accept letters, digits and dashes; keep it short and legible.
  return `pishkan-${digest}`;
}

/**
 * Pull the public URL out of `devtunnel host` output.
 *
 * The CLI prints several lines and the URL appears in more than one of them
 * ("Connect via browser:", the port table, and sometimes a bare line). The
 * web-forwarding URL is the one shaped `<id>-<port>.<region>.devtunnels.ms`;
 * the `-inspect` host is a different thing and must never be handed to a
 * customer.
 */
export function parseHostUrl(text) {
  const source = String(text ?? '');
  const matches = source.match(/https:\/\/[A-Za-z0-9][A-Za-z0-9.\-]*devtunnels\.ms(?::\d+)?\/?/g) ?? [];
  const usable = matches
    .map((url) => url.replace(/\/+$/, ''))
    // The inspect host exposes every request and response body; it must never
    // reach a customer, so it is dropped before any preference is applied.
    .filter((url) => !/-inspect\./.test(url));
  if (!usable.length) return '';
  // The CLI prints two equivalent forms for the same port:
  //   https://<id>.<region>.devtunnels.ms:3000   (legacy, explicit port)
  //   https://<id>-3000.<region>.devtunnels.ms   (preferred, port in the label)
  // Prefer the second: it is the form that survives being pasted into apps
  // that rewrite or drop an explicit :port, and the form the docs lead with.
  return usable.find((url) => /-\d+\.[a-z0-9]+\.devtunnels\.ms/.test(url)) ?? usable[0];
}

/** The URL that must never be shown: it exposes every request and response. */
export function inspectUrlFor(publicUrl) {
  const url = String(publicUrl ?? '');
  if (!url.includes('devtunnels.ms')) return '';
  return url.replace('://', '://').replace(/(-(\d+)\.)/, '-$2-inspect.');
}

/**
 * The three .env values that must change when the tunnel is on, and their
 * values when it is off. Returned as a plain object so the caller can decide
 * *how* to persist it: the installer writes the whole file, the manager edits
 * three keys in place.
 *
 * The reasoning for each one is in the comment beside it — they are the three
 * things that silently break a public HTTPS tunnel in front of an app that was
 * configured for plain-HTTP LAN use.
 */
export function tunnelEnvOverrides({ publicUrl, port, lanAccess, enabled, extraOrigins = [] }) {
  const base = `http://127.0.0.1:${port}`;
  // The SPA is served by the API itself, so the loopback origins are only
  // needed for the LAN/Vite cases. They are kept because dropping them would
  // break the local operator's own browser session the moment the tunnel is on.
  // `extraOrigins` carries whatever the file already allowed (a custom domain,
  // a LAN address the operator added by hand). Replacing the whole list instead
  // of merging it would break those silently, so they are preserved here.
  const unique = [...new Set([base, `http://localhost:${port}`, ...extraOrigins].filter(Boolean))];
  if (enabled && publicUrl) {
    return {
      TUNNEL_ENABLED: 'true',
      TUNNEL_URL: publicUrl,
      TUNNEL_PORT: String(port),
      // The public address is HTTPS, so the session cookie must be marked
      // Secure or browsers will refuse to send it back on the tunnel origin.
      COOKIE_SECURE: 'true',
      // The SPA and the API share one origin behind the tunnel, but the origin
      // guard compares the Origin header of every mutating request. Without the
      // tunnel host here, every POST/PUT/DELETE from the tunnel is rejected as
      // cross-site — the login form being the first casualty.
      CORS_ORIGINS: [...unique, publicUrl].join(','),
      // Used for absolute links: a customer who taps a link built from
      // 127.0.0.1 is sent to their own phone instead of this server.
      APP_URL: publicUrl,
    };
  }
  return {
    TUNNEL_ENABLED: 'false',
    TUNNEL_URL: '',
    TUNNEL_PORT: String(port),
    COOKIE_SECURE: 'false',
    CORS_ORIGINS: unique.join(','),
    APP_URL: base,
  };
}

/**
 * Is this install already in the "public tunnel" configuration? Used by the
 * manager to decide whether stopping the tunnel needs a server restart (it
 * does: COOKIE_SECURE and CORS_ORIGINS are read at boot).
 */
export function tunnelIsConfigured(env) {
  const enabled = String(env?.TUNNEL_ENABLED ?? '').toLowerCase() === 'true';
  const url = String(env?.TUNNEL_URL ?? '').trim();
  return enabled && /^https:\/\//i.test(url);
}

/* -------------------------------------------------------------------------- */
/*  process control                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Start `devtunnel host <name>` as a detached process and keep its output in a
 * log file. Detached so closing the manager window does not kill the tunnel,
 * which is the whole point: the customer's link must survive the operator
 * closing a dialog.
 *
 * Returns the pid; the caller stores it in the state file.
 */
export function startTunnelProcess({ spawn, binPath, name, root, logFile, extraArgs = [] }) {
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const out = fs.openSync(logFile, 'a');
  const child = spawn(binPath, ['host', name, ...extraArgs], {
    cwd: root,
    detached: true,
    stdio: ['ignore', out, out],
    windowsHide: true,
  });
  child.unref();
  fs.closeSync(out);
  return child.pid;
}

/**
 * Read the public URL from the tunnel log, waiting up to `timeoutMs`.
 *
 * `devtunnel host` does not print the URL immediately — it first connects to
 * the relay, then resolves the port. Polling the log is the only portable way
 * to know when it is actually ready (there is no `--json` output mode).
 */
export async function waitForTunnelUrl(logFile, { timeoutMs = 45_000, intervalMs = 600, sleep } = {}) {
  const wait = sleep ?? ((ms) => new Promise((resolve) => { setTimeout(resolve, ms); }));
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const url = parseHostUrl(readTail(logFile, 64 * 1024));
    if (url) return url;
    await wait(intervalMs);
  }
  return '';
}

export function readTail(file, maxBytes = 64 * 1024) {
  try {
    const stats = fs.statSync(file);
    const start = Math.max(0, stats.size - maxBytes);
    const buffer = Buffer.alloc(stats.size - start);
    const fd = fs.openSync(file, 'r');
    try { fs.readSync(fd, buffer, 0, buffer.length, start); } finally { fs.closeSync(fd); }
    return buffer.toString('utf8');
  } catch {
    return '';
  }
}

/**
 * Best-effort check that a pid is the tunnel we started and not a recycled
 * number. We cannot read the command line without extra tooling, so this
 * checks liveness only and the caller re-verifies by asking the CLI itself.
 */
export function pidLikelyAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

/* -------------------------------------------------------------------------- */
/*  state                                                                     */
/* -------------------------------------------------------------------------- */

export function readTunnelState(root) {
  try {
    return JSON.parse(fs.readFileSync(tunnelStatePath(root), 'utf8'));
  } catch {
    return null;
  }
}

export function writeTunnelState(root, value) {
  const file = tunnelStatePath(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return file;
}

/**
 * Never persist anything secret. The CLI keeps the login token in the Windows
 * credential vault; this is the allow-list of what may be written to disk.
 */
export function sanitizeTunnelState(input) {
  return {
    ok: Boolean(input?.ok),
    tunnelName: String(input?.tunnelName ?? ''),
    publicUrl: String(input?.publicUrl ?? ''),
    port: Number(input?.port) || 0,
    pid: Number(input?.pid) || 0,
    startedAt: String(input?.startedAt ?? ''),
    account: String(input?.account ?? ''),
    message: String(input?.message ?? ''),
    updatedAt: new Date().toISOString(),
  };
}
