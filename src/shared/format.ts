// Display formatting only. All money/date/number rendering funnels through this module so the rest of the
// app never formats values ad hoc. Uses Intl with a fixed 'en-US' / 'USD' locale.

import type { DayString, ShipmentStatus } from './types';
import { centsToDollars } from './money';

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

const dayFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  year: 'numeric',
  month: 'short',
  day: 'numeric'
});

const monthFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  year: 'numeric',
  month: 'short'
});

/** Formats integer cents as a full currency string, e.g. "$1,234.56". */
export function formatCents(cents: number): string {
  return currencyFormatter.format(centsToDollars(cents));
}

const COMPACT_UNITS: ReadonlyArray<{ divisor: number; suffix: string }> = [
  { divisor: 1e12, suffix: 'T' },
  { divisor: 1e9, suffix: 'B' },
  { divisor: 1e6, suffix: 'M' },
  { divisor: 1e3, suffix: 'K' }
];

/** Scales a non-negative magnitude into `{ scaled, suffix }` for the largest unit it reaches, moving up a unit
 * when rounding to `digits(scaled)` decimals would otherwise read as 1000 of the smaller one (so 999,999 is "1M",
 * never "1000K"). Below 1,000 there is no unit. */
function scaleCompact(abs: number, digits: (scaled: number) => number): { scaled: number; suffix: string } {
  for (let i = 0; i < COMPACT_UNITS.length; i += 1) {
    const unit = COMPACT_UNITS[i] as { divisor: number; suffix: string };
    if (abs < unit.divisor) continue;
    const scaled = abs / unit.divisor;
    const rounded = Number(scaled.toFixed(digits(scaled)));
    const bigger = COMPACT_UNITS[i - 1];
    if (rounded >= 1000 && bigger) return { scaled: abs / bigger.divisor, suffix: bigger.suffix };
    return { scaled, suffix: unit.suffix };
  }
  // Base tier (under 1,000): shown with up to 2 decimals, so 999.999 rounds to 1000 and must roll up to "1K".
  if (Number(abs.toFixed(2)) >= 1000) return { scaled: abs / 1000, suffix: 'K' };
  return { scaled: abs, suffix: '' };
}

/** Decimals to print for a scaled value: up to 2 in the base tier (no unit), adaptive above it. */
function axisDigits(scaled: number, suffix: string): number {
  return suffix === '' ? 2 : adaptiveDigits(scaled);
}

/** Fixed `digits` decimals, then trailing zeros (and a dangling ".") removed: 2.50 → "2.5", 2.00 → "2". */
function trimFixed(v: number, digits: number): string {
  const fixed = v.toFixed(digits);
  return fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed;
}

/** Adaptive precision for axis labels: 2 decimals under 10, 1 under 100, none from 100 (2.5, 12.5, 125). */
function adaptiveDigits(scaled: number): number {
  return scaled < 10 ? 2 : scaled < 100 ? 1 : 0;
}

/** Formats integer cents compactly for KPIs (e.g. "$12.3K", "$1.24M", "$2.50B"). Under $1,000 this is the full
 * `formatCents`; from $1,000 up it uses K/M/B/T units. Axis ticks should use `formatCentsAxis` instead. */
export function formatCentsCompact(cents: number): string {
  const dollars = centsToDollars(cents);
  const abs = Math.abs(dollars);
  if (abs < 1_000) return formatCents(cents);
  const sign = dollars < 0 ? '-' : '';
  const { scaled, suffix } = scaleCompact(abs, (v) => (v < 10 ? 2 : 1));
  if (suffix === 'K') {
    return scaled < 10 ? `${sign}$${trimFixed(scaled, 2)}K` : `${sign}$${scaled.toFixed(1)}K`;
  }
  return `${sign}$${scaled.toFixed(2)}${suffix}`;
}

/** Formats integer cents for a chart axis: as short as possible while still exact for "nice" tick values, with
 * adaptive precision and no trailing zeros: "$0", "$500", "$2K", "$2.5K", "$10K", "$1.25M", "$100M", "$2.5B",
 * "$1.2T". Tick labels are never truncated, so they must be short and correct on their own. */
export function formatCentsAxis(cents: number): string {
  const dollars = centsToDollars(cents);
  const abs = Math.abs(dollars);
  const sign = dollars < 0 && abs !== 0 ? '-' : '';
  const { scaled, suffix } = scaleCompact(abs, adaptiveDigits);
  return `${sign}$${trimFixed(scaled, axisDigits(scaled, suffix))}${suffix}`;
}

/** Formats a plain number with grouping, up to `maxFractionDigits` decimal places (default 0). */
export function formatNumber(n: number, maxFractionDigits = 0): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: maxFractionDigits }).format(n);
}

/** Formats a plain count compactly for space-constrained UI like chart axis ticks, with adaptive precision and no
 * trailing zeros ("0", "999", "1K", "1.2K", "12.5K", "125K", "2.5M", "1B", "-2.5B", "1.2T"). Below 1,000 (in
 * absolute value) it is a plain number with up to 2 decimals. Tick labels are never truncated, so the text has to
 * be short and correct on its own. Full-precision values still go through `formatNumber`/`toLocaleString` in
 * tooltips, mark labels and data tables. See `formatCentsAxis` for the currency equivalent. */
export function formatCompactNumber(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 && abs !== 0 ? '-' : '';
  const { scaled, suffix } = scaleCompact(abs, adaptiveDigits);
  return `${sign}${trimFixed(scaled, axisDigits(scaled, suffix))}${suffix}`;
}

/** Formats a 0..1 ratio as a percentage string, e.g. "84.3%"; null → "—". */
export function formatPercent(ratio: number | null, digits = 1): string {
  if (ratio === null) return '—';
  return `${(ratio * 100).toFixed(digits)}%`;
}

/** Formats a DayString for display, e.g. "Mar 4, 2026" (rendered in UTC so it never shifts by local TZ); null → "—". */
export function formatDay(day: DayString | null): string {
  if (day === null) return '—';
  const parts = day.split('-').map(Number) as [number, number, number];
  return dayFormatter.format(new Date(Date.UTC(parts[0], parts[1] - 1, parts[2])));
}

/** Formats a 'YYYY-MM' month key for display, e.g. "Mar 2026". */
export function formatMonth(month: string): string {
  const parts = month.split('-').map(Number) as [number, number];
  return monthFormatter.format(new Date(Date.UTC(parts[0], parts[1] - 1, 1)));
}

/** Formats a 'YYYY-MM' month key for display, appending " (MTD)" when it is the current (partial) month of
 * `today` (a 'YYYY-MM-DD' DayString), e.g. "Sep 2026 (MTD)". */
export function formatMonthWithMtd(month: string, today: DayString): string {
  const label = formatMonth(month);
  return month === today.slice(0, 7) ? `${label} (MTD)` : label;
}

const monthShortFormatter = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short' });

/** Short x-axis labels for a run of 'YYYY-MM' months: "Apr", "May", ... Where the run crosses a year boundary the
 * first label and every January also carry the year ("Dec '26" style: "Jan '27"), so years are never ambiguous.
 * When `currentMonth` is given, that month is marked with a trailing "*" (month to date; explain it with
 * `monthAxisNote`). The full text (`formatMonth`/`formatMonthWithMtd`) stays in tooltips, aria and tables. */
export function monthAxisLabels(months: readonly string[], currentMonth: string | null = null): string[] {
  const years = new Set(months.map((m) => m.slice(0, 4)));
  return months.map((month, i) => {
    const parts = month.split('-').map(Number) as [number, number];
    let label = monthShortFormatter.format(new Date(Date.UTC(parts[0], parts[1] - 1, 1)));
    if (years.size > 1 && (i === 0 || parts[1] === 1)) label += ` '${month.slice(2, 4)}`;
    return month === currentMonth ? `${label}*` : label;
  });
}

/** The note that explains the "*" that `monthAxisLabels` puts on the current month, or null if it isn't shown. */
export function monthAxisNote(months: readonly string[], today: DayString): string | null {
  const current = today.slice(0, 7);
  return months.includes(current) ? `* ${formatMonth(current)} is month to date (a partial month).` : null;
}

/** Formats a day count to 1 decimal place, e.g. "3.4 days"; null → "—". */
export function formatDays(n: number | null): string {
  if (n === null) return '—';
  return `${n.toFixed(1)} days`;
}

const STATUS_LABELS: Record<ShipmentStatus, string> = {
  pending: 'Pending',
  in_transit: 'In transit',
  delivered: 'Delivered',
  cancelled: 'Cancelled'
};

/** Human-readable label for a shipment status, e.g. "In transit". */
export function statusLabel(s: ShipmentStatus): string {
  return STATUS_LABELS[s];
}

/** Truncates a string to `max` characters (default 40), appending "…" when truncated. Used for echoed CSV values. */
export function truncateForMessage(v: string, max = 40): string {
  if (v.length <= max) return v;
  return `${v.slice(0, max)}…`;
}
