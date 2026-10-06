// The Shipments page (plan §8.6): search + status/carrier/flag filters over the enriched shipments, with the
// same hash-synced filter pattern as InventoryPage.

import { useEffect, useMemo } from 'react';
import type { Shipment } from '../../shared/types';
import { formatCents, formatDay, statusLabel } from '../../shared/format';
import { useSnapshot } from '../state/DataContext';
import { buildHash, navigate, useHashRoute } from '../router';
import { useTableState } from '../hooks/useTableState';
import { matchesSearch, paginate, sortRows } from '../lib/table';
import { PageStage } from '../components/layout/PageStage';
import { DataTable, type Column } from '../components/ui/DataTable';
import { RouteLabel } from '../components/ui/RouteLabel';
import { Pagination } from '../components/ui/Pagination';
import { SearchInput } from '../components/ui/SearchInput';
import { SelectField, type SelectOption } from '../components/ui/SelectField';
import { Badge, type BadgeTone } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';
import { IdText } from '../components/ui/IdText';

const STATUS_FILTER_OPTIONS: SelectOption[] = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'in_transit', label: 'In transit' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'cancelled', label: 'Cancelled' }
];
const STATUS_FILTER_VALUES = new Set(STATUS_FILTER_OPTIONS.map((o) => o.value));

const FLAG_FILTER_OPTIONS: SelectOption[] = [
  { value: 'all', label: 'All' },
  { value: 'delayed', label: 'Delayed' },
  { value: 'missing_dates', label: 'Missing dates' },
  { value: 'cost_anomaly', label: 'Unusual cost' },
  { value: 'data_issue', label: 'Data issue' },
  { value: 'any_issue', label: 'Any issue' }
];
const FLAG_FILTER_VALUES = new Set(FLAG_FILTER_OPTIONS.map((o) => o.value));

const STATUS_BADGE_TONE: Record<Shipment['status'], BadgeTone> = {
  pending: 'neutral',
  in_transit: 'info',
  delivered: 'good',
  cancelled: 'neutral'
};

type SortAccessor = (s: Shipment) => string | number | null;

/** The "Sort by" choices (needed on phones, where the column headers are hidden). Value is `key:direction`. */
const SORT_OPTIONS: SelectOption[] = [
  { value: 'shipDate:desc', label: 'Newest ship date' },
  { value: 'attention:desc', label: 'Needs attention first' },
  { value: 'eta:asc', label: 'Soonest ETA' },
  { value: 'cost:desc', label: 'Highest cost' },
  { value: 'id:asc', label: 'Shipment ID' }
];

/** The attention row: one figure per flag, never a combined total (a shipment can carry several flags). */
const ATTENTION_FLAGS: ReadonlyArray<{ flag: string; label: string; tone: 'critical' | 'warning' }> = [
  { flag: 'delayed', label: 'Delayed', tone: 'critical' },
  { flag: 'cost_anomaly', label: 'Unusual cost', tone: 'warning' },
  { flag: 'missing_dates', label: 'Missing dates', tone: 'warning' },
  { flag: 'data_issue', label: 'Data issue', tone: 'warning' }
];

/** Any of the four flags the attention row counts (the same test as the "Any issue" filter). */
function needsAttention(s: Shipment): boolean {
  return hasFlag(s, 'any_issue');
}

const SORT_ACCESSORS: Record<string, SortAccessor> = {
  // Flagged shipments first, then the newest ship date (sorted descending: "1|2026-06-20" before "0|…").
  attention: (s) => `${needsAttention(s) ? 1 : 0}|${s.shipDate}`,
  id: (s) => s.shipmentId,
  route: (s) => s.routeLabel,
  carrier: (s) => s.carrier,
  status: (s) => s.status,
  shipDate: (s) => s.shipDate,
  eta: (s) => s.estimatedDelivery,
  delivered: (s) => s.actualDelivery,
  cost: (s) => s.shippingCostCents
};

function hasFlag(s: Shipment, flag: string): boolean {
  const missingDates = s.missingDates.length > 0;
  const dataIssue = s.issues.length > 0;
  switch (flag) {
    case 'all':
      return true;
    case 'delayed':
      return s.isDelayed;
    case 'missing_dates':
      return missingDates;
    case 'cost_anomaly':
      return s.cost.isAnomaly;
    case 'data_issue':
      return dataIssue;
    case 'any_issue':
      return s.isDelayed || missingDates || s.cost.isAnomaly || dataIssue;
    default:
      return true;
  }
}

/** The Shipments page (plan §8.6): search + status/carrier/flag filters over the enriched shipments. */
export function ShipmentsPage() {
  const snapshot = useSnapshot();
  const route = useHashRoute();
  const table = useTableState({ sort: { key: 'shipDate', direction: 'desc' } });

  const carrierOptions = useMemo<SelectOption[]>(() => {
    const carriers = [...new Set(snapshot.shipments.map((s) => s.carrier))].sort((a, b) => a.localeCompare(b));
    return [{ value: 'all', label: 'All' }, ...carriers.map((c) => ({ value: c, label: c }))];
  }, [snapshot.shipments]);
  const carrierValues = useMemo(() => new Set(carrierOptions.map((o) => o.value)), [carrierOptions]);

  const rawQuery = route.params.get('q') ?? '';
  const rawStatus = route.params.get('status') ?? 'all';
  const rawCarrier = route.params.get('carrier') ?? 'all';
  const rawFlag = route.params.get('flag') ?? 'all';

  const query = rawQuery;
  const status = STATUS_FILTER_VALUES.has(rawStatus) ? rawStatus : 'all';
  const carrier = carrierValues.has(rawCarrier) ? rawCarrier : 'all';
  const flag = FLAG_FILTER_VALUES.has(rawFlag) ? rawFlag : 'all';

  const filterKey = `${query}|${status}|${carrier}|${flag}`;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => table.resetPage(), [filterKey]);

  function updateParams(changes: Record<string, string>): void {
    const next: Record<string, string> = { q: query, status, carrier, flag, ...changes };
    const cleaned: Record<string, string> = {};
    for (const [key, value] of Object.entries(next)) {
      if (value !== '' && value !== 'all') cleaned[key] = value;
    }
    navigate(buildHash('shipments', cleaned));
  }

  const filtered = snapshot.shipments.filter(
    (s) =>
      matchesSearch([s.shipmentId, s.origin, s.destination, s.carrier], query) &&
      (status === 'all' || s.status === status) &&
      (carrier === 'all' || s.carrier === carrier) &&
      hasFlag(s, flag)
  );
  const accessor = SORT_ACCESSORS[table.sort.key] ?? ((s: Shipment) => s.shipDate);
  const sorted = sortRows(filtered, accessor, table.sort.direction);
  const { rows, pageCount, total, start, end } = paginate(sorted, table.page, table.pageSize);

  const hasAnyFilter = query !== '' || status !== 'all' || carrier !== 'all' || flag !== 'all';

  // Stage figures, counted over every shipment (not the filtered view) with the same tests the filters use.
  const all = snapshot.shipments;
  const statusCounts = STATUS_FILTER_OPTIONS.filter((o) => o.value !== 'all').map((o) => ({
    value: o.value,
    label: o.label,
    count: all.filter((s) => s.status === o.value).length
  }));
  const attentionCounts = ATTENTION_FLAGS.map((a) => ({ ...a, count: all.filter((s) => hasFlag(s, a.flag)).length }));
  const overdueCount = all.filter((s) => s.deliveryState === 'overdue').length;
  const lateCount = all.filter((s) => s.deliveryState === 'late').length;

  const sortValue = `${table.sort.key}:${table.sort.direction}`;
  const sortOptions: SelectOption[] = SORT_OPTIONS.some((o) => o.value === sortValue)
    ? SORT_OPTIONS
    : [{ value: sortValue, label: 'Column order' }, ...SORT_OPTIONS]; // a header click picked another order

  const columns: Column<Shipment>[] = [
    { key: 'id', header: 'ID', sortable: true, render: (s) => <IdText text={s.shipmentId} /> },
    {
      key: 'route',
      header: 'Route',
      sortable: true,
      // From 1100px to 1439px the carrier is shown under the route (its own column is only visually hidden there, so
      // assistive tech still reads it in the Carrier column; this copy is aria-hidden).
      render: (s) => (
        <>
          <RouteLabel label={s.routeLabel} />
          <span className="shipments-route__carrier" aria-hidden="true">
            {s.carrier}
          </span>
        </>
      )
    },
    { key: 'carrier', header: 'Carrier', sortable: true, render: (s) => s.carrier },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      render: (s) => <Badge tone={STATUS_BADGE_TONE[s.status]}>{statusLabel(s.status)}</Badge>
    },
    { key: 'shipDate', header: 'Ship date', sortable: true, phoneLabel: 'Ship', render: (s) => formatDay(s.shipDate) },
    { key: 'eta', header: 'ETA', sortable: true, phoneLabel: 'ETA', render: (s) => formatDay(s.estimatedDelivery) },
    { key: 'delivered', header: 'Delivered', sortable: true, phoneLabel: 'Delivered', render: (s) => formatDay(s.actualDelivery) },
    { key: 'cost', header: 'Cost', sortable: true, align: 'right', emphasis: true, phoneLabel: 'Cost', render: (s) => formatCents(s.shippingCostCents) },
    {
      key: 'flags',
      header: 'Flags',
      render: (s) => (
        <>
          {s.isDelayed && s.daysLate !== null && <Badge tone="critical">{`Delayed ${s.daysLate}d`}</Badge>}{' '}
          {s.missingDates.includes('estimated_delivery') && <Badge tone="warning">Missing ETA</Badge>}{' '}
          {s.missingDates.includes('actual_delivery') && <Badge tone="warning">Missing delivery date</Badge>}{' '}
          {s.cost.isAnomaly && (
            <Badge tone="warning" title={s.cost.baselineCents !== null ? `Typical: ${formatCents(s.cost.baselineCents)}` : undefined}>
              Unusual cost
            </Badge>
          )}{' '}
          {s.issues.length > 0 && <Badge tone="warning" title={s.issues.map((i) => i.message).join(' ')}>Data issue</Badge>}
        </>
      )
    }
  ];

  return (
    <div className="page">
      {/* The stage answers "how are shipments doing and what needs attention", then the ledger below lists them. */}
      <PageStage title="Shipments" variant="compact">
        {all.length > 0 && (
          <div className="figure-stage">
            <section className="figure-stage__group" aria-labelledby="shipments-by-status">
              <h2 className="figure-stage__label" id="shipments-by-status">
                By status
              </h2>
              <ul className="figure-stage__figures">
                {statusCounts.map((s) => (
                  <li key={s.value}>
                    <a className="stage-figure" href={buildHash('shipments', { status: s.value })}>
                      <span className="stage-figure__value">{s.count.toLocaleString('en-US')}</span>{' '}
                      <span className="stage-figure__label">{s.label}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
            <section className="figure-stage__group" aria-labelledby="shipments-attention">
              <h2 className="figure-stage__label" id="shipments-attention">
                Needs attention
              </h2>
              <ul className="figure-stage__figures">
                {attentionCounts.map((a) => (
                  <li key={a.flag}>
                    <a className={`stage-figure${a.count > 0 ? ` stage-figure--${a.tone}` : ''}`} href={buildHash('shipments', { flag: a.flag })}>
                      <span className="stage-figure__value">{a.count.toLocaleString('en-US')}</span>{' '}
                      <span className="stage-figure__label">{a.label}</span>
                      {a.flag === 'delayed' && (
                        <span className="stage-figure__detail">
                          {` ${overdueCount} overdue · ${lateCount}`}
                          <span className="stage-figure__long"> delivered</span> late
                        </span>
                      )}
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        )}
      </PageStage>

      <div className="page-floor">
        {snapshot.shipments.length === 0 ? (
          <EmptyState title="No shipment data yet" action={<a href={buildHash('import')}>Import a CSV</a>} />
        ) : (
          <section className="shipments-ledger" aria-label="Shipment ledger">
            <div className="filter-bar">
              <SearchInput label="Search" value={query} onChange={(v) => updateParams({ q: v })} placeholder="ID, origin, destination or carrier" />
              <SelectField label="Status" value={status} options={STATUS_FILTER_OPTIONS} onChange={(v) => updateParams({ status: v })} />
              <SelectField label="Carrier" value={carrier} options={carrierOptions} onChange={(v) => updateParams({ carrier: v })} />
              <SelectField label="Flag" value={flag} options={FLAG_FILTER_OPTIONS} onChange={(v) => updateParams({ flag: v })} />
              <SelectField
                label="Sort by"
                value={sortValue}
                options={sortOptions}
                onChange={(v) => {
                  const [key = 'shipDate', direction = 'desc'] = v.split(':');
                  table.setSort({ key, direction: direction === 'asc' ? 'asc' : 'desc' });
                }}
              />
              {hasAnyFilter && filtered.length > 0 && (
                <button type="button" className="button shipments-ledger__clear" onClick={() => navigate(buildHash('shipments'))}>
                  Clear filters
                </button>
              )}
            </div>

            {filtered.length === 0 ? (
              <EmptyState
                title="No results match your filters"
                action={
                  hasAnyFilter ? (
                    <button type="button" className="button" onClick={() => navigate(buildHash('shipments'))}>
                      Clear filters
                    </button>
                  ) : undefined
                }
              />
            ) : (
              <>
                <p className="table-summary">
                  {filtered.length} shipment{filtered.length === 1 ? '' : 's'}
                </p>
                <DataTable
                  caption="Shipments"
                  columns={columns}
                  rows={rows}
                  rowKey={(s) => s.shipmentId}
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
