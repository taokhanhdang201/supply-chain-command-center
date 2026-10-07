// @vitest-environment jsdom
// V2 Dashboard ("Atlas"): every headline number is still the one the snapshot carries, every link still goes to the
// same filtered view, and the new presentations (status list, racks, the network's description, the ledger) trace back
// to snapshot data. Presentation rules that the spec fixes (what was removed, reading order, motion) are asserted too.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DashboardPage } from '../../../src/client/pages/DashboardPage';
import { renderWithData } from '../../helpers/renderWithData';
import { makeInventoryRecord, makeShipmentRecord, makeSnapshot, TODAY } from '../../helpers/fixtures';
import { kindCounts } from '../../../src/client/lib/attention';

beforeEach(() => {
  window.location.hash = '';
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function scenario() {
  return makeSnapshot(
    [makeInventoryRecord({ warehouse: 'WH-DFW', quantity: 0 }), makeInventoryRecord({ warehouse: 'WH-ATL', quantity: 400 })],
    [
      makeShipmentRecord({ shipmentId: 'SHP-000001' }),
      makeShipmentRecord({ shipmentId: 'SHP-000002' }),
      makeShipmentRecord({ shipmentId: 'SHP-000003' }),
      makeShipmentRecord({ shipmentId: 'SHP-000004', actualDelivery: '2026-06-08' }), // delivered late
      makeShipmentRecord({ shipmentId: 'SHP-000005', status: 'in_transit', shipDate: '2026-06-05', estimatedDelivery: '2026-06-10', actualDelivery: null }), // overdue
      makeShipmentRecord({ shipmentId: 'SHP-000006', status: 'pending', shipDate: '2026-06-20', estimatedDelivery: '2026-06-25', actualDelivery: null }),
      makeShipmentRecord({ shipmentId: 'SHP-000007', status: 'cancelled', actualDelivery: null })
    ],
    { today: TODAY }
  );
}

describe('Dashboard (Atlas): numbers and links are unchanged', () => {
  it('keeps the exact h1 and the headline on-time figure', async () => {
    await renderWithData(<DashboardPage />, { snapshot: scenario() });
    expect(screen.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('On-time delivery rate')).toBeInTheDocument();
    expect(screen.getByText('75.0%')).toBeInTheDocument();
    expect(screen.getByText('3 of 4 delivered on time · below the 90% target')).toBeInTheDocument();
  });

  it('shows the same KPI strings and drill-down links as before', async () => {
    const snapshot = scenario();
    await renderWithData(<DashboardPage />, { snapshot });

    const shipments = screen.getByRole('link', { name: /^Total shipments 7 2 active · 1 cancelled$/ });
    expect(shipments).toHaveAttribute('href', '#/shipments');
    const delayed = screen.getByRole('link', { name: /^Delayed shipments 2 1 overdue · 1 delivered late$/ });
    expect(delayed).toHaveAttribute('href', '#/shipments?flag=delayed');
    const lowStock = screen.getByRole('link', { name: /^Low-stock items 1 1 out of stock$/ });
    expect(lowStock).toHaveAttribute('href', '#/inventory?stock=low_or_out');

    const attention = snapshot.alerts.filter((a) => a.severity === 'critical' || a.severity === 'warning').length;
    const info = snapshot.alerts.filter((a) => a.severity === 'info').length;
    const alerts = screen.getByRole('link', { name: `Alerts needing attention ${attention} ${snapshot.alerts.length} total · ${info} info` });
    expect(alerts).toHaveAttribute('href', '#/alerts');

    expect(screen.getByRole('link', { name: /^Total inventory value \$/ })).toHaveAttribute('href', '#/inventory');
    expect(screen.getByText('Total shipping cost')).toBeInTheDocument();
    expect(screen.getByText('Average delivery time')).toBeInTheDocument();
  });

  it('status list gives every status its count, each linking to filtered Shipments (no shares)', async () => {
    await renderWithData(<DashboardPage />, { snapshot: scenario() });
    const expected: Array<[RegExp, string]> = [
      [/^Pending 1$/, 'pending'],
      [/^In transit 1$/, 'in_transit'],
      [/^Delivered 4$/, 'delivered'],
      [/^Cancelled 1$/, 'cancelled']
    ];
    for (const [name, status] of expected) {
      expect(screen.getByRole('link', { name })).toHaveAttribute('href', `#/shipments?status=${status}`);
    }
    expect(screen.queryByText(/%$/, { selector: '.status-list *' })).toBeNull();
  });

  it('draws no status list for an empty dataset and still renders every chapter', async () => {
    await renderWithData(<DashboardPage />, { snapshot: makeSnapshot([], [], { today: TODAY }) });
    expect(screen.queryByText('Shipments by status')).toBeNull();
    expect(screen.queryByRole('link', { name: /^(Pending|In transit|Delivered|Cancelled) \d/ })).toBeNull();
    expect(document.querySelector('.hero__gauge')).toBeNull();
    expect(screen.getAllByText('No data for the selected range').length).toBe(2);
    // "Top alerts" (docs/DASHBOARD-ALERTS.md): the empty queue says so (it used to read "No alerts — all clear.")
    expect(screen.getByText('Nothing needs action today.')).toBeInTheDocument();
    expect(screen.getByText('No shipment activity yet.')).toBeInTheDocument();
  });
});

describe('Dashboard (Atlas): derived views trace back to existing data', () => {
  it('names the most delayed lane in the atlas description, not in a visible callout', async () => {
    await renderWithData(<DashboardPage />, { snapshot: scenario() });
    // DFW → HOU: 6 non-cancelled shipments, 2 delayed (1 late + 1 overdue) = 33%, the same figure the Routes page shows.
    const atlas = screen.getByRole('group', { name: /^Network atlas\./ });
    expect(atlas).toHaveAccessibleName(/Most delayed lane, Dallas-Fort Worth DC → Houston, TX: 2 of 6 shipments delayed \(33%\)\./);
    expect(screen.queryByText('Most delayed lane')).toBeNull();
    expect(screen.queryByText('2 of 6 shipments delayed (33%)')).toBeNull();
    expect(document.querySelector('.situation__callout')).toBeNull();
  });

  it('leaves the lane sentence out of the description when no lane reaches the amber threshold', async () => {
    const snapshot = makeSnapshot([], [makeShipmentRecord(), makeShipmentRecord()], { today: TODAY });
    await renderWithData(<DashboardPage />, { snapshot });
    expect(screen.getByRole('group', { name: /^Network atlas\./ }).getAttribute('aria-label')).not.toContain('Most delayed lane');
  });

  it('shows one rack per warehouse with the same utilization Analytics reports', async () => {
    const snapshot = scenario();
    await renderWithData(<DashboardPage />, { snapshot });
    for (const w of snapshot.metrics.warehouseUtilization) {
      const link = screen.getByRole('link', { name: new RegExp(`^${w.name}: .* of capacity used`) });
      expect(link).toHaveAttribute('href', `#/inventory?warehouse=${w.code}`);
    }
  });

  // "Top alerts" replaced the critical / warning / info figures (they repeated the KPI above): the alerts that need
  // attention by kind, adding up to the same count as the KPI tile, each a link to exactly its rows on the Alerts page.
  // Each kind is now its own row, label left and count right (it was one line of "6 out of stock · …" links), named
  // "Out of stock, 6, view in Alerts".
  it('lists the alerts that need attention by kind, adding up to the KPI count, each linking to its filter', async () => {
    const snapshot = scenario();
    await renderWithData(<DashboardPage />, { snapshot });
    const list = screen.getByRole('list', { name: 'Alerts that need attention, by kind' });
    const links = within(list).getAllByRole('link');
    const expected = kindCounts(snapshot.alerts);
    expect(links.map((a) => [a.getAttribute('aria-label'), a.getAttribute('href')])).toEqual(expected.map((k) => [`${k.label}, ${k.count}, view in Alerts`, k.href]));
    for (const [i, a] of links.entries()) {
      expect(a.querySelector('.kind-row__label')?.textContent).toBe(expected[i]?.label);
      expect(a.querySelector('.kind-row__count')?.textContent).toBe(String(expected[i]?.count));
    }
    const needAttention = snapshot.alerts.filter((a) => a.severity === 'critical' || a.severity === 'warning').length;
    expect(expected.reduce((sum, k) => sum + k.count, 0)).toBe(needAttention);
    expect(screen.queryByText('Critical')).toBeNull(); // no severity figures any more
    expect(document.querySelector('.attention .attention__sep')).toBeNull(); // no dots between the kinds any more
  });

  // The total row closes the kinds list: the number it shows is the sum of the counts above it, read from the page. It
  // reads "Need attention", not "All alerts": the KPI tile above says "67 total", so "All alerts 57" said the wrong thing
  // (docs/DASHBOARD-ALERTS.md §10); it opens the Alerts page with exactly those alerts (`kind=any`, no info).
  it('shows a total row whose number is the sum of the kind rows above it', async () => {
    await renderWithData(<DashboardPage />, { snapshot: scenario() });
    const counts = [...document.querySelectorAll('.kind-list .kind-row__count')].map((n) => Number(n.textContent));
    expect(counts.length).toBeGreaterThan(1);
    const total = document.querySelector('.kind-row--total') as HTMLElement;
    expect(total.querySelector('.kind-row__label')?.textContent).toBe('Need attention');
    expect(Number(total.querySelector('.kind-row__count')?.textContent)).toBe(counts.reduce((a, b) => a + b, 0));
    expect(total).toHaveAttribute('href', '#/alerts?kind=any');
  });
});

describe('Dashboard (Atlas): interaction and accessibility', () => {
  it('the Range select still drives both flow charts', async () => {
    const user = userEvent.setup();
    await renderWithData(<DashboardPage />, { snapshot: scenario() });
    expect(screen.getByRole('combobox', { name: 'Range' })).toHaveValue('180d');
    expect(screen.getByText('Range: 180d')).toBeInTheDocument();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Range' }), '30d');
    expect(screen.getByText('Range: 30d')).toBeInTheDocument();
  });

  it('every chart keeps its data-table equivalent', async () => {
    const user = userEvent.setup();
    await renderWithData(<DashboardPage />, { snapshot: scenario() });
    const toggles = screen.getAllByRole('button', { name: 'Show data table' });
    expect(toggles).toHaveLength(2);
    await user.click(toggles[0]!);
    expect(screen.getByRole('table', { name: 'On-time vs delayed by month data' })).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: 'Show data table' })[0]!);
    expect(screen.getByRole('table', { name: 'Shipping cost over time data' })).toBeInTheDocument();
  });

  // The alerts region is named by its title, "Top alerts" (it was "Attention"; docs/DASHBOARD-ALERTS.md §9).
  it('labels each chapter as a region and keeps a single h1', async () => {
    await renderWithData(<DashboardPage />, { snapshot: scenario() });
    for (const name of ['Network situation', 'Flow', 'Nodes', 'Top alerts', 'Movement']) {
      expect(screen.getByRole('region', { name })).toBeInTheDocument();
    }
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  // Top alerts sits on paper (docs/DASHBOARD-ALERTS.md §9): dark is the situation, paper is what to act on, so the block
  // can no longer read as part of the figures above it. It used to be a second dark scene.
  it('puts Top alerts on paper, not on the dark stage', async () => {
    await renderWithData(<DashboardPage />, { snapshot: scenario() });
    const region = screen.getByRole('region', { name: 'Top alerts' });
    expect(region).toHaveClass('scene--paper');
    expect(region).not.toHaveClass('scene--dark');
    expect(region).not.toHaveClass('surface-stage');
    expect(within(region).getByRole('heading', { level: 2 })).toHaveTextContent('Top alerts');
  });

  it('keeps the recent-activity ledger and the alerts link', async () => {
    await renderWithData(<DashboardPage />, { snapshot: scenario() });
    expect(screen.getByRole('table', { name: 'Recent shipment activity' })).toBeInTheDocument();
    // the link names the same "need attention" count as the KPI tile and the badge; it is now the total row of the
    // kinds list ("Need attention" and the count), which replaced "View all alerts (N need attention)", and it opens
    // only those alerts (`kind=any`)
    const snapshot = scenario();
    const n = snapshot.alerts.filter((a) => a.severity === 'critical' || a.severity === 'warning').length;
    expect(screen.getByRole('link', { name: `${n} need attention, view in Alerts` })).toHaveAttribute('href', '#/alerts?kind=any');
    expect(screen.getByRole('link', { name: 'Explore the lanes' })).toHaveAttribute('href', '#/routes');
  });
});
