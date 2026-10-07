// The Dashboard (V2): five scenes on one twelve-column grid, alternating dark and paper in hard cuts.
//   Situation  (dark)   the lane map is the stage (width = traffic, dashed red = late); 85.6% sits inside it at display
//                       size from 1100px, above it on narrower screens; four figures sit at the foot
//   Attention  (dark)   "Do these first": the alerts that need attention by kind, then at most five rows ranked by money
//                       (what needs action comes second)
//   Flow       (paper)  the monthly on-time vs delayed bars, then cost
//   Nodes      (dark)   five identical racks, one system
//   Movement   (paper)  recent shipment activity as a ledger
// Every number is the one the previous Dashboard showed, from the same snapshot fields and shared functions; only the
// way it is drawn changed. Red ("signal") means late or critical and nothing else.

import { Fragment, useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { DateRange, RouteSummary } from '../../shared/domain/analytics';
import { filterShipmentsByRange, recentActivity, shippingCostByMonth, onTimeVsDelayedByMonth, summarizeRoutes } from '../../shared/domain/analytics';
import {
  formatCents,
  formatCentsCompact,
  formatDay,
  formatDays,
  formatMonth,
  formatMonthWithMtd,
  formatPercent,
  monthAxisLabels,
  monthAxisNote,
  statusLabel
} from '../../shared/format';
import type { ShipmentStatus } from '../../shared/types';
import { useSnapshot } from '../state/DataContext';
import { buildHash } from '../router';
import { useReducedMotion, useReveal } from '../hooks/useAtlasHooks';
import { AtlasCaption, AtlasScene } from '../components/atlas/AtlasScene';
import { buildTransitDots, laneTone } from '../components/atlas/atlasGeometry';
import { CostChart, FlowFigure, ReliabilityChart } from '../components/atlas/FlowCharts';
import { WarehouseRacks } from '../components/atlas/WarehouseRacks';
import { RouteLabel } from '../components/ui/RouteLabel';
import { SelectField, type SelectOption } from '../components/ui/SelectField';
import { ON_TIME_FLOOR, ON_TIME_TARGET, onTimeTone, type TargetTone } from '../lib/targets';
import { buildQueue, kindCounts } from '../lib/attention';

const RANGE_OPTIONS: SelectOption[] = [
  { value: 'all', label: 'All' },
  { value: '30d', label: '30d' },
  { value: '90d', label: '90d' },
  { value: '180d', label: '180d' },
  { value: '365d', label: '365d' }
];

/** Lifecycle order. */
const STATUS_ORDER: readonly ShipmentStatus[] = ['pending', 'in_transit', 'delivered', 'cancelled'];

type Tone = TargetTone;

// The on-time thresholds are shared with the Analytics stage; re-exported here for existing imports.
export { ON_TIME_TARGET, ON_TIME_FLOOR };

/** The lane with the highest delayed share (ties: more shipments, then key), only when it is amber or red. */
function mostDelayedLane(routes: readonly RouteSummary[]): RouteSummary | null {
  const candidates = routes.filter((r) => r.mapped && r.originCode !== r.destinationCode && r.delayedCount > 0 && laneTone(r.delayedShare) !== 'neutral');
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) => b.delayedShare - a.delayedShare || b.count - a.count || a.routeKey.localeCompare(b.routeKey))[0] as RouteSummary;
}

const capitalise = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** An 8px severity marker: filled circle = critical, triangle = warning, hollow circle = info. The word is visually hidden text. */
function SeverityGlyph({ severity }: { severity: string }) {
  return (
    <svg className={`alert-glyph alert-glyph--${severity}`} viewBox="0 0 8 8" aria-hidden="true" focusable="false">
      {severity === 'warning' ? <polygon points="4,0 8,8 0,8" /> : <circle cx="4" cy="4" r={severity === 'info' ? 3.25 : 4} />}
    </svg>
  );
}

/** " · " between the parts of one sentence: a dot for the eye (its spaces let the line wrap), a comma for screen readers. */
function Separator({ className }: { className: string }) {
  return (
    <>
      <span className="visually-hidden">,</span>
      <span className={className} aria-hidden="true">
        {' · '}
      </span>
    </>
  );
}

/** An 8px status marker in a fixed slot, so the status words align: filled circle, hollow circle or a dash. The word is the text. */
function StatusMark({ status }: { status: ShipmentStatus }) {
  return (
    <svg className={`status-mark status-mark--${status}`} viewBox="0 0 8 8" aria-hidden="true" focusable="false">
      {status === 'cancelled' ? <rect x="0" y="3.25" width="8" height="1.5" /> : <circle cx="4" cy="4" r={status === 'pending' ? 3.25 : 4} />}
    </svg>
  );
}

interface ChapterProps {
  className: string;
  label: string;
  children: ReactNode;
}

/** A scene on the page grid. Its drawings (bars, line, rack fills) draw once, the first time it scrolls into view. */
function Chapter({ className, label, children }: ChapterProps) {
  const ref = useReveal<HTMLElement>();
  return (
    <section ref={ref} className={`scene ${className}`} aria-label={label}>
      <div className="dash">{children}</div>
    </section>
  );
}

interface FigureProps {
  label: string;
  value: string;
  detail?: string;
  /** `critical` paints the value in the signal colour (only ever used for the delayed count). */
  tone?: 'neutral' | 'critical';
  href?: string;
}

/** A number with its label and context. DOM order label, value, detail (the accessible name); the value is drawn first. */
function Figure({ label, value, detail, tone = 'neutral', href }: FigureProps) {
  const body = (
    <>
      <span className="figure__label">{label}</span>{' '}
      <span className="figure__value">{value}</span>
      {detail !== undefined && (
        <>
          {' '}
          <span className="figure__detail">{detail}</span>
        </>
      )}
    </>
  );
  const className = `figure figure--${tone}`;
  return href !== undefined ? (
    <a className={className} href={href}>
      {body}
    </a>
  ) : (
    <div className={className}>{body}</div>
  );
}

/** The Dashboard page. */
export function DashboardPage() {
  const snapshot = useSnapshot();
  const reduceMotion = useReducedMotion();
  const [range, setRange] = useState<DateRange>('180d');

  const { kpis, metrics } = snapshot;
  const rangedShipments = filterShipmentsByRange(snapshot.shipments, range, snapshot.today);

  const routes = useMemo(() => summarizeRoutes(snapshot.shipments, snapshot.locations), [snapshot.shipments, snapshot.locations]);
  const dots = useMemo(() => buildTransitDots(snapshot.shipments, snapshot.locations, snapshot.today), [snapshot.shipments, snapshot.locations, snapshot.today]);
  const warehouseValue = useMemo(() => new Map(metrics.warehouseUtilization.map((w) => [w.code, w.valueCents])), [metrics.warehouseUtilization]);
  const focusLane = mostDelayedLane(routes);

  const totalShipments = snapshot.shipments.length;
  const statusCounts = STATUS_ORDER.map((status) => ({
    status,
    label: statusLabel(status),
    count: snapshot.shipments.filter((s) => s.status === status).length
  }));

  const costByMonth = shippingCostByMonth(rangedShipments, snapshot.today);
  const costMonthLabels = monthAxisLabels(costByMonth.map((d) => d.month), snapshot.today.slice(0, 7));
  const onTimeByMonth = onTimeVsDelayedByMonth(rangedShipments);
  const onTimeMonthLabels = monthAxisLabels(onTimeByMonth.map((d) => d.month));
  const rangeLabel = RANGE_OPTIONS.find((o) => o.value === range)?.label;

  const activity = recentActivity(snapshot.shipments, snapshot.today, 10);
  // "Needs attention" = critical + warning (matches the Sidebar/Alerts-page badge count); the total also includes
  // info-severity alerts, called out in the detail line so the two numbers never look contradictory (R-14).
  const alertsNeedingAttention = snapshot.alerts.filter((a) => a.severity === 'critical' || a.severity === 'warning').length;
  const infoAlertCount = snapshot.alerts.filter((a) => a.severity === 'info').length;
  // "Do these first": the kinds add up to the same "need attention" count; the queue is ranked by money (docs/DASHBOARD-ALERTS.md).
  const kinds = kindCounts(snapshot.alerts);
  const queue = buildQueue(snapshot);

  const rate = kpis.onTimeRate;
  const tone = onTimeTone(rate);

  return (
    <div className="atlas-page">
      {/* SITUATION (dark): the network across the full width with 85.6% in its lower-left corner, four figures at the foot. */}
      <section className="scene scene--dark surface-stage situation" aria-label="Network situation">
        <div className="dash situation__grid">
          <h1 tabIndex={-1} className="situation__title">
            Dashboard
          </h1>

          <div className="hero">
            <p className="hero__label">On-time delivery rate</p>
            <div className="hero__figure">
              <div className="hero__num">
                <p className="hero__value">{formatPercent(rate)}</p>
                {rate !== null && <span className={`hero__gauge hero__gauge--${tone}`} style={{ ['--rate' as string]: `${(rate * 100).toFixed(2)}%` } as CSSProperties} aria-hidden="true" />}
              </div>
            </div>
            {/* The gauge's colour is decoration (aria-hidden); being under target is also said in words. */}
            <p className="hero__detail">{`${kpis.onTimeCount} of ${kpis.onTimeCount + kpis.lateCount} delivered on time${tone === 'warning' || tone === 'critical' ? ` · below the ${formatPercent(ON_TIME_TARGET, 0)} target` : ''}`}</p>
          </div>

          <div className="situation__map">
            <AtlasScene
              routes={routes}
              locations={snapshot.locations}
              warehouseValueCents={warehouseValue}
              dots={dots}
              focusRouteKey={focusLane?.routeKey ?? null}
              animate={!reduceMotion}
            />
          </div>

          <div className="situation__caption">
            <AtlasCaption />
            <a className="dash-link" href={buildHash('routes')}>
              Explore the lanes
            </a>
          </div>

          <div className="signals">
            <Figure
              label="Total shipments"
              value={kpis.totalShipments.toLocaleString('en-US')}
              detail={`${kpis.activeShipments} active · ${kpis.cancelledShipments} cancelled`}
              href={buildHash('shipments')}
            />
            <Figure
              label="Delayed shipments"
              value={kpis.delayedShipments.toLocaleString('en-US')}
              detail={`${kpis.overdueCount} overdue · ${kpis.lateCount} delivered late`}
              tone={kpis.delayedShipments > 0 ? 'critical' : 'neutral'}
              href={buildHash('shipments', { flag: 'delayed' })}
            />
            <Figure
              label="Alerts needing attention"
              value={alertsNeedingAttention.toLocaleString('en-US')}
              detail={`${snapshot.alerts.length.toLocaleString('en-US')} total · ${infoAlertCount.toLocaleString('en-US')} info`}
              href={buildHash('alerts')}
            />
            <Figure label="Low-stock items" value={kpis.lowStockCount.toLocaleString('en-US')} detail={`${kpis.outOfStockCount} out of stock`} href={buildHash('inventory', { stock: 'low_or_out' })} />
            {totalShipments > 0 && (
              <>
                <p className="status-label" id="status-label">
                  Shipments by status
                </p>
                <ul className="status-list" aria-labelledby="status-label">
                  {statusCounts.map((s) => (
                    <li key={s.status}>
                      <a className="status-list__link" href={buildHash('shipments', { status: s.status })}>
                        <span className="status-list__label">{s.label}</span> <span className="status-list__count">{s.count.toLocaleString('en-US')}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
      </section>

      {/* ATTENTION (dark, one block with Situation): what needs action comes right after what is happening and where.
          "Do these first": the alerts that need attention by kind (each a link to exactly its rows), then at most five
          rows ranked by the money SCC can compute, each one link with what, where, the damage and the next step. */}
      <Chapter className="scene--dark surface-stage attention" label="Attention">
        <div className="attention__head">
          <h2 className="scene__title">Do these first</h2>
          {kinds.length > 0 && (
            <p className="attention__kinds">
              {kinds.map((k, i) => (
                <Fragment key={k.kind}>
                  {i > 0 && <Separator className="attention__sep" />}
                  <a href={k.href}>{k.text}</a>
                </Fragment>
              ))}
            </p>
          )}
          <a className="dash-link" href={buildHash('alerts')}>
            {alertsNeedingAttention === 0 ? 'View all alerts' : `View all alerts (${alertsNeedingAttention.toLocaleString('en-US')} ${alertsNeedingAttention === 1 ? 'needs' : 'need'} attention)`}
          </a>
        </div>

        <div className="attention__list">
          {queue.length === 0 ? (
            <p className="attention__empty">Nothing needs action today.</p>
          ) : (
            <>
              <ol className="queue">
                {queue.map((r) => (
                  <li key={r.key}>
                    <a className="queue-row" href={r.href}>
                      <SeverityGlyph severity={r.tone} />
                      <span className="queue-row__text">
                        <span className="visually-hidden">{capitalise(r.tone)}: </span>
                        <span className="queue-row__what">{r.what}</span>
                        {r.damage !== null && (
                          <>
                            <Separator className="queue-row__sep" />
                            <span className="queue-row__damage">{r.damage}</span>
                          </>
                        )}
                        <Separator className="queue-row__sep" />
                        <span className="queue-row__action">{r.action}</span>
                      </span>
                      <svg className="queue-row__arrow" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                        <path d="M4 10h11M11 5l5 5-5 5" />
                      </svg>
                    </a>
                  </li>
                ))}
              </ol>
              <details className="attention__how">
                <summary>How these are counted</summary>
                <p>
                  Short before restock: what usage will ask for before a reorder placed today can arrive, minus what is on hand, valued at unit
                  cost: (daily usage × lead time − on hand) × unit cost. SCC has no selling prices, so this is not lost revenue. Billed above
                  typical: the cost over the usual cost for the same route and carrier. Late deliveries have no money figure. Rows are ordered by
                  money, with at most three stock rows; the carrier with the most shipments 7 or more days late comes last. Colour shows
                  severity.
                </p>
              </details>
            </>
          )}
        </div>
      </Chapter>

      {/* FLOW (paper): what moved on time, and what it cost. */}
      <Chapter className="scene--paper flow" label="Flow">
        <header className="flow__head">
          <h2 className="scene__title">Delivery reliability and cost</h2>
          <SelectField label="Range" value={range} options={RANGE_OPTIONS} onChange={(v) => setRange(v as DateRange)} />
        </header>

        <div className="flow__focal">
          <FlowFigure
            title="On-time vs delayed by month"
            subtitle="By estimated-delivery month. Delayed means delivered late or still overdue."
            isEmpty={onTimeByMonth.length === 0}
            table={{ columns: ['Month', 'On time', 'Delayed'], rows: onTimeByMonth.map((d) => [formatMonth(d.month), d.onTime, d.delayed]) }}
          >
            <ReliabilityChart
              data={onTimeByMonth.map((d, i) => ({ label: formatMonth(d.month), axisLabel: onTimeMonthLabels[i] as string, onTime: d.onTime, delayed: d.delayed }))}
              ariaLabel="On-time vs delayed shipments by month"
              valueFormat={(n) => n.toLocaleString('en-US')}
            />
          </FlowFigure>
        </div>

        <div className="flow__secondary">
          <div className="flow__figures">
            <Figure
              label="Total shipping cost"
              value={formatCentsCompact(kpis.totalShippingCostCents)}
              detail={`Avg ${kpis.averageShippingCostCents === null ? '—' : formatCents(kpis.averageShippingCostCents)} per shipment`}
            />
            <Figure label="Average delivery time" value={formatDays(kpis.averageDeliveryDays)} />
          </div>

          <div className="flow__cost">
            <FlowFigure
              title="Shipping cost over time"
              subtitle={`Range: ${rangeLabel}`}
              isEmpty={costByMonth.length === 0}
              note={monthAxisNote(costByMonth.map((d) => d.month), snapshot.today)}
              table={{ columns: ['Month', 'Total cost', 'Shipments'], rows: costByMonth.map((d) => [formatMonthWithMtd(d.month, snapshot.today), formatCents(d.totalCents), d.count]) }}
            >
              <CostChart
                data={costByMonth.map((d, i) => ({ label: formatMonthWithMtd(d.month, snapshot.today), axisLabel: costMonthLabels[i] as string, cents: d.totalCents }))}
                ariaLabel="Shipping cost by month"
                valueFormat={formatCentsCompact}
              />
            </FlowFigure>
          </div>
        </div>
      </Chapter>

      {/* NODES (dark): five identical racks. */}
      <Chapter className="scene--dark surface-stage nodes" label="Nodes">
        <div className="nodes__head">
          <h2 className="scene__title">Warehouses and inventory</h2>
          <Figure
            label="Total inventory value"
            value={formatCentsCompact(kpis.totalInventoryValueCents)}
            detail={`${kpis.totalUnits.toLocaleString('en-US')} units in ${kpis.inventoryRecordCount.toLocaleString('en-US')} records`}
            href={buildHash('inventory')}
          />
        </div>
        <div className="nodes__racks">
          <WarehouseRacks warehouses={metrics.warehouseUtilization} />
        </div>
      </Chapter>

      {/* MOVEMENT (paper): the ledger, newest first. Rows are laid out with CSS grid, so the roles are explicit. */}
      <Chapter className="scene--paper movement" label="Movement">
        <h2 className="scene__title">Recent shipment activity</h2>
        <div className="movement__ledger">
          {activity.length === 0 ? (
            <p className="movement__empty">No shipment activity yet.</p>
          ) : (
            <table className="activity" role="table">
              <caption className="visually-hidden">Recent shipment activity</caption>
              <thead role="rowgroup">
                <tr role="row">
                  <th role="columnheader" scope="col" className="activity__id">
                    ID
                  </th>
                  <th role="columnheader" scope="col" className="activity__route">
                    Route
                  </th>
                  <th role="columnheader" scope="col" className="activity__carrier">
                    Carrier
                  </th>
                  <th role="columnheader" scope="col" className="activity__status">
                    Status
                  </th>
                  <th role="columnheader" scope="col" className="activity__date">
                    Activity date
                  </th>
                  <th role="columnheader" scope="col" className="activity__cost">
                    Cost
                  </th>
                </tr>
              </thead>
              <tbody role="rowgroup">
                {activity.map((s) => (
                  <tr role="row" key={s.shipmentId}>
                    <td role="cell" className="activity__id">
                      {s.shipmentId}
                    </td>
                    <td role="cell" className="activity__route">
                      <RouteLabel label={s.routeLabel} />
                    </td>
                    <td role="cell" className="activity__carrier">
                      {s.carrier}
                    </td>
                    <td role="cell" className={`activity__status activity__status--${s.status}`}>
                      <StatusMark status={s.status} />
                      {statusLabel(s.status)}
                    </td>
                    <td role="cell" className="activity__date">
                      {formatDay(s.actualDelivery ?? s.shipDate)}
                    </td>
                    <td role="cell" className="activity__cost">
                      {formatCents(s.shippingCostCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Chapter>
    </div>
  );
}
