/**
 * The guided tour's server half: what starts on its own, and what may interrupt.
 *
 * The two promises the feature makes are both enforced here rather than in a
 * client, so web and Android cannot drift apart:
 *  - a tour auto-starts at most once (complete = never again, dismiss = not
 *    before a gap, and never while the feature is off);
 *  - a contextual tip requires a *repeated* wrong action and is budgeted per
 *    day, so "smart" can never degrade into nagging.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { adminSession, app, customerSession } from './helpers.js';
import { one, run } from '../src/db/index.js';
import { updateSettings } from '../src/modules/settings/service.js';

let server: Awaited<ReturnType<typeof app>>;
let customer: any;
let admin: any;

async function stateOf(userId: string, code: string) {
  return one<any>('SELECT * FROM user_tour_states WHERE user_id = ? AND tour_code = ?', [userId, code]);
}

async function hintRow(userId: string, key: string) {
  return one<any>('SELECT * FROM user_tour_hints WHERE user_id = ? AND hint_key = ?', [userId, key]);
}

/** Fire the same wrong action n times, returning which ones produced a tip. */
async function fire(session: { cookie: string[] }, key: string, times: number) {
  const shows: boolean[] = [];
  for (let index = 0; index < times; index += 1) {
    const res = await request(server).post('/api/tours/hint').set('Cookie', session.cookie).send({ key });
    expect(res.status).toBe(200);
    shows.push(res.body.data.show);
  }
  return shows;
}

beforeAll(async () => {
  server = await app();
  customer = await customerSession();
  admin = await adminSession();
  await updateSettings({
    'tours.enabled': true,
    'tours.auto_start': true,
    'tours.hints_enabled': true,
    'tours.hint_repeat_after': 2,
    'tours.hint_max_per_day': 2,
    'tours.dismiss_retry_days': 30,
    'tours.copy_override': '{}',
  }, { id: 'test', name: 'tours' });
});

describe('tours', () => {
  it('serves each audience its own tour, with copy the clients render', async () => {
    const me = await request(server).get('/api/auth/me').set('Cookie', customer.cookie).expect(200);
    const res = await request(server).get('/api/tours').set('Cookie', customer.cookie).expect(200);
    const codes = res.body.data.tours.map((tour: any) => tour.code);
    expect(codes).toContain('customer-request');
    expect(codes).not.toContain('office-case');
    const guide = res.body.data.tours.find((tour: any) => tour.code === 'customer-request');
    // A step must name an element the client can point at — without `target` the
    // tour is a modal, which is the thing this design is meant to replace.
    for (const step of guide.steps) {
      expect(step.target).toMatch(/^tour:/);
      expect(step.title.length).toBeGreaterThan(3);
      expect(step.body.length).toBeGreaterThan(20);
    }
    expect(res.body.data.hintsCatalog.some((hint: any) => hint.key === 'document-from-profile')).toBe(true);
    expect(res.body.data.state[me.body.data.id]).toBeUndefined();
  });

  it('stops offering a tour once it has been completed, and honours the gap after a dismissal', async () => {
    const { id } = (await request(server).get('/api/auth/me').set('Cookie', customer.cookie)).body.data;
    await request(server).post('/api/tours/customer-request').set('Cookie', customer.cookie).send({ action: 'start' }).expect(200);
    await request(server).post('/api/tours/customer-request').set('Cookie', customer.cookie).send({ action: 'step', step: 2 }).expect(200);
    expect(await stateOf(id, 'customer-request')).toMatchObject({ step: 2, completed: 0 });

    await request(server).post('/api/tours/customer-request').set('Cookie', customer.cookie).send({ action: 'complete' }).expect(200);
    let tours = await request(server).get('/api/tours').set('Cookie', customer.cookie).expect(200);
    expect(tours.body.data.tours.map((t: any) => t.code)).not.toContain('customer-request');
    // …and the state is kept, so the office can see it was finished.
    expect(await stateOf(id, 'customer-request')).toMatchObject({ completed: 1 });

    // Replaying (the «راهنما» button) is the only way it comes back.
    await request(server).post('/api/tours/customer-request').set('Cookie', customer.cookie).send({ action: 'replay' }).expect(200);
    expect(await stateOf(id, 'customer-request')).toBeNull();
    tours = await request(server).get('/api/tours').set('Cookie', customer.cookie).expect(200);
    expect(tours.body.data.tours.map((t: any) => t.code)).toContain('customer-request');

    // A dismissal silences it for the configured gap, not forever.
    await request(server).post('/api/tours/customer-request').set('Cookie', customer.cookie).send({ action: 'dismiss' }).expect(200);
    tours = await request(server).get('/api/tours').set('Cookie', customer.cookie).expect(200);
    expect(tours.body.data.tours.map((t: any) => t.code)).not.toContain('customer-request');
    await run('UPDATE user_tour_states SET updated_at = ? WHERE user_id = ? AND tour_code = ?',
      [new Date(Date.now() - 31 * 86_400_000).toISOString(), id, 'customer-request']);
    tours = await request(server).get('/api/tours').set('Cookie', customer.cookie).expect(200);
    expect(tours.body.data.tours.map((t: any) => t.code)).toContain('customer-request');
  });

  it('needs a repeated mistake before interrupting, and stops at the daily cap', async () => {
    const fresh = await customerSession();
    const { id } = (await request(server).get('/api/auth/me').set('Cookie', fresh.cookie)).body.data;
    await run('DELETE FROM user_tour_hints WHERE user_id = ?', [id]);

    // Once is a mis-click, not a pattern.
    expect(await fire(fresh, 'confirm-before-document', 1)).toEqual([false]);
    // Twice is the first tip. A third in a row is still one per pattern.
    expect(await fire(fresh, 'confirm-before-document', 2)).toEqual([true, false]);
    // …the fourth starts the next one, and the day's budget then closes.
    expect(await fire(fresh, 'confirm-before-document', 4)).toEqual([true, false, false, false]);

    const row = await hintRow(id, 'confirm-before-document');
    expect(Number(row.occurrences)).toBe(7);
    expect(Number(row.shown_count)).toBe(2);
    expect(Number(row.shown_today)).toBe(2);
  });

  it('counts a mistake even when nothing was shown, so the next one comes sooner', async () => {
    const fresh = await customerSession();
    const { id } = (await request(server).get('/api/auth/me').set('Cookie', fresh.cookie)).body.data;
    await run('DELETE FROM user_tour_hints WHERE user_id = ?', [id]);
    await updateSettings({ 'tours.hints_enabled': false }, { id: 'test', name: 'tours' });
    expect(await fire(fresh, 'unassigned-case', 1)).toEqual([false]);
    expect(Number((await hintRow(id, 'unassigned-case')).occurrences)).toBe(1);
    await updateSettings({ 'tours.hints_enabled': true }, { id: 'test', name: 'tours' });
    // The second occurrence completes the pattern that was started while the
    // tips were off, so the customer is not made to repeat it a third time.
    expect(await fire(fresh, 'unassigned-case', 1)).toEqual([true]);
  });

  it('refuses an unknown hint and a tour code that does not exist', async () => {
    await request(server).post('/api/tours/hint').set('Cookie', customer.cookie).send({ key: 'made-up' }).expect(404);
    await request(server).post('/api/tours/no-such-tour').set('Cookie', customer.cookie).send({ action: 'start' }).expect(404);
  });

  it('never lets a customer reach the office views', async () => {
    await request(server).get('/api/tours/preview').set('Cookie', customer.cookie).expect(404);
    await request(server).get('/api/tours/diagnostics').set('Cookie', customer.cookie).expect(404);
    expect((await request(server).get('/api/tours/diagnostics').set('Cookie', admin.cookie)).status).toBe(200);
  });

  it('applies the office wording override without dropping the rest of the step', async () => {
    await updateSettings({
      'tours.copy_override': JSON.stringify({ tours: { 'customer-profile': { prefill: { body: 'متن دفتر' } } } }),
    }, { id: 'test', name: 'tours' });
    const res = await request(server).get('/api/tours').set('Cookie', customer.cookie).expect(200);
    const profile = res.body.data.tours.find((tour: any) => tour.code === 'customer-profile');
    const step = profile.steps.find((item: any) => item.id === 'prefill');
    expect(step.body).toBe('متن دفتر');
    expect(step.title).toBeTruthy();
    expect(step.target).toBe('tour:profile-form');
    await updateSettings({ 'tours.copy_override': '{}' }, { id: 'test', name: 'tours' });
  });

  it('is silent for everyone when the feature is off', async () => {
    await updateSettings({ 'tours.enabled': false }, { id: 'test', name: 'tours' });
    const res = await request(server).get('/api/tours').set('Cookie', customer.cookie).expect(200);
    expect(res.body.data.enabled).toBe(false);
    expect(res.body.data.tours).toEqual([]);
    const hint = await request(server).post('/api/tours/hint').set('Cookie', customer.cookie).send({ key: 'document-in-chat' }).expect(200);
    expect(hint.body.data).toMatchObject({ show: false, reason: 'disabled' });
    await updateSettings({ 'tours.enabled': true }, { id: 'test', name: 'tours' });
  });
});
