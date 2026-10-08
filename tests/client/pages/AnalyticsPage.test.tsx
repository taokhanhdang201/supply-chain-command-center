// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AnalyticsPage } from '../../../src/client/pages/AnalyticsPage';
import { renderWithData } from '../../helpers/renderWithData';
import { makeInventoryRecord, makeShipmentRecord, makeSnapshot, TODAY } from '../../helpers/fixtures';
import type { ShipmentRecord } from '../../../src/shared/types';

beforeEach(() => {
  window.location.hash = '';
});

// `onTime` delivered on their ETA and `late` delivered after it, all shipped in June (inside every range).
function shipments(onTime: number, late: number): ShipmentRecord[] {
  return [
    ...Array.from({ length: onTime }, () => makeShipmentRecord({ shipDate: '2026-06-01', estimatedDelivery: '2026-06-05', actualDelivery: '2026-06-05' })),
    ...Array.from({ length: late }, () => makeShipmentRecord({ shipDate: '2026-06-01', estimatedDelivery: '2026-06-05', actualDelivery: '2026-06-08' }))
  ];
}

const stage = () => screen.getByRole('region', { name: /^Range:/ });
const figure = (label: string) => within(stage()).getByText(label).closest('li') as HTMLElement;

describe('AnalyticsPage: range figures on the stage', () => {
  it('drops the slogan and shows four range figures, with shipments in range instead of inventory value', async () => {
    await renderWithData(<AnalyticsPage />, { snapshot: makeSnapshot([makeInventoryRecord()], shipments(9, 1), { today: TODAY }) });
    expect(screen.getByRole('heading', { level: 1, name: 'Analytics' })).toBeInTheDocument();
    expect(document.querySelector('.page-stage__display')).toBeNull();
    expect(within(stage()).getAllByRole('listitem').map((li) => li.querySelector('.stage-figure__label')?.textContent)).toEqual([
      'On-time rate',
      'Shipping cost',
      'Avg delivery',
      'Shipments in range'
    ]);
    expect(figure('Shipments in range')).toHaveTextContent('10');
  });

  it('keeps the on-time figure plain at or above the 90% target', async () => {
    await renderWithData(<AnalyticsPage />, { snapshot: makeSnapshot([], shipments(9, 1), { today: TODAY }) });
    expect(figure('On-time rate')).toHaveTextContent('90.0%');
    expect(figure('On-time rate').className).toBe('stage-figure');
    expect(figure('On-time rate').querySelector('.stage-gauge')).toHaveClass('stage-gauge--good');
    expect(figure('On-time rate')).not.toHaveTextContent('below the');
  });

  it('turns amber under the target, and says so in words', async () => {
    await renderWithData(<AnalyticsPage />, { snapshot: makeSnapshot([], shipments(17, 3), { today: TODAY }) }); // 85%
    expect(figure('On-time rate')).toHaveClass('stage-figure--warning');
    expect(figure('On-time rate')).toHaveTextContent('17 of 20 delivered on time · below the 90% target');
  });

  it('turns red under the 80% floor', async () => {
    await renderWithData(<AnalyticsPage />, { snapshot: makeSnapshot([], shipments(7, 3), { today: TODAY }) }); // 70%
    expect(figure('On-time rate')).toHaveClass('stage-figure--critical');
    expect(figure('On-time rate').querySelector('.stage-gauge')).toHaveClass('stage-gauge--critical');
  });

  // WCAG 1.3.1: one outline: the range h2 on the band, three section h2s on the floor, and under them each chart and
  // each panel an h3 (the six chart cards were h2s beside "Charts").
  it('outlines the page: section h2s, and every chart and panel an h3 under them', async () => {
    await renderWithData(<AnalyticsPage />, { snapshot: makeSnapshot([makeInventoryRecord()], shipments(9, 1), { today: TODAY }) });
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Range: 180d', 'Charts', 'Metrics', 'How these are calculated']);
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'Inventory value by warehouse',
      'Inventory value by category',
      'Shipment status',
      'Shipping cost over time',
      'On-time vs delayed by month',
      'Top shipping routes',
      'Stockout risk distribution',
      'Warehouse utilization'
    ]);
  });
});

describe('AnalyticsPage: range in the URL, charts in system colours', () => {
  it('opens on 180d without a parameter, and writes a changed range to the hash (180d drops it)', async () => {
    const user = userEvent.setup();
    await renderWithData(<AnalyticsPage />, { snapshot: makeSnapshot([], shipments(2, 0), { today: TODAY }) });
    expect(screen.getByRole('combobox', { name: 'Range' })).toHaveValue('180d');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Range' }), '30d');
    expect(window.location.hash).toBe('#/analytics?range=30d');
    expect(screen.getByRole('heading', { name: 'Range: 30d' })).toBeInTheDocument();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Range' }), '180d');
    expect(window.location.hash).toBe('#/analytics');
  });

  it('reads range= from the hash and ignores an unknown value', async () => {
    window.location.hash = '#/analytics?range=7y';
    await renderWithData(<AnalyticsPage />, { snapshot: makeSnapshot([], shipments(2, 0), { today: TODAY }) });
    expect(screen.getByRole('combobox', { name: 'Range' })).toHaveValue('180d');
  });

  it('shows shipment status as one stacked bar with a count and share per status', async () => {
    const inTransit = makeShipmentRecord({ status: 'in_transit', shipDate: '2026-06-10', estimatedDelivery: '2026-06-20', actualDelivery: null });
    const { container } = await renderWithData(<AnalyticsPage />, { snapshot: makeSnapshot([], [...shipments(9, 0), inTransit], { today: TODAY }) });
    const bar = screen.getByRole('img', { name: /^Shipments by status:/ });
    expect(bar.getAttribute('aria-label')).toContain('Delivered 9 (90%)');
    expect(bar.getAttribute('aria-label')).toContain('In transit 1 (10%)');
    expect(container.querySelector('.share-bar__track .share-bar__segment--ink')).toBeInTheDocument();
    expect(container.querySelector('.share-bar__track .share-bar__segment--accent')).toBeInTheDocument();
  });

  it('draws on-time months in ink, not green; delayed stays red', async () => {
    const { container } = await renderWithData(<AnalyticsPage />, { snapshot: makeSnapshot([], shipments(3, 1), { today: TODAY }) });
    const fills = [...container.querySelectorAll('rect')].map((r) => r.getAttribute('fill'));
    expect(fills).toContain('var(--neutral)');
    expect(fills).toContain('var(--critical)');
    expect(fills).not.toContain('var(--good)');
  });

  it('keeps only inventory turnover in Metrics (cost, delivery and on-time lead the page), as a figure, not a card', async () => {
    const { container } = await renderWithData(<AnalyticsPage />, { snapshot: makeSnapshot([makeInventoryRecord()], shipments(3, 1), { today: TODAY }) });
    const metrics = screen.getByRole('heading', { name: 'Metrics' }).closest('section') as HTMLElement;
    expect(within(metrics).getByText('Inventory turnover (annualized, est.)')).toBeInTheDocument();
    for (const gone of ['Average shipping cost', 'Average delivery time', 'On-time delivery rate']) expect(within(metrics).queryByText(gone)).toBeNull();
    expect(container.querySelector('.page-floor .kpi-card')).toBeNull();
  });

  it('puts the routes chart "Sort by" under its title, apart from the data-table toggle', async () => {
    await renderWithData(<AnalyticsPage />, { snapshot: makeSnapshot([], shipments(3, 1), { today: TODAY }) });
    const sort = screen.getByRole('combobox', { name: 'Sort by' });
    expect(sort.closest('.chart-frame__controls')).not.toBeNull();
  });

  it('colours a warehouse meter only from 90%: ink gray below', async () => {
    const { container } = await renderWithData(<AnalyticsPage />, { snapshot: makeSnapshot([makeInventoryRecord({ quantity: 10 })], [], { today: TODAY }) });
    expect(container.querySelector('.meter--good')).toBeNull();
    expect(container.querySelectorAll('.meter--neutral').length).toBeGreaterThan(0);
  });
});
