// @vitest-environment jsdom
// BUG-7 regression: every axis text in every chart component is guarded against overlap (compact tick format is the
// primary defense; the shared truncation guard in scales.ts is the backstop). Measured the same way as the tester's
// round-3 test: real rendered <text> x/y/anchor, width estimated at 0.6 * fontSize per character.

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { BarChart } from '../../../src/client/components/charts/BarChart';
import { LineChart } from '../../../src/client/components/charts/LineChart';
import { StackedBarChart } from '../../../src/client/components/charts/StackedBarChart';
import { AXIS_FONT_SIZE, CHART_WIDTH, MIN_DESIGN_WIDTH, effectiveFontSize } from '../../../src/client/components/charts/chartMetrics';
import { placeTickLabels, categoryLabelBudgets, tickStride, truncateAxisLabel, truncateMiddle, uniqueAxisLabels, widestLabel } from '../../../src/client/components/charts/scales';
import { formatCents, formatCentsAxis, formatCompactNumber, monthAxisLabels } from '../../../src/shared/format';

const FONT = AXIS_FONT_SIZE;
interface Box { text: string; x0: number; x1: number; y0: number; y1: number }

function boxes(texts: Element[]): Box[] {
  return texts.map((t) => {
    const x = Number(t.getAttribute('x'));
    const y = Number(t.getAttribute('y'));
    const anchor = t.getAttribute('text-anchor') ?? 'start';
    const content = t.textContent ?? '';
    const w = content.length * FONT * 0.6;
    const x0 = anchor === 'end' ? x - w : anchor === 'middle' ? x - w / 2 : x;
    return { text: content, x0, x1: x0 + w, y0: y - FONT / 2, y1: y + FONT / 2 };
  });
}

function overlaps(list: Box[]): boolean {
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      const a = list[i] as Box;
      const b = list[j] as Box;
      if (a.x0 < b.x1 - 1 && b.x0 < a.x1 - 1 && a.y0 < b.y1 - 1 && b.y0 < a.y1 - 1) return true;
    }
  }
  return false;
}

/** All axis text: the aria-hidden tick group plus any <text> outside the role=list mark group. */
function axisTexts(container: HTMLElement): Element[] {
  const svg = container.querySelector('svg') as SVGSVGElement;
  return Array.from(svg.querySelectorAll('text'));
}

function insideViewBox(list: Box[], width = CHART_WIDTH): boolean {
  return list.every((b) => b.x0 >= -1 && b.x1 <= width + 1);
}

const tickTexts = (c: HTMLElement) => Array.from(c.querySelectorAll('g[aria-hidden="true"] text')).map((t) => t.textContent ?? '');
const money = (n: number) => formatCents(Math.round(n * 100));
const compactMoney = (n: number) => formatCentsAxis(Math.round(n * 100));

const categories = ['Electronics', 'Industrial Parts', 'Home Goods', 'Apparel', 'Health & Beauty', 'Packaging'].map(
  (label, i) => ({ key: label, label, value: [21_400_000, 9_800_000, 8_600_000, 3_100_000, 1_200_000, 600_000][i] as number })
);

describe('shared guard helpers', () => {
  it('tickStride thins ticks until labels fit, never below 1', () => {
    expect(tickStride(100, 50)).toBe(1);
    expect(tickStride(76, 109)).toBe(2);
    expect(tickStride(10, 100)).toBe(11);
    expect(tickStride(0, 10)).toBe(1);
  });

  it('widestLabel measures the longest label', () => {
    expect(widestLabel(['$0', '$10,000.00'], FONT)).toBe(10 * FONT * 0.6);
    expect(widestLabel([], FONT)).toBe(0);
  });

  it('truncateAxisLabel shortens to the budget and reports it (category labels only)', () => {
    const r = truncateAxisLabel('Dallas-Fort Worth DC', 70, FONT);
    expect(r.truncated).toBe(true);
    expect(r.text.length * FONT * 0.6).toBeLessThanOrEqual(70);
    expect(truncateAxisLabel('DFW', 70, FONT)).toEqual({ text: 'DFW', truncated: false });
  });

  it('truncateMiddle keeps the distinguishing tail', () => {
    const t = truncateMiddle('Dallas-Fort Worth DC → Nashville, TN', 100, FONT);
    expect(t.startsWith('Dall')).toBe(true);
    expect(t.endsWith('TN')).toBe(true);
    expect(t).toContain('…');
  });

  it('uniqueAxisLabels never renders two different labels identically (BUG-9)', () => {
    const labels = ['Dallas-Fort Worth DC → Nashville, TN', 'Dallas-Fort Worth DC → Denver, CO', 'Dallas-Fort Worth DC → Houston, TX'];
    const shown = uniqueAxisLabels(labels, 90, FONT).map((l) => l.text);
    expect(new Set(shown).size).toBe(labels.length);
  });

  it('uniqueAxisLabels leaves fitting labels whole', () => {
    expect(uniqueAxisLabels(['A', 'B'], 90, FONT)).toEqual([{ text: 'A', truncated: false }, { text: 'B', truncated: false }]);
  });
});

describe('effective text size (R-18)', () => {
  it('axis text renders at 11px or more in any chart card at least MIN_DESIGN_WIDTH wide', () => {
    expect(effectiveFontSize(MIN_DESIGN_WIDTH)).toBeGreaterThanOrEqual(11);
    expect(effectiveFontSize(330)).toBeGreaterThanOrEqual(11);
  });

  it('every rendered axis <text> uses the shared font size', () => {
    const { container } = render(<BarChart data={categories} orientation="horizontal" valueFormat={money} tickFormat={compactMoney} ariaLabel="x" />);
    for (const t of Array.from(container.querySelectorAll('text'))) expect(Number(t.getAttribute('font-size'))).toBe(AXIS_FONT_SIZE);
    expect(container.querySelector('svg')?.getAttribute('viewBox')).toBe(`0 0 ${CHART_WIDTH} 300`);
  });
});

describe('placement helpers', () => {
  it('placeTickLabels staggers over rows and skips only what cannot fit', () => {
    expect(placeTickLabels([0, 100, 200], [50, 50, 50], 3)).toEqual([0, 0, 0]);
    expect(placeTickLabels([0, 30, 60], [50, 50, 50], 3)).toEqual([0, 1, 0]);
    expect(placeTickLabels([0, 10, 20, 30], [100, 100, 100, 100], 3)).toEqual([0, 1, 2, null]);
  });

  it('categoryLabelBudgets gives an edge label more than half a spacing when its neighbour is short', () => {
    const b = categoryLabelBudgets(['Apr', 'May', 'Jun', 'Sep*'], 50, FONT);
    expect(b[1]).toBe(44);
    expect(b[0]).toBeGreaterThan(50 - 44 / 2 - 6 - 1);
    expect(b[3]).toBeGreaterThan(25);
  });
});

describe('BarChart axis overlap guard', () => {
  it.each(['horizontal', 'vertical'] as const)('%s, full currency ticks: whole labels, no overlap, inside the viewBox', (orientation) => {
    const { container } = render(<BarChart data={categories} orientation={orientation} valueFormat={money} ariaLabel="x" />);
    const list = boxes(axisTexts(container).filter((t) => t.closest('[role="list"]') === null));
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((b) => !b.text.includes('…'))).toBe(true);
    expect(overlaps(boxes(axisTexts(container)))).toBe(false);
    expect(insideViewBox(boxes(axisTexts(container)))).toBe(true);
  });

  it.each(['horizontal', 'vertical'] as const)('%s, compact axis ticks: short, correct, all labelled', (orientation) => {
    const { container } = render(
      <BarChart data={categories} orientation={orientation} valueFormat={money} tickFormat={compactMoney} ariaLabel="x" />
    );
    const ticks = tickTexts(container);
    expect(ticks).toEqual(['$0', '$5M', '$10M', '$15M', '$20M', '$25M']);
    expect(container.querySelector('[role="listitem"]')?.getAttribute('aria-label')).toBe('Electronics: $21,400,000.00');
  });

  it('thins ticks (never truncates them) when labels would touch', () => {
    const { container } = render(
      <BarChart data={categories} orientation="horizontal" valueFormat={money} tickFormat={(n) => `${money(n)} total`} ariaLabel="x" />
    );
    const ticks = tickTexts(container);
    expect(ticks.length).toBeLessThan(6);
    expect(ticks.every((t) => t.endsWith(' total') && !t.includes('…'))).toBe(true);
    expect(overlaps(boxes(axisTexts(container)))).toBe(false);
  });

  it('long category labels on both orientations do not overlap and stay distinguishable', () => {
    const data = Array.from({ length: 9 }, (_, i) => ({ key: `k${i}`, label: `A very long warehouse or route label ${i}`, value: 10 + i }));
    for (const orientation of ['horizontal', 'vertical'] as const) {
      const { container } = render(<BarChart data={data} orientation={orientation} valueFormat={String} ariaLabel="x" />);
      expect(overlaps(boxes(axisTexts(container)))).toBe(false);
      const shown = Array.from(container.querySelectorAll('[role="list"] text')).map((t) => t.textContent);
      expect(new Set(shown).size).toBe(9);
    }
  });

  it('shortLabel is shown on the axis while the full label stays in title and aria-label', () => {
    const data = [{ key: 'r', label: 'Dallas-Fort Worth DC → Nashville, TN', shortLabel: 'DFW → BNA', value: 5 }];
    const { container } = render(<BarChart data={data} orientation="horizontal" valueFormat={String} ariaLabel="x" />);
    const item = container.querySelector('[role="listitem"]') as Element;
    expect(item.querySelector('text')?.textContent).toBe('DFW → BNA');
    expect(item.querySelector('title')?.textContent).toBe('Dallas-Fort Worth DC → Nashville, TN');
    expect(item.getAttribute('aria-label')).toBe('Dallas-Fort Worth DC → Nashville, TN: 5');
  });
});

describe('LineChart axis overlap guard', () => {
  const months = ['Jan 2026', 'Feb 2026', 'Mar 2026', 'Apr 2026', 'May 2026', 'Jun 2026', 'Jul 2026', 'Aug 2026', 'Sep 2026 (MTD)'];
  const points = months.map((label, i) => ({ label, value: 1_000_000 * (i + 1) + 234_567 }));

  it('full currency ticks stay whole (margin grows) and crowded month labels do not overlap', () => {
    const { container } = render(<LineChart points={points} valueFormat={money} ariaLabel="x" />);
    const list = boxes(axisTexts(container));
    expect(overlaps(list)).toBe(false);
    expect(insideViewBox(list)).toBe(true);
    expect(tickTexts(container).every((t) => t.startsWith('$') && !t.includes('…'))).toBe(true);
  });

  it('compact ticks read "$2M"-style', () => {
    const { container } = render(<LineChart points={points} valueFormat={money} tickFormat={compactMoney} ariaLabel="x" />);
    const ticks = tickTexts(container);
    expect(ticks.every((t) => !t.includes('…') && !t.includes('.00'))).toBe(true);
    expect(ticks).toContain('$0');
  });
});

describe('StackedBarChart axis overlap guard', () => {
  const cats = Array.from({ length: 7 }, (_, i) => `Month ${i + 1} 2026`);
  const series = [
    { name: 'On time', values: cats.map((_, i) => 1_000_000 + i * 1000), tone: 'good' as const },
    { name: 'Delayed', values: cats.map(() => 250_000), tone: 'critical' as const }
  ];

  it('large counts with the default (full) tick format: no overlap, stays in viewBox', () => {
    const { container } = render(
      <StackedBarChart categories={cats} series={series} valueFormat={(n) => `${n.toLocaleString('en-US')} shipments`} ariaLabel="x" />
    );
    const list = boxes(axisTexts(container));
    expect(overlaps(list)).toBe(false);
    expect(insideViewBox(list)).toBe(true);
  });

  it('compact count ticks read "1M"-style and are not truncated', () => {
    const { container } = render(
      <StackedBarChart categories={cats} series={series} valueFormat={(n) => n.toLocaleString('en-US')} tickFormat={formatCompactNumber} ariaLabel="x" />
    );
    const ticks = Array.from(container.querySelectorAll('g[aria-hidden="true"] text')).map((t) => t.textContent ?? '');
    expect(ticks.some((t) => /M$/.test(t))).toBe(true);
    expect(ticks.every((t) => !t.includes('…'))).toBe(true);
  });
});

describe('month axis keeps the month-to-date marker and the first label whole (R-18)', () => {
  it('6 months, current month last: last label carries the marker, none is truncated, full text in title/aria', () => {
    const months = ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'];
    const short = monthAxisLabels(months, '2026-09');
    const points = months.map((m, i) => ({ label: `${m} full`, axisLabel: short[i] as string, value: 1000 * (i + 1) }));
    const { container } = render(<LineChart points={points} valueFormat={money} tickFormat={compactMoney} ariaLabel="x" />);
    const shown = axisTexts(container)
      .filter((t) => t.closest('[aria-hidden="true"]') === null)
      .map((t) => t.textContent);
    expect(shown).toEqual(['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep*']);
    expect(overlaps(boxes(axisTexts(container)))).toBe(false);
    expect(container.querySelector('[role="listitem"]:last-child')?.getAttribute('aria-label')).toContain('2026-09 full');
  });
});
