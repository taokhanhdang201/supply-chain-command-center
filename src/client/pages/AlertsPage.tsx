// The Alerts page (plan §8.6): severity and type figures on the stage (each a link to its filter), then the alert
// ledger on the paper floor: severity/type/search filters synced to the hash, a "Sort by" for phones, and a paginated
// table linking each alert's entity back to the page it came from. Read only: no alert actions.

import { useEffect } from 'react';
import type { Alert, AlertType, Severity } from '../../shared/types';
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

const SEVERITY_FILTER_OPTIONS: SelectOption[] = [
  { value: 'all', label: 'All' },
  { value: 'critical', label: 'Critical' },
  { value: 'warning', label: 'Warning' },
  { value: 'info', label: 'Info' }
];
const SEVERITY_FILTER_VALUES = new Set(SEVERITY_FILTER_OPTIONS.map((o) => o.value));

const TYPE_LABELS: Record<AlertType, string> = {
  // 'low_stock' covers out of stock as well as low stock, so the label names the subject, not one of the two.
  low_stock: 'Stock',
  shipment_delayed: 'Shipment delayed',
  cost_anomaly: 'Cost anomaly',
  invalid_data: 'Invalid data',
  missing_info: 'Missing info'
};
const TYPE_FILTER_OPTIONS: SelectOption[] = [
  { value: 'all', label: 'All' },
  ...(Object.entries(TYPE_LABELS) as Array<[AlertType, string]>).map(([value, label]) => ({ value, label }))
];
const TYPE_FILTER_VALUES = new Set(TYPE_FILTER_OPTIONS.map((o) => o.value));

const SEVERITY_LABELS: Record<Severity, string> = { critical: 'Critical', warning: 'Warning', info: 'Info' };
// Red for critical, amber for warning; info is neutral gray (it asks for no action).
const SEVERITY_TONE: Record<Severity, BadgeTone> = { critical: 'critical', warning: 'warning', info: 'neutral' };
const SEVERITIES: readonly Severity[] = ['critical', 'warning', 'info'];

type SortAccessor = (a: Alert) => string | number | null;

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };

const SORT_ACCESSORS: Record<string, SortAccessor> = {
  severity: (a) => SEVERITY_RANK[a.severity],
  type: (a) => a.type,
  title: (a) => a.title,
  message: (a) => a.message,
  entity: (a) => a.entity.label
};

/** The "Sort by" choices (needed below 1100px, where the column headers are hidden). Value is `key:direction`. */
const SORT_OPTIONS: SelectOption[] = [
  { value: 'severity:asc', label: 'Severity' },
  { value: 'type:asc', label: 'Type' },
  { value: 'entity:asc', label: 'Entity' }
];

function matchesSeverity(a: Alert, severity: string): boolean {
  return severity === 'all' || a.severity === severity;
}

function matchesType(a: Alert, type: string): boolean {
  return type === 'all' || a.type === type;
}

/** The page an alert came from, filtered to that one item: an inventory row's id is `SKU@warehouse`. */
function entityHref(alert: Alert): string {
  if (alert.entity.kind === 'inventory') {
    const [sku = alert.entity.id, warehouse] = alert.entity.id.split('@');
    return buildHash('inventory', warehouse ? { q: sku, warehouse } : { q: sku });
  }
  if (alert.entity.kind === 'shipment') return buildHash('shipments', { q: alert.entity.id });
  return buildHash('inventory', { warehouse: alert.entity.id });
}

/** The Alerts page (plan §8.6): severity and type figures, filters, and a paginated alert ledger. */
export function AlertsPage() {
  const snapshot = useSnapshot();
  const route = useHashRoute();
  const table = useTableState({ sort: { key: 'severity', direction: 'asc' } });

  const rawSeverity = route.params.get('severity') ?? 'all';
  const rawType = route.params.get('type') ?? 'all';
  const rawQuery = route.params.get('q') ?? '';

  const severity = SEVERITY_FILTER_VALUES.has(rawSeverity) ? rawSeverity : 'all';
  const type = TYPE_FILTER_VALUES.has(rawType) ? rawType : 'all';
  const query = rawQuery;

  const filterKey = `${severity}|${type}|${query}`;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => table.resetPage(), [filterKey]);

  function updateParams(changes: Record<string, string>): void {
    const next: Record<string, string> = { severity, type, q: query, ...changes };
    const cleaned: Record<string, string> = {};
    for (const [key, value] of Object.entries(next)) {
      if (value !== '' && value !== 'all') cleaned[key] = value;
    }
    navigate(buildHash('alerts', cleaned));
  }

  // Stage figures over every alert, counted with the same functions the filters use, so a figure equals its rows:
  // one per severity and one per type present in the data, never a combined total.
  const all = snapshot.alerts;
  const bySeverity = SEVERITIES.map((s) => ({ value: s, label: SEVERITY_LABELS[s], count: all.filter((a) => matchesSeverity(a, s)).length }));
  const byType = (Object.keys(TYPE_LABELS) as AlertType[])
    .map((t) => ({ value: t, label: TYPE_LABELS[t], count: all.filter((a) => matchesType(a, t)).length }))
    .filter((t) => t.count > 0);

  const filtered = all.filter((a) => matchesSeverity(a, severity) && matchesType(a, type) && matchesSearch([a.title, a.message, a.entity.label], query));
  const accessor = SORT_ACCESSORS[table.sort.key] ?? ((a: Alert) => SEVERITY_RANK[a.severity]);
  const sorted = sortRows(filtered, accessor, table.sort.direction);
  const { rows, pageCount, total, start, end } = paginate(sorted, table.page, table.pageSize);

  const hasAnyFilter = severity !== 'all' || type !== 'all' || query !== '';

  const sortValue = `${table.sort.key}:${table.sort.direction}`;
  const sortOptions: SelectOption[] = SORT_OPTIONS.some((o) => o.value === sortValue)
    ? SORT_OPTIONS
    : [{ value: sortValue, label: 'Column order' }, ...SORT_OPTIONS];

  const columns: Column<Alert>[] = [
    { key: 'severity', header: 'Severity', sortable: true, render: (a) => <Badge tone={SEVERITY_TONE[a.severity]}>{SEVERITY_LABELS[a.severity]}</Badge> },
    { key: 'type', header: 'Type', sortable: true, render: (a) => TYPE_LABELS[a.type] },
    { key: 'title', header: 'Title', sortable: true, wrap: true, render: (a) => <IdText text={a.title} /> },
    { key: 'message', header: 'Message', render: (a) => <IdText text={a.message} />, wrap: true },
    { key: 'entity', header: 'Entity', sortable: true, render: (a) => <a href={entityHref(a)}><IdText text={a.entity.label} /></a> }
  ];

  return (
    <div className="page">
      <PageStage title="Alerts" variant="compact">
        {all.length > 0 && (
          <div className="figure-stage">
            <section className="figure-stage__group" aria-labelledby="alerts-by-severity">
              <h2 className="figure-stage__label" id="alerts-by-severity">
                By severity
              </h2>
              <ul className="figure-stage__figures">
                {bySeverity.map((s) => (
                  <li key={s.value}>
                    <a
                      className={`stage-figure${s.count > 0 && s.value !== 'info' ? ` stage-figure--${s.value}` : ''}`}
                      href={buildHash('alerts', { severity: s.value })}
                    >
                      <span className="stage-figure__value">{s.count.toLocaleString('en-US')}</span>{' '}
                      <span className="stage-figure__label">{s.label}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
            <section className="figure-stage__group" aria-labelledby="alerts-by-type">
              <h2 className="figure-stage__label" id="alerts-by-type">
                By type
              </h2>
              <ul className="figure-stage__figures figure-stage__figures--five">
                {byType.map((t) => (
                  <li key={t.value}>
                    <a className="stage-figure" href={buildHash('alerts', { type: t.value })}>
                      <span className="stage-figure__value">{t.count.toLocaleString('en-US')}</span>{' '}
                      <span className="stage-figure__label">{t.label}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        )}
      </PageStage>

      <div className="page-floor">
        {all.length === 0 ? (
          <EmptyState title="No alerts — all clear." />
        ) : (
          <section className="alerts-ledger" aria-label="Alert ledger">
            <div className="filter-bar">
              <SearchInput label="Search" value={query} onChange={(v) => updateParams({ q: v })} placeholder="Title, message or entity" />
              <SelectField label="Severity" value={severity} options={SEVERITY_FILTER_OPTIONS} onChange={(v) => updateParams({ severity: v })} />
              <SelectField label="Type" value={type} options={TYPE_FILTER_OPTIONS} onChange={(v) => updateParams({ type: v })} />
              <SelectField
                label="Sort by"
                value={sortValue}
                options={sortOptions}
                onChange={(v) => {
                  const [key = 'severity', direction = 'asc'] = v.split(':');
                  table.setSort({ key, direction: direction === 'desc' ? 'desc' : 'asc' });
                }}
              />
              {hasAnyFilter && filtered.length > 0 && (
                <button type="button" className="button alerts-ledger__clear" onClick={() => navigate(buildHash('alerts'))}>
                  Clear filters
                </button>
              )}
            </div>

            {filtered.length === 0 ? (
              <EmptyState
                title="No results match your filters"
                action={
                  hasAnyFilter ? (
                    <button type="button" className="button" onClick={() => navigate(buildHash('alerts'))}>
                      Clear filters
                    </button>
                  ) : undefined
                }
              />
            ) : (
              <>
                <p className="table-summary">
                  {filtered.length} alert{filtered.length === 1 ? '' : 's'}
                </p>
                <DataTable
                  caption="Alerts"
                  columns={columns}
                  rows={rows}
                  rowKey={(a) => a.id}
                  sort={table.sort}
                  onSortChange={table.setSort}
                  rowClassName={(a) => `alert-row alert-row--${a.severity}`}
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
