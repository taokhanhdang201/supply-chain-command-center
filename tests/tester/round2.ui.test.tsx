// Round-2 R-16 (assigned to the tester): tests that check what a user actually SEES, not just ARIA plumbing.
// Complements tests/client/components/charts.test.tsx (which only exercises the single R-2 reproduction value)
// with a fuzz across random datasets, adds the missing AnalyticsPage smoke test (there was no dedicated
// AnalyticsPage.test.tsx), and verifies long import-error / alert-message text
// is fully present in the DOM (R-8) rather than truncated.

// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BarChart } from '../../src/client/components/charts/BarChart';
import { LineChart } from '../../src/client/components/charts/LineChart';
import { StackedBarChart } from '../../src/client/components/charts/StackedBarChart';
import { DataTable } from '../../src/client/components/ui/DataTable';
import { formatCents } from '../../src/shared/format';
import { AnalyticsPage } from '../../src/client/pages/AnalyticsPage';
import { ImportPage } from '../../src/client/pages/ImportPage';
import { renderWithData } from '../helpers/renderWithData';
import { makeInventoryRecord, makeShipmentRecord, makeSnapshot, TODAY } from '../helpers/fixtures';
import { ApiError } from '../../src/client/api/apiClient';

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WIDTH = 600;
const HEIGHT = 320;

function file(name: string, size: number): File {
  return new File([new Uint8Array(size)], name, { type: 'text/csv' });
}

describe('R-16 (round 2): chart marks never fall outside the plot area, across random datasets', () => {
  const rand = mulberry32(160916);

  it('BarChart (vertical): every <rect> stays within [0, WIDTH] x [0, HEIGHT] for 30 random datasets', () => {
    for (let trial = 0; trial < 30; trial += 1) {
      const n = 1 + Math.floor(rand() * 6);
      const data = Array.from({ length: n }, (_, i) => ({
        key: `k${i}`,
        label: `Label ${i}`,
        value: Math.floor(rand() * 20_000_000) // spans small and huge, exercising niceTicks broadly
      }));
      const { container, unmount } = render(
        <BarChart data={data} orientation="vertical" valueFormat={(v) => formatCents(Math.round(v * 100))} ariaLabel="Fuzz bar chart" />
      );
      const rects = container.querySelectorAll('svg > g[role="list"] rect');
      expect(rects.length).toBe(n);
      rects.forEach((rect) => {
        const x = Number(rect.getAttribute('x'));
        const y = Number(rect.getAttribute('y'));
        const w = Number(rect.getAttribute('width'));
        const h = Number(rect.getAttribute('height'));
        expect(x).toBeGreaterThanOrEqual(0);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(x + w).toBeLessThanOrEqual(WIDTH + 0.01);
        expect(y + h).toBeLessThanOrEqual(HEIGHT + 0.01);
      });
      unmount();
    }
  });

  it('BarChart (horizontal): every <rect> stays within the SVG viewBox for 20 random datasets', () => {
    for (let trial = 0; trial < 20; trial += 1) {
      const n = 1 + Math.floor(rand() * 6);
      const data = Array.from({ length: n }, (_, i) => ({ key: `k${i}`, label: `Very Long Category Name ${i}`, value: Math.floor(rand() * 5000) }));
      const { container, unmount } = render(
        <BarChart data={data} orientation="horizontal" valueFormat={(v) => v.toLocaleString('en-US')} ariaLabel="Fuzz horizontal bar chart" />
      );
      const rects = container.querySelectorAll('svg > g[role="list"] rect');
      rects.forEach((rect) => {
        const x = Number(rect.getAttribute('x'));
        const y = Number(rect.getAttribute('y'));
        const w = Number(rect.getAttribute('width'));
        const h = Number(rect.getAttribute('height'));
        expect(x).toBeGreaterThanOrEqual(0);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(x + w).toBeLessThanOrEqual(WIDTH + 0.01);
        expect(y + h).toBeLessThanOrEqual(HEIGHT + 0.01);
      });
      unmount();
    }
  });

  it('LineChart: every <circle> mark stays within the SVG viewBox for 30 random point sets, including the R-2 boundary value', () => {
    for (let trial = 0; trial < 30; trial += 1) {
      const n = 1 + Math.floor(rand() * 8);
      const points = Array.from({ length: n }, (_, i) => ({ label: `P${i}`, value: Math.floor(rand() * 20_000_000) }));
      // Force at least one trial to hit the exact reviewer repro value.
      if (trial === 0) points[0] = { label: 'Sep 2026', value: 12_098_558 / 100 };
      const { container, unmount } = render(<LineChart points={points} valueFormat={(v) => formatCents(Math.round(v * 100))} ariaLabel="Fuzz line chart" />);
      const circles = container.querySelectorAll('svg circle');
      expect(circles.length).toBe(n);
      circles.forEach((circle) => {
        const cx = Number(circle.getAttribute('cx'));
        const cy = Number(circle.getAttribute('cy'));
        const r = Number(circle.getAttribute('r'));
        expect(cx - r).toBeGreaterThanOrEqual(-0.5);
        expect(cy - r).toBeGreaterThanOrEqual(-0.5);
        expect(cx + r).toBeLessThanOrEqual(WIDTH + 0.5);
        expect(cy + r).toBeLessThanOrEqual(HEIGHT + 0.5);
      });
      unmount();
    }
  });

  it('StackedBarChart: every <rect> segment stays within the SVG viewBox for 20 random category/series sets', () => {
    for (let trial = 0; trial < 20; trial += 1) {
      const n = 1 + Math.floor(rand() * 6);
      const categories = Array.from({ length: n }, (_, i) => `Cat ${i}`);
      const series = [
        { name: 'On time', values: categories.map(() => Math.floor(rand() * 500)), tone: 'good' as const },
        { name: 'Delayed', values: categories.map(() => Math.floor(rand() * 200)), tone: 'critical' as const }
      ];
      const { container, unmount } = render(
        <StackedBarChart categories={categories} series={series} valueFormat={(v) => v.toLocaleString('en-US')} ariaLabel="Fuzz stacked chart" />
      );
      const rects = container.querySelectorAll('svg > g[role="list"] rect');
      rects.forEach((rect) => {
        const x = Number(rect.getAttribute('x'));
        const y = Number(rect.getAttribute('y'));
        const w = Number(rect.getAttribute('width'));
        const h = Number(rect.getAttribute('height'));
        expect(x).toBeGreaterThanOrEqual(0);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(x + w).toBeLessThanOrEqual(WIDTH + 0.01);
        expect(y + h).toBeLessThanOrEqual(HEIGHT + 0.01);
      });
      unmount();
    }
  });
});

describe('R-16 (round 2): every chart renders at least one readable axis tick label', () => {
  it('BarChart (vertical) renders a value-axis tick <text> distinct from the category labels', () => {
    const data = [{ key: 'a', label: 'Alpha', value: 1234 }];
    render(<BarChart data={data} orientation="vertical" valueFormat={(v) => `$${v}`} ariaLabel="Test" />);
    // The 0 baseline tick is always present and always reads as "$0".
    expect(screen.getByText('$0')).toBeInTheDocument();
  });

  it('LineChart renders a value-axis tick <text>', () => {
    const points = [{ label: 'Jan', value: 500 }, { label: 'Feb', value: 900 }];
    render(<LineChart points={points} valueFormat={(v) => `$${v}`} ariaLabel="Test" />);
    expect(screen.getByText('$0')).toBeInTheDocument();
  });

  it('StackedBarChart renders a value-axis tick <text>', () => {
    render(
      <StackedBarChart
        categories={['Jan', 'Feb']}
        series={[{ name: 'A', values: [10, 20], tone: 'good' }]}
        valueFormat={(v) => `${v} units`}
        ariaLabel="Test"
      />
    );
    expect(screen.getByText('0 units')).toBeInTheDocument();
  });

  it('BarChart (horizontal) truncates an overlong category label but keeps the full text reachable via <title>', () => {
    const longLabel = 'A Very Long Warehouse Name That Would Never Fit In The Margin';
    const data = [{ key: 'a', label: longLabel, value: 10 }];
    const { container } = render(<BarChart data={data} orientation="horizontal" valueFormat={(v) => `${v}`} ariaLabel="Test" />);
    // The full label must still be present somewhere accessible (as a <title> tooltip and in the aria-label),
    // even though the on-canvas <text> is shortened -- so nothing is silently lost (R-3's fix).
    const titleEl = container.querySelector('title');
    expect(titleEl?.textContent).toBe(longLabel);
    expect(screen.getByRole('listitem')).toHaveAttribute('aria-label', expect.stringContaining(longLabel));
  });
});

describe('R-16 (round 2): AnalyticsPage smoke test (previously missing entirely)', () => {
  it('renders all six charts, the metrics section (with meters), and the formula reference, for real sample-shaped data', async () => {
    const inventory = [
      makeInventoryRecord({ warehouse: 'WH-DFW', category: 'Electronics', quantity: 100, avgDailyUsage: 5 }),
      makeInventoryRecord({ warehouse: 'WH-ATL', category: 'Industrial Parts', quantity: 0, avgDailyUsage: 2 })
    ];
    const shipments = [
      makeShipmentRecord({ shipmentId: 'SHP-200001', status: 'delivered' }),
      makeShipmentRecord({ shipmentId: 'SHP-200002', status: 'in_transit', actualDelivery: null })
    ];
    const snapshot = makeSnapshot(inventory, shipments, { today: TODAY });
    await renderWithData(<AnalyticsPage />, { snapshot });

    expect(screen.getByRole('heading', { name: 'Analytics', level: 1 })).toBeInTheDocument();
    for (const title of [
      'Inventory value by warehouse',
      'Inventory value by category',
      'Shipment status',
      'Shipping cost over time',
      'On-time vs delayed by month',
      'Top shipping routes'
    ]) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
    expect(screen.getByText('Stockout risk distribution')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Warehouse utilization' })).toBeInTheDocument();
    expect(screen.getAllByRole('meter').length).toBeGreaterThan(0);
    expect(screen.getByText('How these are calculated')).toBeInTheDocument();
  });

  it('changing the Range select re-renders without crashing and updates the chart subtitle', async () => {
    const snapshot = makeSnapshot([], [makeShipmentRecord()], { today: TODAY });
    const user = userEvent.setup();
    await renderWithData(<AnalyticsPage />, { snapshot });
    const rangeSelect = screen.getByRole('combobox', { name: 'Range' });
    expect(rangeSelect).toHaveValue('180d');
    await user.selectOptions(rangeSelect, '30d');
    expect(rangeSelect).toHaveValue('30d');
    expect(screen.getAllByText('Range: 30d').length).toBeGreaterThan(0);
  });
});

describe('R-16 / R-8 (round 2): long error/message text is fully present in the DOM, not truncated', () => {
  it('a long import-rejection message (many missing columns) is present in the DOM in full, with the wrap class applied', async () => {
    const longMessage =
      'Missing required column(s): category, warehouse, quantity, reorder_point, unit_cost, avg_daily_usage, lead_time_days, product_name, sku.';
    const snapshot = makeSnapshot([], [], { today: TODAY });
    const importCsv = vi.fn().mockRejectedValue(
      new ApiError(422, 'VALIDATION_FAILED', 'The file was rejected: 1 problem(s) found. No data was changed.', [
        { line: null, column: null, code: 'MISSING_COLUMNS', message: longMessage }
      ])
    );
    const user = userEvent.setup();
    await renderWithData(<ImportPage />, { snapshot, api: { importCsv } });

    await user.upload(screen.getByLabelText('Choose inventory CSV file'), file('bad.csv', 100));
    await user.click(screen.getAllByRole('button', { name: 'Import' })[0] as HTMLElement);

    const cell = await screen.findByText(longMessage);
    expect(cell.textContent).toBe(longMessage); // the FULL string, not a truncated "Missing required column(s): ca…"
    expect(cell).toHaveClass('data-table__cell--wrap');
  });

  it('a long Alerts "Message" column value is present in the DOM in full', () => {
    // Exercises the same DataTable `wrap` mechanism AlertsPage uses for its Message column, independent of the
    // full AlertsPage render (which needs a real alert with a long message to reach naturally).
    // We assert the general contract directly against DataTable since that is what both pages share.
    const longMessage = 'Shipment SHP-999999 from Newark DC to Charlotte, NC has been delayed and is 14 day(s) late against its original estimated delivery date.';
    render(
      <DataTable
        caption="Alerts"
        columns={[{ key: 'message', header: 'Message', render: (r: { message: string }) => r.message, wrap: true }]}
        rows={[{ message: longMessage }]}
        rowKey={() => 'row-1'}
      />
    );
    const cell = screen.getByText(longMessage);
    expect(cell.textContent).toBe(longMessage);
    expect(cell).toHaveClass('data-table__cell--wrap');
  });
});
