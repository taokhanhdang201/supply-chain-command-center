// @vitest-environment jsdom
// "Shipping cost over time" on Analytics labels its axis with plain short month names, so no label is cut ("De…",
// "Ju…") at 7 or 13 months; the tooltip and the data table keep the full month and year, and the note names the month
// to date.
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { LineChart } from '../../../src/client/components/charts/LineChart';
import { costAxisLabels } from '../../../src/client/pages/AnalyticsPage';

const months = (n: number, startYear: number, startMonth: number): string[] =>
  Array.from({ length: n }, (_, i) => {
    const m = startMonth - 1 + i;
    return `${startYear + Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, '0')}`;
  });

function axis(ms: string[]): string[] {
  const labels = costAxisLabels(ms);
  const { container } = render(<LineChart points={ms.map((m, i) => ({ label: `${m} full`, axisLabel: labels[i], value: 1000 * (i + 1) }))} valueFormat={(n) => `$${n}`} ariaLabel="Cost" />);
  return [...container.querySelectorAll('svg text')].map((t) => t.textContent ?? '').filter((t) => /^[A-Z][a-z]|…/.test(t));
}

describe('shipping-cost axis labels', () => {
  it('seven months (Dec 2025 to Jun 2026): short names, no year suffix, every month whole', () => {
    expect(costAxisLabels(months(7, 2025, 12))).toEqual(['Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun']);
    expect(axis(months(7, 2025, 12))).toEqual(['Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun']);
  });

  it('thirteen months: the chart thins the labels itself, and none is cut', () => {
    const shown = axis(months(13, 2025, 6));
    expect(shown.length).toBeGreaterThan(3);
    expect(shown.filter((t) => t.includes('…'))).toEqual([]);
  });
});
