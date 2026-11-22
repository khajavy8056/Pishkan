import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from './helpers.js';

describe('web security headers on LAN and HTTPS', () => {
  it('does not upgrade local HTTP assets to nonexistent HTTPS, while preserving the CSP', async () => {
    const server = await app();
    const response = await request(server).get('/').set('Host', '192.168.1.2:2981').expect(200);
    const csp = response.headers['content-security-policy'] as string;
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toContain('upgrade-insecure-requests');
  });

  it('retains upgrade-insecure-requests for HTTPS behind a trusted proxy', async () => {
    const server = await app();
    const response = await request(server).get('/').set('X-Forwarded-Proto', 'https').expect(200);
    expect(response.headers['content-security-policy']).toContain('upgrade-insecure-requests');
  });
});
