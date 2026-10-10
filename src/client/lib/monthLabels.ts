// The month to date, one way on every chart (DESIGN.md "Number formats"): the axis marks it "Oct*" (shared
// monthAxisLabels), the note under the chart says "Oct* is month to date (Oct 1–7).", a data table row reads "Oct 2026*" and a
// tooltip "Oct 2026, month to date". A range without the current month gets no asterisk and no note.

import { formatMonth } from '../../shared/format';
import type { DayString } from '../../shared/types';

const shortMonth = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short' });

/** "Oct" for a 'YYYY-MM' or 'YYYY-MM-DD' key. */
function monthName(key: string): string {
  const [y, m] = key.split('-').map(Number) as [number, number];
  return shortMonth.format(new Date(Date.UTC(y, m - 1, 1)));
}

/** "Oct* is month to date (Oct 1–7)." when the months include today's; "(Oct 1)" on the first day; otherwise null. */
export function partialMonthNote(months: readonly string[], today: DayString): string | null {
  if (!months.includes(today.slice(0, 7))) return null;
  const name = monthName(today);
  const day = Number(today.slice(8, 10));
  return `${name}* is month to date (${name} 1${day === 1 ? '' : `–${day}`}).`;
}

/** A data table's month: "Sep 2026", and "Oct 2026*" for the month to date. */
export function monthTableLabel(month: string, today: DayString): string {
  return month === today.slice(0, 7) ? `${formatMonth(month)}*` : formatMonth(month);
}

/** A tooltip's month: "Sep 2026", and "Oct 2026, month to date". */
export function monthTooltipLabel(month: string, today: DayString): string {
  return month === today.slice(0, 7) ? `${formatMonth(month)}, month to date` : formatMonth(month);
}
