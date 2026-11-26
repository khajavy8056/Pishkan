/**
 * The tour engine's own rules, tested without a server.
 *
 * The two behaviours that decide whether a guide feels intelligent or broken are
 * both geometry, not copy: does a step find its element, and does a missing
 * element make the tour *skip* rather than point at nothing? Those are asserted
 * here on real DOM, plus the anchor contract the panels and the app have to keep
 * honouring — a name the catalogue invents is a step that silently never shows,
 * which no test of copy or colour would ever catch.
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import { anchorName, resolveAnchor } from '../src/lib/tours';

/**
 * jsdom reports every box as 0×0, which would make the size rule untestable —
 * every anchor would look absent. So a box is measured from the width and
 * height the test itself wrote, which is the only geometry jsdom knows about.
 */
const realRect = Element.prototype.getBoundingClientRect;
beforeAll(() => {
  Element.prototype.getBoundingClientRect = function rect(this: Element) {
    const style = (this as HTMLElement).style;
    const width = Number.parseFloat(style.width) || 0;
    const height = Number.parseFloat(style.height) || 0;
    return {
      x: 0, y: 0, top: 0, left: 0, right: width, bottom: height, width, height,
      toJSON: () => ({}),
    } as DOMRect;
  };
});
afterAll(() => {
  Element.prototype.getBoundingClientRect = realRect;
});

const ROOT = path.resolve(__dirname, '../../..');
const read = (...parts: string[]) => fs.readFileSync(path.join(ROOT, ...parts), 'utf-8');

const WEB_FILES = [
  'apps/web/src/pages/public/Services.tsx',
  'apps/web/src/pages/customer/CustomerPages.tsx',
  'apps/web/src/pages/customer/Documents.tsx',
  'apps/web/src/pages/staff/StaffPages.tsx',
  'apps/web/src/pages/shared/MessageCenter.tsx',
];

const MOBILE_FILES = [
  'apps/mobile/lib/screens/service_detail.dart',
  'apps/mobile/lib/screens/request_form.dart',
  'apps/mobile/lib/screens/request_detail.dart',
  'apps/mobile/lib/screens/profile.dart',
  'apps/mobile/lib/screens/documents.dart',
  'apps/mobile/lib/screens/chat.dart',
];

const catalog = read('apps/api/src/modules/tours/catalog.ts');
const webSource = WEB_FILES.map((file) => read(file)).join('\n');
/** Android registers an anchor with a name, not with an HTML attribute. */
const mobileSource = MOBILE_FILES.map((file) => read(file)).join('\n');

/** Every `target:` with the `altTargets:` of the same entry, as one group. */
function anchorGroups(text: string): string[][] {
  // Comments are dropped first: the catalogue documents its own reasoning
  // between fields, and a group must not be missed because a note sits between
  // a target and its fallbacks.
  const lines = text.split('\n').filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line));
  const groups: string[][] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const target = /target:\s*'tour:([^']+)'/.exec(lines[index]);
    if (!target) continue;
    const names = [target[1]];
    for (const neighbour of lines.slice(Math.max(0, index - 2), index + 3)) {
      const alt = /altTargets:\s*\[([^\]]*)\]/.exec(neighbour);
      if (alt) names.push(...[...alt[1].matchAll(/'tour:([^']+)'/g)].map((item) => item[1]));
    }
    groups.push(names);
  }
  return groups;
}

/** Tour blocks, each with the audience it is written for and its step groups. */
function tours(): { code: string; audience: string; groups: string[][] }[] {
  const source = catalog.slice(catalog.indexOf('export const TOURS'), catalog.indexOf('export const TOUR_HINTS'));
  const blocks = source.split(/\n  \{\n    code: '/).slice(1);
  return blocks.map((block) => ({
    code: block.slice(0, block.indexOf("'")),
    audience: /audience:\s*'([^']+)'/.exec(block)?.[1] ?? '',
    groups: anchorGroups(block),
  }));
}

const registered = {
  web: (name: string) => webSource.includes(`data-tour="${name}"`),
  mobile: (name: string) => mobileSource.includes(`name: '${name}'`),
};

describe('tour anchors', () => {
  it('maps a catalogue target onto the attribute a page sets', () => {
    render(<div data-tour="request-documents" style={{ width: 100, height: 40 }}>مدرک</div>);
    expect(document.querySelector(`[data-tour="${anchorName('tour:request-documents')}"]`)).toBeTruthy();
  });

  it('falls through the candidate list to the first anchor with real size', () => {
    render(
      <div>
        {/* A collapsed accordion measures nothing: it must not be framed. */}
        <div data-tour="hidden-one" style={{ width: 0, height: 0 }} />
        <div data-tour="fallback" style={{ width: 120, height: 24 }}>این</div>
      </div>,
    );
    const found = resolveAnchor(['tour:hidden-one', 'tour:fallback']);
    expect(found?.getAttribute('data-tour')).toBe('fallback');
    expect(resolveAnchor(['tour:nope'])).toBeNull();
    expect(resolveAnchor([undefined, ''])).toBeNull();
  });
});

describe('tour catalogue against the clients', () => {
  it('has steps to show on the web', () => {
    const list = tours();
    expect(list.length).toBeGreaterThanOrEqual(4);
    for (const tour of list) {
      for (const group of tour.groups) {
        const found = group.some((name) => registered.web(name));
        expect(found, `${tour.code}: no panel registers ${group.join(' / ')}`).toBe(true);
      }
    }
  });

  it('keeps the customer tours pointable on Android too', () => {
    // Parity is the whole reason the copy lives on the server: a step the phone
    // cannot anchor is a step that quietly exists for one client only.
    const list = tours().filter((tour) => tour.audience === 'customer');
    expect(list.length).toBe(2);
    for (const tour of list) {
      for (const group of tour.groups) {
        const found = group.some((name) => registered.mobile(name));
        expect(found, `${tour.code}: no screen registers ${group.join(' / ')}`).toBe(true);
      }
    }
  });

  it('points every tip at something a client can frame', () => {
    const hints = catalog.slice(catalog.indexOf('export const TOUR_HINTS'));
    const groups = anchorGroups(hints);
    expect(groups.length).toBeGreaterThanOrEqual(5);
    for (const group of groups) {
      expect(group.some((name) => registered.web(name) || registered.mobile(name)), `unframeable tip: ${group.join(' / ')}`)
        .toBe(true);
    }
  });

  it('leaves no anchor in a panel that the catalogue does not use', () => {
    const known = new Set(anchorGroups(catalog).flat());
    const webAnchors = [...webSource.matchAll(/data-tour="([^"]+)"/g)].map((match) => match[1]);
    const mobileAnchors = [...mobileSource.matchAll(/name: '([a-z-]+)'/g)].map((match) => match[1]);
    expect(webAnchors.length).toBeGreaterThan(10);
    for (const name of [...webAnchors, ...mobileAnchors]) {
      expect(known.has(name), `"${name}" is anchored but no tour or tip uses it`).toBe(true);
    }
  });

  it('keeps every tip sentence short enough to read in one glance', () => {
    const hintBlock = catalog.slice(catalog.indexOf('export const TOUR_HINTS'));
    const bodies = [...hintBlock.matchAll(/body:\s*'([^']+)'/g)].map((match) => match[1]);
    expect(bodies.length).toBeGreaterThanOrEqual(5);
    for (const body of bodies) {
      expect(body.length, `tip is too long to be a nudge: ${body}`).toBeLessThan(180);
    }
  });
});
