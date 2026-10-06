// Per-field CSV value parsers. Result-type error handling (never throw for user data): every parser returns
// `{ ok: true, value } | { ok: false, code, message }`. Callers handle blank values first (required → REQUIRED,
// optional → a default) before calling these parsers; a control-character check is applied to every raw value at
// the row-processing level (see `hasControlChars`), independent of which parser is used.

import type { DayString, ImportIssueCode, ShipmentStatus } from '../types';
import { parseIsoDay } from '../dates';
import { parseDecimalToCents } from '../money';
import { SHIPMENT_STATUSES } from '../types';
import { WAREHOUSE_CODES } from '../reference/locations';
import { truncateForMessage } from '../format';

export type FieldResult<T> = { ok: true; value: T } | { ok: false; code: ImportIssueCode; message: string };

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const ID_FORMAT = /^[A-Z0-9][A-Z0-9-]{2,31}$/;
const INTEGER_FORMAT = /^-?\d+$/;
const DECIMAL_LIKE_FORMAT = /^-?\d+\.\d+$/;
const DECIMAL_FORMAT = /^-?\d+(\.\d+)?$/;
const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

/** True when `raw` contains a control character (U+0000-U+001F or U+007F). */
export function hasControlChars(raw: string): boolean {
  return CONTROL_CHARS.test(raw);
}

function quote(v: string): string {
  return truncateForMessage(v);
}

/** Free text with a maximum length; rejects control characters. */
export function parseText(raw: string, maxLength: number): FieldResult<string> {
  if (hasControlChars(raw)) {
    return { ok: false, code: 'CONTROL_CHARS', message: 'Value contains control characters (tabs, line breaks or other non-printing characters).' };
  }
  if (raw.length > maxLength) {
    return { ok: false, code: 'TOO_LONG', message: `Value exceeds ${maxLength} characters.` };
  }
  return { ok: true, value: raw };
}

/** An identifier: uppercased, then matched against 3-32 letters/digits/hyphens starting with a letter or digit. */
export function parseId(raw: string, label: string): FieldResult<string> {
  const upper = raw.toUpperCase();
  if (!ID_FORMAT.test(upper)) {
    return {
      ok: false,
      code: 'INVALID_FORMAT',
      message: `"${quote(raw)}" is not a valid ${label}. Use 3–32 letters, digits or hyphens, starting with a letter or digit.`
    };
  }
  return { ok: true, value: upper };
}

/** A whole number within [min, max]. */
export function parseInteger(raw: string, min: number, max: number): FieldResult<number> {
  if (!INTEGER_FORMAT.test(raw)) {
    if (DECIMAL_LIKE_FORMAT.test(raw)) {
      return { ok: false, code: 'NOT_INTEGER', message: `"${quote(raw)}" must be a whole number.` };
    }
    return {
      ok: false,
      code: 'INVALID_NUMBER',
      message: `"${quote(raw)}" is not a valid number. Use digits with an optional decimal point, e.g. 1250.50 (no currency symbols, thousands separators or spaces).`
    };
  }
  const rawValue = Number(raw);
  const value = rawValue === 0 ? 0 : rawValue; // normalize "-0" to +0 (R-7/BUG-2)
  if (value < 0) {
    return { ok: false, code: 'NEGATIVE', message: `Must not be negative (got ${raw}).` };
  }
  if (value < min || value > max) {
    return { ok: false, code: 'OUT_OF_RANGE', message: `Must be between ${min} and ${max} (got ${raw}).` };
  }
  return { ok: true, value };
}

/** A decimal number within [min, max] with at most `maxDecimals` decimal places (default 2). */
export function parseDecimal(raw: string, min: number, max: number, maxDecimals = 2): FieldResult<number> {
  if (!DECIMAL_FORMAT.test(raw)) {
    return {
      ok: false,
      code: 'INVALID_NUMBER',
      message: `"${quote(raw)}" is not a valid number. Use digits with an optional decimal point, e.g. 1250.50 (no currency symbols, thousands separators or spaces).`
    };
  }
  const negative = raw.startsWith('-');
  const unsigned = negative ? raw.slice(1) : raw;
  const [, fracPart = ''] = unsigned.split('.');
  if (fracPart.length > maxDecimals) {
    return { ok: false, code: 'TOO_MANY_DECIMALS', message: `"${quote(raw)}" has more than ${maxDecimals} decimal places.` };
  }
  const value = Number(raw);
  if (value < 0) {
    return { ok: false, code: 'NEGATIVE', message: `Must not be negative (got ${raw}).` };
  }
  if (value < min || value > max) {
    return { ok: false, code: 'OUT_OF_RANGE', message: `Must be between ${min} and ${max} (got ${raw}).` };
  }
  return { ok: true, value };
}

/** A money value in dollars, converted to integer cents by string arithmetic (never floating-point). */
export function parseMoneyCents(raw: string, maxCents: number): FieldResult<number> {
  if (!DECIMAL_FORMAT.test(raw)) {
    return {
      ok: false,
      code: 'INVALID_NUMBER',
      message: `"${quote(raw)}" is not a valid number. Use digits with an optional decimal point, e.g. 1250.50 (no currency symbols, thousands separators or spaces).`
    };
  }
  const negative = raw.startsWith('-');
  const unsigned = negative ? raw.slice(1) : raw;
  const [intPart, fracPart = ''] = unsigned.split('.');
  if (fracPart.length > 2) {
    return { ok: false, code: 'TOO_MANY_DECIMALS', message: `"${quote(raw)}" has more than 2 decimal places.` };
  }
  const cents = Number(intPart) * 100 + Number(fracPart.padEnd(2, '0'));
  const signedCents = negative ? -cents : cents;
  const value = signedCents === 0 ? 0 : signedCents; // normalize "-0"/"-0.00" to +0 (R-7/BUG-2)
  if (value < 0) {
    return { ok: false, code: 'NEGATIVE', message: `Must not be negative (got ${raw}).` };
  }
  if (value > maxCents) {
    const maxDollars = (maxCents / 100).toFixed(2);
    return { ok: false, code: 'OUT_OF_RANGE', message: `Must be between 0 and ${maxDollars} (got ${raw}).` };
  }
  return { ok: true, value };
}

/** A calendar date in YYYY-MM-DD, restricted to years 2000-2100. */
export function parseDate(raw: string): FieldResult<DayString> {
  if (!DATE_FORMAT.test(raw)) {
    const excelHint = excelDateHint(raw);
    if (excelHint !== null) {
      return { ok: false, code: 'INVALID_DATE', message: excelHint };
    }
    return { ok: false, code: 'INVALID_DATE', message: `"${quote(raw)}" is not a valid date. Use YYYY-MM-DD, e.g. 2026-03-15.` };
  }
  const result = parseIsoDay(raw);
  if (!result.ok) {
    if (result.reason === 'calendar') {
      return { ok: false, code: 'INVALID_DATE', message: `"${quote(raw)}" is not a real calendar date.` };
    }
    return { ok: false, code: 'OUT_OF_RANGE', message: `Year must be between 2000 and 2100 (got ${raw}).` };
  }
  return { ok: true, value: result.value };
}

const SLASH_DATE_FORMAT = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

/**
 * Explains the most common cause of a slash date: Excel re-saving the CSV rewrites YYYY-MM-DD cells in the
 * Windows locale format (M/D/YYYY). The date is still rejected — YYYY-MM-DD stays the only accepted format;
 * this only makes the error actionable. Returns null for values that are not slash dates.
 */
function excelDateHint(raw: string): string | null {
  const m = SLASH_DATE_FORMAT.exec(raw);
  if (m === null) return null;
  const base = `"${quote(raw)}" looks like Excel changed this date to M/D/YYYY. Dates must be YYYY-MM-DD`;
  const month = Number(m[1]);
  const day = Number(m[2]);
  const suggestion = `${m[3]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const example = parseIsoDay(suggestion).ok ? `, e.g. ${suggestion}` : '';
  return `${base}${example}. Re-download the file and upload it without opening it in Excel.`;
}

/** A shipment status, accepting case/space/hyphen variants (e.g. "In Transit", "in-transit"). */
export function parseStatus(raw: string): FieldResult<ShipmentStatus> {
  const normalized = raw.toLowerCase().replace(/[\s-]+/g, '_');
  if ((SHIPMENT_STATUSES as readonly string[]).includes(normalized)) {
    return { ok: true, value: normalized as ShipmentStatus };
  }
  return {
    ok: false,
    code: 'INVALID_STATUS',
    message: `"${quote(raw)}" is not a valid status. Use one of: pending, in_transit, delivered, cancelled.`
  };
}

/** A warehouse code (case-insensitive), validated against the known warehouse list. */
export function parseWarehouseCode(raw: string): FieldResult<string> {
  const upper = raw.toUpperCase();
  if (WAREHOUSE_CODES.includes(upper)) {
    return { ok: true, value: upper };
  }
  return {
    ok: false,
    code: 'UNKNOWN_WAREHOUSE',
    message: `Unknown warehouse "${quote(raw)}". Valid codes: ${WAREHOUSE_CODES.join(', ')}.`
  };
}
