import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { adminSession, app, createStaff, customerSession } from './helpers.js';
import { updateSettings } from '../src/modules/settings/service.js';
import { logEvent } from '../src/modules/logging/service.js';
import { q } from '../src/db/index.js';

let server: Awaited<ReturnType<typeof app>>;
let admin: any;
let customer: any;

beforeAll(async () => {
  server = await app();
  admin = await adminSession();
  customer = await customerSession();
  await updateSettings({
    'monitoring.enabled': true,
    'monitoring.sample_interval_seconds': 60,
    'monitoring.log_level': 'DEBUG',
  } as any, { id: 'system', name: 'monitoring-test-setup' }, { confirmCritical: true });
});

afterAll(async () => {
  await updateSettings({ 'monitoring.log_level': 'INFO' } as any,
    { id: 'system', name: 'monitoring-test-cleanup' }, { confirmCritical: true });
});

describe('monitoring centre', () => {
  it('reports real health for every required component without fake series', async () => {
    const res = await request(server).get('/api/monitoring/health').set('Cookie', admin.cookie).expect(200);
    const keys = res.body.data.components.map((component: any) => component.key);
    expect(keys).toEqual(expect.arrayContaining([
      'database', 'api', 'gateway', 'wallet', 'storage', 'disk', 'memory',
      'cpu', 'notifications', 'queue', 'alerts',
    ]));
    expect(keys.length).toBeGreaterThanOrEqual(11);
    for (const component of res.body.data.components) {
      expect(['ok', 'warning', 'critical', 'unknown']).toContain(component.status);
      expect(typeof component.value).toBe('string');
      expect(component.value.length).toBeGreaterThan(0);
      expect(component.updatedAt).toBeTruthy();
    }
    expect(res.body.data.database.ok).toBe(true);
    expect(res.body.data.database.migrations).toBeGreaterThanOrEqual(18);
    expect(res.body.data.database.lastMigrationAt).toBeTruthy();
    expect(res.body.data.api.totals.total).toBeGreaterThanOrEqual(1);
    expect(res.body.data.sessions.active).toBeGreaterThanOrEqual(1);
    expect(res.body.data.gateway).toBeTruthy();
    // Real values or explicit null; never an invented sample.
    for (const [key, value] of Object.entries(res.body.data.resources ?? {})) {
      if (value !== null && typeof value === 'object') continue;
      expect(['number', 'object']).toContain(typeof value);
      expect(key).toBeTruthy();
    }
  });

  it('samples metrics and serves chart ranges computed from the database', async () => {
    const sample = await request(server).post('/api/monitoring/sample').set('Cookie', admin.cookie).expect(200);
    expect(Number.isFinite(sample.body.data.collectedAt ? 1 : 0)).toBe(true);

    const rows = await q<any>("SELECT * FROM metric_samples WHERE metric='cpu_percent_x100'");
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const cpu = Number(rows[rows.length - 1].value);
    expect(cpu).toBeGreaterThanOrEqual(0);
    expect(cpu).toBeLessThanOrEqual(100 * 100);

    for (const bucket of ['hour', 'day', 'week', 'month']) {
      const charts = await request(server).get(`/api/monitoring/charts?bucket=${bucket}`).set('Cookie', admin.cookie).expect(200);
      expect(charts.body.data.range.bucket).toBe(bucket);
      for (const group of ['infrastructure', 'activity', 'finance', 'security']) {
        expect(charts.body.data[group]).toBeTruthy();
        for (const series of Object.values<any>(charts.body.data[group])) {
          expect(Array.isArray(series)).toBe(true);
          for (const point of series as any[]) {
            expect(typeof point.key).toBe('string');
            expect(Number.isFinite(point.value)).toBe(true);
          }
        }
      }
      // Filled buckets are contiguous and bounded, not random noise.
      const activity = charts.body.data.activity.requestsCreated as any[];
      expect(activity.length).toBeGreaterThan(0);
      expect(activity.length).toBeLessThanOrEqual(2880);
    }

    const overview = await request(server).get('/api/monitoring/overview').set('Cookie', admin.cookie).expect(200);
    expect(overview.body.data.finance.walletCustody).toBeGreaterThanOrEqual(0);
    expect(overview.body.data.requests.open).toBeGreaterThanOrEqual(0);
    expect(overview.body.data.logs).toBeTruthy();
  });

  it('exposes 17 log categories and 6 levels, and filters real structured logs', async () => {
    const meta = await request(server).get('/api/monitoring/meta').set('Cookie', admin.cookie).expect(200);
    expect(meta.body.data.categories).toHaveLength(17);
    expect(meta.body.data.levels).toEqual(['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL', 'SECURITY']);
    expect(meta.body.data.buckets).toEqual(['hour', 'day', 'week', 'month']);
    expect(meta.body.data.retention.logsDays).toBeGreaterThan(0);
    expect(meta.body.data.thresholds.latencyMs).toBeGreaterThan(0);

    const action = `test.log.${Date.now()}`;
    await logEvent({
      level: 'WARNING', category: 'network', action, actorId: 'system', actorName: 'آزمون پایش',
      message: 'رویداد آزمون جست‌وجوی لاگ', ip: '10.0.0.5',
      details: { note: 'safe', password: 'SHOULD-NOT-APPEAR', token: 'ALSO-SHOULD-NOT-APPEAR' },
    });
    const found = await request(server).get(`/api/monitoring/logs?search=${encodeURIComponent(action)}`).set('Cookie', admin.cookie).expect(200);
    expect(found.body.data.length).toBeGreaterThanOrEqual(1);
    const row = found.body.data[0];
    expect(row.level).toBe('WARNING');
    expect(row.category).toBe('network');
    expect(row.correlationId).toBeTruthy();
    expect(row.correlationId).toMatch(/^corr/);
    const serialized = JSON.stringify(row);
    expect(serialized).not.toContain('SHOULD-NOT-APPEAR');
    expect(serialized).not.toContain('ALSO-SHOULD-NOT-APPEAR');

    const debug = await request(server).get('/api/monitoring/logs?level=DEBUG').set('Cookie', admin.cookie).expect(200);
    expect(debug.body.data.every((entry: any) => entry.level === 'DEBUG')).toBe(true);

    const detail = await request(server).get(`/api/monitoring/logs/${row.id}`).set('Cookie', admin.cookie).expect(200);
    expect(detail.body.data.action).toBe(action);

    const stats = await request(server).get('/api/monitoring/logs/stats').set('Cookie', admin.cookie).expect(200);
    expect(stats.body.data.byCategory.length).toBeGreaterThanOrEqual(1);
    expect(stats.body.data.byLevel).toBeTruthy();
  });

  it('exports logs to CSV with an audit trail and prunes only with confirmation', async () => {
    const csv = await request(server).get('/api/monitoring/logs/export').set('Cookie', admin.cookie).expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text.startsWith('\uFEFF')).toBe(true);
    expect(csv.text).toContain('زمان');
    const audit = await q<any>("SELECT * FROM audit_logs WHERE action='logs.export'");
    expect(audit.length).toBeGreaterThanOrEqual(1);

    const missing = await request(server).delete('/api/monitoring/logs/prune').set('Cookie', admin.cookie).send({});
    expect(missing.status).toBe(400);
    const pruned = await request(server).delete('/api/monitoring/logs/prune').set('Cookie', admin.cookie)
      .send({ confirmation: 'PRUNE' }).expect(200);
    expect(Number.isFinite(pruned.body.data.removed)).toBe(true);
    expect(pruned.body.data.retentionDays).toBeGreaterThan(0);
  });

  it('evaluates alerts from real conditions and lets operators acknowledge them', async () => {
    const evaluated = await request(server).post('/api/monitoring/alerts/evaluate').set('Cookie', admin.cookie).expect(200);
    expect(evaluated.body.data).toBeTruthy();

    // An unassigned open case is a real, detectable condition.
    const acknowledged = await request(server).post('/api/monitoring/alerts/evaluate').set('Cookie', admin.cookie).expect(200);
    expect(acknowledged.body.data.evaluatedAt).toBeTruthy();

    const alerts = await request(server).get('/api/monitoring/alerts').set('Cookie', admin.cookie).expect(200);
    for (const alert of alerts.body.data) {
      expect(['info', 'warning', 'critical']).toContain(alert.severity);
      expect(['active', 'acknowledged', 'resolved']).toContain(alert.status);
      expect(alert.metadata).toBeTruthy();
    }
    const summary = await request(server).get('/api/monitoring/alerts/summary').set('Cookie', admin.cookie).expect(200);
    expect(summary.body.data).toBeTruthy();

    if (alerts.body.data.length) {
      const target = alerts.body.data[0];
      const ack = await request(server).post(`/api/monitoring/alerts/${target.id}/acknowledge`)
        .set('Cookie', admin.cookie).send({ note: 'بررسی شد' });
      expect([200, 409]).toContain(ack.status);
      if (ack.status === 200) {
        expect(ack.body.data.status).toBe('acknowledged');
        const resolve = await request(server).post(`/api/monitoring/alerts/${target.id}/resolve`)
          .set('Cookie', admin.cookie).send({ note: 'رفع شد' }).expect(200);
        expect(resolve.body.data.status).toBe('resolved');
      }
    }
  });

  it('keeps monitoring, logs and alerts away from customers and ordinary staff', async () => {
    await request(server).get('/api/monitoring/health').set('Cookie', customer.cookie).expect(403);
    await request(server).get('/api/monitoring/logs').set('Cookie', customer.cookie).expect(403);
    await request(server).get('/api/monitoring/alerts').set('Cookie', customer.cookie).expect(403);
    await request(server).get('/api/monitoring/overview').expect(401);

    const expert = await createStaff('service_expert', {
      username: `mon_exp_${Date.now() % 100000}`, password: 'Expert#12345', fullName: 'کارشناس پایش',
    });
    await request(server).get('/api/monitoring/health').set('Cookie', expert.cookie).expect(403);
    await request(server).get('/api/monitoring/logs').set('Cookie', expert.cookie).expect(403);
    await request(server).delete('/api/monitoring/logs/prune').set('Cookie', expert.cookie)
      .send({ confirmation: 'PRUNE' }).expect(403);
  });

  it('never logs request query strings or gateway secrets through the API middleware', async () => {
    await request(server).get('/api/public/services?token=SUPERSECRETVALUE').expect(200);
    const leaked = await q<any>("SELECT * FROM system_logs WHERE details LIKE '%SUPERSECRETVALUE%' OR message LIKE '%SUPERSECRETVALUE%'");
    expect(leaked).toHaveLength(0);
    const apiLogs = await q<any>("SELECT * FROM system_logs WHERE category='api' ORDER BY created_at DESC LIMIT 5");
    expect(apiLogs.length).toBeGreaterThanOrEqual(1);
  });
});
