import fs from 'node:fs';
import net from 'node:net';
import { env, assertProductionSafety } from './env.js';
import { createApp } from './http/app.js';
import { closeDb, getDb } from './db/index.js';
import { migrate } from './db/migrate.js';
import { ensureSettingDefaults } from './modules/settings/service.js';
import { ensureAdmin, upsertRolesOnly, seedCatalog } from './modules/catalog/seed.js';
import { ensureMediaDirs, recoverStuckMedia } from './modules/media/service.js';

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
    .catch((err) => console.error('[boot] media recovery failed:', err));

  await ensureSettingDefaults();
  await upsertRolesOnly();
  await seedCatalog((m) => console.log(`[boot] ${m}`));

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
  const server = app.listen(env.port, env.host, () => {
    console.log(`[boot] Pishkan API ${env.version} listening on http://${env.host}:${env.port} (${env.nodeEnv}, db=${env.dbDriver})`);
  });

  const shutdown = (signal: string) => {
    console.log(`[shutdown] received ${signal}`);
    server.close(async () => {
      await closeDb().catch(() => undefined);
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
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
      console.error(`[boot] control pipe failed: ${error.message}`);
    });
    if (process.platform !== 'win32' && fs.existsSync(controlPipe)) {
      // A stale unix socket from a crashed process would block listen().
      try { fs.unlinkSync(controlPipe); } catch { /* ignore */ }
    }
    control.listen(controlPipe, () => console.log(`[boot] control pipe ready: ${controlPipe}`));
    control.unref();
  }
}

bootstrap().catch((err) => {
  console.error('[boot] fatal:', err);
  process.exit(1);
});
