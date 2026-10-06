import { describe, it, expect } from 'vitest';
import type { FieldResult } from '../../../src/shared/csv/fieldParsers';
import {
  hasControlChars,
  parseText,
  parseId,
  parseInteger,
  parseDecimal,
  parseMoneyCents,
  parseDate,
  parseStatus,
  parseWarehouseCode
} from '../../../src/shared/csv/fieldParsers';


function errCode<T>(result: FieldResult<T>): string | undefined {
  return result.ok ? undefined : result.code;
}

describe('hasControlChars', () => {
  it('detects a tab', () => {
    expect(hasControlChars('a\tb')).toBe(true);
  });

  it('detects a newline', () => {
    expect(hasControlChars('a\nb')).toBe(true);
  });

  it('is false for normal text', () => {
    expect(hasControlChars('a b')).toBe(false);
  });
});

describe('parseText', () => {
  it('accepts a short string', () => {
    expect(parseText('hello', 10)).toEqual({ ok: true, value: 'hello' });
  });

  it('rejects control characters', () => {
    expect(parseText('a\tb', 10)).toEqual({
      ok: false,
      code: 'CONTROL_CHARS',
      message: 'Value contains control characters (tabs, line breaks or other non-printing characters).'
    });
  });

  it('rejects text longer than maxLength', () => {
    expect(parseText('abcdef', 3)).toEqual({ ok: false, code: 'TOO_LONG', message: 'Value exceeds 3 characters.' });
  });
});

describe('parseId', () => {
  it('uppercases a valid id', () => {
    expect(parseId('elc-9001', 'SKU')).toEqual({ ok: true, value: 'ELC-9001' });
  });

  it('rejects an id that is too short', () => {
    expect(parseId('ab', 'SKU')).toEqual({
      ok: false,
      code: 'INVALID_FORMAT',
      message: '"ab" is not a valid SKU. Use 3–32 letters, digits or hyphens, starting with a letter or digit.'
    });
  });

  it('rejects an id starting with a hyphen', () => {
    expect(parseId('-abc', 'SKU').ok).toBe(false);
  });
});

describe('parseInteger', () => {
  it('accepts a valid integer', () => {
    expect(parseInteger('120', 0, 1000)).toEqual({ ok: true, value: 120 });
  });

  it('rejects a decimal as NOT_INTEGER', () => {
    expect(parseInteger('12.5', 0, 1000)).toEqual({ ok: false, code: 'NOT_INTEGER', message: '"12.5" must be a whole number.' });
  });

  it('rejects thousands separators as INVALID_NUMBER', () => {
    expect(errCode(parseInteger('1,234', 0, 10000))).toBe('INVALID_NUMBER');
  });

  it('rejects a currency symbol', () => {
    expect(parseInteger('$12', 0, 1000).ok).toBe(false);
  });

  it('rejects scientific notation', () => {
    expect(parseInteger('1e5', 0, 1000000).ok).toBe(false);
  });

  it('rejects hex notation', () => {
    expect(parseInteger('0x10', 0, 1000).ok).toBe(false);
  });

  it('rejects NaN literal', () => {
    expect(parseInteger('NaN', 0, 1000).ok).toBe(false);
  });

  it('rejects Infinity literal', () => {
    expect(parseInteger('Infinity', 0, 1000).ok).toBe(false);
  });

  it('rejects embedded spaces', () => {
    expect(parseInteger('12 3', 0, 1000).ok).toBe(false);
  });

  it('rejects a leading plus sign', () => {
    expect(parseInteger('+5', 0, 1000).ok).toBe(false);
  });

  it('rejects a trailing decimal point', () => {
    expect(parseInteger('12.', 0, 1000).ok).toBe(false);
  });

  it('rejects a leading decimal point', () => {
    expect(parseInteger('.5', 0, 1000).ok).toBe(false);
  });

  it('rejects a double negative sign', () => {
    expect(parseInteger('--1', 0, 1000).ok).toBe(false);
  });

  it('rejects a negative value', () => {
    expect(parseInteger('-5', 0, 1000)).toEqual({ ok: false, code: 'NEGATIVE', message: 'Must not be negative (got -5).' });
  });

  it('rejects a value above max', () => {
    expect(parseInteger('2000', 0, 1000)).toEqual({ ok: false, code: 'OUT_OF_RANGE', message: 'Must be between 0 and 1000 (got 2000).' });
  });
});

describe('parseDecimal', () => {
  it('accepts a value with up to 2 decimals', () => {
    expect(parseDecimal('6.5', 0, 1_000_000)).toEqual({ ok: true, value: 6.5 });
  });

  it('rejects more than 2 decimals', () => {
    expect(parseDecimal('6.555', 0, 1_000_000)).toEqual({
      ok: false,
      code: 'TOO_MANY_DECIMALS',
      message: '"6.555" has more than 2 decimal places.'
    });
  });

  it('rejects a negative value', () => {
    expect(errCode(parseDecimal('-1', 0, 1_000_000))).toBe('NEGATIVE');
  });

  it('rejects an out-of-range value', () => {
    expect(errCode(parseDecimal('2000000', 0, 1_000_000))).toBe('OUT_OF_RANGE');
  });
});

describe('parseMoneyCents', () => {
  it('converts dollars to cents exactly', () => {
    expect(parseMoneyCents('89.50', 100_000_000)).toEqual({ ok: true, value: 8950 });
  });

  it('rejects more than 2 decimals', () => {
    expect(errCode(parseMoneyCents('1.234', 100_000_000))).toBe('TOO_MANY_DECIMALS');
  });

  it('rejects a value above the max, showing dollars', () => {
    expect(parseMoneyCents('1000000.01', 100_000_000)).toEqual({
      ok: false,
      code: 'OUT_OF_RANGE',
      message: 'Must be between 0 and 1000000.00 (got 1000000.01).'
    });
  });

  it('rejects a negative amount', () => {
    expect(errCode(parseMoneyCents('-1.00', 100_000_000))).toBe('NEGATIVE');
  });
});

describe('parseDate', () => {
  it('accepts a valid date', () => {
    expect(parseDate('2026-03-15')).toEqual({ ok: true, value: '2026-03-15' });
  });

  it('rejects a slash-formatted date with an Excel hint and the YYYY-MM-DD equivalent', () => {
    expect(parseDate('03/15/2026')).toEqual({
      ok: false,
      code: 'INVALID_DATE',
      message:
        '"03/15/2026" looks like Excel changed this date to M/D/YYYY. Dates must be YYYY-MM-DD, e.g. 2026-03-15. ' +
        'Re-download the file and upload it without opening it in Excel.'
    });
  });

  it('Excel hint handles unpadded M/D/YYYY (as Excel writes it)', () => {
    const r = parseDate('8/15/2026');
    expect(errCode(r)).toBe('INVALID_DATE');
    if (!r.ok) {
      expect(r.message).toContain('looks like Excel changed this date');
      expect(r.message).toContain('e.g. 2026-08-15');
    }
  });

  it('Excel hint omits the example when the slash date is not a real M/D date', () => {
    const r = parseDate('15/08/2026');
    expect(errCode(r)).toBe('INVALID_DATE');
    if (!r.ok) {
      expect(r.message).toContain('looks like Excel changed this date');
      expect(r.message).not.toContain('e.g.');
    }
  });

  it('non-slash invalid formats keep the generic message', () => {
    const r = parseDate('2026/08/15');
    if (!r.ok) expect(r.message).toBe('"2026/08/15" is not a valid date. Use YYYY-MM-DD, e.g. 2026-03-15.');
    expect(r.ok).toBe(false);
  });

  it('rejects a non-padded date', () => {
    expect(errCode(parseDate('2026-3-5'))).toBe('INVALID_DATE');
  });

  it('rejects an impossible month', () => {
    expect(parseDate('2026-13-01')).toEqual({ ok: false, code: 'INVALID_DATE', message: '"2026-13-01" is not a real calendar date.' });
  });

  it('rejects an impossible day', () => {
    expect(errCode(parseDate('2026-02-30'))).toBe('INVALID_DATE');
  });

  it('rejects a year outside the supported range', () => {
    expect(parseDate('1999-12-31')).toEqual({ ok: false, code: 'OUT_OF_RANGE', message: 'Year must be between 2000 and 2100 (got 1999-12-31).' });
  });
});

describe('parseStatus', () => {
  it('accepts lowercase snake_case', () => {
    expect(parseStatus('in_transit')).toEqual({ ok: true, value: 'in_transit' });
  });

  it('accepts "In Transit"', () => {
    expect(parseStatus('In Transit')).toEqual({ ok: true, value: 'in_transit' });
  });

  it('accepts "in-transit"', () => {
    expect(parseStatus('in-transit')).toEqual({ ok: true, value: 'in_transit' });
  });

  it('accepts "DELIVERED"', () => {
    expect(parseStatus('DELIVERED')).toEqual({ ok: true, value: 'delivered' });
  });

  it('rejects an unknown status', () => {
    expect(parseStatus('shipped').ok).toBe(false);
  });
});

describe('parseWarehouseCode', () => {
  it('accepts an uppercase code', () => {
    expect(parseWarehouseCode('WH-DFW')).toEqual({ ok: true, value: 'WH-DFW' });
  });

  it('accepts a lowercase code', () => {
    expect(parseWarehouseCode('wh-dfw')).toEqual({ ok: true, value: 'WH-DFW' });
  });

  it('rejects an unknown warehouse', () => {
    const result = parseWarehouseCode('WH-XXX');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('Unknown warehouse "WH-XXX"');
  });
});
