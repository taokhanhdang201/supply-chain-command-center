import { describe, it, expect } from 'vitest';
import {
  formatCents,
  formatCentsAxis,
  formatCentsCompact,
  formatCompactNumber,
  monthAxisLabels,
  monthAxisNote,
  formatNumber,
  formatPercent,
  formatDay,
  formatMonth,
  formatDays,
  statusLabel,
  truncateForMessage
} from '../../src/shared/format';

describe('formatCents', () => {
  it('formats cents as USD currency', () => {
    expect(formatCents(123456)).toBe('$1,234.56');
  });

  it('formats zero', () => {
    expect(formatCents(0)).toBe('$0.00');
  });
});

describe('formatCentsCompact', () => {
  it('falls back to formatCents below $1,000', () => {
    expect(formatCentsCompact(99_900)).toBe('$999.00');
  });

  it('shortens $1,000-$9,999 to K instead of a full "$2,000.00" (BUG-8)', () => {
    expect(formatCentsCompact(200_000)).toBe('$2K');
    expect(formatCentsCompact(250_000)).toBe('$2.5K');
  });

  it('has B and T units so billions do not read "$2500.00M" (BUG-10)', () => {
    expect(formatCentsCompact(250_000_000_000)).toBe('$2.50B');
    expect(formatCentsCompact(-250_000_000_000)).toBe('-$2.50B');
    expect(formatCentsCompact(120_000_000_000_000)).toBe('$1.20T');
  });

  it('rolls over at unit boundaries instead of printing "1000.0K"', () => {
    expect(formatCentsCompact(99_999_900)).toBe('$1.00M');
  });

  it('formats thousands with K', () => {
    expect(formatCentsCompact(1_230_000)).toBe('$12.3K');
  });

  it('formats millions with M', () => {
    expect(formatCentsCompact(124_000_00 * 10)).toBe('$1.24M');
  });
});

describe('formatNumber', () => {
  it('formats with grouping', () => {
    expect(formatNumber(1234)).toBe('1,234');
  });

  it('respects maxFractionDigits', () => {
    expect(formatNumber(1.2345, 2)).toBe('1.23');
  });
});

describe('formatPercent', () => {
  it('formats a ratio to 1 decimal by default', () => {
    expect(formatPercent(0.843)).toBe('84.3%');
  });

  it('returns an em dash for null', () => {
    expect(formatPercent(null)).toBe('—');
  });
});

describe('formatDay', () => {
  it('renders without a timezone shift under America/Chicago', () => {
    expect(formatDay('2026-03-01')).toBe('Mar 1, 2026');
  });

  it('returns an em dash for null', () => {
    expect(formatDay(null)).toBe('—');
  });
});

describe('formatMonth', () => {
  it('formats a YYYY-MM key', () => {
    expect(formatMonth('2026-03')).toBe('Mar 2026');
  });
});

describe('formatDays', () => {
  it('formats to 1 decimal', () => {
    expect(formatDays(3.44)).toBe('3.4 days');
  });

  it('returns an em dash for null', () => {
    expect(formatDays(null)).toBe('—');
  });
});

describe('statusLabel', () => {
  it('labels in_transit as "In transit"', () => {
    expect(statusLabel('in_transit')).toBe('In transit');
  });

  it('labels every status', () => {
    expect(statusLabel('pending')).toBe('Pending');
    expect(statusLabel('delivered')).toBe('Delivered');
    expect(statusLabel('cancelled')).toBe('Cancelled');
  });
});

describe('truncateForMessage', () => {
  it('leaves short strings untouched', () => {
    expect(truncateForMessage('short')).toBe('short');
  });

  it('truncates to 40 chars by default and appends an ellipsis', () => {
    const long = 'a'.repeat(50);
    const result = truncateForMessage(long);
    expect(result).toBe(`${'a'.repeat(40)}…`);
  });

  it('accepts a custom max length', () => {
    expect(truncateForMessage('abcdef', 3)).toBe('abc…');
  });
});

describe('formatCompactNumber', () => {
  it('leaves values below 1,000 as plain numbers, including 0 and 999', () => {
    expect(formatCompactNumber(0)).toBe('0');
    expect(formatCompactNumber(999)).toBe('999');
  });

  it('switches to K at exactly 1,000', () => {
    expect(formatCompactNumber(1000)).toBe('1K');
    expect(formatCompactNumber(1200)).toBe('1.2K');
    expect(formatCompactNumber(2500)).toBe('2.5K');
  });

  it('rounds 999,999 up to 1M rather than "1000K"', () => {
    expect(formatCompactNumber(999_999)).toBe('1M');
  });

  it('formats millions and billions', () => {
    expect(formatCompactNumber(1e6)).toBe('1M');
    expect(formatCompactNumber(10_000_000)).toBe('10M');
    expect(formatCompactNumber(1e9)).toBe('1B');
    expect(formatCompactNumber(2_500_000_000)).toBe('2.5B');
    expect(formatCompactNumber(1.2e12)).toBe('1.2T');
  });

  it('uses adaptive precision without trailing zeros and never misleadingly rounds a nice tick', () => {
    expect(formatCompactNumber(1250)).toBe('1.25K');
    expect(formatCompactNumber(12_500)).toBe('12.5K');
    expect(formatCompactNumber(125_000)).toBe('125K');
    expect(formatCompactNumber(1_250_000)).toBe('1.25M');
  });

  it('keeps the sign for negatives', () => {
    expect(formatCompactNumber(-1500)).toBe('-1.5K');
    expect(formatCompactNumber(-999)).toBe('-999');
  });

  it('handles fractional values', () => {
    expect(formatCompactNumber(2.5)).toBe('2.5');
    expect(formatCompactNumber(0.4)).toBe('0.4');
    expect(formatCompactNumber(1234.56)).toBe('1.23K');
  });
});

describe('compact formatters: currency vs count', () => {
  it('currency ticks carry a $ and count ticks do not, at the same magnitude', () => {
    expect(formatCentsAxis(1_000_000_000)).toBe('$10M');
    expect(formatCompactNumber(10_000_000)).toBe('10M');
  });

  it('currency compact handles 0, negatives and boundaries', () => {
    expect(formatCentsCompact(0)).toBe('$0.00');
    expect(formatCentsCompact(-2_500_000)).toBe('-$25.0K');
    expect(formatCentsCompact(99_900)).toBe('$999.00');
    expect(formatCentsCompact(1_000_000)).toBe('$10.0K');
    expect(formatCentsCompact(100_000_000)).toBe('$1.00M');
  });

  it('is far shorter than the full currency string for large values', () => {
    expect(formatCentsCompact(2_140_000_000).length).toBeLessThan(formatCents(2_140_000_000).length);
  });
});

describe('formatCentsAxis', () => {
  const d = (dollars: number) => Math.round(dollars * 100);

  it('is short and exact across the whole range, with no trailing ".00"', () => {
    expect(formatCentsAxis(0)).toBe('$0');
    expect(formatCentsAxis(d(500))).toBe('$500');
    expect(formatCentsAxis(d(999))).toBe('$999');
    expect(formatCentsAxis(d(1000))).toBe('$1K');
    expect(formatCentsAxis(d(2000))).toBe('$2K');
    expect(formatCentsAxis(d(2500))).toBe('$2.5K');
    expect(formatCentsAxis(d(10_000))).toBe('$10K');
    expect(formatCentsAxis(d(12_500))).toBe('$12.5K');
    expect(formatCentsAxis(d(100_000))).toBe('$100K');
    expect(formatCentsAxis(d(1_200_000))).toBe('$1.2M');
    expect(formatCentsAxis(d(1_250_000))).toBe('$1.25M');
    expect(formatCentsAxis(d(100_000_000))).toBe('$100M');
    expect(formatCentsAxis(d(2_500_000_000))).toBe('$2.5B');
    expect(formatCentsAxis(d(1_200_000_000_000))).toBe('$1.2T');
  });

  it('handles negatives, fractional dollars and rollover', () => {
    expect(formatCentsAxis(d(-2500))).toBe('-$2.5K');
    expect(formatCentsAxis(d(0.25))).toBe('$0.25');
    expect(formatCentsAxis(d(999_999))).toBe('$1M');
    expect(formatCentsAxis(d(999_999_999))).toBe('$1B');
  });

  it('never yields the "$2500.00M" style (BUG-10)', () => {
    expect(formatCentsAxis(d(2_500_000_000))).not.toMatch(/M$/);
  });
});

describe('rollover at every unit boundary (BUG-11)', () => {
  it('formatCompactNumber moves to the next unit when rounding reaches 1000', () => {
    expect(formatCompactNumber(999.999)).toBe('1K');
    expect(formatCompactNumber(-999.999)).toBe('-1K');
    expect(formatCompactNumber(999_999)).toBe('1M');
    expect(formatCompactNumber(999_999_999)).toBe('1B');
    expect(formatCompactNumber(999_999_999_999)).toBe('1T');
    expect(formatCompactNumber(999.99)).toBe('999.99');
  });

  it('formatCentsAxis rolls over K to M, M to B and B to T', () => {
    const d = (dollars: number) => Math.round(dollars * 100);
    expect(formatCentsAxis(d(999.999))).toBe('$1K');
    expect(formatCentsAxis(d(999_999))).toBe('$1M');
    expect(formatCentsAxis(d(999_999_999))).toBe('$1B');
    expect(formatCentsAxis(d(999_999_999_999))).toBe('$1T');
  });

  it('formatCentsCompact rolls over K to M, M to B and B to T', () => {
    const d = (dollars: number) => Math.round(dollars * 100);
    expect(formatCentsCompact(d(999_999))).toBe('$1.00M');
    expect(formatCentsCompact(d(999_999_999))).toBe('$1.00B');
    expect(formatCentsCompact(d(999_999_999_999))).toBe('$1.00T');
  });
});

describe('monthAxisLabels / monthAxisNote (R-18)', () => {
  const months = ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'];

  it('uses short month names and marks the current month with "*"', () => {
    expect(monthAxisLabels(months, '2026-09')).toEqual(['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep*']);
    expect(monthAxisLabels(months)).toEqual(['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep']);
  });

  it('adds the year to the first label and every January when the run crosses a year', () => {
    expect(monthAxisLabels(['2026-11', '2026-12', '2027-01', '2027-02'], null)).toEqual(["Nov '26", 'Dec', "Jan '27", 'Feb']);
  });

  it('explains the "*" only when the current month is on the axis', () => {
    expect(monthAxisNote(months, '2026-09-28')).toBe('* Sep 2026 is month to date (a partial month).');
    expect(monthAxisNote(months.slice(0, 3), '2026-09-28')).toBeNull();
  });
});
