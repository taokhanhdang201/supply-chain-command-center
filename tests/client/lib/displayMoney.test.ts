// DESIGN.md "Money": summary figures compact ($32.6M, $165.4K), table amounts to the dollar, prices to
// the cent. The edge cases; proof that every money string the tests changed to this format is the same cents as before,
// within the rounding of its new format; and the rule that every money string of the client comes from this module
// (chart axes keep formatCentsAxis).
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatCents, formatCentsCompact } from '../../../src/shared/format';
import { displayMoneySummary, displayMoneyTable, type MoneyKind } from '../../../src/client/lib/displayMoney';

/** The dollars a money string reads, and the most its rounding can be off by (half its last digit), in dollars. */
function read(text: string): { dollars: number; slack: number } {
  const m = /^(-?)\$([\d,]+(?:\.(\d+))?)([KMB]?)$/.exec(text);
  if (m === null) throw new Error(`not a money string: ${text}`);
  const unit = { '': 1, K: 1e3, M: 1e6, B: 1e9 }[m[4] as '' | 'K' | 'M' | 'B'];
  const decimals = (m[3] ?? '').length;
  return { dollars: (m[1] === '-' ? -1 : 1) * Number((m[2] as string).replace(/,/g, '')) * unit, slack: (unit * 10 ** -decimals) / 2 };
}

describe('displayMoneySummary', () => {
  it.each<[number, string]>([
    [0, '$0'],
    [128_504, '$1,285'],
    [999_949, '$9,999'],
    [999_950, '$10,000'], // $9,999.50 is under $10,000: whole dollars, rounded half up
    [1_000_000, '$10.0K'],
    [16_541_230, '$165.4K'],
    [99_994_999, '$999.9K'],
    [99_995_000, '$1.0M'], // $999,950: never "$1000.0K"
    [250_000_000, '$2.5M'],
    [3_264_337_148, '$32.6M'],
    [-1_234_500, '-$12.3K'],
    [-550, '-$6'],
    [-40, '$0'] // rounds to zero: no minus sign
  ])('%i cents reads %s', (cents, text) => {
    expect(displayMoneySummary(cents)).toBe(text);
  });
});

describe('displayMoneyTable', () => {
  it.each<[number, MoneyKind, string]>([
    [140_321_718, 'amount', '$1,403,217'],
    [121_377_669, 'amount', '$1,213,777'],
    [999_950, 'amount', '$10,000'],
    [0, 'amount', '$0'],
    [-550, 'amount', '-$6'],
    [-40, 'amount', '$0'],
    [61_707, 'price', '$617.07'],
    [54_508, 'price', '$545.08'],
    [999_950, 'price', '$9,999.50'],
    [0, 'price', '$0.00'],
    [-40, 'price', '-$0.40']
  ])('%i cents as an %s reads %s', (cents, kind, text) => {
    expect(displayMoneyTable(cents, kind)).toBe(text);
  });

  it('writes a price exactly as before (to the cent), so Unit cost and shipment costs do not change', () => {
    for (const cents of [0, 1, 99, 54_508, 61_707, 90_819, 128_504, 140_321_718, -40]) expect(displayMoneyTable(cents, 'price')).toBe(formatCents(cents));
  });
});

describe('the money strings the tests changed are the same cents, rounded', () => {
  // [where, cents, the string before (shared/format.ts), the string now, how it is shown now]
  const CHANGED: Array<[string, number, string, string, 'summary' | 'amount' | 'price']> = [
    ['v16 Dashboard: total inventory value', 3_264_337_148, '$32.64M', '$32.6M', 'summary'],
    ['v16 Dashboard: the WH-DFW rack', 795_923_314, '$7.96M', '$8.0M', 'summary'],
    ['v16 Dashboard and Analytics: average shipping cost (a price: to the cent)', 128_504, '$1,285.04', '$1,285.04', 'price'],
    ['v16 Inventory: 360 items', 3_264_337_148, '$32,643,371.48', '$32.6M', 'summary'],
    ['v16 Inventory: ELC-0015 value', 140_321_718, '$1,403,217.18', '$1,403,217', 'amount'],
    ['v16 Inventory: 20 items low or out of stock', 44_964_220, '$449,642.20', '$449.6K', 'summary'],
    ['InventoryPage.test: 2 items', 51_000, '$510.00', '$510', 'summary'],
    ['InventoryPage.test: 1 item', 50_000, '$500.00', '$500', 'summary'],
    ['atlasComponents and atlasDesign: a rack', 250_000_000, '$2.50M', '$2.5M', 'summary'],
    ['attention.test: Alpha Freight above typical', 35_000, '$350.00', '$350', 'summary'],
    ['attention.test: Beta Lines above typical', 10_000, '$100.00', '$100', 'summary'],
    ['attention.test: a partial move', 18_510, '$185.10', '$185', 'summary']
  ];
  it.each(CHANGED)('%s: %i cents, %s → %s', (_where, cents, before, now, shown) => {
    expect([formatCents(cents), formatCentsCompact(cents)], 'the string before is these cents').toContain(before);
    expect(shown === 'summary' ? displayMoneySummary(cents) : displayMoneyTable(cents, shown)).toBe(now);
    const { dollars, slack } = read(now);
    expect(Math.abs(dollars * 100 - cents), 'within the rounding of the new string').toBeLessThanOrEqual(slack * 100 + 1e-6);
  });
});

describe('one way to show money in the client', () => {
  it('no client file formats money with the shared formatCents or formatCentsCompact (axes keep formatCentsAxis)', () => {
    const root = resolve('src/client');
    const offenders = readdirSync(root, { recursive: true, encoding: 'utf8' })
      .filter((file) => /\.tsx?$/.test(file))
      .filter((file) => /\bformatCents(?:Compact)?\b/.test(readFileSync(join(root, file), 'utf8')));
    expect(offenders).toEqual([]);
  });
});
