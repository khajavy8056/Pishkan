/**
 * The tour renderer: a spotlight, one card, and the short contextual tip.
 *
 * Nothing in this file knows what a tour is *about* — the steps come from
 * `/api/tours` (see `lib/tours.ts`) — and nothing in it decides whether a tour
 * should start. Its whole job is measurement and restraint:
 *
 *  - **It points at the element the server named**, found by
 *    `[data-tour="…"]`. A step whose element is not on screen is skipped, which
 *    is what lets one tour cross screens and keeps a layout change from stranding
 *    a card in the middle of the viewport.
 *  - **It follows the page.** Scroll, resize and an element that grows are all
 *    re-measured on the next frame; a tour whose ring has drifted off its target
 *    is worse than no tour, so the ring is recomputed rather than animated to a
 *    stale place.
 *  - **It gets out of the way when it is time to act.** On a step marked
 *    `interactive` the scrim stops swallowing clicks, the highlighted control
 *    stays usable, and using it advances the tour — the instruction and the
 *    action are the same gesture, which is the only way a guide teaches
 *    something instead of describing it.
 *  - **Escape always works, and skipping is always one tab away.**
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
// Shipped with this chunk rather than with the global stylesheet: a person who
// never sees a tour never pays for its CSS.
import '../../styles/tour.css';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';

import {
  beginTour, closeTour, completeTour, dismissTourHint, resolveAnchor, stepTour, tourForRoute, toursStore,
  type Tour, type TourHintCopy,
} from '../../lib/tours';

/** Padding around the highlighted element, in px. */
const PAD = 8;
/** Gap between the ring and the card. */
const GAP = 14;

interface Rect { top: number; left: number; width: number; height: number }

function frameOf(rect: Rect): Rect {
  return {
    top: rect.top - PAD,
    left: rect.left - PAD,
    width: rect.width + PAD * 2,
    height: rect.height + PAD * 2,
  };
}

/**
 * Where the card goes: the side with the most room, clamped into the viewport.
 *
 * `dir` is the *requested* side from the catalogue and is only a preference — an
 * element in a sticky footer is described from above even if the copy asked for
 * below, because a card that overflows the screen teaches nothing.
 */
function placeCard(frame: Rect, size: { width: number; height: number }, dir?: string) {
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const below = frame.top + frame.height + GAP;
  const above = frame.top - GAP - size.height;
  const roomBelow = viewport.height - below;
  const roomAbove = frame.top - GAP;
  const preferAbove = dir === 'top' ? roomAbove >= 0 : roomBelow < size.height + 16 && roomAbove > roomBelow;
  const top = preferAbove && roomAbove > 0
    ? Math.max(12, above)
    : Math.min(below, Math.max(12, viewport.height - size.height - 12));
  const left = Math.min(
    Math.max(12, frame.left + frame.width / 2 - size.width / 2),
    Math.max(12, viewport.width - size.width - 12),
  );
  return { top, left };
}

/** Live geometry of the first anchor that exists on screen, or null. */
function useTargetRect(targets: (string | undefined)[], deps: unknown[] = []) {
  const [rect, setRect] = useState<Rect | null>(null);
  const signature = targets.filter(Boolean).join('|');
  const element = useMemo(
    () => resolveAnchor(targets),
    // `signature` is the dependency: the candidate list is rebuilt on every step
    // change and on any re-render that matters, while the strings themselves are
    // not stable identities.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [signature, ...deps],
  );

  useLayoutEffect(() => {
    if (!element) { setRect(null); return; }
    let frame = 0;
    let alive = true;
    const measure = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (!alive) return;
        const box = element.getBoundingClientRect();
        // Display:none, a collapsed accordion, or an off-screen virtualised row
        // all measure as nothing. Treat them as "not here" and let the caller
        // skip the step rather than frame an empty rectangle.
        if (box.width < 2 || box.height < 2) { setRect(null); return; }
        setRect({ top: box.top, left: box.left, width: box.width, height: box.height });
      });
    };
    measure();
    const events: (keyof WindowEventMap)[] = ['scroll', 'resize'];
    for (const type of events) window.addEventListener(type, measure, { passive: true, capture: true });
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    observer?.observe(element);
    return () => {
      alive = false;
      if (frame) cancelAnimationFrame(frame);
      for (const type of events) window.removeEventListener(type, measure, { capture: true });
      observer?.disconnect();
    };
  }, [element]);

  return { rect, element };
}

function useCardSize(ref: React.RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState({ width: 368, height: 190 });
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const read = () => setSize({ width: node.offsetWidth, height: node.offsetHeight });
    read();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(read) : null;
    observer?.observe(node);
    return () => observer?.disconnect();
  }, [ref]);
  return size;
}

export function SmartTour() {
  const state = useSyncExternalStore(toursStore.subscribe, toursStore.snapshot, toursStore.snapshot);
  const location = useLocation();

  // The store is loaded by the shell; this only decides when to auto-start, and
  // it happens once per screen, after the page has painted what the tour points
  // at — starting a tour before its target exists means pointing at nothing.
  useEffect(() => {
    if (!state.loaded || state.open) return;
    const tour = tourForRoute(location.pathname);
    if (!tour) return;
    const first = tour.steps.find((step) => resolveAnchor([step.target, ...(step.altTargets ?? [])]));
    if (!first) return;
    const timer = window.setTimeout(() => {
      const current = tourForRoute(location.pathname);
      if (current) beginTour(current.code, Math.max(0, current.steps.indexOf(first)));
    }, 650);
    return () => window.clearTimeout(timer);
  }, [state.loaded, state.open, state.progress, location.pathname]);

  const tour = state.tours.find((item) => item.code === state.open) ?? null;
  if (!tour) return <TourTip tip={state.tip?.hint ?? null} />;
  return (
    <>
      <TourSpotlight tour={tour} stepIndex={state.stepIndex} />
      <TourTip tip={state.tip?.hint ?? null} dim />
    </>
  );
}

function TourSpotlight({ tour, stepIndex }: { tour: Tour; stepIndex: number }) {
  const step = tour.steps[Math.min(stepIndex, tour.steps.length - 1)];
  const cardRef = useRef<HTMLDivElement>(null);
  const cardSize = useCardSize(cardRef);
  const { rect, element } = useTargetRect([step?.target, ...(step?.altTargets ?? [])], [step?.id, tour.code]);
  const [frame, setFrame] = useState<Rect | null>(null);

  // Skippable by keyboard, from anywhere, without stealing focus from the card.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeTour(true); }
      if (event.key === 'ArrowLeft') stepTour(1);
      if (event.key === 'ArrowRight') stepTour(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // An element that has to be scrolled into view is scrolled once, gently.
  useEffect(() => {
    if (!element || rect) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
  }, [element, rect]);

  const interactive = Boolean(step?.interactive);
  const onFrame = useCallback((value: Rect | null) => setFrame(value), []);
  useLayoutEffect(() => {
    if (!rect) { onFrame(null); return; }
    onFrame(frameOf(rect));
  }, [rect, onFrame]);

  // Using the highlighted control finishes a "do this" step.
  useEffect(() => {
    if (!interactive || !element) return;
    const onClick = (event: MouseEvent) => {
      if (!element.contains(event.target as Node)) return;
      // Let the click do its real work first, then move on.
      window.setTimeout(() => {
        if (stepIndex >= tour.steps.length - 1) completeTour();
        else stepTour(1);
      }, 180);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [interactive, element, stepIndex, tour.steps.length]);

  if (!step) return null;

  // No frame means the target is not on this screen: show the card centred and
  // let the person move on, rather than rendering a ring around empty space.
  const position = frame ? placeCard(frame, cardSize, step.placement) : { top: Math.max(16, window.innerHeight / 2 - cardSize.height / 2), left: window.innerWidth / 2 - cardSize.width / 2 };
  const last = stepIndex >= tour.steps.length - 1;
  const visibleFrame = frame ?? { top: 0, left: 0, width: 0, height: 0 };

  return createPortal(
    <div className="pishkan-tour-scrim" data-mode={interactive ? 'interactive' : 'descriptive'} data-tour-open={step.target}>
      {frame && <div className="pishkan-tour-ring" style={{ top: visibleFrame.top, left: visibleFrame.left, width: visibleFrame.width, height: visibleFrame.height }} aria-hidden="true" />}
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="false"
        aria-label={`راهنمای ${tour.label} — مرحلهٔ ${stepIndex + 1} از ${tour.steps.length}`}
        tabIndex={-1}
        className="pishkan-tour-card rounded-2xl border border-white/15 bg-navy-900/95 p-4 text-white shadow-2xl backdrop-blur"
        style={{ top: position.top, left: position.left }}
      >
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="text-[11px] font-bold tracking-wide text-white/60">{tour.label}</span>
          <div className="pishkan-tour-dots flex items-center gap-1.5" aria-hidden="true">
            {tour.steps.map((item, index) => (
              <span key={item.id} data-current={index === stepIndex ? 'true' : 'false'} />
            ))}
          </div>
        </div>
        <h2 className="text-[15px] font-bold leading-6">{step.title}</h2>
        <p className="mt-1.5 text-[13px] leading-6 text-white/85">{step.body}</p>
        <div className="mt-3.5 flex items-center justify-between gap-2">
          <button type="button" onClick={() => closeTour(true)}
            className="rounded-lg px-2 py-1 text-xs font-semibold text-white/70 transition hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70">
            رد کردن
          </button>
          <div className="flex items-center gap-2">
            {stepIndex > 0 && (
              <button type="button" onClick={() => stepTour(-1)}
                className="rounded-lg border border-white/25 px-2.5 py-1 text-xs font-semibold text-white/85 transition hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70">
                قبلی
              </button>
            )}
            <button type="button" autoFocus onClick={() => (last ? completeTour() : stepTour(1))}
              className="rounded-lg bg-white px-3.5 py-1.5 text-xs font-bold text-navy-900 transition hover:bg-white/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70">
              {interactive ? 'انجامش می‌دهم' : last ? 'فهمیدم' : 'بعدی'}
            </button>
          </div>
        </div>
        {interactive && (
          <p className="mt-2 text-[11px] leading-5 text-white/60">
            همین حالا روی همان دکمه بزنید؛ راهنما خودش ادامه را می‌گیرد.
          </p>
        )}
      </div>
    </div>,
    document.body,
  );
}

/**
 * The contextual tip.
 *
 * Deliberately not a dialog: no scrim, no focus steal, no Escape-less modal, and
 * it never re-opens a tour. One sentence anchored to the control the person is
 * about to use again, dismissible by a click anywhere on it — because the
 * moment they have read it they want to get back to work, not to hunt a button.
 */
function TourTip({ tip, dim }: { tip: TourHintCopy | null; dim?: boolean }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const size = useCardSize(cardRef);
  const { rect } = useTargetRect([tip?.target, ...(tip?.altTargets ?? [])], [tip?.key]);
  if (!tip) return null;
  const frame = rect ? frameOf(rect) : null;
  const position = frame
    ? placeCard(frame, size, 'top')
    : { top: window.innerHeight - size.height - 20, left: window.innerWidth - size.width - 20 };
  return createPortal(
    <div ref={cardRef} role="status" aria-live="polite" data-tour-hint={tip.key}
      className={`pishkan-tour-tip rounded-2xl border p-3.5 shadow-xl backdrop-blur ${dim ? 'border-accent/40 bg-navy-900/95 text-white' : 'border-amber-300 bg-amber-50 text-navy-900'}`}
      style={{ top: position.top, left: position.left }}>
      <div className="flex items-start gap-2.5">
        <span aria-hidden="true" className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-full text-[13px] ${dim ? 'bg-accent text-white' : 'bg-amber-400 text-navy-900'}`}>
          ✦
        </span>
        <div className="min-w-0">
          <p className={`text-[13px] font-bold ${dim ? 'text-white' : 'text-navy-900'}`}>{tip.title}</p>
          <p className={`mt-0.5 text-xs leading-6 ${dim ? 'text-white/85' : 'text-navy-700'}`}>{tip.body}</p>
        </div>
        <button type="button" onClick={dismissTourHint} aria-label="بستن این راهنما"
          className={`mr-auto shrink-0 rounded-lg p-1 text-xs font-semibold transition ${dim ? 'text-white/70 hover:bg-white/10' : 'text-navy-500 hover:bg-amber-100'}`}>
          ✕
        </button>
      </div>
    </div>,
    document.body,
  );
}
