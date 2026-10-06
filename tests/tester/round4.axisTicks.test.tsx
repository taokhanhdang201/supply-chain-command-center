// Round 4: verify BUG-7's fix (compact ticks + shared overlap guard) from the user's point of view, and probe the
// two side effects the fix could introduce: (1) value-axis ticks silently chopped to "$2,000…" (a truncated number
// reads as a DIFFERENT number), (2) category labels truncated so hard that distinct categories look identical.

// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, within } from '@testing-library/react';
import { BarChart } from '../../src/client/components/charts/BarChart';
import { LineChart } from '../../src/client/components/charts/LineChart';
import { AnalyticsPage } from '../../src/client/pages/AnalyticsPage';
import { formatCents, formatCentsCompact, formatCompactNumber } from '../../src/shared/format';
import { renderWithData } from '../helpers/renderWithData';
import { createSampleDataset } from '../../src/shared/sample/generateSampleData';
import { buildSnapshot } from '../../src/shared/domain/snapshot';
import { TODAY } from '../helpers/fixtures';

function sampleSnapshot() {
  return buildSnapshot(createSampleDataset(42, TODAY, '2026-06-15T00:00:00.000Z'), TODAY, {
    generatedAt: '2026-06-15T00:00:00.000Z',
    limits: { maxUploadBytes: 5_000_000, maxRows: 10_000 }
  });
}

const cents = (d: number) => Math.round(d * 100);
const tickTexts = (c: HTMLElement) => Array.from(c.querySelectorAll('g[aria-hidden="true"] text')).map((t) => t.textContent ?? '');

describe('compact formatters: units, sign, zero, precision', () => {
  it('formatCentsCompact uses correct K/M units and keeps sign', () => {
    expect(formatCentsCompact(cents(12_345))).toBe('$12.3K');
    expect(formatCentsCompact(cents(-12_345))).toBe('-$12.3K');
    expect(formatCentsCompact(cents(2_500_000))).toBe('$2.50M');
    expect(formatCentsCompact(cents(-2_500_000))).toBe('-$2.50M');
    expect(formatCentsCompact(0)).toBe('$0.00');
  });
  it('formatCompactNumber handles 0, negatives, thresholds', () => {
    expect(formatCompactNumber(0)).toBe('0');
    expect(formatCompactNumber(-1500)).toBe('-1.5K');
    expect(formatCompactNumber(999)).toBe('999');
    expect(formatCompactNumber(1000)).toBe('1K');
    expect(formatCompactNumber(2_500_000)).toBe('2.5M');
  });
  it('tooltips / full formatter keep full precision', () => {
    const { container } = render(
      <BarChart data={[{ key: 'a', label: 'A', value: 1234567.89 }]} orientation="vertical"
        valueFormat={(n) => formatCents(cents(n))} tickFormat={(n) => formatCentsCompact(cents(n))} ariaLabel="x" />
    );
    expect(container.querySelector('[role="listitem"]')?.getAttribute('aria-label')).toContain('$1,234,567.89');
  });
  it('axis has no mixed-precision noise: every K tick and every M tick in one axis use the same decimals', () => {
    // "$0.00 / $50.0K / $100.0K" is tolerated; but within a single unit the decimals must agree.
    const { container } = render(
      <LineChart points={[{ label: 'a', value: 0 }, { label: 'b', value: 150_000 }]} valueFormat={(n) => formatCents(cents(n))}
        tickFormat={(n) => formatCentsCompact(cents(n))} ariaLabel="x" />
    );
    const ks = tickTexts(container).filter((t) => t.endsWith('K')).map((t) => t.split('.')[1]?.length);
    expect(new Set(ks).size).toBeLessThanOrEqual(1);
  });
});

describe('value-axis ticks must never be truncated with an ellipsis (a chopped number is misleading)', () => {
  const valueMaxes = [800, 2_500, 8_000, 9_999, 15_000, 250_000, 3_000_000, 90_000_000, 2_500_000_000];
  for (const orientation of ['vertical', 'horizontal'] as const) {
    for (const max of valueMaxes) {
      it(`BarChart ${orientation}, max $${max.toLocaleString()} with compact ticks: no tick contains an ellipsis`, () => {
        const { container } = render(
          <BarChart data={[{ key: 'a', label: 'A', value: max }, { key: 'b', label: 'B', value: max / 3 }]} orientation={orientation}
            valueFormat={(n) => formatCents(cents(n))} tickFormat={(n) => formatCentsCompact(cents(n))} ariaLabel="x" />
        );
        const bad = tickTexts(container).filter((t) => t.includes('…') && !/^[A-Z]/.test(t));
        expect(bad).toEqual([]);
      });
    }
  }
  it('LineChart with small dollar values ($2,500 max): ticks not ellipsized', () => {
    const { container } = render(
      <LineChart points={[{ label: 'a', value: 100 }, { label: 'b', value: 2500 }]} valueFormat={(n) => formatCents(cents(n))}
        tickFormat={(n) => formatCentsCompact(cents(n))} ariaLabel="x" />
    );
    expect(tickTexts(container).filter((t) => t.includes('…'))).toEqual([]);
  });
});

describe('truncation guard must not hide the distinguishing part of category labels', () => {
  it('Analytics "Top shipping routes" (real sample data): the visible labels are unique', async () => {
    const snapshot = sampleSnapshot();
    const { container } = await renderWithData(<AnalyticsPage />, { snapshot });
    const svg = container.querySelector('svg[aria-label="Top shipping routes"]') as SVGSVGElement;
    expect(svg).toBeTruthy();
    const visible = Array.from(svg.querySelectorAll('g[role="list"] text')).map((t) => t.textContent ?? '');
    expect(visible.length).toBeGreaterThan(3);
    const dupes = visible.filter((t, i) => visible.indexOf(t) !== i);
    // BUG-9: routes sharing a long origin ("Dallas-Fort Worth DC → ...") are all cut to "Dallas-Fort Worth DC…".
    expect(dupes).toEqual([]);
  });
  it('full names remain reachable: every truncated category label has a <title> with the full text and an aria-label', async () => {
    const snapshot = sampleSnapshot();
    const { container } = await renderWithData(<AnalyticsPage />, { snapshot });
    const svg = container.querySelector('svg[aria-label="Top shipping routes"]') as SVGSVGElement;
    const items = Array.from(svg.querySelectorAll('g[role="listitem"]'));
    for (const g of items) {
      const shown = g.querySelector('text')?.textContent ?? '';
      const full = g.querySelector('title')?.textContent;
      if (shown.endsWith('…')) expect(full && full.length).toBeGreaterThan(shown.length - 1);
      expect(g.getAttribute('aria-label')).toMatch(/→/);
    }
  });
});
