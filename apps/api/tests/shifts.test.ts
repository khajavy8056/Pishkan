import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { adminSession, app, createStaff, customerSession } from './helpers.js';

describe('shifts and attendance workflows', () => {
  it('rejects invalid/overlapping shifts and prevents cross-user change requests', async () => {
    const server = await app();
    const admin = await adminSession();
    const firstStaff = await createStaff('service_expert', {
      username: `shift_one_${Date.now()}`, password: 'Shift#12345', fullName: 'کارمند شیفت یک',
    });
    const secondStaff = await createStaff('service_expert', {
      username: `shift_two_${Date.now()}`, password: 'Shift#12345', fullName: 'کارمند شیفت دو',
    });
    const firstId = (await request(server).get('/api/auth/me').set('Cookie', firstStaff.cookie)).body.data.id;
    const secondId = (await request(server).get('/api/auth/me').set('Cookie', secondStaff.cookie)).body.data.id;
    const makeShift = (userId: string, date: string, startTime: string, endTime: string) => request(server)
      .post('/api/shifts').set('Cookie', admin.cookie).send({ userId, date, startTime, endTime });

    const first = await makeShift(firstId, '2032-01-10', '09:00', '12:00').expect(201);
    await makeShift(firstId, '2032-01-10', '11:00', '13:00').expect(409);
    await makeShift(firstId, '2032-02-30', '13:00', '15:00').expect(400);
    await makeShift(firstId, '2032-01-10', '16:00', '09:00').expect(400);
    const other = await makeShift(secondId, '2032-01-10', '09:00', '12:00').expect(201);

    await request(server).post('/api/shifts/change-requests').set('Cookie', firstStaff.cookie)
      .send({ kind: 'leave', shiftId: other.body.data.ids[0], reason: 'درخواست مرخصی' }).expect(404);
    await request(server).post('/api/shifts/change-requests').set('Cookie', firstStaff.cookie)
      .send({ kind: 'leave', shiftId: first.body.data.ids[0], reason: 'درخواست مرخصی' }).expect(201);
  });

  it('applies approved leave, date swap, and additional-shift requests with conflict checks', async () => {
    const server = await app();
    const admin = await adminSession();
    const staff = await createStaff('service_expert', {
      username: `shift_workflow_${Date.now()}`, password: 'Shift#12345', fullName: 'کارمند گردش شیفت',
    });
    const userId = (await request(server).get('/api/auth/me').set('Cookie', staff.cookie)).body.data.id;
    const createShift = async (date: string, startTime = '09:00', endTime = '12:00') => {
      const result = await request(server).post('/api/shifts').set('Cookie', admin.cookie)
        .send({ userId, date, startTime, endTime }).expect(201);
      return result.body.data.ids[0] as string;
    };
    const approve = (id: string) => request(server).patch(`/api/shifts/change-requests/${id}`)
      .set('Cookie', admin.cookie).send({ decision: 'approved', note: 'تأیید شد' });

    const leaveShift = await createShift('2032-02-01');
    const leave = await request(server).post('/api/shifts/change-requests').set('Cookie', staff.cookie)
      .send({ kind: 'leave', shiftId: leaveShift, reason: 'درخواست مرخصی' }).expect(201);
    await approve(leave.body.data.id).expect(200);

    const swapShift = await createShift('2032-02-02');
    const swap = await request(server).post('/api/shifts/change-requests').set('Cookie', staff.cookie)
      .send({ kind: 'swap', shiftId: swapShift, requestedDate: '2032-02-03', reason: 'تغییر روز کاری' }).expect(201);
    await approve(swap.body.data.id).expect(200);

    const add = await request(server).post('/api/shifts/change-requests').set('Cookie', staff.cookie)
      .send({ kind: 'add', requestedDate: '2032-02-04', startTime: '13:00', endTime: '17:00', reason: 'نیاز به شیفت اضافه' }).expect(201);
    await approve(add.body.data.id).expect(200);

    const conflictAdd = await request(server).post('/api/shifts/change-requests').set('Cookie', staff.cookie)
      .send({ kind: 'add', requestedDate: '2032-02-04', startTime: '16:00', endTime: '18:00', reason: 'درخواست هم‌پوشان' }).expect(201);
    await approve(conflictAdd.body.data.id).expect(409);

    const shifts = await request(server).get('/api/shifts?from=2032-02-01&to=2032-02-04').set('Cookie', staff.cookie);
    expect(shifts.body.data.find((shift: any) => shift.id === leaveShift).status).toBe('leave');
    expect(shifts.body.data.find((shift: any) => shift.id === swapShift).date).toBe('2032-02-03');
    expect(shifts.body.data.some((shift: any) => shift.date === '2032-02-04' && shift.startTime === '13:00')).toBe(true);
    const customer = await customerSession();
    await request(server).post('/api/shifts/change-requests').set('Cookie', customer.cookie)
      .send({ kind: 'add', requestedDate: '2032-02-05', startTime: '09:00', endTime: '10:00', reason: 'نباید مجاز باشد' }).expect(403);
  });
});
