import fs from 'node:fs';
import net from 'node:net';
import { env, assertProductionSafety } from './env.js';
import { createApp } from './http/app.js';
import { closeDb, getDb } from './db/index.js';
import { migrate } from './db/migrate.js';
import { ensureSettingDefaults } from './modules/settings/service.js';
import { ensureAdmin, upsertRolesOnly, seedCatalog, syncSystemRolePermissions } from './modules/catalog/seed.js';
import { ensureMediaDirs, recoverStuckMedia } from './modules/media/service.js';
import { isLanFirewallLeaseValid, isLanStrictMode, resolveListenHost } from './lib/server-bind.js';
import { safeErrorText } from './lib/safe-log.js';
import { startMetricsCollector, stopMetricsCollector } from './modules/monitoring/metrics.js';
import { evaluateAlerts } from './modules/monitoring/alerts.js';
import { startAlertScheduler, stopAlertScheduler } from './modules/monitoring/scheduler.js';
import { startAssignmentScheduler, stopAssignmentScheduler } from './modules/requests/scheduler.js';
import { startBackupScheduler, stopBackupScheduler } from './modules/system/scheduler.js';
import { setMinimumLevel } from './modules/logging/service.js';
import { getString } from './modules/settings/service.js';

async function bootstrap() {
  const problems = assertProductionSafety();
  if (problems.length) {
    console.error('[boot] unsafe production configuration:');
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }

  fs.mkdirSync(env.uploadDir, { recursive: true });
  fs.mkdirSync(env.backupDir, { recursive: true });
  ensureMediaDirs();

  await getDb();
  const applied = await migrate({ log: (m) => console.log(`[boot] ${m}`) });
  if (applied.applied.length) console.log(`[boot] applied ${applied.applied.length} migration(s)`);

  // Resume image jobs interrupted by a crash or deploy. Never blocks startup.
  recoverStuckMedia({ log: (m) => console.log(`[boot] ${m}`) })
    .catch((err) => console.error(`[boot] media recovery failed: ${safeErrorText(err)}`));

  await ensureSettingDefaults();
  await upsertRolesOnly();
  const upgradedRoles = await syncSystemRolePermissions();
  if (upgradedRoles) console.log(`[boot] roles: ${upgradedRoles} system role(s) received the wallet/monitoring permission set`);
  await seedCatalog((m) => console.log(`[boot] ${m}`));
  // Starter banners for the customer app on a completely fresh install
  // (no-op afterwards; the same idempotent pattern as the catalogue seed).
  const { seedDefaultBanners, upgradeStarterBanners } = await import('./modules/mobile/service.js');
  await seedDefaultBanners((m) => console.log(`[boot] ${m}`)).catch((error) => {
    console.error(`[boot] starter banners failed: ${safeErrorText(error)}`);
  });
  // An install seeded before the five-slide set keeps its first-generation
  // cards until this runs once. Idempotent, and it only rewrites cards the
  // office has never edited.
  await upgradeStarterBanners((m) => console.log(`[boot] ${m}`)).catch((error) => {
    console.error(`[boot] starter banner upgrade failed: ${safeErrorText(error)}`);
  });
  // Requirements seeded before they carried a `documentType` cannot be matched
  // to anything in the customer's archive, so «ذخیره مدارک» looks like it did
  // nothing and every new request asks for the same national card again. This
  // files the types the titles already imply. Idempotent; it never overwrites a
  // type the office set by hand.
  const { backfillServiceDocumentTypes } = await import('./modules/catalog/service.js');
  await backfillServiceDocumentTypes((m) => console.log(`[boot] ${m}`)).catch((error) => {
    console.error(`[boot] document type backfill failed: ${safeErrorText(error)}`);
  });
  setMinimumLevel(await getString('monitoring.log_level').catch(() => 'INFO'));

  if (env.bootstrapAdmin.username && env.bootstrapAdmin.password) {
    await ensureAdmin(
      {
        username: env.bootstrapAdmin.username,
        password: env.bootstrapAdmin.password,
        fullName: env.bootstrapAdmin.fullName,
        mobile: env.bootstrapAdmin.mobile,
      },
      (m) => console.log(`[boot] ${m}`),
    );
  }

  const app = await createApp();
  // Simple LAN mode (default): an explicit installer opt-in
  // (HOST=0.0.0.0 + LAN_ACCESS=true) is enough to serve the office Wi-Fi; the
  // firewall rule is best-effort and must never stop the service. Strict mode
  // (PISHKAN_LAN_STRICT=true) keeps the original fail-closed behaviour where
  // the launcher must continuously refresh a verified firewall lease.
  const lanStrict = isLanStrictMode();
  const lanAccessRequested = process.platform === 'win32'
    && env.host.trim().toLowerCase() === '0.0.0.0'
    && process.env.LAN_ACCESS?.trim().toLowerCase() === 'true';
  const firewallLeaseFile = process.env.PISHKAN_LAN_FIREWALL_STATUS_FILE;
  const firewallLeaseToken = process.env.PISHKAN_LAN_FIREWALL_TOKEN;
  const firewallLeasePort = Number(process.env.PISHKAN_LAN_FIREWALL_PORT ?? env.port);
  const firewallLeaseValid = () => firewallLeasePort === env.port && isLanFirewallLeaseValid(
    firewallLeaseFile, firewallLeaseToken, firewallLeasePort,
  );
  const listenHost = resolveListenHost(env.host);
  if (lanStrict && lanAccessRequested && (listenHost !== '0.0.0.0' || !firewallLeaseValid())) {
    throw new Error('Strict LAN mode: the Windows firewall verification lease is missing, expired, or invalid.');
  }
  if (listenHost !== env.host) {
    console.warn('[boot] Windows safety: binding to loopback because LAN opt-in was not fully present.');
  } else if (!lanStrict && lanAccessRequested && listenHost === '0.0.0.0') {
    console.log('[boot] LAN simple mode: serving the local network on 0.0.0.0 (sign-in required; firewall rule is best-effort).');
  }
  // Monitoring runs in-process: one metric sample per interval plus the alert
  // evaluator. Both are unref'd so they never keep a test process alive.
  await startMetricsCollector().catch((error) => {
    console.error(`[boot] metrics collector failed: ${safeErrorText(error)}`);
  });
  startAlertScheduler();
  startAssignmentScheduler();
  startBackupScheduler();
  await evaluateAlerts({ notify: true }).catch((error) => {
    console.error(`[boot] alert evaluation failed: ${safeErrorText(error)}`);
  });

  const server = app.listen(env.port, listenHost, () => {
    console.log(`[boot] Pishkan API ${env.version} listening on http://${listenHost}:${env.port} (${env.nodeEnv}, db=${env.dbDriver})`);
  });
  server.on('error', (error) => {
    // e.g. EADDRINUSE from a leftover process: land a clear line in the error
    // log (which the Windows manager now surfaces) instead of a bare stack.
    console.error(`[boot] server error: ${safeErrorText(error)}`);
    process.exit(1);
  });

  let shuttingDown = false;
  let leaseTimer: NodeJS.Timeout | null = null;
  const shutdown = (signal: string, exitCode = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (leaseTimer) clearInterval(leaseTimer);
    stopMetricsCollector();
    stopAlertScheduler();
    stopAssignmentScheduler();
    stopBackupScheduler();
    console.log(`[shutdown] received ${signal}`);
    server.close(() => {
      void closeDb().catch(() => undefined).finally(() => process.exit(exitCode));
    });
    if (exitCode !== 0) server.closeAllConnections?.();
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  // Strict mode only: PowerShell/Windows Firewall inspection remains in the
  // Windows launcher. The cross-platform API trusts its short-lived lease and
  // closes the listener if that independent watchdog stops refreshing it. In
  // the default simple mode nothing here can shut the office service down.
  if (lanStrict && lanAccessRequested && listenHost === '0.0.0.0') {
    leaseTimer = setInterval(() => {
      if (firewallLeaseValid() || shuttingDown) return;
      console.error('[boot] Windows safety: firewall lease expired; closing the LAN listener.');
      shutdown('firewall-lease', 1);
    }, 1_000);
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  /**
   * Optional local control channel (`PISHKAN_CONTROL_PIPE`).
   *
   * Windows cannot deliver SIGTERM to a detached child process, so the local
   * launcher opens a pipe (a named pipe on Windows, a unix socket elsewhere),
   * connects to it and sends "shutdown". The server answers "bye" and runs the
   * exact same graceful shutdown as SIGTERM: stop accepting requests, close the
   * database, exit 0.
   *
   * The channel is off unless the variable is set, only accepts the words
   * "shutdown" and "ping", and never exposes data.
   */
  const controlPipe = process.env.PISHKAN_CONTROL_PIPE;
  if (controlPipe) {
    const control = net.createServer((socket) => {
      socket.setEncoding('utf8');
      socket.on('data', (chunk: string) => {
        for (const line of chunk.split('\n')) {
          const command = line.trim();
          if (command === 'shutdown') {
            socket.end('bye\n');
            shutdown('control-pipe');
          } else if (command === 'ping') {
            socket.write('pong\n');
          }
        }
      });
      socket.on('error', () => undefined);
    });
    control.on('error', (error: NodeJS.ErrnoException) => {
      console.error(`[boot] control pipe failed: ${safeErrorText(error)}`);
    });
    if (process.platform !== 'win32' && fs.existsSync(controlPipe)) {
      // A stale unix socket from a crashed process would block listen().
      try { fs.unlinkSync(controlPipe); } catch { /* ignore */ }
    }
    control.listen(controlPipe, () => console.log('[boot] control pipe ready'));
    control.unref();
  }
}

bootstrap().catch((err) => {
  console.error(`[boot] fatal: ${safeErrorText(err)}`);
  process.exit(1);
});
