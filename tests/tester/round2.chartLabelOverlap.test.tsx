// Round-2 R-16: a real-browser check (this session's Playwright pass against the built app, using SVG
// getBBox() on the live Analytics page) found that LineChart's and StackedBarChart's x-axis category labels
// OVERLAP each other -- badly enough to be illegible -- whenever there are several categories. Measured live:
// on "Shipping cost over time" (6 months), "Aug 2026" (middle-anchored, x=431.19, width=63.22) and
// "Sep 2026 (MTD)" (end-anchored, x=455.16, width=105.21) overlap by ~56px, rendering as garbled text
// ("AugS2ep2026026 (MTD)"). The
// same happens on "On-time vs delayed by month" between "Apr 2026" and "May 2026" (~43px overlap). Root cause:
// R-3's fix anchored the FIRST label 'start' and the LAST label 'end' (instead of 'middle') so they don't run
// past the plot's own edges -- but nothing was done about the *adjacent* interior label, so a long label (worse
// now that R-4 added the "(MTD)" suffix to the current month) simply overlaps its neighbor instead.
//
// This file reproduces it deterministically using the REAL rendered `x`/`text-anchor` values from LineChart and
// StackedBarChart (not reimplemented), and a per-character width estimate at the charts' own AXIS_FONT_SIZE
// (13px) calibrated against the real getBBox() measurements above (measured "Apr 2026", 8 chars -> 60.33px ->
// 7.54px/char -> 0.58 * fontSize, matching the 0.6 * fontSize heuristic BarChart.tsx's own `truncateLabel`
// already uses elsewhere in this codebase for exactly this kind of estimate).

// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { LineChart } from '../../src/client/components/charts/LineChart';
import { StackedBarChart } from '../../src/client/components/charts/StackedBarChart';

const AXIS_FONT_SIZE = 13;
const CHAR_WIDTH_FACTOR = 0.6; // matches BarChart.tsx's own truncateLabel heuristic

function estimatedWidth(text: string): number {
  return text.length * AXIS_FONT_SIZE * CHAR_WIDTH_FACTOR;
}

/** Reads every axis-label <text> (i.e. NOT inside the aria-hidden tick group and not a per-mark listitem label)
 * directly from the rendered SVG, with its real x and text-anchor, and estimates its rendered span. */
function axisLabelSpans(container: HTMLElement): Array<{ text: string; start: number; end: number }> {
  const svg = container.querySelector('svg') as SVGSVGElement;
  const tickGroup = svg.querySelector('g[aria-hidden="true"]');
  const listGroup = svg.querySelector('g[role="list"]');
  const spans: Array<{ text: string; start: number; end: number }> = [];
  for (const text of Array.from(svg.querySelectorAll('text'))) {
    if (tickGroup?.contains(text)) continue;
    if (listGroup?.contains(text)) continue; // per-mark labels (BarChart), not axis category labels
    const x = Number(text.getAttribute('x'));
    const anchor = text.getAttribute('text-anchor') ?? 'start';
    const content = text.textContent ?? '';
    const w = estimatedWidth(content);
    const start = anchor === 'end' ? x - w : anchor === 'middle' ? x - w / 2 : x;
    const end = start + w;
    spans.push({ text: content, start, end });
  }
  return spans;
}

function hasOverlap(spans: Array<{ start: number; end: number }>): boolean {
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i += 1) {
    if ((sorted[i] as { start: number }).start < (sorted[i - 1] as { end: number }).end - 1) return true;
  }
  return false;
}

describe('BUG-6 marker (round 2): LineChart/StackedBarChart x-axis category labels overlap with several categories', () => {
  it('LineChart: 6 months including a "(MTD)"-suffixed current month overlap (reproduces the live Analytics/Dashboard bug)', () => {
    const points = [
      { label: 'Apr 2026', value: 90000 },
      { label: 'May 2026', value: 95000 },
      { label: 'Jun 2026', value: 88000 },
      { label: 'Jul 2026', value: 91000 },
      { label: 'Aug 2026', value: 96000 },
      { label: 'Sep 2026 (MTD)', value: 62000 }
    ];
    const { container } = render(<LineChart points={points} valueFormat={(v) => `$${v}`} ariaLabel="Shipping cost by month" />);
    const spans = axisLabelSpans(container);
    expect(spans.length).toBe(6);
    // This is the bug: with 6 evenly-spaced categories over the ~488px plot width, "Aug 2026" (middle-anchored)
    // and "Sep 2026 (MTD)" (end-anchored, much wider because of the MTD suffix) overlap. Left failing per
    // tester process -- not a fix.
    expect(hasOverlap(spans)).toBe(false);
  });

  it('StackedBarChart: 6 plain months (no MTD suffix) still overlap between the first and second label', () => {
    const categories = ['Apr 2026', 'May 2026', 'Jun 2026', 'Jul 2026', 'Aug 2026', 'Sep 2026'];
    const { container } = render(
      <StackedBarChart
        categories={categories}
        series={[
          { name: 'On time', values: [60, 62, 58, 70, 65, 55], tone: 'good' },
          { name: 'Delayed', values: [15, 12, 18, 10, 14, 8], tone: 'critical' }
        ]}
        valueFormat={(v) => `${v}`}
        ariaLabel="On-time vs delayed shipments by month"
      />
    );
    const spans = axisLabelSpans(container);
    expect(spans.length).toBe(6);
    expect(hasOverlap(spans)).toBe(false);
  });

  it('sanity: with only 2-3 categories (plenty of room), no overlap occurs -- the bug is specific to crowded axes', () => {
    const { container } = render(
      <LineChart points={[{ label: 'Jan 2026', value: 100 }, { label: 'Feb 2026', value: 200 }]} valueFormat={(v) => `$${v}`} ariaLabel="Two points" />
    );
    const spans = axisLabelSpans(container);
    expect(hasOverlap(spans)).toBe(false);
  });
});
