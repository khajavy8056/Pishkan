import { Router } from 'express';
import { env } from '../env.js';
import { one } from '../db/index.js';

export const healthRouter = Router();

const startedAt = Date.now();

healthRouter.get('/', async (_req, res) => {
  let dbOk = false;
  let migrations = 0;
  let error: string | undefined;
  try {
    const row = await one<{ c: number }>('SELECT COUNT(*) AS c FROM schema_migrations');
    migrations = Number(row?.c ?? 0);
    dbOk = migrations > 0;
  } catch (err: any) {
    error = err?.message ?? 'database error';
  }

  const healthy = dbOk;
  res.status(healthy ? 200 : 503).json({
    ok: healthy,
    status: healthy ? 'ok' : 'degraded',
    version: env.version,
    environment: env.nodeEnv,
    driver: env.dbDriver,
    database: { ok: dbOk, migrations, error },
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    time: new Date().toISOString(),
  });
});

healthRouter.get('/ready', async (_req, res) => {
  try {
    await one('SELECT 1 AS ok');
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false });
  }
});

healthRouter.get('/live', (_req, res) => {
  res.json({ ok: true, uptimeSeconds: Math.round((Date.now() - startedAt) / 1000) });
});
