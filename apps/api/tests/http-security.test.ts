import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createRateLimitStore, resetRateLimits } from '../src/http/middleware.js';
import { app } from './helpers.js';

describe('HTTP origin and rate-limit protection', () => {
  it('expires old windows and keeps the in-memory key map bounded', () => {
    const store = createRateLimitStore(3, 2);
    expect(store.take('ip-a', 1000, 2, 100).allowed).toBe(true);
    expect(store.take('ip-a', 1000, 2, 200).allowed).toBe(true);
    expect(store.take('ip-a', 1000, 2, 300).allowed).toBe(false);
    expect(store.take('ip-a', 1000, 2, 1200).allowed).toBe(true);
    store.take('ip-b', 1000, 1, 1201);
    store.take('ip-c', 1000, 1, 1202);
    store.take('ip-d', 1000, 1, 1203);
    expect(store.size).toBeLessThanOrEqual(3);
  });

  it('returns 403 for invalid or malformed Origin and does not misreport it as 500', async () => {
    resetRateLimits();
    const server = await app();
    const invalid = await request(server).post('/api/auth/register').set('Origin', 'https://evil.example').send({});
    expect(invalid.status).toBe(403);
    expect(invalid.body.error.code).toBe('forbidden');
    const malformed = await request(server).post('/api/auth/register').set('Origin', 'not a URL').send({});
    expect(malformed.status).toBe(403);
    const allowed = await request(server).post('/api/auth/register').set('Origin', 'http://localhost:5173').send({});
    expect(allowed.status).toBe(400);
  });
});
