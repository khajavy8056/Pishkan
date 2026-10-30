import { one, q, run, nowIso } from '../../db/index.js';
import { badRequest } from '../../http/errors.js';

export const SMS_EVENT_DEFINITIONS = [
  { eventCode: 'request_created', title: 'ثبت درخواست جدید', recipientType: 'customer', variables: ['tracking_code', 'service_title'], description: 'ارسال پس از ثبت قطعی پرونده.' },
  { eventCode: 'request_status', title: 'تغییر وضعیت پرونده', recipientType: 'customer', variables: ['tracking_code', 'status'], description: 'فقط وضعیت کوتاه پرونده؛ بدون یادداشت داخلی یا اطلاعات مدارک.' },
  { eventCode: 'request_assigned', title: 'ارجاع پرونده به کارشناس', recipientType: 'staff', variables: ['tracking_code', 'service_title'], description: 'ارسال به کارشناس دریافت‌کننده ارجاع.' },
  { eventCode: 'document_status', title: 'نتیجه بررسی مدرک', recipientType: 'customer', variables: ['tracking_code', 'document_status'], description: 'نتیجه بررسی بدون نام یا محتوای فایل.' },
  { eventCode: 'invoice_created', title: 'صدور فاکتور', recipientType: 'customer', variables: ['invoice_number', 'amount'], description: 'اطلاع‌رسانی درباره فاکتور متعلق به مشتری.' },
  { eventCode: 'payment_status', title: 'وضعیت پرداخت', recipientType: 'customer', variables: ['invoice_number', 'payment_status'], description: 'فقط پس از ثبت نتیجه مالی سمت سرور.' },
] as const;

export type SmsEventCode = (typeof SMS_EVENT_DEFINITIONS)[number]['eventCode'];
export type SmsEvent = { eventCode: SmsEventCode; variables: Record<string, string> };

export function getSmsEventDefinition(eventCode: string) {
  return SMS_EVENT_DEFINITIONS.find((event) => event.eventCode === eventCode);
}

export async function listSmsTemplates() {
  const rows = await q<any>('SELECT * FROM sms_templates ORDER BY event_code');
  const byCode = new Map(rows.map((row) => [row.event_code, row]));
  return SMS_EVENT_DEFINITIONS.map((definition) => {
    const row = byCode.get(definition.eventCode);
    return {
      ...definition,
      bodyId: row?.body_id ?? '',
      patternText: row?.pattern_text ?? '',
      parameters: definition.variables,
      enabled: Boolean(row?.enabled),
      validationStatus: row?.validation_status ?? 'incomplete',
      validationError: row?.validation_error ?? null,
      createdAt: row?.created_at ?? null,
      updatedAt: row?.updated_at ?? null,
    };
  });
}

export async function getEnabledSmsTemplate(eventCode: string) {
  const definition = getSmsEventDefinition(eventCode);
  if (!definition) return null;
  const row = await one<any>('SELECT * FROM sms_templates WHERE event_code = ? AND enabled = 1', [eventCode]);
  if (!row || row.validation_status !== 'configured' || !row.body_id) return null;
  return { ...definition, bodyId: row.body_id };
}

export async function saveSmsTemplate(input: {
  eventCode: string; bodyId: string; patternText: string; enabled: boolean;
}, actor: { id: string }) {
  const definition = getSmsEventDefinition(input.eventCode);
  if (!definition) throw badRequest('رویداد پیامکی ناشناخته است.');
  const bodyId = input.bodyId.trim().replace(/[۰-۹٠-٩]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩'.indexOf(digit) % 10));
  const patternText = input.patternText.trim();
  const hasValidId = /^\d{1,12}$/.test(bodyId);
  const placeholderNames = [...patternText.matchAll(/\{([a-z][a-z0-9_]*)\}/g)].map((match) => match[1]);
  const expected = [...definition.variables].sort();
  const actual = [...placeholderNames].sort();
  const hasExactParameters = actual.length === expected.length && actual.every((name, index) => name === expected[index]);
  const validationError = !hasValidId
    ? 'شناسه الگوی ثبت‌شده باید عددی و ۱ تا ۱۲ رقم باشد.'
    : !hasExactParameters
      ? `متن الگو باید هر متغیر را دقیقاً یک بار و فقط با این نام‌ها داشته باشد: ${expected.map((name) => `{${name}}`).join('، ')}`
      : null;
  if (input.enabled && validationError) throw badRequest(validationError);

  const current = await one('SELECT event_code FROM sms_templates WHERE event_code = ?', [input.eventCode]);
  const ts = nowIso();
  if (current) {
    await run(
      `UPDATE sms_templates SET title=?, recipient_type=?, body_id=?, pattern_text=?, parameter_names=?, enabled=?, validation_status=?, validation_error=?, updated_at=?, updated_by=? WHERE event_code=?`,
      [definition.title, definition.recipientType, bodyId, patternText, JSON.stringify(definition.variables), input.enabled ? 1 : 0,
        validationError ? 'incomplete' : 'configured', validationError, ts, actor.id, input.eventCode],
    );
  } else {
    await run(
      `INSERT INTO sms_templates (event_code, title, recipient_type, body_id, pattern_text, parameter_names, enabled, validation_status, validation_error, created_at, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [input.eventCode, definition.title, definition.recipientType, bodyId, patternText, JSON.stringify(definition.variables), input.enabled ? 1 : 0,
        validationError ? 'incomplete' : 'configured', validationError, ts, ts, actor.id],
    );
  }
  return (await listSmsTemplates()).find((template) => template.eventCode === input.eventCode)!;
}
