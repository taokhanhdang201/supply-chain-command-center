// Round-3 (BUG-6 re-scrutiny per the coder's own "where the tester should look again" note): a real-browser
// Playwright pass against the built Analytics page at 1440px AND 390px found that the round-2 fix for BUG-6
// (LineChart/StackedBarChart x-axis CATEGORY labels overlapping) did NOT cover a different, still-broken axis:
// BarChart's VALUE axis in `orientation="horizontal"` mode. On the live "Inventory value by category" chart
// (6 categories, dollar values up to ~$20M, `valueFormat={(n) => formatCents(...)}` per AnalyticsPage.tsx), the
// value-axis tick labels "$0.00", "$5,000,000.00", "$10,000,000.00", "$15,000,000.00", "$20,000,000.00" render on
// top of each other and are illegible -- measured with real `getBoundingClientRect()` on both desktop (1440px)
// and mobile (390px). This is a genuinely new,
// separate defect from BUG-6: it is BarChart.tsx's tick-label loop (the `isVertical` ternary's horizontal branch,
// around line ~95), which -- unlike every category-label path in this codebase (BarChart's own `truncateLabel`
// for its per-mark labels, and the round-2 fix's `axisLabelBudget`/`truncateAxisLabel` for LineChart/
// StackedBarChart) -- never truncates or budgets its VALUE tick text at all; it simply centers each tick's full
// formatted string at a fixed x position with no spacing check against its neighbors.
//
// This file reproduces it deterministically from the real rendered SVG (`x`, `text-anchor`, actual `<text>`
// content), using the same 0.6*fontSize per-character width estimate the rest of this codebase's own
// `truncateLabel` uses, at BarChart's own AXIS_FONT_SIZE (13px). Left failing per tester process -- this is a
// product bug (BUG-7), not fixed here.

// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { BarChart } from '../../src/client/components/charts/BarChart';
import { formatCents } from '../../src/shared/format';

const AXIS_FONT_SIZE = 13;
const CHAR_WIDTH_FACTOR = 0.6;

function estimatedWidth(text: string): number {
  return text.length * AXIS_FONT_SIZE * CHAR_WIDTH_FACTOR;
}

interface TickBox { text: string; x0: number; x1: number; y0: number; y1: number }

/** Reads every VALUE-axis tick <text> (inside the aria-hidden tick group) as a 2D box, from its real x/y and
 * text-anchor (estimated width) plus a line-height-sized vertical extent centered on `y` (matches
 * `dominantBaseline="middle"`/baseline text rendering closely enough for an overlap check). */
function valueAxisTickBoxes(container: HTMLElement): TickBox[] {
  const svg = container.querySelector('svg') as SVGSVGElement;
  const tickGroup = svg.querySelector('g[aria-hidden="true"]') as SVGGElement;
  const boxes: TickBox[] = [];
  for (const text of Array.from(tickGroup.querySelectorAll('text'))) {
    const x = Number(text.getAttribute('x'));
    const y = Number(text.getAttribute('y'));
    const anchor = text.getAttribute('text-anchor') ?? 'start';
    const content = text.textContent ?? '';
    const w = estimatedWidth(content);
    const x0 = anchor === 'end' ? x - w : anchor === 'middle' ? x - w / 2 : x;
    const x1 = x0 + w;
    const halfH = AXIS_FONT_SIZE * 0.5;
    boxes.push({ text: content, x0, x1, y0: y - halfH, y1: y + halfH });
  }
  return boxes;
}

function boxesOverlap(a: TickBox, b: TickBox): boolean {
  return a.x0 < b.x1 - 1 && b.x0 < a.x1 - 1 && a.y0 < b.y1 - 1 && b.y0 < a.y1 - 1;
}

function hasOverlap(boxes: TickBox[]): boolean {
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      if (boxesOverlap(boxes[i] as TickBox, boxes[j] as TickBox)) return true;
    }
  }
  return false;
}

describe('BUG-7 marker (round 3): BarChart horizontal-orientation VALUE-axis tick labels overlap', () => {
  it('reproduces the live "Inventory value by category" chart: 6 categories, dollar values up to ~$20M', () => {
    // Same shape as the real sample data at seed 42 (Electronics highest, Packaging lowest).
    const data = [
      { key: 'Electronics', label: 'Electronics', value: 21_400_000 },
      { key: 'Industrial Parts', label: 'Industrial Parts', value: 9_800_000 },
      { key: 'Home Goods', label: 'Home Goods', value: 8_600_000 },
      { key: 'Apparel', label: 'Apparel', value: 3_100_000 },
      { key: 'Health & Beauty', label: 'Health & Beauty', value: 1_200_000 },
      { key: 'Packaging', label: 'Packaging', value: 600_000 }
    ];
    const { container } = render(
      <BarChart
        data={data}
        orientation="horizontal"
        valueFormat={(n) => formatCents(Math.round(n * 100))}
        ariaLabel="Inventory value by category"
      />
    );
    const spans = valueAxisTickBoxes(container);
    expect(spans.length).toBeGreaterThanOrEqual(4); // $0, $5M, $10M, $15M, (maybe $20M/$25M depending on niceTicks)
    // This is the bug: full "$X,XXX,XXX.XX"-formatted tick labels, evenly spaced across the ~348px plot width
    // (WIDTH 600 - MARGIN_HORIZONTAL.left 180 - MARGIN_HORIZONTAL.right 40 - see BarChart.tsx), are far too wide
    // to fit without overlapping their neighbors -- observed directly, garbled, in a real browser.
    expect(hasOverlap(spans)).toBe(false);
  });

  it('sanity: small integer values (e.g. "Top shipping routes" shipment-count mode) do not overlap -- the bug is specific to wide formatted labels', () => {
    const data = [
      { key: 'A', label: 'Atlanta DC -> Boston', value: 42 },
      { key: 'B', label: 'Atlanta DC -> Columbus', value: 38 },
      { key: 'C', label: 'Dallas-Fort Worth -> Denver', value: 31 }
    ];
    const { container } = render(
      <BarChart data={data} orientation="horizontal" valueFormat={(n) => n.toLocaleString('en-US')} ariaLabel="Top shipping routes" />
    );
    const spans = valueAxisTickBoxes(container);
    expect(hasOverlap(spans)).toBe(false);
  });

  it('sanity: vertical orientation with the same dollar values does not overlap (value axis has a full column to itself)', () => {
    const data = [
      { key: 'Dallas-Fort Worth DC', label: 'Dallas-Fort Worth DC', value: 21_400_000 },
      { key: 'Newark DC', label: 'Newark DC', value: 9_800_000 },
      { key: 'Atlanta DC', label: 'Atlanta DC', value: 8_600_000 }
    ];
    const { container } = render(
      <BarChart data={data} orientation="vertical" valueFormat={(n) => formatCents(Math.round(n * 100))} ariaLabel="Inventory value by warehouse" />
    );
    const spans = valueAxisTickBoxes(container);
    expect(hasOverlap(spans)).toBe(false);
  });
});
