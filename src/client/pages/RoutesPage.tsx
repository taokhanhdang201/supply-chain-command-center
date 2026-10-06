// The Routes page (plan §8.6): lane figures on the stage, carrier/status/range/lane/top controls synced to the hash
// (so a figure is a link to its filter), a schematic route map with its route list and a selected-route detail panel,
// then the "Unmapped routes" ledger on the floor.

import { useMemo, useState } from 'react';
import type { DateRange, RouteSummary } from '../../shared/domain/analytics';
import { filterShipmentsByRange, summarizeRoutes } from '../../shared/domain/analytics';
import type { Shipment } from '../../shared/types';
import { formatCents, formatPercent } from '../../shared/format';
import { ROUTE_DELAY_CRITICAL_SHARE, ROUTE_DELAY_WARNING_SHARE } from '../../shared/constants';
import { useSnapshot } from '../state/DataContext';
import { buildHash, navigate, useHashRoute } from '../router';
import { Card } from '../components/ui/Card';
import { RouteLabel } from '../components/ui/RouteLabel';
import { PageStage } from '../components/layout/PageStage';
import { SelectField, type SelectOption } from '../components/ui/SelectField';
import { DataTable, type Column } from '../components/ui/DataTable';
import { EmptyState } from '../components/ui/EmptyState';
import { RouteMap } from '../components/routes/RouteMap';

const STATUS_GROUP_OPTIONS: SelectOption[] = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'delivered', label: 'Delivered' }
];

const RANGE_OPTIONS: SelectOption[] = [
  { value: 'all', label: 'All' },
  { value: '30d', label: '30d' },
  { value: '90d', label: '90d' },
  { value: '180d', label: '180d' },
  { value: '365d', label: '365d' }
];

const TOP_OPTIONS: SelectOption[] = [
  { value: '10', label: '10' },
  { value: '25', label: '25' },
  { value: 'all', label: 'All' }
];

const LANE_OPTIONS: SelectOption[] = [
  { value: 'all', label: 'All' },
  { value: 'critical', label: 'Delayed ≥20%' },
  { value: 'watch', label: 'Delayed 10–20%' },
  { value: 'cost', label: 'Unusual cost' }
];

const valuesOf = (options: SelectOption[]) => new Set(options.map((o) => o.value));
const STATUS_VALUES = valuesOf(STATUS_GROUP_OPTIONS);
const RANGE_VALUES = valuesOf(RANGE_OPTIONS);
const TOP_VALUES = valuesOf(TOP_OPTIONS);
const LANE_VALUES = valuesOf(LANE_OPTIONS);

/** Show top 25 by default; with a lane filter, every matching lane, so a figure equals the rows its link shows. */
const defaultTop = (lane: string) => (lane === 'all' ? '25' : 'all');

/** The routes the page lists: every unmapped route (the floor table) and every mapped route the map can draw. A
 * mapped route whose two ends are the same place is neither drawn nor listed, so it is not counted either. */
function isListed(r: RouteSummary): boolean {
  return !r.mapped || r.originCode !== r.destinationCode;
}

/** Route keys with at least one shipment flagged as an unusual cost (the `cost.isAnomaly` behind the Shipments flag). */
function costAnomalyKeys(shipments: readonly Shipment[]): Set<string> {
  return new Set(shipments.filter((s) => s.status !== 'cancelled' && s.cost.isAnomaly).map((s) => s.routeKey));
}

/** The lane filter. The stage figures count with this same function. */
function matchesLane(r: RouteSummary, lane: string, costKeys: ReadonlySet<string>): boolean {
  if (lane === 'critical') return r.delayedShare >= ROUTE_DELAY_CRITICAL_SHARE;
  if (lane === 'watch') return r.delayedShare >= ROUTE_DELAY_WARNING_SHARE && r.delayedShare < ROUTE_DELAY_CRITICAL_SHARE;
  if (lane === 'cost') return costKeys.has(r.routeKey);
  return true;
}

/** One figure per lane filter, never a combined total: a lane can be both late and costly. Red only for the late. */
const ATTENTION_FIGURES: ReadonlyArray<{ lane: string; label: string; tone: 'critical' | 'warning' }> = [
  { lane: 'critical', label: 'Delayed ≥20%', tone: 'critical' },
  { lane: 'watch', label: 'Delayed 10–20%', tone: 'warning' },
  { lane: 'cost', label: 'Unusual cost', tone: 'warning' }
];

const UNMAPPED_COLUMNS: Column<RouteSummary>[] = [
  { key: 'route', header: 'Route', wrap: true, render: (r) => <RouteLabel label={r.label} /> },
  { key: 'count', header: 'Shipments', align: 'right', phoneLabel: 'Shipments', render: (r) => r.count },
  { key: 'avgCost', header: 'Avg cost', align: 'right', phoneLabel: 'Avg cost', render: (r) => formatCents(r.avgCostCents) }
];

/** The Routes page (plan §8.6): lane figures, a schematic route map, its detail panel, and unmapped routes. */
export function RoutesPage() {
  const snapshot = useSnapshot();
  const route = useHashRoute();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const carrierOptions = useMemo<SelectOption[]>(() => {
    const carriers = [...new Set(snapshot.shipments.map((s) => s.carrier))].sort((a, b) => a.localeCompare(b));
    return [{ value: 'all', label: 'All' }, ...carriers.map((c) => ({ value: c, label: c }))];
  }, [snapshot.shipments]);

  // Unknown or missing values fall back to the defaults, so the page without parameters behaves as before.
  const param = (key: string, values: ReadonlySet<string>, fallback: string) => {
    const raw = route.params.get(key);
    return raw !== null && values.has(raw) ? raw : fallback;
  };
  const carrier = param('carrier', valuesOf(carrierOptions), 'all');
  const statusGroup = param('status', STATUS_VALUES, 'all');
  const range = param('range', RANGE_VALUES, 'all') as DateRange;
  const lane = param('lane', LANE_VALUES, 'all');
  const top = param('top', TOP_VALUES, defaultTop(lane));

  function updateParams(changes: Record<string, string>): void {
    const next: Record<string, string> = { carrier, status: statusGroup, range, lane, top, ...changes };
    const cleaned: Record<string, string> = {};
    for (const [key, value] of Object.entries(next)) {
      if (key === 'top' ? value !== defaultTop(next.lane ?? 'all') : value !== 'all') cleaned[key] = value;
    }
    navigate(buildHash('routes', cleaned));
  }

  const filteredShipments = useMemo(() => {
    const ranged = filterShipmentsByRange(snapshot.shipments, range, snapshot.today);
    return ranged.filter((s) => {
      if (carrier !== 'all' && s.carrier !== carrier) return false;
      if (statusGroup === 'open') return s.status === 'pending' || s.status === 'in_transit';
      if (statusGroup === 'delivered') return s.status === 'delivered';
      return true;
    });
  }, [snapshot.shipments, snapshot.today, carrier, statusGroup, range]);

  const costKeys = useMemo(() => costAnomalyKeys(filteredShipments), [filteredShipments]);
  const allRoutes = useMemo(
    () => summarizeRoutes(filteredShipments, snapshot.locations).filter((r) => isListed(r) && matchesLane(r, lane, costKeys)),
    [filteredShipments, snapshot.locations, lane, costKeys]
  );
  const mappedRoutes = allRoutes.filter((r) => r.mapped);
  const unmappedRoutes = allRoutes.filter((r) => !r.mapped);
  const limit = top === 'all' ? mappedRoutes.length : Number(top);
  const shownRoutes = mappedRoutes.slice(0, limit);

  // Stage figures over every shipment (no filter), counted with the filter functions above.
  const network = useMemo(() => summarizeRoutes(snapshot.shipments, snapshot.locations).filter(isListed), [snapshot.shipments, snapshot.locations]);
  const networkCostKeys = useMemo(() => costAnomalyKeys(snapshot.shipments), [snapshot.shipments]);
  const attention = ATTENTION_FIGURES.map((a) => ({ ...a, count: network.filter((r) => matchesLane(r, a.lane, networkCostKeys)).length }));

  const hasAnyFilter = carrier !== 'all' || statusGroup !== 'all' || range !== 'all' || lane !== 'all';
  const selectedRoute: RouteSummary | undefined = allRoutes.find((r) => r.routeKey === selectedKey);

  return (
    <div className="page">
      <PageStage title="Routes">
        {network.length > 0 && (
          <div className="figure-stage">
            <section className="figure-stage__group" aria-labelledby="routes-network">
              <h2 className="figure-stage__label" id="routes-network">
                The network
              </h2>
              <ul className="figure-stage__figures">
                <li>
                  <a className="stage-figure" href={buildHash('routes')}>
                    <span className="stage-figure__value">{network.length.toLocaleString('en-US')}</span>{' '}
                    <span className="stage-figure__label">Total lanes</span>
                  </a>
                </li>
              </ul>
            </section>
            <section className="figure-stage__group" aria-labelledby="routes-attention">
              <h2 className="figure-stage__label" id="routes-attention">
                Needs attention
              </h2>
              <ul className="figure-stage__figures">
                {attention.map((a) => (
                  <li key={a.lane}>
                    <a className={`stage-figure${a.count > 0 ? ` stage-figure--${a.tone}` : ''}`} href={buildHash('routes', { lane: a.lane })}>
                      <span className="stage-figure__value">{a.count.toLocaleString('en-US')}</span>{' '}
                      <span className="stage-figure__label">{a.label}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        )}

        <div className="control-rail">
          <SelectField label="Carrier" value={carrier} options={carrierOptions} onChange={(v) => updateParams({ carrier: v })} />
          <SelectField label="Status" value={statusGroup} options={STATUS_GROUP_OPTIONS} onChange={(v) => updateParams({ status: v })} />
          <SelectField label="Range" value={range} options={RANGE_OPTIONS} onChange={(v) => updateParams({ range: v })} />
          <SelectField label="Lane" value={lane} options={LANE_OPTIONS} onChange={(v) => updateParams({ lane: v, top: defaultTop(v) })} />
          <SelectField label="Show top" value={top} options={TOP_OPTIONS} onChange={(v) => updateParams({ top: v })} />
          {hasAnyFilter && (
            <button type="button" className="button routes__clear" onClick={() => navigate(buildHash('routes'))}>
              Clear filters
            </button>
          )}
        </div>

        {allRoutes.length === 0 ? (
          <EmptyState title="No routes match your filters" />
        ) : (
          <>
            <p className="routes__summary">
              {allRoutes.length} lane{allRoutes.length === 1 ? '' : 's'}
              {shownRoutes.length < mappedRoutes.length ? ` · the map shows the top ${shownRoutes.length}` : ''}
            </p>
            <RouteMap routes={shownRoutes} locations={snapshot.locations} selectedKey={selectedKey} onSelect={setSelectedKey} />
          </>
        )}

        {selectedRoute !== undefined && (
          <Card title={`Route details: ${selectedRoute.label}`} className="route-detail">
            <dl className="route-detail__grid">
              <div>
                <dt>Shipments</dt>
                <dd>{selectedRoute.count}</dd>
              </div>
              <div>
                <dt>Total cost</dt>
                <dd>{formatCents(selectedRoute.totalCostCents)}</dd>
              </div>
              <div>
                <dt>Average cost</dt>
                <dd>{formatCents(selectedRoute.avgCostCents)}</dd>
              </div>
              <div>
                <dt>Delayed</dt>
                <dd>
                  {selectedRoute.delayedCount} ({formatPercent(selectedRoute.delayedShare)})
                </dd>
              </div>
            </dl>
            <p>Carriers: {selectedRoute.carriers.map((c) => `${c.carrier} (${c.count})`).join(', ')}</p>
          </Card>
        )}
      </PageStage>

      {unmappedRoutes.length > 0 && (
        <div className="page-floor">
          <section className="routes-ledger" aria-labelledby="routes-unmapped">
            <h2 className="routes-ledger__title" id="routes-unmapped">
              Unmapped routes
            </h2>
            <p className="routes-ledger__note">These locations are not in the reference map.</p>
            <DataTable caption="Unmapped routes" columns={UNMAPPED_COLUMNS} rows={unmappedRoutes} rowKey={(r) => r.routeKey} stackOnPhone />
          </section>
        </div>
      )}
    </div>
  );
}
