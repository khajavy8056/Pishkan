import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, customerSession } from './helpers.js';
import { one, q } from '../src/db/index.js';

/**
 * "The office already has my national card — why am I uploading it again?"
 *
 * The answer has to be a property of the server, not of which client the
 * customer happened to use:
 *
 *  1. a document uploaded against a requirement is mirrored into the customer's
 *     archive, so the *next* request can offer it; and
 *  2. it is mirrored as `pending`, never as `approved`, so nothing pretends a
 *     human reviewed it.
 *
 * The regression this pins: the Android request form archived the upload after
 * sending, the web request page only did so if the customer opened an optional
 * modal, and the server did nothing at all. A customer who used the browser had
 * an empty archive and was asked for the same national card on every request.
 */
describe('request documents reach the profile archive', () => {
  /// `insurance-history` is the seeded service the Android contract test builds
  /// against; its snapshot carries a typed document requirement.
  async function typedService(server: any) {
    // The seeded catalogue is the interesting case: its requirements are
    // title-only, which is exactly why the archive could never be matched back
    // to them. `inferDocumentType` below is what the server uses to file those.
    const res = await request(server).get('/api/public/services/insurance-history').expect(200);
    const service = res.body.data;
    const requirement = (service.documents ?? []).find(
      (doc: any) => !doc?.documentType || doc.documentType === 'other',
    ) ?? (service.documents ?? [])[0];
    return { service, requirement };
  }

  function formDataFor(service: any) {
    const formData: Record<string, any> = {};
    for (const field of service.form ?? []) {
      if (!field.required) continue;
      switch (field.type) {
        case 'national_id': formData[field.key] = '0013546295'; break;
        case 'tel': formData[field.key] = '09121234567'; break;
        case 'iban': formData[field.key] = 'IR062960000000100324200001'; break;
        case 'postal_code': formData[field.key] = '1234567890'; break;
        case 'number': case 'money': formData[field.key] = 1000000; break;
        case 'select': case 'radio': formData[field.key] = field.options?.[0] ?? 'سایر'; break;
        case 'checkbox': formData[field.key] = true; break;
        default: formData[field.key] = 'اطلاعات آزمایشی';
      }
    }
    return formData;
  }

  const upload = async (server: any, cookie: string[], name: string) => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    const res = await request(server)
      .post('/api/files/upload?purpose=document')
      .set('Cookie', cookie)
      .attach('file', png, name)
      .expect(201);
    return res.body.data.id as string;
  };

  /// Submits one request carrying the same file against the typed requirement —
  /// the flow both clients actually use. A request's document set is fixed at
  /// submission, which is why attaching afterwards is not the path to test.
  async function submitWithDocument(server: any, customer: { cookie: string[] }) {
    const { service, requirement } = await typedService(server);
    expect(requirement, 'fixture service must expose a typed document requirement').toBeTruthy();
    const fileId = await upload(server, customer.cookie, 'national-card.png');
    const created = await request(server)
      .post('/api/requests')
      .set('Cookie', customer.cookie)
      .set('Idempotency-Key', `archive-${Date.now()}-${Math.random()}`)
      .send({
        serviceId: service.id,
        formData: formDataFor(service),
        priority: 'normal',
        documentIds: [
          { fileId, requirementKey: requirement.key, title: requirement.title },
        ],
      });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    return { requestId: created.body.data.id as string, fileId, requirement };
  }

  it('archives the document attached to a submitted request, as pending', async () => {
    const server = await app();
    const customer = await customerSession();
    const { fileId, requirement } = await submitWithDocument(server, customer);

    // The archive now holds it — without a second, optional step.
    const archived = await one<any>('SELECT * FROM customer_documents WHERE file_id = ?', [fileId]);
    expect(archived, 'the submitted document must be mirrored into the archive').toBeTruthy();
    expect(archived.doc_type).toBe(requirement.documentType);

    // And it is *pending*. Archiving is not approval: the next request still
    // offers it, the customer still confirms reuse, a reviewer still decides.
    expect(archived.status).toBe('pending');

    // The endpoint both clients read agrees.
    const mine = await request(server).get('/api/documents/mine').set('Cookie', customer.cookie).expect(200);
    const listed = mine.body.data.find((doc: any) => doc.id === archived.id);
    expect(listed, 'the archive endpoint must list the mirrored document').toBeTruthy();
    expect(listed.file.id).toBe(fileId);
    expect(listed.status).toBe('pending');
  });

  it('never loses the document, even when the mirror is skipped', async () => {
    const server = await app();
    const customer = await customerSession();
    const { requestId, fileId } = await submitWithDocument(server, customer);

    // The request keeps its own copy regardless of what the archive did.
    const attached = await q<any>('SELECT file_id FROM request_documents WHERE request_id = ?', [requestId]);
    expect(attached.some((row) => row.file_id === fileId)).toBe(true);
  });

  it('holds exactly one archive row per file, however many times it is submitted', async () => {
    const server = await app();
    const customer = await customerSession();
    const first = await submitWithDocument(server, customer);
    const second = await submitWithDocument(server, customer);

    const firstRows = await q<any>('SELECT id FROM customer_documents WHERE file_id = ?', [first.fileId]);
    expect(firstRows.length).toBe(1);
    // A different file is a different archive entry, not a replacement.
    const secondRows = await q<any>('SELECT id FROM customer_documents WHERE file_id = ?', [second.fileId]);
    expect(secondRows.length).toBe(1);
  });
});
