// Pure date utilities. All dates are `DayString` ('YYYY-MM-DD'). Arithmetic uses epoch days (UTC) so it is
// timezone-independent. No `Date.now()` / `new Date()` is used here except inside `localToday`, which receives
// the current Date explicitly from the caller.

import type { DayString } from './types';

export type ParseDayResult = { ok: true; value: DayString } | { ok: false; reason: 'format' | 'calendar' | 'range' };

const DAY_FORMAT = /^(\d{4})-(\d{2})-(\d{2})$/;
const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

/** Parses a 'YYYY-MM-DD' string, checking format, real-calendar-date validity, and the 2000..2100 year range. */
export function parseIsoDay(input: string): ParseDayResult {
  const match = DAY_FORMAT.exec(input);
  if (!match) return { ok: false, reason: 'format' };
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const epoch = Date.UTC(year, month - 1, day);
  const check = new Date(epoch);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return { ok: false, reason: 'calendar' };
  }
  if (year < MIN_YEAR || year > MAX_YEAR) return { ok: false, reason: 'range' };
  return { ok: true, value: input };
}

/** True when `input` is a valid 'YYYY-MM-DD' day within the supported range. */
export function isDayString(input: string): boolean {
  return parseIsoDay(input).ok;
}

/** Converts a DayString to a whole-number epoch day count (days since 1970-01-01 UTC). */
export function dayToEpochDay(day: DayString): number {
  const match = DAY_FORMAT.exec(day);
  if (!match) throw new Error(`Invalid DayString: "${day}"`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const dom = Number(match[3]);
  return Date.UTC(year, month - 1, dom) / 86_400_000;
}

/** Converts an epoch day count back to a DayString. */
export function epochDayToDay(n: number): DayString {
  const date = new Date(n * 86_400_000);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dom = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${dom}`;
}

/** Adds (or subtracts, for negative n) whole days to a DayString. */
export function addDays(day: DayString, n: number): DayString {
  return epochDayToDay(dayToEpochDay(day) + n);
}

/** Returns `a - b` in whole days. */
export function diffDays(a: DayString, b: DayString): number {
  return dayToEpochDay(a) - dayToEpochDay(b);
}

/** Formats the local (server machine) date of `now` as a DayString, using local calendar fields. */
export function localToday(now: Date): DayString {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const dom = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${dom}`;
}

/** Returns the 'YYYY-MM' month key of a DayString. */
export function monthKey(day: DayString): string {
  return day.slice(0, 7);
}

/** Returns every 'YYYY-MM' month key from `from` to `to` inclusive, contiguous. */
export function monthRange(from: string, to: string): string[] {
  const [fromYear, fromMonth] = from.split('-').map(Number) as [number, number];
  const [toYear, toMonth] = to.split('-').map(Number) as [number, number];
  const months: string[] = [];
  let year = fromYear;
  let month = fromMonth;
  while (year < toYear || (year === toYear && month <= toMonth)) {
    months.push(`${year}-${String(month).padStart(2, '0')}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return months;
}
