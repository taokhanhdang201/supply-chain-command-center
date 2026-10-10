// The month to date, one way on every chart: the note under it, a data table row, a tooltip. A range without the current month
// gets no asterisk and no note.
import { describe, expect, it } from 'vitest';
import { monthTableLabel, monthTooltipLabel, partialMonthNote } from '../../../src/client/lib/monthLabels';

const TODAY = '2026-10-07';

describe('partialMonthNote', () => {
  it('says which days the starred month covers', () => {
    expect(partialMonthNote(['2026-08', '2026-09', '2026-10'], TODAY)).toBe('Oct* is month to date (Oct 1–7).');
  });

  it('adds no asterisk and no note when the range has no month to date', () => {
    expect(partialMonthNote(['2026-07', '2026-08', '2026-09'], TODAY)).toBeNull();
    expect(partialMonthNote([], TODAY)).toBeNull();
  });

  it('reads "(Oct 1)" on the first day of the month, never "Oct 1–1"', () => {
    const note = partialMonthNote(['2026-09', '2026-10'], '2026-10-01');
    expect(note).toBe('Oct* is month to date (Oct 1).');
    expect(note).not.toContain('1–1');
  });

  it('names the month of today, not the last month of the range, and spans two digits of days', () => {
    expect(partialMonthNote(['2026-02', '2026-03'], '2026-03-28')).toBe('Mar* is month to date (Mar 1–28).');
    expect(partialMonthNote(['2026-02', '2026-03'], '2026-02-10')).toBe('Feb* is month to date (Feb 1–10).');
  });
});

describe('monthTableLabel', () => {
  it('stars the month to date and leaves a finished month plain', () => {
    expect(monthTableLabel('2026-10', TODAY)).toBe('Oct 2026*');
    expect(monthTableLabel('2026-09', TODAY)).toBe('Sep 2026');
  });
});

describe('monthTooltipLabel', () => {
  it('says "month to date" for the current month and just the month for the others', () => {
    expect(monthTooltipLabel('2026-10', TODAY)).toBe('Oct 2026, month to date');
    expect(monthTooltipLabel('2026-09', TODAY)).toBe('Sep 2026');
    expect(monthTooltipLabel('2025-10', TODAY)).toBe('Oct 2025');
  });
});
