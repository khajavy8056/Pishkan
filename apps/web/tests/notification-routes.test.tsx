/**
 * A notification link is only useful if the app has a screen for it.
 *
 * Two failures were reported together: notices that opened the home page instead
 * of the thing they announced, and notices whose link (`/staff/messages/<id>`)
 * was a route nobody had registered, which the router answered with «۴۰۴». The
 * API builds links, the web app owns the route table, and nothing connected
 * them — this file is that connection.
 *
 * It reads the real sources instead of restating them: every route the
 * notification layer can fall back to (PANEL_SECTIONS) and every per-entity
 * link shape it can emit must appear in the router. Adding a section to the
 * server without adding the screen is now a failing test, not a user complaint.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../../..');
const read = (...parts: string[]) => fs.readFileSync(path.join(ROOT, ...parts), 'utf-8');

const router = read('apps/web/src/main.tsx');
const notifications = read('apps/api/src/modules/notifications/service.ts');
const messagesRoute = read('apps/api/src/routes/messages.ts');

/** Every `path="…"` the router registers, including the nested ones. */
function registeredRoutes(source: string): string[] {
  return [...source.matchAll(/<Route\s+[^>]*path="([^"]+)"/g)].map((m) => m[1]);
}

/** The object literal of routes the notification layer falls back to. */
function panelSectionRoutes(source: string): string[] {
  const block = source.slice(source.indexOf('const PANEL_SECTIONS'), source.indexOf('/** Machine `event_type`'));
  return [...block.matchAll(/'(\/[^']+)'/g)].map((m) => m[1]);
}

describe('notification destinations', () => {
  const routes = registeredRoutes(router);

  it('registers a panel section for every fallback the notification layer knows', () => {
    const sections = panelSectionRoutes(notifications);
    expect(sections.length).toBeGreaterThan(10);
    // Exact equality where a section lists a screen, so a rename in either
    // file (route or fallback) is a failure here rather than a broken tap.
    for (const route of sections) {
      expect(routes, `the router must register ${route}`).toContain(route);
    }
  });

  it('opens one conversation directly, on all three panels', () => {
    // The message routes carry a param, which is what makes "tap the notice →
    // read that thread" possible at all.
    for (const panel of ['/app', '/staff', '/admin']) {
      expect(routes).toContain(`${panel}/messages/:threadId`);
    }
  });

  it('has a screen for every link shape the message router emits', () => {
    const threadLink = messagesRoute.slice(
      messagesRoute.indexOf('function threadLink('),
      messagesRoute.indexOf('function threadLink(') + 700,
    );
    const literals = [...threadLink.matchAll(/return [`']([^`']+)[`']/g)].map((m) => m[1].replace(/\$\{[^}]+\}/, ':threadId'));
    expect(literals.length).toBe(3);
    for (const literal of literals) {
      expect(routes, `the router must register ${literal}`).toContain(literal);
    }
  });

  it('does not send an admin to a staff-only screen', () => {
    // /admin/documents and /admin/accounting do not exist; a prefix-built link
    // was how a correct-looking notice ended on a 404.
    const adminSectionRoutes = panelSectionRoutes(notifications).filter((r) => r.startsWith('/admin'));
    for (const route of adminSectionRoutes) {
      expect(route).not.toMatch(/\/admin\/(documents|accounting)$/);
    }
    expect(routes).not.toContain('/admin/documents');
  });
});
