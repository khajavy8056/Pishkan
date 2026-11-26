import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { adminSession, app, createStaff } from './helpers.js';
import { UPDATE_SUDOERS_CONTENT, UPDATE_SUDOERS_LINE, checkForUpdate } from '../src/modules/system/update.js';

/**
 * The panel's update button, and the grant that makes it safe.
 *
 * There is no fixture here that pretends to be a production install. What can be
 * proved on any machine — and what would silently rot otherwise — is:
 *  1. the routes answer with the *truth about this box*, and never invent an
 *     "up to date" when the updater is not even installed;
 *  2. the privilege the panel gets is exactly two enumerated commands, and stays
 *     the same text in TypeScript advice and in the bash generator the installer
 *     runs (two copies of a security rule is how one of them gets widened);
 *  3. permission boundaries: reading the version is `system.view`, replacing the
 *     code is `system.edit`.
 */
describe('system update endpoints', () => {
  it('reports the real state of this box instead of a comfortable lie', async () => {
    const server = await app();
    const admin = await adminSession();
    const res = await request(server).get('/api/system/update/check').set('cookie', admin.cookie).expect(200);
    const check = res.body.data;

    // On a checkout, `is_installed` is false, so the only honest answer is that
    // there is no update path here. A `mode` of 'privileged' would mean the panel
    // offers a button that cannot work.
    expect(['unavailable', 'read-only', 'privileged']).toContain(check.mode);
    if (check.mode !== 'privileged') {
      expect(check.ok).toBe(false);
      expect(typeof check.hint).toBe('string');
      expect(check.hint!.length, 'an unusable feature must come with the fix, not a shrug').toBeGreaterThan(20);
    }
  });

  it('refuses to start an update that this server cannot carry out', async () => {
    const server = await app();
    const admin = await adminSession();
    const res = await request(server).post('/api/system/update/start').set('cookie', admin.cookie).send({});
    // Either it genuinely started (a real install with the grant), or it is a
    // 409 that says why. A 200 with a job id that nothing is behind is neither.
    expect([200, 409]).toContain(res.status);
    if (res.status === 409) {
      expect(res.body.error.message).toMatch(/به‌روزرسانی|مجوز/);
    } else {
      expect(res.body.data.status).toBe('running');
    }
  });

  it('keeps reading the version cheap and applying it expensive', async () => {
    const server = await app();
    const clerk = await createStaff('manager', {
      username: `upd_mgr_${Date.now()}`, password: 'Manager#12345', fullName: 'ناظر به‌روزرسانی',
    });
    // The manager role has no system.* grants, so neither half works for them —
    // and crucially the *read* is refused too, because the commit hash of a
    // production server is not something every role should see.
    await request(server).get('/api/system/update/check').set('cookie', clerk.cookie).expect(403);
    await request(server).post('/api/system/update/start').set('cookie', clerk.cookie).send({}).expect(403);
    await request(server).get('/api/system/update/check').expect(401);
  });

  it('grants exactly two commands, in both places the rule is written', () => {
    const line = UPDATE_SUDOERS_LINE('pishkan');
    expect(line).toBe('pishkan ALL=(root) NOPASSWD: /usr/local/bin/pishkan check-update --json, /usr/local/bin/pishkan update --json');
    // The two things a wider grant would allow, and that make this feature unsafe.
    expect(line).not.toMatch(/--ref|--no-backup|!|\*|bash|sudo/i);
    expect(UPDATE_SUDOERS_CONTENT().split('\n').filter((row) => row && !row.startsWith('#'))).toHaveLength(1);

    // The bash generator the installer actually runs must say the same thing.
    const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
    const bash = execFileSync('bash', ['-c', `. "${root}/scripts/lib/update-sudoers.sh"; update_sudoers_content pishkan`], { encoding: 'utf8' });
    expect(bash).toContain(line);
    expect(bash.trim().split('\n').filter((row) => row && !row.startsWith('#'))).toHaveLength(1);
  });

  it('checks without a password prompt and never mutates anything', async () => {
    // `checkForUpdate` shells out to the same script the operator would run. Two
    // properties matter: it must not hang waiting for a root password (hence the
    // `sudo -n` probe), and it must not touch the box.
    const head = () => execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const before = head();
    const check = await checkForUpdate();
    // Not "must not be privileged": run this suite on the production host itself
    // and privileged is the correct answer. What is asserted is that it answers,
    // in a bounded way, and that nothing moved.
    expect(['unavailable', 'read-only', 'privileged']).toContain(check.mode);
    const after = head();
    expect(after).toBe(before);
  });
});
