import { describe, expect, it } from 'vitest';
import { newCustomer } from './helpers.js';
import { notifyDocumentApproval, listNotifications, markRead } from '../src/modules/notifications/service.js';
import { id } from '../src/lib/crypto.js';

describe('document approval aggregation', () => {
  it('is atomic and idempotent, scoped to customer and case, and only reopens on new events', async () => {
    const a = await newCustomer('مشتری الف');
    const b = await newCustomer('مشتری ب');
    const request = id('case');
    const first = id('review');
    await Promise.all(Array.from({ length: 5 }, () => notifyDocumentApproval(a.id, request, 'PK-1', first)));
    let notes = (await listNotifications(a.id, { limit: 100 })).items.filter(n => n.eventType === 'document_approved');
    expect(notes).toHaveLength(1);
    expect(notes[0].revision).toBe(1);
    await markRead(a.id, notes[0].id);
    await notifyDocumentApproval(a.id, request, 'PK-1', first);
    notes = (await listNotifications(a.id, { limit: 100 })).items.filter(n => n.eventType === 'document_approved');
    expect(notes[0].readAt).not.toBeNull();
    await Promise.all(Array.from({ length: 4 }, () => notifyDocumentApproval(a.id, request, 'PK-1', id('review'))));
    await notifyDocumentApproval(a.id, id('case'), 'PK-2', id('review'));
    await notifyDocumentApproval(b.id, request, 'PK-1', id('review'));
    notes = (await listNotifications(a.id, { limit: 100 })).items.filter(n => n.eventType === 'document_approved');
    expect(notes).toHaveLength(2);
    expect(notes.find(n => n.link === `/app/requests/${request}`)).toMatchObject({ revision: 5, readAt: null });
    expect((await listNotifications(b.id)).items.filter(n => n.eventType === 'document_approved')).toHaveLength(1);
  });
});
