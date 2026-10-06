import { describe, it, expect } from 'vitest';
import { parseDecimalToCents, centsToDollars } from '../../src/shared/money';

describe('parseDecimalToCents', () => {
  it('parses a whole dollar amount', () => {
    expect(parseDecimalToCents('12')).toEqual({ ok: true, cents: 1200 });
  });

  it('parses a two-decimal amount', () => {
    expect(parseDecimalToCents('12.5')).toEqual({ ok: true, cents: 1250 });
  });

  it('parses a fully specified two-decimal amount', () => {
    expect(parseDecimalToCents('12.05')).toEqual({ ok: true, cents: 1205 });
  });

  it('parses zero', () => {
    expect(parseDecimalToCents('0')).toEqual({ ok: true, cents: 0 });
  });

  it('parses a negative amount', () => {
    expect(parseDecimalToCents('-3.10')).toEqual({ ok: true, cents: -310 });
  });

  it('parses a large amount exactly', () => {
    expect(parseDecimalToCents('1000000.00')).toEqual({ ok: true, cents: 100_000_000 });
  });

  it('converts 0.29 to exactly 29 cents (no float drift)', () => {
    expect(parseDecimalToCents('0.29')).toEqual({ ok: true, cents: 29 });
  });

  it('rejects thousands separators', () => {
    expect(parseDecimalToCents('1,234')).toEqual({ ok: false, code: 'INVALID_NUMBER' });
  });

  it('rejects a currency symbol', () => {
    expect(parseDecimalToCents('$12')).toEqual({ ok: false, code: 'INVALID_NUMBER' });
  });

  it('rejects scientific notation', () => {
    expect(parseDecimalToCents('1e5')).toEqual({ ok: false, code: 'INVALID_NUMBER' });
  });

  it('rejects a leading decimal point', () => {
    expect(parseDecimalToCents('.5')).toEqual({ ok: false, code: 'INVALID_NUMBER' });
  });

  it('rejects a trailing decimal point', () => {
    expect(parseDecimalToCents('12.')).toEqual({ ok: false, code: 'INVALID_NUMBER' });
  });

  it('rejects an explicit plus sign', () => {
    expect(parseDecimalToCents('+5')).toEqual({ ok: false, code: 'INVALID_NUMBER' });
  });

  it('rejects non-numeric input', () => {
    expect(parseDecimalToCents('NaN')).toEqual({ ok: false, code: 'INVALID_NUMBER' });
  });

  it('rejects more than 2 decimal places', () => {
    expect(parseDecimalToCents('12.345')).toEqual({ ok: false, code: 'TOO_MANY_DECIMALS' });
  });
});

describe('centsToDollars', () => {
  it('divides cents by 100', () => {
    expect(centsToDollars(1234)).toBeCloseTo(12.34);
  });
});
