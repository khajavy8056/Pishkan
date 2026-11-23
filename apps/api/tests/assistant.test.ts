import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import sharp from 'sharp';
import { adminSession, app, newCustomer, type Session } from './helpers.js';
import { updateSettings } from '../src/modules/settings/service.js';

let server: Awaited<ReturnType<typeof app>>;
let admin: Session;
let customerA: { session: Session; id: string; mobile: string };
let customerB: { session: Session; id: string; mobile: string };
let trackingCode = '';
let requestId = '';
let documentKey = '';

async function uploadPng(session: Session, n = 0): Promise<string> {
  const image = await sharp({ create: { width: 40 + n, height: 35 + n, channels: 3, background: { r: 10 + n, g: 100, b: 200 } } }).png().toBuffer();
  const res = await request(server).post('/api/files/upload?purpose=document').set('Cookie', session.cookie)
    .attach('file', image, `assistant-doc-${n}.png`).expect(201);
  return res.body.data.id as string;
}

describe('smart assistant (context-aware, agentic, isolated)', () => {
  beforeAll(async () => {
    server = await app();
    admin = await adminSession();
    customerA = await newCustomer('مشتری دستیار الف');
    customerB = await newCustomer('مشتری دستیار ب');

    const service = (await request(server).get('/api/public/services/insurance-history')
      .set('Cookie', customerA.session.cookie).expect(200)).body.data;
    documentKey = service.documents.find((document: any) => document.required)?.key ?? service.documents[0].key;
    const fileId = await uploadPng(customerA.session, 1);
    const created = await request(server).post('/api/requests').set('Cookie', customerA.session.cookie).send({
      serviceId: service.id,
      formData: {
        full_name: 'مشتری دستیار الف',
        national_id: '0013546295',
        insurance_number: '12345678',
        mobile: customerA.mobile,
        consent: true,
      },
      documentIds: [{ fileId, requirementKey: documentKey, title: service.documents[0].title }],
    }).expect(201);
    requestId = created.body.data.id;
    trackingCode = created.body.data.trackingCode;

    // A rejected document with a human-readable reason.
    const detail = await request(server).get(`/api/requests/${requestId}`).set('Cookie', admin.cookie).expect(200);
    const document = detail.body.data.documents[0];
    await request(server).post(`/api/requests/${requestId}/documents/${document.id}/review`)
      .set('Cookie', admin.cookie).send({ decision: 'rejected', note: 'تصویر کارت ملی ناخوانا است' }).expect(200);

    await request(server).post('/api/wallet/admin/credit').set('Cookie', admin.cookie)
      .send({ customerId: customerA.id, amount: 250000, reason: 'اعتبار آزمایشی دستیار' }).expect(201);

    await request(server).post('/api/support/tickets').set('Cookie', customerA.session.cookie)
      .send({ department: 'services', subject: 'وضعیت پرونده بیمه', body: 'لطفاً وضعیت را بررسی کنید.' }).expect(201);
  }, 120_000);

  afterAll(async () => {
    await updateSettings({
      'assistant.enabled': true,
      'assistant.account_access': true,
      'assistant.request_submission': true,
      'assistant.profile_autofill': true,
      'assistant.llm_provider': 'builtin',
    }, { id: 'system', name: 'assistant-test-cleanup' }, { confirmCritical: true }).catch(() => undefined);
  });

  /* ------------------------------ live catalogue ---------------------------- */

  it('answers a service question from the live catalogue with a service card', async () => {
    const res = await request(server).post('/api/assistant/chat')
      .send({ message: 'هزینه دریافت سوابق بیمه چقدر است؟' }).expect(200);
    expect(res.body.data.suggestions.length).toBeGreaterThan(0);
    expect(res.body.data.suggestions[0].slug).toBe('insurance-history');
    expect(res.body.data.cards.some((card: any) => card.type === 'service')).toBe(true);
    expect(res.body.data.reply).toMatch(/سوابق بیمه/);
  });

  it('discovers a service published after the process started', async () => {
    const marker = `دستیار آزمایشی ${Date.now()}`;
    const slug = `assistant-live-${Date.now()}`;
    const created = await request(server).post('/api/catalog/services').set('Cookie', admin.cookie)
      .send({
        title: `خدمت ${marker}`,
        slug,
        summary: 'خدمتی که همین الان منتشر شد',
        baseFee: 456000,
        estimatedMinutes: 90,
        tags: ['دستیار', marker],
        form: [],
        documents: [],
      }).expect(201);

    const chat = await request(server).post('/api/assistant/chat')
      .send({ message: `هزینه خدمت ${marker} چقدر است؟` }).expect(200);
    expect(chat.body.data.suggestions.some((service: any) => service.id === created.body.data.id)).toBe(true);
    expect(chat.body.data.reply).toContain('۴۵۶');

    const catalog = await request(server).get('/api/assistant/catalog').query({ q: marker }).expect(200);
    expect(catalog.body.data.services.some((service: any) => service.id === created.body.data.id)).toBe(true);
  });

  it('lists categories and newest services', async () => {
    const res = await request(server).post('/api/assistant/chat')
      .send({ message: 'چه خدماتی دارید؟' }).expect(200);
    expect(res.body.data.reply).toMatch(/دسته/);
    expect(res.body.data.suggestions.length).toBeGreaterThan(0);
  });

  it('refuses to invent an answer for something outside the catalogue', async () => {
    const res = await request(server).post('/api/assistant/chat')
      .send({ message: 'قانون مالیات بر ارث سال ۱۴۱۰ چقدر است؟' }).expect(200);
    expect(res.body.data.handoffSuggested).toBe(true);
    expect(res.body.data.reply).toMatch(/حدس|کارشناس|پشتیبانی/);
  });

  /* -------------------------------- isolation ------------------------------- */

  it('treats a signed-in customer as authenticated and returns only their own case', async () => {
    const res = await request(server).post('/api/assistant/chat').set('Cookie', customerA.session.cookie)
      .send({ message: 'کارم به کجا رسید؟' }).expect(200);
    expect(res.body.data.authenticated).toBe(true);
    expect(res.body.data.usedPersonalContext).toBe(true);
    expect(res.body.data.reply).toContain(trackingCode);
    const caseCard = res.body.data.cards.find((card: any) => card.type === 'case');
    expect(caseCard).toBeTruthy();
    expect(caseCard.case.trackingCode).toBe(trackingCode);
    expect(caseCard.case.documents.some((document: any) => document.status === 'rejected')).toBe(true);
  });

  it('never exposes another customer case by tracking code', async () => {
    const res = await request(server).post('/api/assistant/chat').set('Cookie', customerB.session.cookie)
      .send({ message: `وضعیت پرونده ${trackingCode} را بگو` }).expect(200);
    expect(res.body.data.reply).not.toContain(trackingCode);
    expect(res.body.data.cards.some((card: any) => card.type === 'case')).toBe(false);
    expect(res.body.data.usedPersonalContext).toBe(true);
  });

  it('does not expose a draft belonging to another customer', async () => {
    await request(server).post('/api/assistant/chat').set('Cookie', customerA.session.cookie)
      .send({ message: 'برای من درخواست دریافت سوابق بیمه ثبت کن' }).expect(200);
    const other = await request(server).get('/api/assistant/draft').set('Cookie', customerB.session.cookie).expect(200);
    expect(other.body.data.draft).toBeNull();
    await request(server).post('/api/assistant/draft/cancel').set('Cookie', customerA.session.cookie).send({}).expect(200);
  });

  it('treats a staff session as a guest for personal questions', async () => {
    const res = await request(server).post('/api/assistant/chat').set('Cookie', admin.cookie)
      .send({ message: 'وضعیت پرونده‌های من' }).expect(200);
    expect(res.body.data.authenticated).toBe(false);
    expect(res.body.data.cards.some((card: any) => card.type === 'case')).toBe(false);
  });

  /* ------------------------------ account awareness ------------------------- */

  it('explains a rejected document with its reason', async () => {
    const res = await request(server).post('/api/assistant/chat').set('Cookie', customerA.session.cookie)
      .send({ message: 'چرا مدرکم رد شده؟' }).expect(200);
    expect(res.body.data.reply).toContain('ناخوانا');
    expect(res.body.data.cards.some((card: any) => card.type === 'case' || card.type === 'profile')).toBe(true);
  });

  it('answers the payable amount with invoice cards', async () => {
    const res = await request(server).post('/api/assistant/chat').set('Cookie', customerA.session.cookie)
      .send({ message: 'چقدر باید پرداخت کنم؟' }).expect(200);
    expect(res.body.data.reply).toContain('مبلغ قابل پرداخت');
    const invoice = res.body.data.cards.find((card: any) => card.type === 'invoice');
    expect(invoice).toBeTruthy();
    expect(invoice.invoice.remaining).toBeGreaterThan(0);
    expect(res.body.data.actions.some((action: any) => action.route === '/app/invoices')).toBe(true);
  });

  it('reports the wallet balance from the customers own wallet', async () => {
    const res = await request(server).post('/api/assistant/chat').set('Cookie', customerA.session.cookie)
      .send({ message: 'موجودی کیف پولم چقدر است؟' }).expect(200);
    const wallet = res.body.data.cards.find((card: any) => card.type === 'wallet');
    expect(wallet.wallet.balance).toBe(250000);
    expect(res.body.data.reply).toContain('کیف پول');
  });

  it('reads profile completeness and support tickets', async () => {
    const profile = await request(server).post('/api/assistant/chat').set('Cookie', customerA.session.cookie)
      .send({ message: 'پروفایل من ناقص است؟' }).expect(200);
    expect(profile.body.data.cards.some((card: any) => card.type === 'profile')).toBe(true);

    const tickets = await request(server).post('/api/assistant/chat').set('Cookie', customerA.session.cookie)
      .send({ message: 'تیکت‌های پشتیبانی من' }).expect(200);
    expect(tickets.body.data.cards.some((card: any) => card.type === 'ticket')).toBe(true);
  });

  /* ------------------------------- guided request --------------------------- */

  it('creates only a draft from a submit request — never a real request', async () => {
    const before = await request(server).get('/api/requests').set('Cookie', customerA.session.cookie).expect(200);
    const res = await request(server).post('/api/assistant/chat').set('Cookie', customerA.session.cookie)
      .send({ message: 'برای من درخواست دریافت سوابق بیمه ثبت کن' }).expect(200);
    expect(res.body.data.draft).toBeTruthy();
    expect(res.body.data.draft.stage).toBe('collecting');
    expect(res.body.data.draft.requestId).toBeNull();
    expect(res.body.data.draft.missingFields.length).toBeGreaterThan(0);
    const after = await request(server).get('/api/requests').set('Cookie', customerA.session.cookie).expect(200);
    expect(after.body.data.length).toBe(before.body.data.length);
  });

  it('does not confirm without an explicit confirm flag', async () => {
    const res = await request(server).post('/api/assistant/draft/confirm').set('Cookie', customerA.session.cookie)
      .send({ confirm: false }).expect(400);
    expect(res.body.ok).toBe(false);
  });

  it('fills the form, attaches the required document, previews and confirms exactly once', async () => {
    const current = (await request(server).get('/api/assistant/draft').set('Cookie', customerA.session.cookie).expect(200)).body.data.draft;
    expect(current).toBeTruthy();

    const values: Record<string, string> = {
      full_name: 'مشتری دستیار الف',
      national_id: '0013546295',
      insurance_number: '87654321',
      mobile: customerA.mobile,
      consent: 'true',
    };
    for (const field of current.fields.filter((item: any) => item.required)) {
      const value = values[field.key];
      expect(value, `no test value for ${field.key}`).toBeTruthy();
      await request(server).patch('/api/assistant/draft').set('Cookie', customerA.session.cookie)
        .send({ key: field.key, value }).expect(200);
    }
    const fileId = await uploadPng(customerA.session, 2);
    await request(server).post('/api/assistant/draft/documents').set('Cookie', customerA.session.cookie)
      .send({ requirementKey: documentKey, fileId }).expect(200);

    const preview = await request(server).post('/api/assistant/draft/preview').set('Cookie', customerA.session.cookie)
      .send({}).expect(200);
    expect(preview.body.data.draft.stage).toBe('awaiting_confirmation');
    expect(preview.body.data.draft.missingFields).toEqual([]);
    expect(preview.body.data.draft.missingDocuments).toEqual([]);
    expect(preview.body.data.draft.actions.some((action: any) => action.kind === 'confirm')).toBe(true);

    const before = await request(server).get('/api/requests').set('Cookie', customerA.session.cookie).expect(200);
    const confirmed = await request(server).post('/api/assistant/draft/confirm').set('Cookie', customerA.session.cookie)
      .send({ confirm: true }).expect(200);
    expect(confirmed.body.data.intent).toBe('request_submitted');
    expect(confirmed.body.data.draft.requestId).toBeTruthy();
    expect(confirmed.body.data.draft.trackingCode).toBeTruthy();

    const after = await request(server).get('/api/requests').set('Cookie', customerA.session.cookie).expect(200);
    expect(after.body.data.length).toBe(before.body.data.length + 1);

    // A second confirm must not create a second request.
    const replay = await request(server).post('/api/assistant/draft/confirm').set('Cookie', customerA.session.cookie)
      .send({ confirm: true }).expect(200);
    expect(replay.body.data.draft).toBeNull();
    const final = await request(server).get('/api/requests').set('Cookie', customerA.session.cookie).expect(200);
    expect(final.body.data.length).toBe(after.body.data.length);
  });

  it('supports the same flow through chat with a typed confirmation', async () => {
    const start = await request(server).post('/api/assistant/chat').set('Cookie', customerB.session.cookie)
      .send({ message: 'برای من درخواست دریافت سوابق بیمه ثبت کن' }).expect(200);
    expect(start.body.data.draft).toBeTruthy();
    const current = (await request(server).get('/api/assistant/draft').set('Cookie', customerB.session.cookie).expect(200)).body.data.draft;

    const values: Record<string, string> = {
      full_name: 'مشتری دستیار ب',
      national_id: '0013546295',
      insurance_number: '11223344',
      mobile: customerB.mobile,
      consent: 'true',
    };
    for (const field of current.fields.filter((item: any) => item.required)) {
      await request(server).patch('/api/assistant/draft').set('Cookie', customerB.session.cookie)
        .send({ key: field.key, value: values[field.key] }).expect(200);
    }
    // Before the required document is attached, a typed "ثبت کن" must not
    // create anything: the preview is not complete yet.
    const early = await request(server).post('/api/assistant/chat').set('Cookie', customerB.session.cookie)
      .send({ message: 'ثبت کن' }).expect(200);
    expect(early.body.data.draft?.requestId ?? null).toBeNull();

    const fileId = await uploadPng(customerB.session, 3);
    await request(server).post('/api/assistant/draft/documents').set('Cookie', customerB.session.cookie)
      .send({ requirementKey: documentKey, fileId }).expect(200);
    await request(server).post('/api/assistant/draft/preview').set('Cookie', customerB.session.cookie).send({}).expect(200);
    const before = await request(server).get('/api/requests').set('Cookie', customerB.session.cookie).expect(200);
    const confirmed = await request(server).post('/api/assistant/chat').set('Cookie', customerB.session.cookie)
      .send({ message: 'تأیید می‌کنم' }).expect(200);
    expect(confirmed.body.data.draft.requestId).toBeTruthy();
    const after = await request(server).get('/api/requests').set('Cookie', customerB.session.cookie).expect(200);
    expect(after.body.data.length).toBe(before.body.data.length + 1);
  });

  it('proposes profile values only when the customer asks for them', async () => {
    const start = await request(server).post('/api/assistant/chat').set('Cookie', customerA.session.cookie)
      .send({ message: 'برای من درخواست دریافت سوابق بیمه ثبت کن' }).expect(200);
    const plain = start.body.data.draft;
    expect(plain.fields.find((field: any) => field.key === 'full_name').value).toBe('');
    const filled = await request(server).post('/api/assistant/chat').set('Cookie', customerA.session.cookie)
      .send({ message: 'از پروفایل پر کن' }).expect(200);
    expect(filled.body.data.draft.useProfile).toBe(true);
    expect(filled.body.data.draft.fields.find((field: any) => field.key === 'full_name').fromProfile).toBe(true);
    await request(server).post('/api/assistant/draft/cancel').set('Cookie', customerA.session.cookie).send({}).expect(200);
  });

  it('cancels a draft without creating a request', async () => {
    await request(server).post('/api/assistant/chat').set('Cookie', customerA.session.cookie)
      .send({ message: 'برای من درخواست دریافت سوابق بیمه ثبت کن' }).expect(200);
    const before = await request(server).get('/api/requests').set('Cookie', customerA.session.cookie).expect(200);
    const cancelled = await request(server).post('/api/assistant/draft/cancel').set('Cookie', customerA.session.cookie)
      .send({}).expect(200);
    expect(cancelled.body.data.draft).toBeNull();
    const after = await request(server).get('/api/requests').set('Cookie', customerA.session.cookie).expect(200);
    expect(after.body.data.length).toBe(before.body.data.length);
  });

  /* --------------------------------- guests --------------------------------- */

  it('guides a guest to sign in instead of creating a draft', async () => {
    const res = await request(server).post('/api/assistant/chat')
      .send({ message: 'برای من درخواست تعویض پلاک ثبت کن' }).expect(200);
    expect(res.body.data.draft).toBeNull();
    expect(res.body.data.authenticated).toBe(false);
    expect(res.body.data.actions.some((action: any) => action.kind === 'login')).toBe(true);
  });

  it('does not let a guest use draft endpoints', async () => {
    await request(server).get('/api/assistant/draft').expect(401);
    await request(server).post('/api/assistant/draft/confirm').send({ confirm: true }).expect(401);
  });

  /* -------------------------------- settings -------------------------------- */

  it('respects the account-access switch', async () => {
    await updateSettings({ 'assistant.account_access': false }, { id: 'system', name: 'assistant-test' }, { confirmCritical: true });
    const res = await request(server).post('/api/assistant/chat').set('Cookie', customerA.session.cookie)
      .send({ message: 'وضعیت پرونده‌های من' }).expect(200);
    expect(res.body.data.usedPersonalContext).toBe(false);
    expect(res.body.data.cards.some((card: any) => card.type === 'case')).toBe(false);
    await updateSettings({ 'assistant.account_access': true }, { id: 'system', name: 'assistant-test' }, { confirmCritical: true });
  });

  it('respects the request-submission switch', async () => {
    await updateSettings({ 'assistant.request_submission': false }, { id: 'system', name: 'assistant-test' }, { confirmCritical: true });
    const res = await request(server).post('/api/assistant/chat').set('Cookie', customerA.session.cookie)
      .send({ message: 'برای من درخواست دریافت سوابق بیمه ثبت کن' }).expect(200);
    expect(res.body.data.draft).toBeNull();
    expect(res.body.data.reply).toMatch(/غیرفعال/);
    // The endpoint itself refuses too: a stale client cannot create a draft.
    await request(server).post('/api/assistant/draft').set('Cookie', customerA.session.cookie)
      .send({ serviceSlug: 'insurance-history' }).expect(403);
    await updateSettings({ 'assistant.request_submission': true }, { id: 'system', name: 'assistant-test' }, { confirmCritical: true });
  });

  it('exposes capabilities on /info for a signed-in customer and a guest', async () => {
    const guest = await request(server).get('/api/assistant/info').expect(200);
    expect(guest.body.data.authenticated).toBe(false);
    expect(guest.body.data.capabilities.accountAccess).toBe(false);

    const signedIn = await request(server).get('/api/assistant/info').set('Cookie', customerA.session.cookie).expect(200);
    expect(signedIn.body.data.authenticated).toBe(true);
    expect(signedIn.body.data.capabilities.requestSubmission).toBe(true);
  });
});
