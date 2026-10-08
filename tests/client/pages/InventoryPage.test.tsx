// Reference UI test file (plan §12): `// @vitest-environment jsdom` docblock, `renderWithData`, query by
// role/label/text (no test ids), `userEvent.setup()`, hash reset in `beforeEach`.
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InventoryPage } from '../../../src/client/pages/InventoryPage';
import { renderWithData } from '../../helpers/renderWithData';
import { makeInventoryRecord, makeSnapshot, TODAY } from '../../helpers/fixtures';

beforeEach(() => {
  window.location.hash = '';
});

describe('InventoryPage', () => {
  it('shows the empty state and an import link when there is no inventory data', async () => {
    const snapshot = makeSnapshot([], []);
    await renderWithData(<InventoryPage />, { snapshot });
    expect(screen.getByText('No inventory data yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Import a CSV' })).toHaveAttribute('href', '#/import');
  });

  it('renders the item count and total filtered value, sorted by value descending by default', async () => {
    const inventory = [
      makeInventoryRecord({ sku: 'ELC-0001', productName: 'Cheap Widget', quantity: 10, unitCostCents: 100 }),
      makeInventoryRecord({ sku: 'ELC-0002', productName: 'Pricey Widget', quantity: 10, unitCostCents: 5000 })
    ];
    const snapshot = makeSnapshot(inventory, [], { today: TODAY });
    await renderWithData(<InventoryPage />, { snapshot });

    expect(screen.getByText('2 items · $510')).toBeInTheDocument();
    const rows = screen.getAllByRole('row').slice(1); // skip header row
    expect(rows[0]).toHaveTextContent('ELC-0002');
    expect(rows[1]).toHaveTextContent('ELC-0001');
  });

  // Phase 1 spec §4 (D5): in the table a unit price keeps its cents and a value rounds to the dollar; the band figure and
  // the line over the table are summaries.
  it('keeps the cents of Unit cost, rounds Value to the dollar, and shows the totals as summaries', async () => {
    const snapshot = makeSnapshot([makeInventoryRecord({ sku: 'PRC-1', quantity: 3, unitCostCents: 61_707 })], [], { today: TODAY });
    await renderWithData(<InventoryPage />, { snapshot });
    expect(document.querySelector('tbody td.data-table__col--unitCost')?.textContent).toMatch(/\$617\.07$/);
    expect(document.querySelector('tbody td.data-table__col--value')?.textContent).toMatch(/\$1,851$/);
    expect(screen.getByText('Inventory value').closest('li')).toHaveTextContent('$1,851');
    expect(screen.getByText('1 item · $1,851')).toBeInTheDocument();
  });

  it('filters by search text (SKU or product name)', async () => {
    const inventory = [
      makeInventoryRecord({ sku: 'ELC-0001', productName: 'Wireless Scanner' }),
      makeInventoryRecord({ sku: 'PKG-0002', productName: 'Corrugated Box' })
    ];
    const snapshot = makeSnapshot(inventory, [], { today: TODAY });
    const user = userEvent.setup();
    await renderWithData(<InventoryPage />, { snapshot });

    await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'scanner');
    expect(await screen.findByText('1 item · $500')).not.toBeNull();
    expect(screen.getByText('ELC-0001')).toBeInTheDocument();
    expect(screen.queryByText('PKG-0002')).not.toBeInTheDocument();
  });

  it('filters by stock status, including the combined "low or out" option', async () => {
    const inventory = [
      makeInventoryRecord({ sku: 'A-001', quantity: 100, reorderPoint: 10 }), // in_stock
      makeInventoryRecord({ sku: 'A-002', quantity: 5, reorderPoint: 10 }), // low_stock
      makeInventoryRecord({ sku: 'A-003', quantity: 0, reorderPoint: 10 }) // out_of_stock
    ];
    const snapshot = makeSnapshot(inventory, [], { today: TODAY });
    const user = userEvent.setup();
    await renderWithData(<InventoryPage />, { snapshot });

    await user.selectOptions(screen.getByRole('combobox', { name: 'Stock status' }), 'Low or out');
    expect(screen.getByText('A-002')).toBeInTheDocument();
    expect(screen.getByText('A-003')).toBeInTheDocument();
    expect(screen.queryByText('A-001')).not.toBeInTheDocument();
  });

  it('shows "no results" with a working clear-filters button when filters match nothing', async () => {
    const inventory = [makeInventoryRecord({ sku: 'A-001', productName: 'Widget' })];
    const snapshot = makeSnapshot(inventory, [], { today: TODAY });
    const user = userEvent.setup();
    await renderWithData(<InventoryPage />, { snapshot });

    await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'nomatch');
    expect(screen.getByText('No results match your filters')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(await screen.findByText('A-001')).toBeInTheDocument();
  });

  it('ignores an invalid stock filter value in the hash', async () => {
    window.location.hash = '#/inventory?stock=bogus';
    const inventory = [makeInventoryRecord({ sku: 'A-001' })];
    const snapshot = makeSnapshot(inventory, [], { today: TODAY });
    await renderWithData(<InventoryPage />, { snapshot });
    expect(screen.getByRole('combobox', { name: 'Stock status' })).toHaveValue('all');
    expect(screen.getByText('A-001')).toBeInTheDocument();
  });

  it('applies a stock filter carried in from the hash (e.g. a Dashboard KPI link)', async () => {
    window.location.hash = '#/inventory?stock=low_or_out';
    const inventory = [
      makeInventoryRecord({ sku: 'A-001', quantity: 100, reorderPoint: 10 }),
      makeInventoryRecord({ sku: 'A-002', quantity: 0, reorderPoint: 10 })
    ];
    const snapshot = makeSnapshot(inventory, [], { today: TODAY });
    await renderWithData(<InventoryPage />, { snapshot });
    expect(screen.getByText('A-002')).toBeInTheDocument();
    expect(screen.queryByText('A-001')).not.toBeInTheDocument();
  });
});

describe('InventoryPage: a triaged ledger', () => {
  // Out of stock (also high risk), low stock (also high risk), in stock with high risk, in stock with unknown usage,
  // and a well-stocked item worth the most.
  function triage() {
    return makeSnapshot(
      [
        makeInventoryRecord({ sku: 'INV-A', quantity: 0, reorderPoint: 10 }),
        makeInventoryRecord({ sku: 'INV-B', quantity: 5, reorderPoint: 10 }),
        makeInventoryRecord({ sku: 'INV-C', quantity: 1000, reorderPoint: 10 }),
        makeInventoryRecord({ sku: 'INV-D', quantity: 100, reorderPoint: 20, avgDailyUsage: 10 }),
        makeInventoryRecord({ sku: 'INV-E', quantity: 100, reorderPoint: 20, avgDailyUsage: null, unitCostCents: 600 })
      ],
      [],
      { today: TODAY }
    );
  }
  const skus = () => screen.getAllByRole('row').slice(1).map((r) => r.textContent?.match(/INV-[A-E]/)?.[0]);

  it('shows the network value and item count as plain figures, not links', async () => {
    await renderWithData(<InventoryPage />, { snapshot: triage() });
    const group = screen.getByRole('region', { name: 'In the network' });
    expect(within(group).queryAllByRole('link')).toHaveLength(0);
    expect(group).toHaveTextContent('5 Items');
  });

  it('counts each attention filter with the filter logic and links to it, with no combined total', async () => {
    await renderWithData(<InventoryPage />, { snapshot: triage() });
    const group = screen.getByRole('region', { name: 'Needs attention' });
    expect(within(group).getAllByRole('link').map((a) => [a.textContent?.replace(/\s+/g, ' ').trim(), a.getAttribute('href')])).toEqual([
      ['1 Out of stock', '#/inventory?stock=out_of_stock'],
      ['1 Low stock', '#/inventory?stock=low_stock'],
      ['3 High stockout risk', '#/inventory?risk=high'],
      ['1 Unknown risk', '#/inventory?risk=unknown']
    ]);
    expect(within(group).queryByText(/total/i)).toBeNull();
  });

  // Phase 1 spec §2 and DESIGN.md "Neutral": an unknown risk is neutral, never a warning (amber until commit 9b).
  it('keeps red for Out of stock only and amber for Low stock and High stockout risk; Unknown risk is plain ink', async () => {
    await renderWithData(<InventoryPage />, { snapshot: triage() });
    expect(screen.getByRole('link', { name: /^1 Out of stock/ })).toHaveClass('stage-figure--critical');
    expect(screen.getByRole('link', { name: /^1 Low stock/ })).toHaveClass('stage-figure--warning');
    expect(screen.getByRole('link', { name: /^3 High stockout risk/ })).toHaveClass('stage-figure--warning');
    expect(screen.getByRole('link', { name: /^1 Unknown risk/ }).className).toBe('stage-figure');
  });

  it('colours the Stockout risk badge: Low green, Medium neutral, High amber (red stays for Out of stock)', async () => {
    const snapshot = makeSnapshot(
      [
        makeInventoryRecord({ sku: 'RSK-L', quantity: 1000 }), // 200 days of supply: low risk
        makeInventoryRecord({ sku: 'RSK-M', quantity: 80 }), // 16 days, under lead time 14 + buffer 7: medium risk
        makeInventoryRecord({ sku: 'RSK-H', quantity: 30 }) // 6 days: high risk
      ],
      [],
      { today: TODAY }
    );
    await renderWithData(<InventoryPage />, { snapshot });
    const badge = (sku: string) => screen.getByText(sku).closest('tr')!.querySelector('td.data-table__col--risk .badge');
    expect(badge('RSK-L')).toHaveClass('badge--good');
    expect(badge('RSK-M')).toHaveClass('badge--neutral');
    expect(badge('RSK-H')).toHaveClass('badge--warning');
    expect(document.querySelector('td.data-table__col--risk .badge--critical')).toBeNull();
  });

  it('colours the Stock badge: In stock neutral gray (not green), Low stock amber, Out of stock red', async () => {
    await renderWithData(<InventoryPage />, { snapshot: triage() });
    const badge = (sku: string) => screen.getByText(sku).closest('tr')!.querySelector('td.data-table__col--stock .badge');
    expect(badge('INV-C')).toHaveClass('badge--neutral');
    expect(badge('INV-B')).toHaveClass('badge--warning');
    expect(badge('INV-A')).toHaveClass('badge--critical');
    expect(document.querySelector('td.data-table__col--stock .badge--good')).toBeNull();
  });

  it('a figure count equals the rows its filter shows', async () => {
    window.location.hash = '#/inventory?risk=high';
    await renderWithData(<InventoryPage />, { snapshot: triage() });
    expect(screen.getByText(/^3 items ·/)).toBeInTheDocument();
    expect(skus().sort()).toEqual(['INV-A', 'INV-B', 'INV-D']);
  });

  it('sorts by highest value by default, and "Needs attention first" lifts out of stock, then low stock, then high risk', async () => {
    const user = userEvent.setup();
    await renderWithData(<InventoryPage />, { snapshot: triage() });
    const sort = screen.getByRole('combobox', { name: 'Sort by' });
    expect(sort).toHaveValue('value:desc');
    expect(skus()).toEqual(['INV-C', 'INV-E', 'INV-D', 'INV-B', 'INV-A']);
    await user.selectOptions(sort, 'attention:desc');
    expect(skus()).toEqual(['INV-A', 'INV-B', 'INV-D', 'INV-C', 'INV-E']);
  });

  it('shows Clear filters next to the filters while one is active', async () => {
    window.location.hash = '#/inventory?stock=low_stock';
    await renderWithData(<InventoryPage />, { snapshot: triage() });
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument();
  });

  // The Category column is visually hidden from 1280px (the category sits under the product), so Sort by sorts by it: the
  // same order as the column, highest value first until then.
  it('sorts by Category from "Sort by", A to Z, as its column does', async () => {
    const snapshot = makeSnapshot(
      [
        makeInventoryRecord({ sku: 'CAT-1', category: 'Packaging', unitCostCents: 900 }),
        makeInventoryRecord({ sku: 'CAT-2', category: 'Apparel', unitCostCents: 100 }),
        makeInventoryRecord({ sku: 'CAT-3', category: 'Electronics', unitCostCents: 500 })
      ],
      [],
      { today: TODAY }
    );
    const user = userEvent.setup();
    await renderWithData(<InventoryPage />, { snapshot });
    const order = () => screen.getAllByRole('row').slice(1).map((r) => r.textContent?.match(/CAT-\d/)?.[0]);
    const sort = screen.getByRole('combobox', { name: 'Sort by' });
    expect(order()).toEqual(['CAT-1', 'CAT-3', 'CAT-2']);
    expect(within(sort).getByRole('option', { name: 'Category' })).toHaveAttribute('value', 'category:asc');
    await user.selectOptions(sort, 'category:asc');
    expect(order()).toEqual(['CAT-2', 'CAT-3', 'CAT-1']);
    expect(screen.getByRole('columnheader', { name: /category/i })).toHaveAttribute('aria-sort', 'ascending');
    expect(within(sort).queryByRole('option', { name: 'Column order' })).toBeNull();
  });

  it('marks the ledger as a stacking table with explicit roles, labelled numbers and an aria-hidden category copy', async () => {
    await renderWithData(<InventoryPage />, { snapshot: triage() });
    const table = screen.getByRole('table', { name: 'Inventory' });
    expect(table).toHaveClass('data-table--stack');
    for (const r of table.querySelectorAll('tr')) expect(r).toHaveAttribute('role', 'row');
    for (const c of table.querySelectorAll('td')) expect(c).toHaveAttribute('role', 'cell');
    const first = table.querySelector('tbody tr') as HTMLElement;
    for (const [key, label] of [['quantity', 'Qty'], ['reorderPoint', 'Reorder pt'], ['daysOfSupply', 'Days of supply'], ['unitCost', 'Unit cost'], ['value', 'Value'], ['risk', 'Stockout risk']] as const) {
      expect(first.querySelector(`td.data-table__col--${key} .data-table__phone-label`)).toHaveTextContent(label);
    }
    expect(first.querySelector('td.data-table__col--product .inventory-product__category')).toHaveAttribute('aria-hidden', 'true');
  });

  it('drops the editorial slogan: the stage carries figures, and the h1 stays the page title', async () => {
    await renderWithData(<InventoryPage />, { snapshot: triage() });
    expect(screen.getByRole('heading', { level: 1, name: 'Inventory' })).toBeInTheDocument();
    expect(screen.queryByText('What’s in')).toBeNull();
  });
});
