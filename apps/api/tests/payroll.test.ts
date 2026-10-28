import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { ACCOUNTANT, adminSession, app, createStaff, login } from './helpers.js';

describe('payroll role authorization', () => {
  it('allows the accountant role and super admin while keeping manager operations separate', async () => {
    const server = await app();
    const admin = await adminSession();
    const accountant = await createStaff('accountant', ACCOUNTANT);
    const manager = await createStaff('manager', { username: 'manager_payroll_test', password: 'Manager#12345', fullName: 'مدیر داخلی آزمون' });

    expect((await request(server).get('/api/payroll/staff').set('Cookie', accountant.cookie)).status).toBe(200);
    expect((await request(server).get('/api/payroll/staff').set('Cookie', admin.cookie)).status).toBe(200);

    const forbiddenCalls = [
      request(server).get('/api/payroll/staff').set('Cookie', manager.cookie),
      request(server).get('/api/payroll/staff/someone').set('Cookie', manager.cookie),
      request(server).post('/api/payroll/contracts').set('Cookie', manager.cookie).send({
        userId: 'someone', kind: 'monthly', monthlyAmount: 1000, commissionPercent: 0, startsOn: '2026-01-01',
      }),
      request(server).post('/api/payroll/accrue').set('Cookie', manager.cookie).send({ month: '2026-01' }),
      request(server).post('/api/payroll/settlements').set('Cookie', manager.cookie).send({
        userId: 'someone', amount: 1000, idempotencyKey: 'manager-blocked-123', note: 'آزمون دسترسی',
      }),
    ];
    for (const call of forbiddenCalls) expect((await call).status).toBe(403);
  });

  it('does not allow customers to access employee payroll', async () => {
    const server = await app();
    const registered = await request(server).post('/api/auth/register').send({
      mobile: '09128887766', password: 'Customer#98765', fullName: 'مشتری آزمون حقوق',
    });
    expect(registered.status).toBe(201);
    const customer = await login('09128887766', 'Customer#98765');
    expect((await request(server).get('/api/payroll/staff').set('Cookie', customer.cookie)).status).toBe(403);
  });
});
