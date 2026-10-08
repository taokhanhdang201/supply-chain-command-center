// Money on screen, one way everywhere (Phase 1 spec §4; owner decision D5): summary figures read compact ($32.6M,
// $165.4K); in a table an amount rounds to the dollar and a price (one unit, one shipment) keeps its cents. Only the
// presentation changes: every value is the integer cents the snapshot holds. Chart axes keep their own short format
// (formatCentsAxis in shared/format.ts).

import { centsToDollars } from '../../shared/money';

/** What a money cell holds: an amount (a value, a total) or a price (one unit, one shipment, an average of those). */
export type MoneyKind = 'amount' | 'price';

/** $10,000: from here a summary figure reads compact. */
export const COMPACT_FROM_CENTS = 1_000_000;

const usd = (options: Intl.NumberFormatOptions): Intl.NumberFormat =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', ...options });
// One decimal, always ("$8.0M" beside "$6.6M"). Intl moves up a unit when rounding reaches 1,000: $999,950 is "$1.0M".
const compact = usd({ notation: 'compact', minimumFractionDigits: 1, maximumFractionDigits: 1 });
const wholeDollars = usd({ minimumFractionDigits: 0, maximumFractionDigits: 0 });
const withCents = usd({ minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Whole dollars, half away from zero; anything that rounds to zero reads "$0", never "-$0". */
function toWholeDollars(cents: number): string {
  return wholeDollars.format(Math.abs(cents) < 50 ? 0 : centsToDollars(cents));
}

/** A summary figure: compact with one decimal from $10,000 ("$32.6M", "$165.4K"), whole dollars under it ("$1,285";
 * $9,999.50 is under it and reads "$10,000"). */
export function displayMoneySummary(cents: number): string {
  return Math.abs(cents) >= COMPACT_FROM_CENTS ? compact.format(centsToDollars(cents)) : toWholeDollars(cents);
}

/** A table cell: an amount to the dollar ("$1,403,217"), a price to the cent ("$617.07"). */
export function displayMoneyTable(cents: number, kind: MoneyKind): string {
  return kind === 'price' ? withCents.format(centsToDollars(cents)) : toWholeDollars(cents);
}
