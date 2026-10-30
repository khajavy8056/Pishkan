import { describe, expect, it } from 'vitest';
import { one } from '../src/db/index.js';
import { notifyUser } from '../src/modules/notifications/service.js';
import { sendEventNotificationSms } from '../src/modules/sms/provider.js';
import { saveSmsTemplate } from '../src/modules/sms/templates.js';
import { updateSettings } from '../src/modules/settings/service.js';
import { adminSession, app } from './helpers.js';

describe('notifications and SMS idempotency', () => {
  it('sends a configured event pattern through the mock provider only once', async () => {
    await adminSession();
    await app();
    await updateSettings({ 'sms.enabled': true, 'sms.notify_enabled': true, 'sms.provider': 'console' }, { id: 'test-admin', name: 'مدیر آزمون' });
    await saveSmsTemplate({
      eventCode: 'request_created', bodyId: '582001', patternText: 'درخواست {tracking_code} برای {service_title}', enabled: true,
    }, { id: 'test-admin' });

    const idempotencyKey = `test:sms-idempotency:${Date.now()}`;
    const event = { eventCode: 'request_created' as const, variables: { tracking_code: 'P-123', service_title: 'نمونه خدمت' } };
    const first = await sendEventNotificationSms('09121112233', event, idempotencyKey);
    const duplicate = await sendEventNotificationSms('09121112233', event, idempotencyKey);
    expect(first.ok).toBe(true);
    expect(duplicate.errorCode).toBe('duplicate');
    const log = await one<any>('SELECT * FROM sms_logs WHERE idempotency_key = ?', [idempotencyKey]);
    expect(log.status).toBe('sent');
    expect(log.body).toBe('event:request_created; params:2');
    expect(log.body).not.toContain('P-123');
  });

  it('persists one in-app notice for repeated event keys', async () => {
    await adminSession();
    await app();
    const admin = await one<{ id: string }>("SELECT id FROM users WHERE username = 'testadmin'");
    const before = await one<{ c: number }>('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ?', [admin!.id]);
    const eventKey = `test:notification-idempotency:${Date.now()}`;
    const notice = { title: 'آزمون اعلان', body: 'محتوای غیرحساس', idempotencyKey: eventKey };
    await notifyUser(admin!.id, notice);
    await notifyUser(admin!.id, notice);
    const after = await one<{ c: number }>('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ?', [admin!.id]);
    expect(Number(after!.c) - Number(before!.c)).toBe(1);
  });
});
