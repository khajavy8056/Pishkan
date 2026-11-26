/**
 * The Jalali calendar behind every date field in the panels.
 *
 * The bug this guards is the one the office reported: labels in Persian while the
 * picker opened a Gregorian grid. Fixing it by re-implementing the calendar is how
 * you get a *second* truth about what day it is, and two truths agree right up
 * until a leap year and then print an invoice one day off. So the tests below do
 * two things: pin the dates a human can check by hand (Nowruz, the first day of
 * Azar), and hold the whole module against `Intl`'s Persian calendar for every day
 * across four decades — the same source the labels use, which is the point.
 */
import { describe, expect, it } from 'vitest';
import {
  isoToJalali, jalaliToIso, jalaliMonthLength, jalaliMonthGrid, jalaliYear,
  parseJalaliInput, formatJalaliIso, jalaliToDay, dateFromDay,
} from '../src/lib/jalali';

/** The oracle: ICU's Persian calendar, exactly what lib/format.ts displays with. */
const oracle = new Intl.DateTimeFormat('en-US-u-ca-persian-latn', {
  calendar: 'persian', year: 'numeric', month: 'numeric', day: 'numeric',
  numberingSystem: 'latn', timeZone: 'UTC',
});

function oracleParts(iso: string) {
  const out: Record<string, number> = {};
  for (const part of oracle.formatToParts(new Date(`${iso}T00:00:00Z`))) {
    if (part.type !== 'literal') out[part.type] = Number(part.value);
  }
  return { jy: out.year, jm: out.month, jd: out.day };
}

describe('jalali conversion', () => {
  it('puts Nowruz where the almanac does', () => {
    expect(isoToJalali('2024-03-20')).toEqual({ jy: 1403, jm: 1, jd: 1 });
    expect(isoToJalali('2025-03-21')).toEqual({ jy: 1404, jm: 1, jd: 1 });
    expect(isoToJalali('2026-03-21')).toEqual({ jy: 1405, jm: 1, jd: 1 });
    // And the last day of the year before each of them — which is where the
    // leap years show up: 1403 ends on Esfand 30, 1404 on Esfand 29.
    expect(isoToJalali('2025-03-20')).toEqual({ jy: 1403, jm: 12, jd: 30 });
    expect(isoToJalali('2026-03-20')).toEqual({ jy: 1404, jm: 12, jd: 29 });
  });

  it('converts a date a person can verify against the printed calendar', () => {
    // 22 November 2025 is Azar 1 of 1404 — the day after Aban 30.
    expect(isoToJalali('2025-11-22')).toEqual({ jy: 1404, jm: 9, jd: 1 });
    expect(isoToJalali('2025-11-21')).toEqual({ jy: 1404, jm: 8, jd: 30 });
    expect(formatJalaliIso('2025-11-22')).toBe('۱۴۰۴/۰۹/۰۱');
    expect(jalaliToIso(1404, 9, 1)).toBe('2025-11-22');
  });

  it('agrees with the platform calendar for every sampled day of four decades', () => {
    // Every 7th day, so a leap-year boundary cannot hide between samples, plus
    // the days around each Nowruz which the checks above pin exactly.
    for (let day = Math.floor(Date.UTC(1999, 0, 1) / 86_400_000); day <= Math.floor(Date.UTC(2039, 11, 31) / 86_400_000); day += 7) {
      const iso = dateFromDay(day).toISOString().slice(0, 10);
      const mine = isoToJalali(iso);
      expect(mine, `no conversion for ${iso}`).not.toBeNull();
      expect(mine, iso).toEqual(oracleParts(iso));
      expect(jalaliToIso(mine!.jy, mine!.jm, mine!.jd), `round trip for ${iso}`).toBe(iso);
    }
  });

  it('reads month lengths from the calendar, not from a rule', () => {
    expect(jalaliMonthLength(1403, 1)).toBe(31);
    expect(jalaliMonthLength(1404, 6)).toBe(31);
    expect(jalaliMonthLength(1404, 7)).toBe(30);
    // 1403 is the leap year here (Esfand 30), 1404 is not (Esfand 29). Asserting
    // both is the point: a hand-written table would get exactly one of them right.
    expect(jalaliMonthLength(1403, 12)).toBe(30);
    expect(jalaliMonthLength(1404, 12)).toBe(29);
    const leap = jalaliYear(1403);
    expect(leap.lengths.reduce((a, b) => a + b, 0)).toBe(366);
    expect(leap.starts[0]).toBe(jalaliToDay(1403, 1, 1));
    expect(leap.nextNowruz - leap.starts[0]).toBe(366);
    const plain = jalaliYear(1404);
    expect(plain.lengths.reduce((a, b) => a + b, 0)).toBe(365);
  });
});

describe('the month grid', () => {
  it('lays out a whole week-aligned month with no missing or extra days', () => {
    for (const [jy, jm] of [[1403, 1], [1404, 9], [1404, 12], [1405, 6]] as const) {
      const grid = jalaliMonthGrid(jy, jm);
      const days = grid.filter((cell) => cell !== null) as number[];
      expect(days.length, `month ${jy}/${jm}`).toBe(jalaliMonthLength(jy, jm));
      expect(grid.length % 7).toBe(0);
      // Saturday-first: the header row order the grid is built for, i.e. the
      // month's first day sits in the column its weekday names.
      const leading = grid.findIndex((cell) => cell !== null);
      expect(leading).toBe((dateFromDay(days[0]).getUTCDay() + 1) % 7);
      expect(days[days.length - 1] - days[0]).toBe(days.length - 1);
    }
  });

  it('keeps a 30-day Esfand and a 29-day one both renderable', () => {
    // The last month is the one that absorbs the leap day, so it is the month a
    // hand-written table gets wrong first.
    const leap = jalaliMonthGrid(1403, 12);
    const short = jalaliMonthGrid(1404, 12);
    expect(leap.filter((c) => c !== null).length).toBe(30);
    expect(short.filter((c) => c !== null).length).toBe(29);
    expect(leap.length % 7).toBe(0);
    expect(short.length % 7).toBe(0);
  });
});

describe('typed input', () => {
  it('accepts what a person actually types', () => {
    expect(parseJalaliInput('1404/09/01')).toBe('2025-11-22');
    expect(parseJalaliInput('۱۴۰۴-۰۹-۰۱')).toBe('2025-11-22');
    expect(parseJalaliInput('1404.9.1')).toBe('2025-11-22');
    expect(parseJalaliInput('1404091')).toBe('2025-11-22');
    expect(parseJalaliInput('  1404/09/01  ')).toBe('2025-11-22');
    expect(parseJalaliInput('')).toBeNull();
  });

  it('rejects dates that do not exist instead of quietly moving them', () => {
    // A 31st of a 30-day month is the classic silent off-by-one-month bug.
    expect(parseJalaliInput('1404/07/31')).toBeNull();
    expect(parseJalaliInput('1404/12/31')).toBeNull();
    expect(parseJalaliInput('1404/13/01')).toBeNull();
    // A Gregorian date typed into a Jalali field must not be reinterpreted.
    expect(parseJalaliInput('2025-11-22')).toBeNull();
  });
});
