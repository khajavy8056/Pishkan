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
 *      properties (`--p`, `--mx`, `--my`, `--hero`, …). The expensive work stays
 *      in CSS, which the compositor can run off the main thread.
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
 */
export function useScrollProgress<T extends HTMLElement>(options: {
  start?: number;
  end?: number;
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
 */
export function useExitProgress<T extends HTMLElement>(
  propertyOrDistance: string | number = '--hero',
  options: { distance?: number } = {},
) {
  const property = typeof propertyOrDistance === 'string' ? propertyOrDistance : '--hero';
  const distance = typeof propertyOrDistance === 'number' ? propertyOrDistance : (options.distance ?? 0.8);
  const ref = useRef<T>(null);

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
      if (Math.abs(p - last) > 0.001) {
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

/** Hover tilt for 3D cards. Touch-inert. */
export function useHoverTilt<T extends HTMLElement>(max = 9) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (typeof window.matchMedia === 'function' && !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    if (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let frame = 0;
    const apply = (clientX: number, clientY: number) => {
      const rect = node.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const px = (clientX - rect.left) / rect.width - 0.5;
      const py = (clientY - rect.top) / rect.height - 0.5;
      node.style.transform = `perspective(1000px) rotateX(${(-py * max).toFixed(2)}deg) rotateY(${(px * max).toFixed(2)}deg) translateZ(6px)`;
    };
    const reset = () => { node.style.transform = ''; };
    const onMove = (event: PointerEvent) => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        apply(event.clientX, event.clientY);
      });
    };

    node.addEventListener('pointermove', onMove);
    node.addEventListener('pointerleave', reset);
    return () => {
      node.removeEventListener('pointermove', onMove);
      node.removeEventListener('pointerleave', reset);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [max]);
  return ref;
}

/** Pauses animations when off-screen. */
export function useVisibilityPause<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver !== 'function') return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {
      rootMargin: '140px',
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return { ref, visible };
}

/**
 * Reveals children as they enter the viewport (fail-open).
 */
export function useRevealOnScroll<T extends HTMLElement>(options: {
  stagger?: number;
  threshold?: number;
  observe?: React.RefObject<HTMLElement | null>;
} = {}) {
  const ownRef = useRef<T>(null);
  const { stagger = 70, threshold = 0.12, observe } = options;
  const ref = observe ?? (ownRef as React.RefObject<T | null>);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const reduced = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const canObserve = typeof IntersectionObserver === 'function' && !reduced;

    const seen = new WeakSet<Element>();
    let observer: IntersectionObserver | null = null;
    const scopedObservers: IntersectionObserver[] = [];

    const showNow = (el: HTMLElement) => el.classList.add('is-in');

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

      const scroller = inScroller(el);
      if (scroller) {
        // Items inside a horizontal snap-scroll rail should appear as soon as the rail is seen.
        showNow(el);
        return;
      }
      observer?.observe(el);
    };

    let seenCount = 0;
    const scan = () => {
      const found = Array.from(node.querySelectorAll<HTMLElement>('[data-reveal]'));
      if (!found.length) return;
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

    let mutationObserver: MutationObserver | null = null;
    if (typeof MutationObserver === 'function') {
      mutationObserver = new MutationObserver(() => scan());
      mutationObserver.observe(node, { childList: true, subtree: true });
    }

    return () => {
      observer?.disconnect();
      scopedObservers.forEach((o) => o.disconnect());
      mutationObserver?.disconnect();
      node.classList.remove('reveal-armed');
    };
  }, [stagger, threshold, ref]);

  return ref;
}

export const useReveal = useRevealOnScroll;

/**
 * Tracks whether the page has scrolled past a threshold, for the sticky header
 * and the scroll-progress bar.
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
