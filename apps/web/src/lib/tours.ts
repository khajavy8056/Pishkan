/**
 * Client side of the guided tours: one store, no context, no provider.
 *
 * The tour has to be reachable from anywhere (the request form fires a hint,
 * the shell draws it) without dragging a provider through eight page
 * components, so it is a tiny observable module — the same shape `lib/push.ts`
 * uses. Two details matter more than the structure:
 *
 *  - **Nothing is decided here.** Whether a tour may auto-start and whether a tip
 *    may interrupt are answered by `/api/tours`, so the web app and Android
 *    cannot diverge, and the office can retune both from one screen.
 *  - **`localStorage` is a cache, never the truth.** The cached payload is what
 *    lets the spotlight appear on the first paint instead of a moment after a
 *    round trip; the server remains the only place `completed`/`dismissed` is
 *    decided. A person using a different browser sees the same answer.
 */
import { api } from './api';

export interface TourStep {
  id: string;
  target: string;
  altTargets?: string[];
  title: string;
  body: string;
  route?: string;
  placement?: 'top' | 'bottom' | 'start' | 'end';
  interactive?: boolean;
}

export interface Tour {
  code: string;
  label: string;
  audience: 'customer' | 'office';
  anchor: string;
  steps: TourStep[];
}

export interface TourHintCopy {
  key: string;
  target: string;
  altTargets?: string[];
  title: string;
  body: string;
}

/** The attribute value of an anchor: `tour:request-form` → `request-form`. */
export function anchorName(target: string): string {
  return target.replace(/^tour:/, '');
}

/**
 * The first anchor of a step that is actually on this screen.
 *
 * One catalogue serves both layouts, so a step may name an ideal element and
 * several fallbacks; whichever is present wins, and `null` means the caller
 * skips the step instead of framing empty space.
 */
export function resolveAnchor(targets: (string | undefined)[], root: ParentNode = document): HTMLElement | null {
  for (const target of targets) {
    if (!target) continue;
    const node = root.querySelector<HTMLElement>(`[data-tour="${anchorName(target)}"]`);
    if (!node) continue;
    const box = node.getBoundingClientRect();
    if (box.width < 2 || box.height < 2) continue;
    return node;
  }
  return null;
}

export interface TourProgress {
  step: number;
  completed: boolean;
  dismissed: boolean;
}

export interface TourSnapshot {
  loaded: boolean;
  enabled: boolean;
  autoStart: boolean;
  tours: Tour[];
  hints: TourHintCopy[];
  progress: Record<string, TourProgress>;
  /** The tour currently on screen, if any. */
  open: string | null;
  stepIndex: number;
  /** A contextual tip that was granted by the server and has not been dismissed. */
  tip: { hint: TourHintCopy; at: number } | null;
}

const CACHE_KEY = 'pishkan:tours:v1';

let snapshot: TourSnapshot = {
  loaded: false, enabled: false, autoStart: false, tours: [], hints: [], progress: {},
  open: null, stepIndex: 0, tip: null,
};

const listeners = new Set<() => void>();
let inflight: Promise<void> | null = null;
/** Steps already auto-started in this browser session, so a re-render cannot reopen one. */
const startedThisSession = new Set<string>();
let tipTimer: ReturnType<typeof setTimeout> | null = null;

function emit() {
  for (const listener of listeners) listener();
}

function set(patch: Partial<TourSnapshot>) {
  snapshot = { ...snapshot, ...patch };
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function tourSnapshot(): TourSnapshot {
  return snapshot;
}

function readCache(): Partial<TourSnapshot> | null {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) as Partial<TourSnapshot> : null;
  } catch {
    return null;
  }
}

function writeCache() {
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify({
      enabled: snapshot.enabled, autoStart: snapshot.autoStart,
      tours: snapshot.tours, hints: snapshot.hints, progress: snapshot.progress,
    }));
  } catch {
    /* private mode: the tour still works, it just starts a beat later */
  }
}

/**
 * Load once per session; a cached copy is applied first so the very first paint
 * can already show the spotlight.
 */
export async function loadTours(): Promise<void> {
  if (inflight) return inflight;
  const cached = readCache();
  if (cached && !snapshot.loaded) set({ ...cached, loaded: false });
  inflight = (async () => {
    try {
      const { data } = await api.get<{ data: {
        enabled: boolean; autoStart: boolean; tours: Tour[]; hints: TourHintCopy[];
        state: Record<string, TourProgress>;
      } }>('/api/tours');
      set({
        loaded: true,
        enabled: data.enabled === true,
        autoStart: data.autoStart === true,
        tours: Array.isArray(data.tours) ? data.tours : [],
        hints: Array.isArray(data.hints) ? data.hints : [],
        progress: data.state ?? {},
      });
      writeCache();
    } catch {
      // A tour is a nicety: a failed load must leave the product fully usable,
      // so it stays silent and marks itself loaded to stop retrying every mount.
      set({ loaded: true, tours: snapshot.loaded ? snapshot.tours : [] });
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

async function post(code: string, body: Record<string, unknown>) {
  try {
    const { data } = await api.post<{ data: { step: number; completed: boolean; dismissed: boolean } }>(`/api/tours/${code}`, body);
    set({ progress: { ...snapshot.progress, [code]: { step: data.step ?? 0, completed: data.completed, dismissed: data.dismissed } } });
    writeCache();
  } catch {
    /* progress is best-effort */
  }
}

/** First eligible tour for this screen, if the person has not been through it. */
export function tourForRoute(pathname: string): Tour | undefined {
  if (!snapshot.enabled || !snapshot.autoStart) return undefined;
  return snapshot.tours.find((tour) => !startedThisSession.has(tour.code)
    && (snapshot.progress[tour.code]?.completed !== true)
    // A tour that cannot find a single anchor on this screen is not offered —
    // the alternative to this rule is a card floating in the middle of a page.
    && tour.steps.some((step) => resolveAnchor([step.target, ...(step.altTargets ?? [])])));
}

export function beginTour(code: string, stepIndex = 0) {
  startedThisSession.add(code);
  set({ open: code, stepIndex });
  void post(code, { action: stepIndex === 0 ? 'start' : 'step', step: stepIndex });
}

export function stepTour(delta: 1 | -1) {
  const tour = snapshot.tours.find((item) => item.code === snapshot.open);
  if (!tour) return;
  const next = Math.max(0, Math.min(tour.steps.length - 1, snapshot.stepIndex + delta));
  set({ stepIndex: next });
  if (delta > 0) void post(tour.code, { action: 'step', step: next });
}

export function completeTour() {
  const code = snapshot.open;
  if (!code) return;
  set({ open: null, stepIndex: 0, tip: null });
  void post(code, { action: 'complete' });
}

/** «بعدی» on the last step and «رد کردن» both mean: stop, do not come back on your own. */
export function closeTour(dismiss = false) {
  const code = snapshot.open;
  if (!code) return;
  set({ open: null, stepIndex: 0 });
  if (dismiss) void post(code, { action: 'dismiss' });
}

/** The explicit «راهنمای این صفحه» entry point — allowed even after a completion. */
export async function replayTour(code: string) {
  startedThisSession.delete(code);
  await post(code, { action: 'replay' });
  const tour = snapshot.tours.find((item) => item.code === code);
  if (tour) beginTour(code, 0);
}

/**
 * Ask whether a contextual tip may be shown, and show it if the server agrees.
 *
 * Called on every recognised wrong action — the counting is the server's job, so
 * a customer who errs twice in the app and twice on the web is recognised as the
 * same pattern, and one who clears browser storage is not reset to zero.
 */
export async function fireTourHint(key: string): Promise<boolean> {
  if (!snapshot.enabled) return false;
  try {
    const { data } = await api.post<{ data: { show: boolean; hint: TourHintCopy | null } }>('/api/tours/hint', { key });
    if (!data?.show || !data.hint) return false;
    set({ tip: { hint: data.hint, at: Date.now() } });
    if (tipTimer) clearTimeout(tipTimer);
    // Long enough to read twice, short enough that ignoring it is not a cost.
    tipTimer = setTimeout(() => set({ tip: null }), 9_000);
    return true;
  } catch {
    return false;
  }
}

export function dismissTourHint() {
  if (tipTimer) clearTimeout(tipTimer);
  set({ tip: null });
}

export const toursStore = { subscribe, snapshot: tourSnapshot };
