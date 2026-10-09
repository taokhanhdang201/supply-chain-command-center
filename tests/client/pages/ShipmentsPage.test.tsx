// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ShipmentsPage } from '../../../src/client/pages/ShipmentsPage';
import { renderWithData } from '../../helpers/renderWithData';
import { makeShipmentRecord, makeSnapshot, TODAY } from '../../helpers/fixtures';

beforeEach(() => {
  window.location.hash = '';
});

describe('ShipmentsPage', () => {
  it('shows the empty state and an import link when there is no shipment data', async () => {
    const snapshot = makeSnapshot([], []);
    await renderWithData(<ShipmentsPage />, { snapshot });
    expect(screen.getByText('No shipment data yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Import a CSV' })).toHaveAttribute('href', '#/import');
  });

  it('lists shipments sorted by ship date descending by default', async () => {
    const shipments = [
      makeShipmentRecord({ shipmentId: 'SHP-100001', shipDate: '2026-06-01' }),
      makeShipmentRecord({ shipmentId: 'SHP-100002', shipDate: '2026-06-10' })
    ];
    const snapshot = makeSnapshot([], shipments, { today: TODAY });
    await renderWithData(<ShipmentsPage />, { snapshot });

    const rows = screen.getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('SHP-100002');
    expect(rows[1]).toHaveTextContent('SHP-100001');
  });

  it('filters by search text across id/origin/destination/carrier', async () => {
    const shipments = [
      makeShipmentRecord({ shipmentId: 'SHP-100001', carrier: 'Northstar Freight' }),
      makeShipmentRecord({ shipmentId: 'SHP-100002', carrier: 'Summit Express' })
    ];
    const snapshot = makeSnapshot([], shipments, { today: TODAY });
    const user = userEvent.setup();
    await renderWithData(<ShipmentsPage />, { snapshot });

    await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'summit');
    expect(await screen.findByText('SHP-100002')).toBeInTheDocument();
    expect(screen.queryByText('SHP-100001')).not.toBeInTheDocument();
  });

  it('shows a "Delayed Nd" flag badge for an overdue shipment carried in via the hash', async () => {
    window.location.hash = '#/shipments?flag=delayed';
    const shipments = [
      makeShipmentRecord({
        shipmentId: 'SHP-100001',
        status: 'in_transit',
        shipDate: '2026-05-01',
        estimatedDelivery: '2026-06-01',
        actualDelivery: null
      })
    ];
    const snapshot = makeSnapshot([], shipments, { today: TODAY }); // TODAY = 2026-06-15, so 14 days overdue
    await renderWithData(<ShipmentsPage />, { snapshot });
    expect(screen.getByText('Delayed 14d')).toBeInTheDocument();
  });

  it('shows "no results" with a working clear-filters button when filters match nothing', async () => {
    const shipments = [makeShipmentRecord({ shipmentId: 'SHP-100001' })];
    const snapshot = makeSnapshot([], shipments, { today: TODAY });
    const user = userEvent.setup();
    await renderWithData(<ShipmentsPage />, { snapshot });

    await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'nomatch');
    expect(screen.getByText('No results match your filters')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(await screen.findByText('SHP-100001')).toBeInTheDocument();
  });

  it('ignores an invalid status filter value in the hash', async () => {
    window.location.hash = '#/shipments?status=bogus';
    const shipments = [makeShipmentRecord({ shipmentId: 'SHP-100001' })];
    const snapshot = makeSnapshot([], shipments, { today: TODAY });
    await renderWithData(<ShipmentsPage />, { snapshot });
    expect(screen.getByRole('combobox', { name: 'Status' })).toHaveValue('all');
    expect(screen.getByText('SHP-100001')).toBeInTheDocument();
  });
});

describe('ShipmentsPage: a triaged ledger', () => {
  // Two delivered on time, one delivered late (delayed), one in transit with no ETA (missing dates), one pending.
  function triage() {
    return makeSnapshot(
      [],
      [
        makeShipmentRecord({ shipmentId: 'SHP-200001', shipDate: '2026-06-12', estimatedDelivery: '2026-06-14', actualDelivery: '2026-06-14' }),
        makeShipmentRecord({ shipmentId: 'SHP-200002', shipDate: '2026-06-11', estimatedDelivery: '2026-06-13', actualDelivery: '2026-06-13' }),
        makeShipmentRecord({ shipmentId: 'SHP-200003', shipDate: '2026-06-01', actualDelivery: '2026-06-09' }),
        makeShipmentRecord({ shipmentId: 'SHP-200004', status: 'in_transit', shipDate: '2026-06-02', estimatedDelivery: null, actualDelivery: null }),
        makeShipmentRecord({ shipmentId: 'SHP-200005', status: 'pending', shipDate: '2026-06-14', estimatedDelivery: '2026-06-20', actualDelivery: null })
      ],
      { today: TODAY }
    );
  }
  const figure = (name: RegExp) => screen.getByRole('link', { name });

  it('counts shipments by status, each figure linking to its filter', async () => {
    await renderWithData(<ShipmentsPage />, { snapshot: triage() });
    const group = screen.getByRole('region', { name: 'By status' });
    expect(within(group).getAllByRole('link').map((a) => [a.textContent?.replace(/\s+/g, ' ').trim(), a.getAttribute('href')])).toEqual([
      ['1 Pending', '#/shipments?status=pending'],
      ['1 In transit', '#/shipments?status=in_transit'],
      ['3 Delivered', '#/shipments?status=delivered'],
      ['0 Cancelled', '#/shipments?status=cancelled']
    ]);
  });

  it('shows one figure per flag and no combined total (a shipment can carry several flags)', async () => {
    await renderWithData(<ShipmentsPage />, { snapshot: triage() });
    const group = screen.getByRole('region', { name: 'Needs attention' });
    const links = within(group).getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['#/shipments?flag=delayed', '#/shipments?flag=cost_anomaly', '#/shipments?flag=missing_dates', '#/shipments?flag=data_issue']);
    expect(figure(/^1 Delayed/)).toHaveTextContent('0 overdue · 1 delivered late');
    expect(figure(/^1 Delayed/)).toHaveClass('stage-figure--critical');
    expect(figure(/^1 Missing dates/)).toHaveClass('stage-figure--warning');
    expect(figure(/^0 Unusual cost/)).not.toHaveClass('stage-figure--warning'); // a zero is plain ink
    expect(figure(/^0 Data issue/)).not.toHaveClass('stage-figure--warning');
    expect(within(group).queryByText(/total/i)).toBeNull();
  });

  it('a figure count equals the rows its filter shows', async () => {
    window.location.hash = '#/shipments?flag=missing_dates';
    await renderWithData(<ShipmentsPage />, { snapshot: triage() });
    expect(screen.getByText('1 shipment')).toBeInTheDocument();
    expect(screen.getByText('SHP-200004')).toBeInTheDocument();
  });

  it('keeps the newest ship date first by default, and "Needs attention first" lifts flagged shipments', async () => {
    const user = userEvent.setup();
    await renderWithData(<ShipmentsPage />, { snapshot: triage() });
    const sort = screen.getByRole('combobox', { name: 'Sort by' });
    expect(sort).toHaveValue('shipDate:desc');
    const ids = () => screen.getAllByRole('row').slice(1).map((r) => r.textContent?.match(/SHP-\d+/)?.[0]);
    expect(ids()).toEqual(['SHP-200005', 'SHP-200001', 'SHP-200002', 'SHP-200004', 'SHP-200003']);
    await user.selectOptions(sort, 'attention:desc');
    expect(ids()).toEqual(['SHP-200004', 'SHP-200003', 'SHP-200005', 'SHP-200001', 'SHP-200002']);
  });

  it('shows Clear filters next to the filters while one is active', async () => {
    window.location.hash = '#/shipments?status=delivered';
    await renderWithData(<ShipmentsPage />, { snapshot: triage() });
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument();
  });

  it('marks the ledger as a stacking table with explicit table roles, per-column classes and hidden phone labels', async () => {
    await renderWithData(<ShipmentsPage />, { snapshot: triage() });
    const table = screen.getByRole('table', { name: 'Shipments' });
    expect(table).toHaveClass('data-table--stack');
    expect(table).toHaveAttribute('role', 'table');
    for (const g of table.querySelectorAll('thead, tbody')) expect(g).toHaveAttribute('role', 'rowgroup');
    for (const r of table.querySelectorAll('tr')) expect(r).toHaveAttribute('role', 'row');
    for (const h of table.querySelectorAll('th')) expect(h).toHaveAttribute('role', 'columnheader');
    for (const c of table.querySelectorAll('td')) expect(c).toHaveAttribute('role', 'cell');
    const first = table.querySelector('tbody tr') as HTMLElement;
    expect(first.querySelector('td.data-table__col--eta .data-table__phone-label')).toHaveTextContent('ETA');
    expect(first.querySelector('td.data-table__col--eta .data-table__phone-label')).toHaveAttribute('aria-hidden', 'true');
    expect(first.querySelector('td.data-table__col--cost .data-table__phone-label')).toHaveTextContent('Cost');
  });

  it('drops the editorial slogan: the stage carries figures, and the h1 stays the page title', async () => {
    await renderWithData(<ShipmentsPage />, { snapshot: triage() });
    expect(screen.getByRole('heading', { level: 1, name: 'Shipments' })).toBeInTheDocument();
    expect(screen.queryByText('Every load.')).toBeNull();
  });
});

// See InventoryPage.test.tsx. The count is one node that stays mounted when the table gives way to the empty state.
describe('ShipmentsPage: the filtered count is read by one always-present polite region', () => {
  const counts = () => [...document.querySelectorAll('.visually-hidden[aria-live="polite"]')];

  it('says how many shipments match, one, and none, in the same node before and after the filter leaves nothing', async () => {
    const shipments = [makeShipmentRecord({ shipmentId: 'SHP-100001', carrier: 'Summit Logistics' }), makeShipmentRecord({ shipmentId: 'SHP-100002', carrier: 'Northstar Freight' })];
    const user = userEvent.setup();
    await renderWithData(<ShipmentsPage />, { snapshot: makeSnapshot([], shipments, { today: TODAY }) });
    expect(counts().map((n) => n.textContent)).toEqual(['2 items match']);
    const node = counts()[0];
    await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'SHP-100001');
    expect(await screen.findByText('1 item matches')).toBe(node);
    await user.clear(screen.getByRole('searchbox', { name: 'Search' }));
    await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'nomatch');
    expect(await screen.findByText('No items match these filters')).toBe(node);
    expect(counts()).toHaveLength(1);
  });
});
