import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { adminSession, app } from './helpers.js';
import { updateSettings } from '../src/modules/settings/service.js';
import { detectConditions } from '../src/modules/monitoring/alerts.js';
import { checkSslCertificate, resetSslCache, sslTargetHost } from '../src/modules/monitoring/ssl.js';
import { run, nowIso } from '../src/db/index.js';
import { id } from '../src/lib/crypto.js';

/**
 * Infrastructure alerting: backup freshness and SSL expiry are measured from
 * real state (backup rows, a real TLS handshake) — never simulated. The SSL
 * probe is exercised against github.com, a real certificate reachable from
 * the test environment, plus the honest "not checkable" local path.
 */

let server: Awaited<ReturnType<typeof app>>;
let admin: any;

const actor = { id: 'system', name: 'monitoring-infra-test' };

beforeAll(async () => {
  server = await app();
  admin = await adminSession();
});

afterAll(async () => {
  await updateSettings({ 'backup.enabled': true, 'monitoring.ssl_check_host': '' } as any, actor, { confirmCritical: true });
  await run("DELETE FROM backups WHERE note = 'infra-test'");
  resetSslCache();
});

describe('backup freshness alerts', () => {
  it('flags a missing successful backup as critical when auto-backup is on', async () => {
    await run("DELETE FROM backups WHERE note = 'infra-test'");
    await updateSettings({ 'backup.enabled': true } as any, actor, { confirmCritical: true });
    // Remove other successful rows only for the duration of this check by
    // using a fresh condition run against a DB where we control backups:
    // instead of deleting real rows, temporarily mark them failed.
    await run("UPDATE backups SET status = 'infra-test-parked' WHERE status = 'ok'");
    try {
      const { detections, checks } = await detectConditions();
      expect((checks.backup as any).enabled).toBe(true);
      const missing = detections.find((d) => d.key === 'backup.missing');
      expect(missing).toBeTruthy();
      expect(missing!.severity).toBe('critical');
    } finally {
      await run("UPDATE backups SET status = 'ok' WHERE status = 'infra-test-parked'");
    }
  });

  it('flags a stale backup and clears when a fresh one exists', async () => {
    await updateSettings({ 'backup.enabled': true, 'monitoring.alert_backup_age_hours': 36 } as any, actor, { confirmCritical: true });
    await run("UPDATE backups SET status = 'infra-test-parked' WHERE status = 'ok'");
    try {
      const old = new Date(Date.now() - 50 * 3_600_000).toISOString();
      await run(
        'INSERT INTO backups (id, filename, size, status, note, created_at) VALUES (?, ?, 10, ?, ?, ?)',
        [id('bkp'), 'infra-test-old.tar', 'ok', 'infra-test', old],
      );
      const stale = await detectConditions();
      const found = stale.detections.find((d) => d.key === 'backup.stale');
      expect(found).toBeTruthy();
      expect(['warning', 'critical']).toContain(found!.severity);

      await run("UPDATE backups SET created_at = ? WHERE note = 'infra-test'", [nowIso()]);
      const fresh = await detectConditions();
      expect(fresh.detections.find((d) => d.key === 'backup.stale')).toBeUndefined();
      expect(fresh.detections.find((d) => d.key === 'backup.missing')).toBeUndefined();
    } finally {
      await run("DELETE FROM backups WHERE note = 'infra-test'");
      await run("UPDATE backups SET status = 'ok' WHERE status = 'infra-test-parked'");
    }
  });

  it('does not nag about backups when auto-backup is disabled', async () => {
    await updateSettings({ 'backup.enabled': false } as any, actor, { confirmCritical: true });
    const { detections, checks } = await detectConditions();
    expect((checks.backup as any).enabled).toBe(false);
    expect(detections.find((d) => d.key.startsWith('backup.'))).toBeUndefined();
    await updateSettings({ 'backup.enabled': true } as any, actor, { confirmCritical: true });
  });
});

describe('SSL expiry checks', () => {
  it('is honestly "not checkable" on a local http deployment', async () => {
    await updateSettings({ 'monitoring.ssl_check_host': '' } as any, actor, { confirmCritical: true });
    resetSslCache();
    const target = await sslTargetHost();
    expect(target.host).toBeNull(); // APP_URL in tests is http://localhost
    const result = await checkSslCertificate(true);
    expect(result.checked).toBe(false);
    expect(result.reason).toBeTruthy();
    expect(result.reason!.length).toBeGreaterThan(10);
  });

  it('performs a real TLS handshake and reads days left from the certificate', async () => {
    await updateSettings({ 'monitoring.ssl_check_host': 'github.com' } as any, actor, { confirmCritical: true });
    resetSslCache();
    const result = await checkSslCertificate(true);
    expect(result.checked).toBe(true);
    expect(result.host).toBe('github.com');
    expect(typeof result.daysLeft).toBe('number');
    expect(result.daysLeft!).toBeGreaterThanOrEqual(0);
    expect(result.validTo).toBeTruthy();
    expect(new Date(result.validTo!).getTime()).toBeGreaterThan(Date.now());
    expect(result.expired).toBe(false);

    // Detection must be CONSISTENT with the measured certificate. CI egress
    // proxies may present short-lived certs (<24h), which legitimately trip
    // the expiry warning — that is the alert engine working, not a bug.
    const { detections, checks } = await detectConditions();
    expect((checks.ssl as any).checked).toBe(true);
    const sslDetection = detections.find((d) => d.key.startsWith('ssl.'));
    if (result.daysLeft! <= 14) {
      expect(sslDetection).toBeTruthy();
      expect(['warning', 'critical']).toContain(sslDetection!.severity);
    } else {
      expect(sslDetection).toBeUndefined();
    }
    await updateSettings({ 'monitoring.ssl_check_host': '' } as any, actor, { confirmCritical: true });
    resetSslCache();
  }, 20_000);

  it('reports a connection failure honestly instead of a fake green status', async () => {
    // Port 443 on loopback: nothing listens there in the test environment.
    await updateSettings({ 'monitoring.ssl_check_host': '127.0.0.1' } as any, actor, { confirmCritical: true });
    resetSslCache();
    const result = await checkSslCertificate(true);
    expect(result.checked).toBe(false);
    expect(result.error).toBeTruthy();
    await updateSettings({ 'monitoring.ssl_check_host': '' } as any, actor, { confirmCritical: true });
    resetSslCache();
  }, 15_000);

  it('exposes health components and a manual re-check endpoint', async () => {
    const health = await request(server).get('/api/monitoring/health').set('Cookie', admin.cookie).expect(200);
    const keys = health.body.data.components.map((c: any) => c.key);
    expect(keys).toContain('backup');
    expect(keys).toContain('ssl');

    const check = await request(server).post('/api/monitoring/ssl/check').set('Cookie', admin.cookie).expect(200);
    expect(typeof check.body.data.checked).toBe('boolean');
    expect(check.body.data.checkedAt).toBeTruthy();

    // Customers must not reach the monitoring surface.
    await request(server).post('/api/monitoring/ssl/check').expect(401);
  });
});
