/**
 * Takh Pishkhan Guard — real behavioral tests.
 *
 * Attacker IPs are simulated with X-Forwarded-For (trust proxy is on in the
 * test env). Every assertion waits for the actual DB effect, never a sleep.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { Express } from 'express';
import { app, adminSession, customerSession, createStaff, EXPERT } from './helpers.js';
import { q, one, run } from '../src/db/index.js';
import { updateSettings } from '../src/modules/settings/service.js';
import { env } from '../src/env.js';
import { resetDetectors } from '../src/modules/guard/detectors.js';
import { invalidateBlockCache } from '../src/modules/guard/service.js';
import { parseAuditReport } from '../src/modules/guard/deps.js';
import { parseEnamadSnippet, renderEnamadHtml, sanitizeEnamadSetting } from '../src/modules/settings/enamad.js';

let server: Express;
let admin: { cookie: string[] };
const ATTACKER = '203.0.113.77';
const OTHER = '198.51.100.23';

async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, timeoutMs = 8000): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = await fn();
    if (value) return value as T;
    if (Date.now() - started > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 60));
  }
}

const eventOfKind = (kind: string, ip?: string) => one<any>(
  ip ? 'SELECT * FROM guard_events WHERE kind = ? AND source_ip = ? ORDER BY created_at DESC LIMIT 1' : 'SELECT * FROM guard_events WHERE kind = ? ORDER BY created_at DESC LIMIT 1',
  ip ? [kind, ip] : [kind],
);

beforeAll(async () => {
  server = await app();
  admin = await adminSession();
  await updateSettings({
    'guard.enabled': true,
    'guard.auto_block_enabled': true,
    'guard.window_seconds': 60,
    'guard.auth_fail_threshold': 3,
    'guard.notfound_threshold': 10,
    'guard.upload_reject_threshold': 3,
    'guard.forbidden_threshold': 5,
    'guard.block_minutes': 5,
    'guard.trusted_ips': '',
    'guard.never_block_staff': true,
  }, { id: 'system', name: 'guard-test' }, { confirmCritical: true });
});

beforeEach(async () => {
  resetDetectors();
  invalidateBlockCache();
  await run('DELETE FROM guard_events');
  await run('DELETE FROM guard_blocks');
  // The account lockout is real product behavior; reset it so each detector
  // test exercises the guard, not the (already tested) per-account lock.
  await run("UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE kind IN ('staff','admin')");
});

afterAll(async () => {
  delete process.env.GUARD_SCAN_ROOTS;
});

describe('guard access control', () => {
  it('refuses customers and staff without guard.view', async () => {
    const customer = await customerSession();
    await request(server).get('/api/guard/overview').set('Cookie', customer.cookie).expect(403);
    const expert = await createStaff('service_expert', { ...EXPERT, username: `expert_guard_${Date.now()}` });
    await request(server).get('/api/guard/overview').set('Cookie', expert.cookie).expect(403);
    const res = await request(server).get('/api/guard/overview').set('Cookie', admin.cookie).expect(200);
    expect(Array.isArray(res.body.data.posture)).toBe(true);
    expect(res.body.data.posture.length).toBeGreaterThan(5);
  });

  it('manager role can view but not manage', async () => {
    const manager = await createStaff('manager', { username: `mgr_guard_${Date.now()}`, password: 'Manager#12345', fullName: 'مدیر گارد' });
    await request(server).get('/api/guard/events').set('Cookie', manager.cookie).expect(200);
    await request(server).post('/api/guard/blocks').set('Cookie', manager.cookie).send({ ip: OTHER, reason: 'test', minutes: 5 }).expect(403);
  });
});

describe('brute-force detection and reversible blocking', () => {
  it('blocks the attacking IP after repeated failed logins, exempts staff, and unblocks', async () => {
    for (let i = 0; i < 3; i += 1) {
      await request(server).post('/api/auth/staff/login')
        .set('X-Forwarded-For', ATTACKER)
        .send({ identifier: 'testadmin', password: 'WrongPassword#1' });
    }
    // The event row is inserted first, then the auto-block + action_taken
    // update land asynchronously. Wait for the COMPLETED action so the test
    // is robust on the slower PostgreSQL path too (assertion is unchanged).
    const event = await waitFor(async () => {
      const e = await eventOfKind('auth_bruteforce', ATTACKER);
      return e && e.action_taken === 'blocked' ? e : null;
    });
    expect(event.severity).toBe('critical');
    expect(event.action_taken).toBe('blocked');
    const block = await waitFor(() => one<any>('SELECT * FROM guard_blocks WHERE ip = ? AND revoked_at IS NULL', [ATTACKER]));

    // The blocked IP is refused on a public endpoint…
    const blocked = await request(server).get('/api/public/settings').set('X-Forwarded-For', ATTACKER).expect(403);
    expect(blocked.body.error.code).toBe('guard_blocked');
    // …but the authenticated administrator from the same IP is never locked out.
    await request(server).get('/api/guard/overview').set('Cookie', admin.cookie).set('X-Forwarded-For', ATTACKER).expect(200);
    // Loopback (office machine / local monitoring) is untouched.
    await request(server).get('/api/public/settings').expect(200);

    // Reversible: revoke through the API and the IP works again.
    await request(server).delete(`/api/guard/blocks/${block.id}`).set('Cookie', admin.cookie).expect(200);
    await request(server).get('/api/public/settings').set('X-Forwarded-For', ATTACKER).expect(200);
  });

  it('never auto-blocks a trusted IP but still records the event', async () => {
    await updateSettings({ 'guard.trusted_ips': OTHER }, { id: 'system', name: 'guard-test' }, { confirmCritical: true });
    try {
      for (let i = 0; i < 3; i += 1) {
        await request(server).post('/api/auth/staff/login').set('X-Forwarded-For', OTHER).send({ identifier: 'testadmin', password: 'WrongPassword#2' });
      }
      await waitFor(() => eventOfKind('auth_bruteforce', OTHER));
      const block = await one('SELECT * FROM guard_blocks WHERE ip = ?', [OTHER]);
      expect(block).toBeNull();
      await request(server).get('/api/public/settings').set('X-Forwarded-For', OTHER).expect(200);
    } finally {
      await updateSettings({ 'guard.trusted_ips': '' }, { id: 'system', name: 'guard-test' }, { confirmCritical: true });
    }
  });

  it('manual block requires guard.manage and validates the IP', async () => {
    const created = await request(server).post('/api/guard/blocks').set('Cookie', admin.cookie)
      .send({ ip: OTHER, reason: 'رفتار مشکوک دستی', minutes: 2 }).expect(200);
    expect(created.body.data.ip).toBe(OTHER);
    await request(server).get('/api/public/settings').set('X-Forwarded-For', OTHER).expect(403);
    await request(server).post('/api/guard/blocks').set('Cookie', admin.cookie).send({ ip: 'not-an-ip', reason: 'x' }).expect(400);
    await request(server).post('/api/guard/blocks').set('Cookie', admin.cookie).send({ ip: '127.0.0.1', reason: 'loopback' }).expect(400);
  });
});

describe('request-pattern detectors', () => {
  it('flags a 404 scanner burst', async () => {
    for (let i = 0; i < 11; i += 1) {
      await request(server).get(`/api/nope-${i}`).set('X-Forwarded-For', ATTACKER);
    }
    const event = await waitFor(() => eventOfKind('path_scan', ATTACKER));
    expect(event.severity).toBe('warning');
  });

  it('reports a known exploit probe immediately without blocking', async () => {
    await request(server).get('/.env').set('X-Forwarded-For', OTHER).expect(404);
    const event = await waitFor(() => eventOfKind('exploit_probe', OTHER));
    expect(event.path).toContain('.env');
    const block = await one('SELECT * FROM guard_blocks WHERE ip = ?', [OTHER]);
    expect(block).toBeNull();
  });

  it('counts rejected uploads and raises upload_attack', async () => {
    const customer = await customerSession();
    for (let i = 0; i < 3; i += 1) {
      await request(server).post('/api/files/upload')
        .set('Cookie', customer.cookie)
        .set('X-Forwarded-For', ATTACKER)
        .attach('file', Buffer.from('MZ fake executable'), 'malware.exe');
    }
    const event = await waitFor(() => eventOfKind('upload_attack', ATTACKER));
    expect(event.severity).toBe('critical');
  });
});

describe('file integrity scanner', () => {
  it('builds a baseline, then detects a tampered file', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-integrity-'));
    fs.writeFileSync(path.join(dir, 'app.js'), 'console.log(1);\n');
    fs.writeFileSync(path.join(dir, 'config.json'), '{"a":1}\n');
    process.env.GUARD_SCAN_ROOTS = dir;
    try {
      const first = await request(server).post('/api/guard/scan').set('Cookie', admin.cookie).send({ kind: 'integrity' }).expect(200);
      expect(first.body.data.summary.baselineCreated).toBe(true);
      expect(first.body.data.summary.files).toBe(2);

      fs.writeFileSync(path.join(dir, 'app.js'), 'console.log("tampered");\n');
      const second = await request(server).post('/api/guard/scan').set('Cookie', admin.cookie).send({ kind: 'integrity' }).expect(200);
      expect(second.body.data.summary.changed).toBe(1);
      expect(second.body.data.findings[0].type).toBe('changed');
      const event = await waitFor(() => eventOfKind('integrity_change'));
      expect(event.severity).toBe('critical');

      // Explicit rebuild accepts the new state.
      await request(server).post('/api/guard/baseline/rebuild').set('Cookie', admin.cookie).send({ confirm: 'wrong' }).expect(400);
      await request(server).post('/api/guard/baseline/rebuild').set('Cookie', admin.cookie).send({ confirm: 'بازسازی خط مبنا' }).expect(200);
      const third = await request(server).post('/api/guard/scan').set('Cookie', admin.cookie).send({ kind: 'integrity' }).expect(200);
      expect(third.body.data.summary.findings).toBe(0);
    } finally {
      delete process.env.GUARD_SCAN_ROOTS;
      fs.rmSync(dir, { recursive: true, force: true });
      await run('DELETE FROM guard_file_baseline');
    }
  });
});

describe('uploads scanner and quarantine', () => {
  it('quarantines an unknown executable, restores it, and only flags registered files', async () => {
    const rogue = path.join(env.uploadDir, 'rogue-tool.bin');
    fs.writeFileSync(rogue, Buffer.concat([Buffer.from([0x7f]), Buffer.from('ELF fake executable body')]));
    const scan = await request(server).post('/api/guard/scan').set('Cookie', admin.cookie).send({ kind: 'uploads' }).expect(200);
    expect(scan.body.data.summary.quarantined).toBe(1);
    expect(fs.existsSync(rogue)).toBe(false);
    const quarantined = await one<any>('SELECT * FROM guard_quarantine WHERE original_path = ?', ['rogue-tool.bin']);
    expect(quarantined).toBeTruthy();
    expect(fs.existsSync(quarantined.quarantine_path)).toBe(true);

    // Restore is explicit, confirmed and checksum-verified.
    await request(server).post(`/api/guard/quarantine/${quarantined.id}/restore`).set('Cookie', admin.cookie).send({ confirm: 'no' }).expect(400);
    await request(server).post(`/api/guard/quarantine/${quarantined.id}/restore`).set('Cookie', admin.cookie).send({ confirm: 'بازگردانی فایل' }).expect(200);
    expect(fs.existsSync(rogue)).toBe(true);
    fs.rmSync(rogue, { force: true });

    // A REGISTERED file with a dangerous signature is flagged, never auto-removed.
    const registeredRel = path.join('private', 'originals', 'registered-evil.pdf');
    const registeredAbs = path.join(env.uploadDir, registeredRel);
    fs.mkdirSync(path.dirname(registeredAbs), { recursive: true });
    fs.writeFileSync(registeredAbs, Buffer.concat([Buffer.from([0x7f]), Buffer.from('ELF disguised as pdf')]));
    await run(
      'INSERT INTO files (id, owner_id, name, mime, size, storage_key, is_public, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)',
      ['file_guard_test', admin ? 'usr_test' : null, 'evil.pdf', 'application/pdf', 24, registeredRel, new Date().toISOString()],
    );
    const scan2 = await request(server).post('/api/guard/scan').set('Cookie', admin.cookie).send({ kind: 'uploads' }).expect(200);
    const flagged = scan2.body.data.findings.find((f: any) => f.path === registeredRel);
    expect(flagged.action).toBe('needs_admin');
    expect(fs.existsSync(registeredAbs)).toBe(true); // still there — admin decides

    // Admin-confirmed quarantine of the registered file.
    const manual = await request(server).post('/api/guard/quarantine').set('Cookie', admin.cookie)
      .send({ path: registeredRel, confirm: 'قرنطینه فایل' }).expect(200);
    expect(manual.body.data.quarantined).toBe(true);
    expect(fs.existsSync(registeredAbs)).toBe(false);
    await run('DELETE FROM files WHERE id = ?', ['file_guard_test']);
  });
});

describe('dependency audit parsing', () => {
  it('parses a real npm audit report and sorts by severity', () => {
    const fixture = {
      auditReportVersion: 2,
      vulnerabilities: {
        'adm-zip': {
          name: 'adm-zip', severity: 'high', isDirect: true, range: '<0.6.1',
          via: [{ title: 'Zip bomb', url: 'https://github.com/advisories/GHSA-x', severity: 'high' }],
          fixAvailable: { name: 'adm-zip', version: '0.6.1', isSemVerMajor: false },
        },
        minimatch: {
          name: 'minimatch', severity: 'moderate', isDirect: false, range: '7.0.0 - 11.0.0',
          via: ['adm-zip'], fixAvailable: false,
        },
      },
      metadata: { vulnerabilities: { info: 0, low: 0, moderate: 1, high: 1, critical: 0, total: 2 } },
    };
    const parsed = parseAuditReport(fixture);
    expect(parsed.total).toBe(2);
    expect(parsed.vulnerabilities[0].name).toBe('adm-zip');
    expect(parsed.counts.high).toBe(1);
    expect(parsed.vulnerabilities[0].fixAvailable).toMatchObject({ version: '0.6.1' });
  });
});

describe('guard SMS alerts', () => {
  it('sends through the office SMS provider and respects the hourly budget', async () => {
    await updateSettings({
      'sms.enabled': true, 'sms.provider': 'console', 'sms.notify_enabled': true, 'sms.notify_template_id': 'notify-test',
      'guard.sms_enabled': true, 'guard.sms_mobile': '09120000000', 'guard.sms_min_severity': 'critical',
      'guard.sms_max_per_hour': 1, 'guard.sms_template_id': 'guard-pattern',
    }, { id: 'system', name: 'guard-test' }, { confirmCritical: true });
    try {
      for (let i = 0; i < 3; i += 1) {
        await request(server).post('/api/auth/staff/login').set('X-Forwarded-For', ATTACKER).send({ identifier: 'testadmin', password: 'WrongPassword#3' });
      }
      await waitFor(() => one('SELECT * FROM sms_logs WHERE purpose = ?', ['guard-alert']));
      const sent = await q<any>('SELECT * FROM sms_logs WHERE purpose = ?', ['guard-alert']);
      expect(sent.length).toBe(1);
      expect(sent[0].template_code).toBe('guard-pattern');

      // Second critical event within the hour: budget exhausted, no second SMS.
      // Fresh IP: OTHER may still carry the manual block from an earlier test.
      const THIRD = '192.0.2.55';
      resetDetectors();
      await run("UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE kind IN ('staff','admin')");
      for (let i = 0; i < 3; i += 1) {
        await request(server).post('/api/auth/staff/login').set('X-Forwarded-For', THIRD).send({ identifier: 'testadmin', password: 'WrongPassword#4' });
      }
      await waitFor(() => eventOfKind('auth_bruteforce', THIRD));
      await new Promise((r) => setTimeout(r, 300));
      const sentAfter = await q<any>('SELECT * FROM sms_logs WHERE purpose = ?', ['guard-alert']);
      expect(sentAfter.length).toBe(1);
    } finally {
      await updateSettings({ 'guard.sms_enabled': false }, { id: 'system', name: 'guard-test' }, { confirmCritical: true });
    }
  });
});

describe('enamad sanitizer', () => {
  const official = '<a referrerpolicy="origin" target="_blank" href="https://trustseal.enamad.ir/?id=123456&Code=Ab12Cd34Ef"><img referrerpolicy="origin" src="https://trustseal.enamad.ir/logo.aspx?id=123456&Code=Ab12Cd34Ef" alt="" style="cursor:pointer" id="xyz"/></a>';

  it('rebuilds the official a+img snippet deterministically', () => {
    const parts = parseEnamadSnippet(official);
    expect(parts.id).toBe('123456');
    const html = renderEnamadHtml(parts);
    expect(html).toContain('href="https://trustseal.enamad.ir/?id=123456&Code=Ab12Cd34Ef"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).not.toContain('cursor:pointer');
    expect(sanitizeEnamadSetting(official)).toBe(html);
  });

  it('accepts the iframe form', () => {
    const html = sanitizeEnamadSetting('<iframe src="https://trustseal.enamad.ir/?id=999&Code=Xy98Zw76"></iframe>');
    expect(html.startsWith('<iframe')).toBe(true);
    expect(html).toContain('id=999');
  });

  it('rejects scripts, foreign hosts and event handlers', () => {
    expect(() => sanitizeEnamadSetting('<script src="https://trustseal.enamad.ir/x.js"></script>')).toThrow();
    expect(() => sanitizeEnamadSetting('<a href="https://evil.com/?id=1&Code=aaaa"><img src="https://trustseal.enamad.ir/logo.aspx?id=1&Code=aaaa"></a>')).toThrow();
    expect(() => sanitizeEnamadSetting('<a href="https://trustseal.enamad.ir/?id=1&Code=aaaa" onclick="alert(1)"><img src="https://trustseal.enamad.ir/logo.aspx?id=1&Code=aaaa"></a>')).toThrow();
    expect(() => sanitizeEnamadSetting('<a href="http://trustseal.enamad.ir/?id=1&Code=aaaa">x</a>')).toThrow();
    expect(sanitizeEnamadSetting('')).toBe('');
  });
});
