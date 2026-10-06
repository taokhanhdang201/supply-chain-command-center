// Round 5: independent verification of BUG-8/9/10 with adversarial values.
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { BarChart } from '../../src/client/components/charts/BarChart';
import { LineChart } from '../../src/client/components/charts/LineChart';
import { StackedBarChart } from '../../src/client/components/charts/StackedBarChart';
import { formatCents, formatCentsAxis, formatCentsCompact, formatCompactNumber } from '../../src/shared/format';
import { routeShortLabel } from '../../src/shared/domain/analytics';

const cents = (d: number) => Math.round(d * 100);
const W = (s: string) => s.length * 13 * 0.6;
const ADV = [0, -0, 1, 0.5, 999.99, 1_000, 1_500, 9_999.99, 10_000, 999_999, 1_000_000, 1_250_000, 999_999_999, 1e9, 2.5e9, 2.5e12, -1, -999.99, -1_000, -999_999, -2.5e9];

describe('BUG-10 / formatter sanity on adversarial values', () => {
  for (const v of ADV) {
    it(`formatCentsAxis(${v}) and formatCompactNumber(${v}) are well-formed`, () => {
      for (const s of [formatCentsAxis(cents(v)), formatCompactNumber(v)]) {
        expect(s).not.toMatch(/NaN|Infinity|undefined/);
        expect(s).not.toMatch(/\b1000[KMBT]?\b/);   // no un-rolled 1000K / 1000M
        expect(s).not.toMatch(/^-\$?0(\.0+)?[KMBT]?$/); // no "-$0"
        expect(s).not.toMatch(/\.\d*0[KMBT]?$/);       // no trailing zeros on axis text
        expect(s.length).toBeLessThanOrEqual(8);
      }
    });
  }
  it('exact expectations', () => {
    const e: Array<[number, string]> = [[0, '$0'], [999.99, '$999.99'], [1000, '$1K'], [999_999, '$1M'], [1e9, '$1B'], [2.5e12, '$2.5T'], [-1000, '-$1K'], [-999.99, '-$999.99']];
    for (const [v, s] of e) expect(formatCentsAxis(cents(v))).toBe(s);
    expect(formatCompactNumber(999_999)).toBe('1M');
    expect(formatCompactNumber(999.999)).toBe('1K'); // non-integer count just under a unit must roll over
    expect(formatCompactNumber(999_999_999)).toBe('1B');
  });
  it('KPI formatter formatCentsCompact rolls over and has B/T', () => {
    expect(formatCentsCompact(cents(999_999))).not.toMatch(/1000/);
    expect(formatCentsCompact(cents(2.5e9))).toBe('$2.50B');
    expect(formatCentsCompact(cents(2.5e12))).toBe('$2.50T');
    expect(formatCentsCompact(cents(-2.5e9))).toBe('-$2.50B');
  });
  it('full precision is untouched by the axis formatters', () => {
    expect(formatCents(cents(1234567.89))).toBe('$1,234,567.89');
  });
});

const tickEls = (c: HTMLElement) => Array.from(c.querySelectorAll('g[aria-hidden="true"] text'));
const tickTexts = (c: HTMLElement) => tickEls(c).map((t) => t.textContent ?? '');

function datasets(): Array<[string, number[]]> {
  return [['zeros', [0, 0]], ['single bar', [5]], ['all equal', [7, 7, 7]], ['tiny', [0.5, 0.25]], ['999.99', [999.99]], ['1,000', [1000]],
    ['999,999', [999_999, 500_000]], ['1e9', [1e9, 4e8]], ['2.5e12', [2.5e12, 1e12]], ['mixed huge/small', [2.5e12, 3]]];
}

describe('BUG-8: numeric ticks never truncated and never overlap, all chart types', () => {
  for (const [name, vals] of datasets()) {
    for (const orientation of ['vertical', 'horizontal'] as const) {
      it(`BarChart ${orientation} / ${name}`, () => {
        const { container } = render(
          <BarChart data={vals.map((v, i) => ({ key: `k${i}`, label: `Cat ${i}`, value: v }))} orientation={orientation}
            valueFormat={(n) => formatCents(cents(n))} tickFormat={(n) => formatCentsAxis(cents(n))} ariaLabel="x" />
        );
        const texts = tickTexts(container);
        expect(texts.some((t) => t.includes('…'))).toBe(false);
        expect(texts.some((t) => /NaN/.test(t))).toBe(false);
        // pairwise overlap between tick labels (estimated boxes; centred for horizontal, end-anchored for vertical)
        const els = tickEls(container).filter((t) => /^-?\$/.test(t.textContent ?? ''));
        const boxes = els.map((t) => {
          const x = Number(t.getAttribute('x')); const y = Number(t.getAttribute('y')); const w = W(t.textContent ?? '');
          return orientation === 'horizontal' ? { x0: x - w / 2, x1: x + w / 2, y0: y - 13, y1: y } : { x0: x - w, x1: x, y0: y - 6.5, y1: y + 6.5 };
        });
        for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i]!, b = boxes[j]!;
          const ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), oy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
          expect(ox > 0 && oy > 0, `${texts[i]} overlaps ${texts[j]}`).toBe(false);
        }
        // labels stay inside the 600px-wide viewBox
        boxes.forEach((b) => { expect(b.x0).toBeGreaterThanOrEqual(0); expect(b.x1).toBeLessThanOrEqual(600); });
      });
    }
    it(`LineChart / ${name}`, () => {
      const { container } = render(<LineChart points={vals.map((v, i) => ({ label: `M${i}`, value: v }))}
        valueFormat={(n) => formatCents(cents(n))} tickFormat={(n) => formatCentsAxis(cents(n))} ariaLabel="x" />);
      const els = tickEls(container).filter((t) => /^-?\$/.test(t.textContent ?? ''));
      expect(els.some((t) => (t.textContent ?? '').includes('…'))).toBe(false);
      els.forEach((t) => expect(Number(t.getAttribute('x')) - W(t.textContent ?? '')).toBeGreaterThanOrEqual(0));
    });
    it(`StackedBarChart / ${name}`, () => {
      const { container } = render(<StackedBarChart categories={vals.map((_, i) => `M${i}`)}
        series={[{ name: 'a', values: vals, tone: 'good' }, { name: 'b', values: vals.map((v) => v / 2), tone: 'critical' }]}
        valueFormat={(n) => formatCents(cents(n))} tickFormat={(n) => formatCentsAxis(cents(n))} ariaLabel="x" />);
      const els = tickEls(container).filter((t) => /^-?\$/.test(t.textContent ?? ''));
      expect(els.some((t) => (t.textContent ?? '').includes('…'))).toBe(false);
      els.forEach((t) => expect(Number(t.getAttribute('x')) - W(t.textContent ?? '')).toBeGreaterThanOrEqual(0));
    });
  }
  it('horizontal value axis uses at most two rows (not cluttered) for a typical $20M axis', () => {
    const { container } = render(<BarChart data={[{ key: 'a', label: 'A', value: 2e7 }]} orientation="horizontal"
      valueFormat={(n) => formatCents(cents(n))} tickFormat={(n) => formatCentsAxis(cents(n))} ariaLabel="x" />);
    const ys = new Set(tickEls(container).filter((t) => /^\$/.test(t.textContent ?? '')).map((t) => t.getAttribute('y')));
    expect(ys.size).toBeLessThanOrEqual(2);
  });
});

describe('BUG-9: distinct category labels stay distinct and full names stay reachable', () => {
  const names = ['Dallas-Fort Worth DC → Nashville, TN', 'Dallas-Fort Worth DC → Denver, CO', 'Dallas-Fort Worth DC → Houston, TX', 'Dallas-Fort Worth DC → Phoenix, AZ'];
  for (const orientation of ['vertical', 'horizontal'] as const) {
    it(`BarChart ${orientation}: 4 same-prefix long labels render 4 different texts, full name in <title>`, () => {
      const { container } = render(<BarChart data={names.map((n, i) => ({ key: `k${i}`, label: n, value: 10 - i }))} orientation={orientation}
        valueFormat={String} ariaLabel="x" />);
      const shown = Array.from(container.querySelectorAll('g[role="list"] text')).map((t) => t.textContent);
      expect(new Set(shown).size).toBe(4);
      const titles = Array.from(container.querySelectorAll('g[role="listitem"] title')).map((t) => t.textContent);
      names.forEach((n) => expect(titles).toContain(n));
    });
  }
  it('identical labels that are genuinely equal are not renamed', () => {
    const { container } = render(<BarChart data={[{ key: 'a', label: 'Same', value: 1 }, { key: 'b', label: 'Same', value: 2 }]}
      orientation="vertical" valueFormat={String} ariaLabel="x" />);
    expect(Array.from(container.querySelectorAll('g[role="list"] text')).map((t) => t.textContent)).toEqual(['Same', 'Same']);
  });
  it('routeShortLabel: codes when known, names when unmapped, and unique per route', () => {
    expect(routeShortLabel({ originCode: 'WH-DFW', destinationCode: 'BNA', originName: 'x', destinationName: 'y' })).toBe('DFW → BNA');
    expect(routeShortLabel({ originCode: null, destinationCode: null, originName: 'Foo', destinationName: 'Bar' })).toBe('Foo → Bar');
  });
});
