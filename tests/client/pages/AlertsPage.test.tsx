// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AlertsPage } from '../../../src/client/pages/AlertsPage';
import { renderWithData } from '../../helpers/renderWithData';
import { makeInventoryRecord, makeShipmentRecord, makeSnapshot, TODAY } from '../../helpers/fixtures';
import { createSampleDataset } from '../../../src/shared/sample/generateSampleData';
import { buildSnapshot } from '../../../src/shared/domain/snapshot';
import { kindCounts } from '../../../src/client/lib/attention';

// Alert titles keep their IDs in a no-wrap span (IdText), so match a title by the whole text of its table cell.
const cell = (text: string | RegExp) => (_: string, el: Element | null) =>
  el?.tagName === 'TD' && (typeof text === 'string' ? el.textContent === text : text.test(el.textContent ?? ''));

beforeEach(() => {
  window.location.hash = '';
});

describe('AlertsPage', () => {
  it('shows the empty state when there are no alerts', async () => {
    const snapshot = makeSnapshot([], []);
    await renderWithData(<AlertsPage />, { snapshot });
    expect(screen.getByText('No alerts — all clear.')).toBeInTheDocument();
  });

  it('shows severity summary counts and the alert table with an entity link', async () => {
    const inventory = [makeInventoryRecord({ sku: 'ELC-0001', warehouse: 'WH-DFW', quantity: 0 })]; // out of stock -> 1 critical
    const snapshot = makeSnapshot(inventory, [], { today: TODAY });
    await renderWithData(<AlertsPage />, { snapshot });

    expect(screen.getAllByText('Critical').length).toBeGreaterThan(0);
    expect(screen.getByText(cell('Out of stock: ELC-0001'))).toBeInTheDocument();
    // The link opens Inventory on that one row: the SKU in that warehouse.
    expect(screen.getByRole('link', { name: 'ELC-0001 @ WH-DFW' })).toHaveAttribute('href', '#/inventory?q=ELC-0001&warehouse=WH-DFW');
  });

  it('filters by severity', async () => {
    const inventory = [
      makeInventoryRecord({ sku: 'ELC-0001', quantity: 0 }), // critical
      makeInventoryRecord({ sku: 'ELC-0002', quantity: 5, reorderPoint: 10 }) // low_stock -> warning
    ];
    const snapshot = makeSnapshot(inventory, [], { today: TODAY });
    const user = userEvent.setup();
    await renderWithData(<AlertsPage />, { snapshot });

    await user.selectOptions(screen.getByRole('combobox', { name: 'Severity' }), 'Warning');
    expect(screen.getByText(cell('Low stock: ELC-0002'))).toBeInTheDocument();
    expect(screen.queryByText(cell('Out of stock: ELC-0001'))).not.toBeInTheDocument();
  });

  it('shows "no results" with a working clear-filters button when filters match nothing', async () => {
    const inventory = [makeInventoryRecord({ sku: 'ELC-0001', quantity: 0 })];
    const snapshot = makeSnapshot(inventory, [], { today: TODAY });
    const user = userEvent.setup();
    await renderWithData(<AlertsPage />, { snapshot });

    await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'nomatch');
    expect(screen.getByText('No results match your filters')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(await screen.findByText(cell('Out of stock: ELC-0001'))).toBeInTheDocument();
  });

  it('ignores an invalid severity filter value in the hash', async () => {
    window.location.hash = '#/alerts?severity=bogus';
    const inventory = [makeInventoryRecord({ sku: 'ELC-0001', quantity: 0 })];
    const snapshot = makeSnapshot(inventory, [], { today: TODAY });
    await renderWithData(<AlertsPage />, { snapshot });
    expect(screen.getByRole('combobox', { name: 'Severity' })).toHaveValue('all');
    expect(screen.getByText(cell('Out of stock: ELC-0001'))).toBeInTheDocument();
  });
});

describe('AlertsPage: a read-only triaged ledger', () => {
  // Out of stock (critical low_stock), low stock (warning low_stock), unknown usage (info missing_info), and a
  // shipment overdue (warning or critical shipment_delayed).
  function triage() {
    return makeSnapshot(
      [
        makeInventoryRecord({ sku: 'ELC-0001', warehouse: 'WH-DFW', quantity: 0 }),
        makeInventoryRecord({ sku: 'ELC-0002', warehouse: 'WH-ATL', quantity: 5, reorderPoint: 10 }),
        makeInventoryRecord({ sku: 'ELC-0003', avgDailyUsage: null })
      ],
      [makeShipmentRecord({ shipmentId: 'SHP-300001', status: 'in_transit', shipDate: '2026-06-01', estimatedDelivery: '2026-06-10', actualDelivery: null })],
      { today: TODAY }
    );
  }
  const linkPairs = (region: string) =>
    within(screen.getByRole('region', { name: region }))
      .getAllByRole('link')
      .map((a) => [a.textContent?.replace(/\s+/g, ' ').trim(), a.getAttribute('href')]);

  it('counts alerts per severity and per type with the filter logic, each linking to its filter, with no total', async () => {
    const snapshot = triage();
    await renderWithData(<AlertsPage />, { snapshot });
    const count = (pred: (a: (typeof snapshot.alerts)[number]) => boolean) => snapshot.alerts.filter(pred).length;
    expect(linkPairs('By severity')).toEqual([
      [`${count((a) => a.severity === 'critical')} Critical`, '#/alerts?severity=critical'],
      [`${count((a) => a.severity === 'warning')} Warning`, '#/alerts?severity=warning'],
      [`${count((a) => a.severity === 'info')} Info`, '#/alerts?severity=info']
    ]);
    // Only the types present in the data, in a fixed order.
    expect(linkPairs('By type')).toEqual([
      ['2 Stock', '#/alerts?type=low_stock'], // out of stock and low stock together
      ['1 Shipment delayed', '#/alerts?type=shipment_delayed'],
      [`${count((a) => a.type === 'missing_info')} Missing info`, '#/alerts?type=missing_info']
    ]);
    expect(screen.queryByText(/total/i)).toBeNull();
  });

  it('colours only severity: Critical red, Warning amber, Info and every type figure plain', async () => {
    await renderWithData(<AlertsPage />, { snapshot: triage() });
    const figure = (name: RegExp) => screen.getByRole('link', { name });
    expect(figure(/Critical$/)).toHaveClass('stage-figure--critical');
    expect(figure(/Warning$/)).toHaveClass('stage-figure--warning');
    expect(figure(/Info$/).className).toBe('stage-figure');
    for (const a of within(screen.getByRole('region', { name: 'By type' })).getAllByRole('link')) expect(a.className).toBe('stage-figure');
  });

  it('a figure count equals the rows its filter shows', async () => {
    window.location.hash = '#/alerts?type=low_stock';
    await renderWithData(<AlertsPage />, { snapshot: triage() });
    expect(screen.getByText('2 alerts')).toBeInTheDocument();
    expect(screen.getAllByRole('row').slice(1)).toHaveLength(2);
  });

  it('badges severity Critical red, Warning amber, Info neutral gray, with a matching row rule class', async () => {
    await renderWithData(<AlertsPage />, { snapshot: triage() });
    const badge = (title: string) => screen.getByText(cell(title)).closest('tr')!.querySelector('td.data-table__col--severity .badge');
    expect(badge('Out of stock: ELC-0001')).toHaveClass('badge--critical');
    expect(badge('Low stock: ELC-0002')).toHaveClass('badge--warning');
    const info = screen.getAllByRole('row').find((r) => r.classList.contains('alert-row--info'))!;
    expect(info.querySelector('.badge')).toHaveClass('badge--neutral');
    expect(document.querySelector('.badge--info')).toBeNull();
  });

  it('links each entity to its page with the right filter: inventory row, shipment', async () => {
    await renderWithData(<AlertsPage />, { snapshot: triage() });
    expect(screen.getByRole('link', { name: 'ELC-0002 @ WH-ATL' })).toHaveAttribute('href', '#/inventory?q=ELC-0002&warehouse=WH-ATL');
    expect(screen.getByRole('link', { name: 'SHP-300001' })).toHaveAttribute('href', '#/shipments?q=SHP-300001');
  });

  it('sorts by severity by default and offers Sort by Type and Entity', async () => {
    const user = userEvent.setup();
    await renderWithData(<AlertsPage />, { snapshot: triage() });
    const sort = screen.getByRole('combobox', { name: 'Sort by' });
    expect(sort).toHaveValue('severity:asc');
    expect(screen.getAllByRole('row')[1]).toHaveClass('alert-row--critical');
    await user.selectOptions(sort, 'entity:asc');
    const labels = screen.getAllByRole('row').slice(1).map((r) => r.querySelector('td.data-table__col--entity')!.textContent!);
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b)));
  });

  it('shows Clear filters next to the filters while one is active, and none without', async () => {
    await renderWithData(<AlertsPage />, { snapshot: triage() });
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();
    window.location.hash = '#/alerts?severity=warning';
    expect(await screen.findByRole('button', { name: 'Clear filters' })).toBeInTheDocument();
  });

  it('stacks on phones with explicit table roles; drops the slogan; offers no alert actions', async () => {
    await renderWithData(<AlertsPage />, { snapshot: triage() });
    const table = screen.getByRole('table', { name: 'Alerts' });
    expect(table).toHaveClass('data-table--stack');
    for (const c of table.querySelectorAll('td')) expect(c).toHaveAttribute('role', 'cell');
    expect(screen.getByRole('heading', { level: 1, name: 'Alerts' })).toBeInTheDocument();
    expect(document.querySelector('.page-stage__display')).toBeNull();
    expect(screen.queryByRole('button', { name: /resolve|dismiss|acknowledge/i })).toBeNull();
  });
});

describe('AlertsPage: the Dashboard kinds (kind=)', () => {
  const seed42 = () =>
    buildSnapshot(createSampleDataset(42, '2026-10-07', '2026-10-07T00:00:00.000Z'), '2026-10-07', {
      generatedAt: '2026-10-07T00:00:00.000Z',
      limits: { maxUploadBytes: 2_097_152, maxRows: 20_000 }
    });

  it('opens exactly the rows each Dashboard kind counts, and shows the kind in the Problem filter', async () => {
    const snapshot = seed42();
    const kinds = kindCounts(snapshot.alerts);
    expect(kinds.map((k) => k.count)).toEqual([6, 14, 12, 8, 17]);
    for (const k of kinds) {
      window.location.hash = k.href;
      const { unmount } = await renderWithData(<AlertsPage />, { snapshot });
      expect(screen.getByText(`${k.count} alerts`)).toBeInTheDocument();
      expect(screen.getByRole('combobox', { name: 'Problem' })).toHaveValue(k.kind);
      expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument();
      unmount();
    }
  });

  it('overdue keeps critical and warning delays and leaves out delivered-late info alerts', async () => {
    window.location.hash = '#/alerts?kind=overdue';
    await renderWithData(<AlertsPage />, { snapshot: seed42() });
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.textContent).toMatch(/Shipment overdue/);
      expect(r.textContent).not.toMatch(/Delivered late/);
    }
  });

  // The Dashboard's "Need attention" total opens kind=any: every kind together, so exactly the 57 it counts and none of
  // the 10 info alerts (67 in all); the Problem filter names it "Any problem".
  it('kind=any opens exactly the alerts that need attention: the Dashboard total, no info alerts', async () => {
    const snapshot = seed42();
    const needAttention = snapshot.alerts.filter((a) => a.severity !== 'info').length;
    expect([needAttention, snapshot.alerts.length]).toEqual([57, 67]);
    expect(kindCounts(snapshot.alerts).reduce((sum, k) => sum + k.count, 0)).toBe(needAttention);
    window.location.hash = '#/alerts?kind=any';
    await renderWithData(<AlertsPage />, { snapshot });
    expect(screen.getByText('57 alerts')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Problem' })).toHaveValue('any');
    expect(screen.getByRole('option', { name: 'Any problem' })).toBeInTheDocument();
    for (const r of screen.getAllByRole('row').slice(1)) expect(r.textContent).not.toMatch(/\bInfo\b/);
  });

  it('ignores an unknown kind, and the Problem filter writes kind= to the hash', async () => {
    window.location.hash = '#/alerts?kind=bogus';
    const user = userEvent.setup();
    await renderWithData(<AlertsPage />, { snapshot: makeSnapshot([makeInventoryRecord({ sku: 'ELC-0001', quantity: 0 }), makeInventoryRecord({ sku: 'ELC-0002', quantity: 5, reorderPoint: 10 })], [], { today: TODAY }) });
    expect(screen.getByRole('combobox', { name: 'Problem' })).toHaveValue('all');
    expect(screen.getByText('2 alerts')).toBeInTheDocument();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Problem' }), 'out_of_stock');
    expect(window.location.hash).toBe('#/alerts?kind=out_of_stock');
    expect(await screen.findByText('1 alert')).toBeInTheDocument();
  });
});
