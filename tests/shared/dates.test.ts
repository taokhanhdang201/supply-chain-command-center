import { describe, it, expect } from 'vitest';
import {
  parseIsoDay,
  isDayString,
  dayToEpochDay,
  epochDayToDay,
  addDays,
  diffDays,
  localToday,
  monthKey,
  monthRange
} from '../../src/shared/dates';

describe('parseIsoDay', () => {
  it('accepts a valid day', () => {
    expect(parseIsoDay('2026-03-04')).toEqual({ ok: true, value: '2026-03-04' });
  });

  it('rejects non-padded month/day as a format error', () => {
    expect(parseIsoDay('2026-3-5')).toEqual({ ok: false, reason: 'format' });
  });

  it('rejects slash-formatted dates as a format error', () => {
    expect(parseIsoDay('03/15/2026')).toEqual({ ok: false, reason: 'format' });
  });

  it('rejects an empty string as a format error', () => {
    expect(parseIsoDay('')).toEqual({ ok: false, reason: 'format' });
  });

  it('rejects an impossible month as a calendar error', () => {
    expect(parseIsoDay('2026-13-01')).toEqual({ ok: false, reason: 'calendar' });
  });

  it('rejects an impossible day-of-month as a calendar error', () => {
    expect(parseIsoDay('2026-02-30')).toEqual({ ok: false, reason: 'calendar' });
  });

  it('accepts Feb 29 on a leap year', () => {
    expect(parseIsoDay('2028-02-29')).toEqual({ ok: true, value: '2028-02-29' });
  });

  it('rejects Feb 29 on a non-leap year', () => {
    expect(parseIsoDay('2026-02-29')).toEqual({ ok: false, reason: 'calendar' });
  });

  it('rejects a year below the supported range', () => {
    expect(parseIsoDay('1999-12-31')).toEqual({ ok: false, reason: 'range' });
  });

  it('rejects a year above the supported range', () => {
    expect(parseIsoDay('2101-01-01')).toEqual({ ok: false, reason: 'range' });
  });
});

describe('isDayString', () => {
  it('is true for a valid day', () => {
    expect(isDayString('2026-06-15')).toBe(true);
  });

  it('is false for an invalid day', () => {
    expect(isDayString('not-a-date')).toBe(false);
  });
});

describe('dayToEpochDay / epochDayToDay', () => {
  it('round-trips a date', () => {
    const day = '2026-06-15';
    expect(epochDayToDay(dayToEpochDay(day))).toBe(day);
  });

  it('epoch day 0 is 1970-01-01', () => {
    expect(epochDayToDay(0)).toBe('1970-01-01');
  });
});

describe('addDays', () => {
  it('adds days within a month', () => {
    expect(addDays('2026-03-04', 3)).toBe('2026-03-07');
  });

  it('rolls over a month end', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
  });

  it('rolls over a year end', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('subtracts with a negative n', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('handles leap-year rollover', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });
});

describe('diffDays', () => {
  it('is positive when a is after b', () => {
    expect(diffDays('2026-03-10', '2026-03-01')).toBe(9);
  });

  it('is negative when a is before b', () => {
    expect(diffDays('2026-03-01', '2026-03-10')).toBe(-9);
  });

  it('is zero for the same day', () => {
    expect(diffDays('2026-03-01', '2026-03-01')).toBe(0);
  });
});

describe('localToday', () => {
  it('uses the local calendar fields of the given Date', () => {
    const now = new Date(2026, 2, 4, 23, 0, 0); // local March 4, 2026
    expect(localToday(now)).toBe('2026-03-04');
  });
});

describe('monthKey', () => {
  it('extracts the YYYY-MM prefix', () => {
    expect(monthKey('2026-03-04')).toBe('2026-03');
  });
});

describe('monthRange', () => {
  it('returns a single month when from === to', () => {
    expect(monthRange('2026-03', '2026-03')).toEqual(['2026-03']);
  });

  it('is contiguous across a year boundary', () => {
    expect(monthRange('2025-11', '2026-02')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
  });
});
