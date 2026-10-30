import fs from 'node:fs';
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
}

bootstrap().catch((err) => {
  console.error('[boot] fatal:', err);
  process.exit(1);
});
