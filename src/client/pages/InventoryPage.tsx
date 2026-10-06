// Reference page for T20 (plan §8.6 Inventory / §12). Filterable, sortable inventory table whose filters are
// synced to the hash query string so links like `#/inventory?stock=low_or_out` (from the Dashboard) work, and so
// filter state survives navigation/back-forward.

import { useEffect, useMemo } from 'react';
import type { InventoryItem, StockStatus, StockoutRisk } from '../../shared/types';
import { formatCents, formatCentsCompact, formatDays } from '../../shared/format';
import { useSnapshot } from '../state/DataContext';
import { buildHash, navigate, useHashRoute } from '../router';
import { useTableState } from '../hooks/useTableState';
import { matchesSearch, paginate, sortRows } from '../lib/table';
import { PageStage } from '../components/layout/PageStage';
import { DataTable, type Column } from '../components/ui/DataTable';
import { Pagination } from '../components/ui/Pagination';
import { SearchInput } from '../components/ui/SearchInput';
import { SelectField, type SelectOption } from '../components/ui/SelectField';
import { Badge, type BadgeTone } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';
import { IdText } from '../components/ui/IdText';

const STOCK_FILTER_OPTIONS: SelectOption[] = [
  { value: 'all', label: 'All' },
  { value: 'in_stock', label: 'In stock' },
  { value: 'low_stock', label: 'Low stock' },
  { value: 'out_of_stock', label: 'Out of stock' },
  { value: 'low_or_out', label: 'Low or out' }
];
const STOCK_FILTER_VALUES = new Set(STOCK_FILTER_OPTIONS.map((o) => o.value));

const RISK_FILTER_OPTIONS: SelectOption[] = [
  { value: 'all', label: 'All' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
  { value: 'unknown', label: 'Unknown' }
];
const RISK_FILTER_VALUES = new Set(RISK_FILTER_OPTIONS.map((o) => o.value));

// In stock is the normal state: neutral gray (green is kept for the Low risk badge and Delivered shipments).
const STOCK_BADGE_TONE: Record<StockStatus, BadgeTone> = { in_stock: 'neutral', low_stock: 'warning', out_of_stock: 'critical' };
const STOCK_BADGE_LABEL: Record<StockStatus, string> = { in_stock: 'In stock', low_stock: 'Low stock', out_of_stock: 'Out of stock' };
// Red is kept for an empty shelf (Out of stock); a high stockout risk is a warning, not yet a failure.
const RISK_BADGE_TONE: Record<StockoutRisk, BadgeTone> = { high: 'warning', medium: 'neutral', low: 'good', unknown: 'neutral' };
const RISK_BADGE_LABEL: Record<StockoutRisk, string> = { high: 'High', medium: 'Medium', low: 'Low', unknown: 'Unknown' };

type SortAccessor = (item: InventoryItem) => string | number | null;

const SORT_ACCESSORS: Record<string, SortAccessor> = {
  // Highest attention rank first, then the highest value (sorted descending).
  attention: (i) => `${attentionRank(i)}|${String(i.inventoryValueCents).padStart(15, '0')}`,
  sku: (i) => i.sku,
  product: (i) => i.productName,
  category: (i) => i.category,
  warehouse: (i) => i.warehouse,
  quantity: (i) => i.quantity,
  reorderPoint: (i) => i.reorderPoint,
  unitCost: (i) => i.unitCostCents,
  value: (i) => i.inventoryValueCents,
  daysOfSupply: (i) => i.daysOfSupply,
  stock: (i) => i.stockStatus,
  risk: (i) => i.stockoutRisk
};

function matchesStock(item: InventoryItem, stock: string): boolean {
  if (stock === 'all') return true;
  if (stock === 'low_or_out') return item.stockStatus === 'low_stock' || item.stockStatus === 'out_of_stock';
  return item.stockStatus === stock;
}

function matchesRisk(item: InventoryItem, risk: string): boolean {
  return risk === 'all' || item.stockoutRisk === risk;
}

/** Attention rank for "Needs attention first": out of stock, then low stock, then high stockout risk. */
function attentionRank(item: InventoryItem): number {
  if (item.stockStatus === 'out_of_stock') return 3;
  if (item.stockStatus === 'low_stock') return 2;
  return item.stockoutRisk === 'high' ? 1 : 0;
}

/** The "Sort by" choices (needed below 1100px, where the column headers are hidden). Value is `key:direction`. */
const SORT_OPTIONS: SelectOption[] = [
  { value: 'value:desc', label: 'Highest value' },
  { value: 'attention:desc', label: 'Needs attention first' },
  { value: 'daysOfSupply:asc', label: 'Fewest days of supply' },
  { value: 'sku:asc', label: 'SKU' }
];

/** The attention row: one figure per filter, never a combined total (an item can be both low and high risk). Only an
 * empty shelf is red; the rest are warnings. */
const ATTENTION_FIGURES: ReadonlyArray<{ param: 'stock' | 'risk'; value: string; label: string; tone: 'critical' | 'warning' }> = [
  { param: 'stock', value: 'out_of_stock', label: 'Out of stock', tone: 'critical' },
  { param: 'stock', value: 'low_stock', label: 'Low stock', tone: 'warning' },
  { param: 'risk', value: 'high', label: 'High stockout risk', tone: 'warning' },
  { param: 'risk', value: 'unknown', label: 'Unknown risk', tone: 'warning' }
];

/** The Inventory page (plan §8.6): search + warehouse/category/stock/risk filters over the enriched inventory. */
export function InventoryPage() {
  const snapshot = useSnapshot();
  const route = useHashRoute();
  const table = useTableState({ sort: { key: 'value', direction: 'desc' } });

  const warehouseOptions = useMemo<SelectOption[]>(() => {
    const codes = new Set(snapshot.inventory.map((i) => i.warehouse));
    const options = [...codes]
      .map((code) => ({ value: code, label: snapshot.locations.find((l) => l.code === code)?.name ?? code }))
      .sort((a, b) => a.label.localeCompare(b.label));
    return [{ value: 'all', label: 'All' }, ...options];
  }, [snapshot.inventory, snapshot.locations]);
  const warehouseValues = useMemo(() => new Set(warehouseOptions.map((o) => o.value)), [warehouseOptions]);

  const categoryOptions = useMemo<SelectOption[]>(() => {
    const categories = [...new Set(snapshot.inventory.map((i) => i.category))].sort((a, b) => a.localeCompare(b));
    return [{ value: 'all', label: 'All' }, ...categories.map((c) => ({ value: c, label: c }))];
  }, [snapshot.inventory]);
  const categoryValues = useMemo(() => new Set(categoryOptions.map((o) => o.value)), [categoryOptions]);

  const rawQuery = route.params.get('q') ?? '';
  const rawWarehouse = route.params.get('warehouse') ?? 'all';
  const rawCategory = route.params.get('category') ?? 'all';
  const rawStock = route.params.get('stock') ?? 'all';
  const rawRisk = route.params.get('risk') ?? 'all';

  const query = rawQuery;
  const warehouse = warehouseValues.has(rawWarehouse) ? rawWarehouse : 'all';
  const category = categoryValues.has(rawCategory) ? rawCategory : 'all';
  const stock = STOCK_FILTER_VALUES.has(rawStock) ? rawStock : 'all';
  const risk = RISK_FILTER_VALUES.has(rawRisk) ? rawRisk : 'all';

  const filterKey = `${query}|${warehouse}|${category}|${stock}|${risk}`;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => table.resetPage(), [filterKey]);

  function updateParams(changes: Record<string, string>): void {
    const next: Record<string, string> = { q: query, warehouse, category, stock, risk, ...changes };
    const cleaned: Record<string, string> = {};
    for (const [key, value] of Object.entries(next)) {
      if (value !== '' && value !== 'all') cleaned[key] = value;
    }
    navigate(buildHash('inventory', cleaned));
  }

  const filtered = snapshot.inventory.filter(
    (item) =>
      matchesSearch([item.sku, item.productName], query) &&
      (warehouse === 'all' || item.warehouse === warehouse) &&
      (category === 'all' || item.category === category) &&
      matchesStock(item, stock) &&
      matchesRisk(item, risk)
  );
  const accessor = SORT_ACCESSORS[table.sort.key] ?? ((i: InventoryItem) => i.inventoryValueCents);
  const sorted = sortRows(filtered, accessor, table.sort.direction);
  const { rows, pageCount, total, start, end } = paginate(sorted, table.page, table.pageSize);
  const filteredValueCents = filtered.reduce((sum, i) => sum + i.inventoryValueCents, 0);

  const hasAnyFilter = query !== '' || warehouse !== 'all' || category !== 'all' || stock !== 'all' || risk !== 'all';

  // Stage figures over every item, counted with the same functions the filters use, so a figure equals its rows.
  const all = snapshot.inventory;
  const totalValueCents = all.reduce((sum, i) => sum + i.inventoryValueCents, 0);
  const attention = ATTENTION_FIGURES.map((a) => ({
    ...a,
    count: all.filter((i) => (a.param === 'stock' ? matchesStock(i, a.value) : matchesRisk(i, a.value))).length
  }));

  const sortValue = `${table.sort.key}:${table.sort.direction}`;
  const sortOptions: SelectOption[] = SORT_OPTIONS.some((o) => o.value === sortValue)
    ? SORT_OPTIONS
    : [{ value: sortValue, label: 'Column order' }, ...SORT_OPTIONS];

  const columns: Column<InventoryItem>[] = [
    { key: 'sku', header: 'SKU', sortable: true, render: (i) => <IdText text={i.sku} /> },
    {
      key: 'product',
      header: 'Product',
      sortable: true,
      // From 1100px to 1439px the category is shown under the product (its own column is only visually hidden there,
      // so assistive tech still reads it in the Category column; this copy is aria-hidden).
      render: (i) => (
        <>
          {i.productName}
          <span className="inventory-product__category" aria-hidden="true">
            {i.category}
          </span>
        </>
      )
    },
    { key: 'category', header: 'Category', sortable: true, render: (i) => i.category },
    {
      key: 'warehouse',
      header: 'Warehouse',
      sortable: true,
      render: (i) => (
        <span className="code-tag" title={snapshot.locations.find((l) => l.code === i.warehouse)?.name ?? i.warehouse}>
          {i.warehouse}
        </span>
      )
    },
    { key: 'quantity', header: 'Qty', sortable: true, align: 'right', phoneLabel: 'Qty', render: (i) => i.quantity.toLocaleString('en-US') },
    { key: 'reorderPoint', header: 'Reorder pt', sortable: true, align: 'right', phoneLabel: 'Reorder pt', render: (i) => i.reorderPoint.toLocaleString('en-US') },
    { key: 'unitCost', header: 'Unit cost', sortable: true, align: 'right', phoneLabel: 'Unit cost', render: (i) => formatCents(i.unitCostCents) },
    { key: 'value', header: 'Value', sortable: true, align: 'right', emphasis: true, phoneLabel: 'Value', render: (i) => formatCents(i.inventoryValueCents) },
    {
      key: 'stock',
      header: 'Stock',
      sortable: true,
      render: (i) => <Badge tone={STOCK_BADGE_TONE[i.stockStatus]}>{STOCK_BADGE_LABEL[i.stockStatus]}</Badge>
    },
    { key: 'daysOfSupply', header: 'Days of supply', sortable: true, align: 'right', phoneLabel: 'Days of supply', render: (i) => formatDays(i.daysOfSupply) },
    {
      key: 'risk',
      header: 'Stockout risk',
      sortable: true,
      phoneLabel: 'Stockout risk',
      render: (i) => <Badge tone={RISK_BADGE_TONE[i.stockoutRisk]}>{RISK_BADGE_LABEL[i.stockoutRisk]}</Badge>
    }
  ];

  return (
    <div className="page">
      {/* The stage answers "what is on the shelves and what needs attention", then the ledger below lists the items. */}
      <PageStage title="Inventory" variant="compact">
        {all.length > 0 && (
          <div className="figure-stage">
            <section className="figure-stage__group" aria-labelledby="inventory-network">
              <h2 className="figure-stage__label" id="inventory-network">
                In the network
              </h2>
              <ul className="figure-stage__figures">
                <li className="stage-figure">
                  <span className="stage-figure__value">{formatCentsCompact(totalValueCents)}</span>{' '}
                  <span className="stage-figure__label">Inventory value</span>
                </li>
                <li className="stage-figure">
                  <span className="stage-figure__value">{all.length.toLocaleString('en-US')}</span>{' '}
                  <span className="stage-figure__label">Items</span>
                </li>
              </ul>
            </section>
            <section className="figure-stage__group" aria-labelledby="inventory-attention">
              <h2 className="figure-stage__label" id="inventory-attention">
                Needs attention
              </h2>
              <ul className="figure-stage__figures">
                {attention.map((a) => (
                  <li key={`${a.param}-${a.value}`}>
                    <a className={`stage-figure${a.count > 0 ? ` stage-figure--${a.tone}` : ''}`} href={buildHash('inventory', { [a.param]: a.value })}>
                      <span className="stage-figure__value">{a.count.toLocaleString('en-US')}</span>{' '}
                      <span className="stage-figure__label">{a.label}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        )}
      </PageStage>

      <div className="page-floor">
        {snapshot.inventory.length === 0 ? (
          <EmptyState title="No inventory data yet" action={<a href={buildHash('import')}>Import a CSV</a>} />
        ) : (
          <section className="inventory-ledger" aria-label="Inventory ledger">
            <div className="filter-bar">
              <SearchInput label="Search" value={query} onChange={(v) => updateParams({ q: v })} placeholder="SKU or product name" />
              <SelectField label="Warehouse" value={warehouse} options={warehouseOptions} onChange={(v) => updateParams({ warehouse: v })} />
              <SelectField label="Category" value={category} options={categoryOptions} onChange={(v) => updateParams({ category: v })} />
              <SelectField label="Stock status" value={stock} options={STOCK_FILTER_OPTIONS} onChange={(v) => updateParams({ stock: v })} />
              <SelectField label="Stockout risk" value={risk} options={RISK_FILTER_OPTIONS} onChange={(v) => updateParams({ risk: v })} />
              <SelectField
                label="Sort by"
                value={sortValue}
                options={sortOptions}
                onChange={(v) => {
                  const [key = 'value', direction = 'desc'] = v.split(':');
                  table.setSort({ key, direction: direction === 'asc' ? 'asc' : 'desc' });
                }}
              />
              {hasAnyFilter && filtered.length > 0 && (
                <button type="button" className="button inventory-ledger__clear" onClick={() => navigate(buildHash('inventory'))}>
                  Clear filters
                </button>
              )}
            </div>

            {filtered.length === 0 ? (
              <EmptyState
                title="No results match your filters"
                action={
                  hasAnyFilter ? (
                    <button type="button" className="button" onClick={() => navigate(buildHash('inventory'))}>
                      Clear filters
                    </button>
                  ) : undefined
                }
              />
            ) : (
              <>
                <p className="table-summary">
                  {filtered.length} item{filtered.length === 1 ? '' : 's'} · {formatCents(filteredValueCents)}
                </p>
                <DataTable
                  caption="Inventory"
                  columns={columns}
                  rows={rows}
                  rowKey={(i) => i.id}
                  sort={table.sort}
                  onSortChange={table.setSort}
                  stackOnPhone
                />
                <Pagination
                  page={table.page}
                  pageCount={pageCount}
                  pageSize={table.pageSize}
                  total={total}
                  start={start}
                  end={end}
                  onPageChange={table.setPage}
                  onPageSizeChange={table.setPageSize}
                />
              </>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
