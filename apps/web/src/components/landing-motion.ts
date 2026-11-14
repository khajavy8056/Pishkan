/**
 * Motion primitives for the landing page.
 *
 * The page is built around three ideas:
 *
 *   1. **One frame loop.** Every scroll- and pointer-driven effect subscribes to
 *      a single `requestAnimationFrame` loop. Twenty separate listeners that each
 *      measure the DOM would thrash layout on a phone; this reads every geometry
 *      once per frame and writes styles once per frame.
 *   2. **Tokens, not values.** Effects publish a small set of CSS custom
 *      properties (`--p`, `--mx`, `--my`, …). The expensive work stays in CSS,
 *      which the compositor can run off the main thread.
 *   3. **Nothing is load-bearing.** If the loop never runs — reduced motion, an
 *      old browser, JavaScript disabled mid-flight — the page still reads
 *      correctly because every animated element has a sensible static state.
 */
import { useEffect, useRef, useState } from 'react';

/** True when the visitor asked the OS to reduce motion. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

/**
 * Progress of an element through the viewport, 0 → 1.
 *
 * 0 means its top edge just reached the bottom of the viewport; 1 means its
 * bottom edge just left the top. The value is written to the element as the
 * `--p` custom property, so CSS can drive transforms without React re-rendering
 * on every frame.
 */
export function useScrollProgress<T extends HTMLElement>(options: {
  /** Start the range once the element is this far into the viewport (0-1). */
  start?: number;
  /** End the range when it has travelled this far (0-1). */
  end?: number;
  /** Also publish a −1…1 value centred on the viewport as `--c`. */
  centred?: boolean;
} = {}) {
  const ref = useRef<T>(null);
  const { start = 0, end = 1, centred = false } = options;

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    let frame = 0;
    let last = -1;

    const measure = () => {
      frame = 0;
      const rect = node.getBoundingClientRect();
      const viewport = window.innerHeight || 1;
      // Distance the element has travelled from "just below the fold" to
      // "just above the fold", including the element's own height.
      const span = viewport + rect.height;
      const travelled = viewport - rect.top;
      let p = travelled / span;
      p = (p - start) / Math.max(0.0001, end - start);
      p = Math.min(1, Math.max(0, p));
      if (Math.abs(p - last) > 0.0015) {
        last = p;
        node.style.setProperty('--p', p.toFixed(3));
        if (centred) node.style.setProperty('--c', (p * 2 - 1).toFixed(3));
      }
    };

    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule, { passive: true });
    return () => {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [start, end, centred]);

  return ref;
}

/**
 * How far an element has scrolled *out* of the viewport, published as `--hero`
 * (or a custom property of your choosing) in the range 0…1.
 *
 * Distinct from `useScrollProgress`, which starts counting while the element is
 * still entering from below. A hero sits at the top of the page, so on load it
 * is already "high" on that scale; this hook instead reads 0 exactly while the
 * hero is in its resting position and climbs to 1 as it leaves. Every piece of
 * the hero then multiplies that single 0…1 token by its own amount, so the
 * whole composition lifts apart at different rates from one number.
 */
export function useExitProgress<T extends HTMLElement>(
  property = '--hero',
  options: { distance?: number } = {},
) {
  const ref = useRef<T>(null);
  const { distance = 0.85 } = options;

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    let frame = 0;
    let last = -1;

    const measure = () => {
      frame = 0;
      const rect = node.getBoundingClientRect();
      const span = Math.max(1, rect.height * distance);
      const p = Math.min(1, Math.max(0, -rect.top / span));
      if (Math.abs(p - last) > 0.0015) {
        last = p;
        node.style.setProperty(property, p.toFixed(3));
      }
    };

    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule, { passive: true });
    return () => {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [property, distance]);

  return ref;
}

/**
 * Pointer position over an element, published as `--mx` / `--my` in the range
 * −1…1, plus `--px` / `--py` in 0…1. Pointer-only: on touch devices this never
 * fires, and the element keeps its resting state.
 */
export function usePointerTilt<T extends HTMLElement>(strength = 1) {
  const ref = useRef<T>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (typeof window.matchMedia !== 'function') return;
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;

    let frame = 0;
    let target = { x: 0, y: 0 };
    let current = { x: 0, y: 0 };
    let running = false;

    const apply = () => {
      frame = 0;
      // Ease toward the pointer instead of snapping, so a quick mouse sweep
      // reads as the object following rather than teleporting.
      current.x += (target.x - current.x) * 0.14;
      current.y += (target.y - current.y) * 0.14;
      node.style.setProperty('--mx', (current.x * strength).toFixed(4));
      node.style.setProperty('--my', (current.y * strength).toFixed(4));
      node.style.setProperty('--px', ((current.x + 1) / 2).toFixed(4));
      node.style.setProperty('--py', ((current.y + 1) / 2).toFixed(4));
      if (Math.abs(target.x - current.x) > 0.0008 || Math.abs(target.y - current.y) > 0.0008) {
        frame = requestAnimationFrame(apply);
      } else {
        running = false;
      }
    };

    const onMove = (event: PointerEvent) => {
      const rect = node.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      target = {
        x: Math.max(-1, Math.min(1, ((event.clientX - rect.left) / rect.width) * 2 - 1)),
        y: Math.max(-1, Math.min(1, ((event.clientY - rect.top) / rect.height) * 2 - 1)),
      };
      if (!running) { running = true; frame = requestAnimationFrame(apply); }
    };
    const onLeave = () => {
      target = { x: 0, y: 0 };
      if (!running) { running = true; frame = requestAnimationFrame(apply); }
    };

    node.addEventListener('pointermove', onMove);
    node.addEventListener('pointerleave', onLeave);
    return () => {
      node.removeEventListener('pointermove', onMove);
      node.removeEventListener('pointerleave', onLeave);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [strength]);

  return ref;
}

/**
 * Reveals children as they enter the viewport.
 *
 * Returns a ref to put on a container; every `[data-reveal]` descendant gets
 * `.is-in` once it has been seen. Deliberately one observer per section rather
 * than one per element, and it unobserves after firing — the animation is a
 * one-shot, so re-entering the viewport must not replay it.
 */
export function useRevealOnScroll<T extends HTMLElement>(options: {
  /** Stagger index → delay in ms, read from `data-reveal`'s sibling order. */
  stagger?: number;
  threshold?: number;
  /**
   * Observe this element instead of the returned ref.
   *
   * Needed when the caller already owns a ref on the same node for another
   * purpose — a single DOM node can only take one React `ref`, and silently
   * overwriting the caller's ref would break their effect instead.
   */
  observe?: React.RefObject<HTMLElement | null>;
} = {}) {
  const ownRef = useRef<T>(null);
  const { stagger = 70, threshold = 0.15, observe } = options;
  const ref = observe ?? (ownRef as React.RefObject<T | null>);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const reduced = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const canObserve = typeof IntersectionObserver === 'function' && !reduced;

    // The sections this hook serves are filled asynchronously — categories and
    // popular services arrive from `/api/public/site` *after* the first render.
    // A one-shot querySelectorAll therefore found nothing, the observer was
    // never attached to the real cards, and because the effect's dependencies
    // never change it never ran again: those cards stayed at opacity:0 forever.
    // Re-scanning on DOM mutation is what makes the reveal survive async data.
    const seen = new WeakSet<Element>();
    let observer: IntersectionObserver | null = null;
    const scopedObservers: IntersectionObserver[] = [];

    /** Show an element immediately (no observer available or reduced motion). */
    const showNow = (el: HTMLElement) => el.classList.add('is-in');

    /** Nearest ancestor that scrolls, e.g. the category rail. */
    const inScroller = (el: Element): Element | null => {
      let parent = el.parentElement;
      while (parent && parent !== node) {
        const style = window.getComputedStyle(parent);
        if (/(auto|scroll)/.test(style.overflowX) || /(auto|scroll)/.test(style.overflowY)) return parent;
        parent = parent.parentElement;
      }
      return null;
    };

    const watch = (el: HTMLElement) => {
      if (seen.has(el)) return;
      seen.add(el);
      if (!el.dataset.revealIndex) el.dataset.revealIndex = String(seenCount++);
      if (!canObserve) { showNow(el); return; }

      // Cards inside a horizontal rail are clipped by it, so they are observed
      // against the rail: a swipe then reveals them as they come into view
      // instead of the rail scrolling into blank space.
      const scroller = inScroller(el);
      if (scroller) {
        const railObserver = new IntersectionObserver((entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            (entry.target as HTMLElement).classList.add('is-in');
            railObserver.unobserve(entry.target);
          }
        }, { root: scroller as Element, threshold: 0, rootMargin: '0px 120px 0px 120px' });
        railObserver.observe(el);
        scopedObservers.push(railObserver);
        return;
      }
      observer?.observe(el);
    };

    let seenCount = 0;
    const scan = () => {
      const found = Array.from(node.querySelectorAll<HTMLElement>('[data-reveal]'));
      if (!found.length) return;
      // Arm the hidden state only once there is something to animate, and only
      // when an observer can actually reveal it again. See the note in
      // styles.css: an unarmed page stays readable no matter what.
      if (canObserve) node.classList.add('reveal-armed');
      for (const el of found) watch(el);
    };

    if (canObserve) {
      observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const el = entry.target as HTMLElement;
          const index = Number(el.dataset.revealIndex ?? 0);
          el.style.transitionDelay = `${Math.min(index * stagger, 480)}ms`;
          el.classList.add('is-in');
          observer?.unobserve(el);
        }
      }, { threshold, rootMargin: '0px 0px -8% 0px' });
    }

    scan();

    // Pick up content that arrives after the first paint. One observer for the
    // whole section, and only over children: cheap enough to run while the site
    // payload streams in, and it disconnects with the component.
    let mutationObserver: MutationObserver | null = null;
    if (typeof MutationObserver === 'function') {
      mutationObserver = new MutationObserver(() => scan());
      mutationObserver.observe(node, { childList: true, subtree: true });
    }

    return () => {
      observer?.disconnect();
      scopedObservers.forEach((o) => o.disconnect());
      mutationObserver?.disconnect();
    };
  }, [stagger, threshold, ref]);

  return ref;
}

/**
 * Tracks whether the page has scrolled past a threshold, for the sticky header
 * and the scroll-progress bar. Reads scrollY only — no layout measurement.
 */
export function useScrollState(threshold = 24) {
  const [state, setState] = useState({ scrolled: false, progress: 0 });
  useEffect(() => {
    let frame = 0;
    const read = () => {
      frame = 0;
      const doc = document.documentElement;
      const max = doc.scrollHeight - window.innerHeight;
      const progress = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
      setState((prev) => {
        const scrolled = window.scrollY > threshold;
        if (prev.scrolled === scrolled && Math.abs(prev.progress - progress) < 0.004) return prev;
        return { scrolled, progress };
      });
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(read); };
    read();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule, { passive: true });
    return () => {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [threshold]);
  return state;
}
