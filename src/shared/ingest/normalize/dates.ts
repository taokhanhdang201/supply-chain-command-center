// Date presets (Addendum AD-3): iso, ymd_slash, mdy_slash, dmy_slash, dmy_dot. A non-ISO preset accepts only its own
// syntax; the year is always four digits; a time-of-day suffix is STRIPPED and the date is taken as written (no time
// zone conversion). The year range 2000-2100 is V1's job. Typed date cells are never passed through here.

import { blankKind, trimJs } from './text';

export type DatePreset = 'iso' | 'ymd_slash' | 'mdy_slash' | 'dmy_slash' | 'dmy_dot';
export const DATE_PRESETS: readonly DatePreset[] = ['iso', 'ymd_slash', 'mdy_slash', 'dmy_slash', 'dmy_dot'];
export const DEFAULT_DATE_PRESET: DatePreset = 'iso';

export const DATE_PRESET_EXAMPLE: Record<DatePreset, string> = {
  iso: '2026-08-15',
  ymd_slash: '2026/08/15',
  mdy_slash: '8/15/2026 (month/day/year)',
  dmy_slash: '15/8/2026 (day/month/year)',
  dmy_dot: '15.8.2026 (day.month.year)'
};

export interface DateCtx {
  /** true for estimated_delivery and actual_delivery: a placeholder reads as blank. */
  optional: boolean;
}

export type DateResult =
  | { ok: true; value: string; timeStripped: boolean; blank?: 'blank' | 'placeholder' }
  | { ok: false };

type Order = 'ymd' | 'mdy' | 'dmy';

const DATE_PART: Record<DatePreset, { re: RegExp; order: Order }> = {
  iso: { re: /^(\d{4})-(\d{2})-(\d{2})/, order: 'ymd' },
  ymd_slash: { re: /^(\d{4})\/(\d{1,2})\/(\d{1,2})/, order: 'ymd' },
  mdy_slash: { re: /^(\d{1,2})\/(\d{1,2})\/(\d{4})/, order: 'mdy' },
  dmy_slash: { re: /^(\d{1,2})\/(\d{1,2})\/(\d{4})/, order: 'dmy' },
  dmy_dot: { re: /^(\d{1,2})\.(\d{1,2})\.(\d{4})/, order: 'dmy' }
};

const TIME = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:[.,]\d{1,9})?)?(?:\s?([AaPp][Mm]))?(?:\s?(Z|z|[+-]\d{2}(?::?\d{2})?))?$/;

function isLeap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeap(year) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

function validTime(suffix: string): boolean {
  const m = TIME.exec(suffix);
  if (m === null) return false;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  const second = m[3] === undefined ? 0 : Number(m[3]);
  const meridiem = m[4];
  if (minute > 59 || second > 59) return false;
  if (meridiem !== undefined ? hour < 1 || hour > 12 : hour > 23) return false;
  const offset = m[5];
  if (offset !== undefined && offset.toLowerCase() !== 'z') {
    const digits = offset.slice(1).replace(':', '');
    const oh = Number(digits.slice(0, 2));
    const om = digits.length > 2 ? Number(digits.slice(2)) : 0;
    if (oh > 14 || om > 59) return false;
  }
  return true;
}

export function normalizeDate(raw: string, preset: DatePreset, ctx: DateCtx): DateResult {
  const s = trimJs(raw);
  const blank = blankKind(s);
  if (blank === 'blank') return { ok: true, value: '', timeStripped: false, blank };
  if (blank === 'placeholder') return ctx.optional ? { ok: true, value: '', timeStripped: false, blank } : { ok: false };

  const spec = DATE_PART[preset];
  const m = spec.re.exec(s);
  if (m === null) return { ok: false };
  const a = Number(m[1]);
  const b = Number(m[2]);
  const c = Number(m[3]);
  const year = spec.order === 'ymd' ? a : c;
  const month = spec.order === 'ymd' ? b : spec.order === 'mdy' ? a : b;
  const day = spec.order === 'ymd' ? c : spec.order === 'mdy' ? b : a;
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return { ok: false };

  const rest = s.slice(m[0].length);
  let timeStripped = false;
  if (rest !== '') {
    let suffix: string | null = null;
    if (preset === 'iso' && rest.startsWith('T')) suffix = rest.slice(1);
    else if (/^\s+/.test(rest)) suffix = rest.replace(/^\s+/, '');
    if (suffix === null || !validTime(suffix)) return { ok: false };
    timeStripped = true;
  }
  const value = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return { ok: true, value, timeStripped };
}

/** The presets under which `raw` is syntactically and calendar valid (AD-3 "compat"), in preset order. */
export function compatibleDatePresets(raw: string): DatePreset[] {
  return DATE_PRESETS.filter((p) => normalizeDate(raw, p, { optional: false }).ok);
}
