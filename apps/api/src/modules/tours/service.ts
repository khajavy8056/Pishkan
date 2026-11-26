/**
 * Tour state and the tip policy.
 *
 * Two rules, both of which the reported complaint is about:
 *
 *  1. A tour starts by itself **once**. After that it is never imposed:
 *     `completed` means done (never auto-start again), `dismissed` means «الان
 *     نه» (may be offered again after a gap, because a person who was in a hurry
 *     last month may have time now — and only if they are back on the screen the
 *     tour is about).
 *  2. A tip is earned by repetition and bounded per day. `hintRepeatAfter`
 *     occurrences before the first interruption, `hintMaxPerDay` interruptions
 *     after that, and a tip is never re-shown for the same mistake twice in a
 *     row. This is the difference between a system that notices you are stuck
 *     and a system that scolds you.
 *
 * The policy lives here rather than in each client so web and Android behave
 * identically and the office can retune it without a release.
 */
import { nowIso, one, q, run } from '../../db/index.js';
import { getBool, getJson, getNumber } from '../settings/service.js';
import { TOURS, TOUR_HINTS, applyTourOverrides, hintByKey, tourByCode, type Tour, type TourHint } from './catalog.js';

export interface TourState {
  step: number;
  completed: boolean;
  dismissed: boolean;
}

export interface TourPayload {
  enabled: boolean;
  autoStart: boolean;
  hints: { repeatAfter: number; maxPerDay: number };
  tours: Tour[];
  hintsCatalog: TourHint[];
  /** Per tour code, as this person has left it. */
  state: Record<string, TourState>;
}

function tehranDay(): string {
  // The daily budget must roll over in the office's own day, not at 03:30 GMT.
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tehran' });
}

/**
 * `tours.copy_override` is the office's way of rewording a step without a
 * deploy: `{ "tours": { "customer-request": { "documents": { "body": "…" } } },
 * "hints": { "document-from-profile": { "title": "…" } } }`. Unknown keys are
 * ignored rather than failing, so a typo in the settings box cannot take the
 * guide away from anybody.
 */
async function overrides(): Promise<Record<string, any>> {
  return getJson<Record<string, any>>('tours.copy_override', {});
}

/** The catalogue as this deployment is configured to show it. */
export async function toursForAudience(audience: 'customer' | 'office'): Promise<{ tours: Tour[]; hints: TourHint[] }> {
  const scoped = TOURS.filter((tour) => tour.audience === audience);
  const { tours, hints } = applyTourOverrides(scoped, TOUR_HINTS, await overrides());
  return { tours, hints };
}

async function statesFor(userId: string): Promise<Record<string, TourState>> {
  const rows = await q<any>('SELECT * FROM user_tour_states WHERE user_id = ?', [userId]);
  const map: Record<string, TourState> = {};
  for (const row of rows) {
    map[row.tour_code] = {
      step: Number(row.step ?? 0),
      completed: Boolean(Number(row.completed ?? 0)),
      dismissed: Boolean(Number(row.dismissed ?? 0)),
    };
  }
  return map;
}

export async function tourPayload(userId: string, audience: 'customer' | 'office'): Promise<TourPayload> {
  const { tours, hints } = await toursForAudience(audience);
  const enabled = await getBool('tours.enabled');
  const autoStart = await getBool('tours.auto_start');
  // Only tours that can still be seen are sent: a customer who finished the
  // request tour should not carry its copy over the wire on every launch.
  const visible: Tour[] = [];
  for (const tour of tours) {
    if (!(await isHidden(userId, tour.code, enabled, autoStart))) visible.push(tour);
  }
  return {
    enabled,
    autoStart,
    hints: {
      repeatAfter: await getNumber('tours.hint_repeat_after'),
      maxPerDay: await getNumber('tours.hint_max_per_day'),
    },
    tours: visible,
    hintsCatalog: hints,
    state: await statesFor(userId),
  };
}

/** Completed, or dismissed and not yet due to be asked again. */
async function isHidden(userId: string, code: string, enabled: boolean, autoStart: boolean): Promise<boolean> {
  if (!enabled) return true;
  const row = await one<any>('SELECT completed, dismissed, updated_at FROM user_tour_states WHERE user_id = ? AND tour_code = ?', [userId, code]);
  if (!row) return false;
  if (Number(row.completed ?? 0)) return true;
  if (!autoStart) return true;
  if (Number(row.dismissed ?? 0)) {
    // A dismissal is a delay, not a sentence — but a long one, and only the
    // client can decide whether the person is back on the right screen.
    const days = await getNumber('tours.dismiss_retry_days');
    const at = Date.parse(String(row.updated_at ?? ''));
    if (!Number.isFinite(at)) return false;
    return Date.now() - at < days * 86_400_000;
  }
  return false;
}

export async function recordTourProgress(
  userId: string,
  code: string,
  action: 'start' | 'step' | 'complete' | 'dismiss' | 'replay',
  step = 0,
): Promise<TourState> {
  const tour = tourByCode(code);
  if (!tour) throw new Error('tour-unknown');
  const ts = nowIso();
  if (action === 'replay') {
    await run('DELETE FROM user_tour_states WHERE user_id = ? AND tour_code = ?', [userId, code]);
    return { step: 0, completed: false, dismissed: false };
  }
  const values = {
    step: action === 'step' ? Math.max(0, Math.min(tour.steps.length - 1, step)) : 0,
    completed: action === 'complete' ? 1 : 0,
    dismissed: action === 'dismiss' ? 1 : 0,
    started_at: action === 'start' ? ts : null,
  };
  await run(
    `INSERT INTO user_tour_states (user_id, tour_code, step, completed, dismissed, started_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, tour_code) DO UPDATE SET
       step = excluded.step, completed = excluded.completed, dismissed = excluded.dismissed,
       started_at = COALESCE(excluded.started_at, user_tour_states.started_at), updated_at = excluded.updated_at`,
    [userId, code, values.step, values.completed, values.dismissed, values.started_at, ts],
  );
  return { step: values.step, completed: Boolean(values.completed), dismissed: Boolean(values.dismissed) };
}

/**
 * May this tip be shown now?
 *
 * Counts the occurrence whether or not it is shown — that is what makes the
 * next one arrive sooner for someone who keeps hitting the same wall, while the
 * daily cap keeps it from becoming a metronome. `reason` is returned for logs
 * and for the tests, never for the user.
 */
export async function requestHint(
  userId: string,
  key: string,
): Promise<{ show: boolean; reason: string; hint?: TourHint }> {
  const hint = hintByKey(key);
  if (!hint) return { show: false, reason: 'unknown-hint' };
  // Globally off means the feature does not exist, and it must not write
  // anything. `hints_enabled` is different: it means "do not interrupt me", and
  // the count keeps accumulating, so an office that switches tips back on next
  // week finds the patterns that were already there instead of making the
  // customer repeat the mistake twice more.
  if (!(await getBool('tours.enabled'))) return { show: false, reason: 'disabled' };
  const allowedToDisplay = await getBool('tours.hints_enabled');

  const repeatAfter = Math.max(1, await getNumber('tours.hint_repeat_after'));
  const maxPerDay = Math.max(0, await getNumber('tours.hint_max_per_day'));
  const day = tehranDay();
  const ts = nowIso();
  const row = await one<any>('SELECT * FROM user_tour_hints WHERE user_id = ? AND hint_key = ?', [userId, key]);

  const occurrences = Number(row?.occurrences ?? 0) + 1;
  const shownToday = Number(row?.shown_today ?? 0);
  const lastShownAt = Number(row?.last_shown_occurrence ?? 0);

  let show = false;
  let reason = '';
  if (!allowedToDisplay) {
    reason = 'hints-off';
  } else if (occurrences < repeatAfter) {
    // The first time is nobody's problem yet — people mis-click.
    show = false; reason = 'not-yet';
  } else if (shownToday >= maxPerDay) {
    show = false; reason = 'daily-cap';
  } else if (lastShownAt > 0 && occurrences - lastShownAt < repeatAfter) {
    show = false; reason = 'still-recent';
  } else {
    show = true; reason = 'shown';
  }

  // Every number is computed from the row we just read and written back whole:
  // portable across SQLite and PostgreSQL, and free of `CASE`/`excluded` tricks
  // that behave differently in the two dialects. Two requests landing in the
  // same millisecond can lose one count, which for a tip budget is a tip shown
  // a minute later than it would have been — not worth a transaction.
  const shownCount = Number(row?.shown_count ?? 0) + (show ? 1 : 0);
  const lastShownOccurrence = show ? occurrences : Number(row?.last_shown_occurrence ?? 0);
  const sameDay = String(row?.last_day ?? '') === day;
  const todayCount = sameDay ? shownToday : 0;
  await run(
    `INSERT INTO user_tour_hints (user_id, hint_key, occurrences, shown_count, last_shown_occurrence, shown_today, last_day, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, hint_key) DO UPDATE SET
       occurrences = excluded.occurrences, shown_count = excluded.shown_count,
       last_shown_occurrence = excluded.last_shown_occurrence, shown_today = excluded.shown_today,
       last_day = excluded.last_day, updated_at = excluded.updated_at`,
    [userId, key, occurrences, shownCount, lastShownOccurrence, show ? todayCount + 1 : todayCount, day, ts],
  ).catch(() => undefined);

  return { show, reason, hint: show ? hint : undefined };
}

/** Admin-facing counters: what the office is actually interrupting people with. */
export async function tourDiagnostics(): Promise<{ tours: { code: string; label: string; started: number; completed: number; dismissed: number }[]; hints: { key: string; shown: number; people: number }[] }> {
  const tourRows = await q<any>(
    `SELECT tour_code, COUNT(*) AS people,
            SUM(completed) AS completed, SUM(dismissed) AS dismissed, SUM(CASE WHEN started_at IS NOT NULL THEN 1 ELSE 0 END) AS started
     FROM user_tour_states GROUP BY tour_code`,
  );
  const hintRows = await q<any>(
    `SELECT hint_key, SUM(shown_count) AS shown, COUNT(*) AS people FROM user_tour_hints GROUP BY hint_key`,
  );
  return {
    tours: tourRows.map((row: any) => ({
      code: row.tour_code,
      label: tourByCode(row.tour_code)?.label ?? row.tour_code,
      started: Number(row.started ?? 0),
      completed: Number(row.completed ?? 0),
      dismissed: Number(row.dismissed ?? 0),
    })),
    hints: hintRows.map((row: any) => ({
      key: row.hint_key,
      shown: Number(row.shown ?? 0),
      people: Number(row.people ?? 0),
    })),
  };
}
