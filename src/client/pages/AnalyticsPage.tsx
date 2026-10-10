// The Analytics page (plan §8.6): range figures on the stage (on-time rate with its target gauge, shipping cost,
// average delivery, shipments in range), the range synced to the hash, six charts in ink gray (colour only where it
// means something: red delays, the shipment status tones in the status bar), a metrics section (turnover, cost, delivery,
// on-time rate, stockout risk distribution, warehouse utilization meters), and the "How these are calculated" formula
// reference driven by `METRIC_DEFINITIONS`.

import { useState, type CSSProperties } from 'react';
import type { DateRange } from '../../shared/domain/analytics';
import {
  countShipmentsByStatus,
  filterShipmentsByRange,
  groupInventoryValue,
  onTimeVsDelayedByMonth,
  shippingCostByMonth,
  routeShortLabel,
  topRoutes
} from '../../shared/domain/analytics';
import { METRIC_DEFINITIONS } from '../../shared/formulas';
import { computeKpis } from '../../shared/domain/metrics';
import { formatCentsAxis, formatCompactNumber, formatDays, formatPercent, monthAxisLabels, statusLabel } from '../../shared/format';
import type { ShipmentStatus, StockoutRisk } from '../../shared/types';
import { useSnapshot } from '../state/DataContext';
import { buildHash, navigate, useHashRoute } from '../router';
import { notMeasurableNote, ON_TIME_TARGET, onTimeTone, targetFigureTone, utilizationTone } from '../lib/targets';
import { displayMoneySummary, displayMoneyTable } from '../lib/displayMoney';
import { monthTableLabel, monthTooltipLabel, partialMonthNote } from '../lib/monthLabels';
import { PageStage } from '../components/layout/PageStage';
import { SelectField, type SelectOption } from '../components/ui/SelectField';
import { SectionHeader } from '../components/ui/SectionHeader';
import { Figure } from '../components/ui/Figure';
import { ChartFrame } from '../components/charts/ChartFrame';
import { BarChart } from '../components/charts/BarChart';
import { ShareBar } from '../components/charts/ShareBar';
import { STATUS_MARK, STATUS_TONE } from '../components/charts/statusTones';
import { LineChart } from '../components/charts/LineChart';
import { StackedBarChart } from '../components/charts/StackedBarChart';

const RANGE_OPTIONS: SelectOption[] = [
  { value: 'all', label: 'All' },
  { value: '30d', label: '30d' },
  { value: '90d', label: '90d' },
  { value: '180d', label: '180d' },
  { value: '365d', label: '365d' }
];

/**
 * Labels of the shipping-cost axis: short month names ("Dec", "Jun"), the month to date marked "Oct*" when `today` is
 * given, as on every month axis. With a year suffix the narrow chart cut them ("De…", "Ju…"); three letters and the "*" fit
 * at every range. The full month and year stay in the tooltip and the data table, and the note under the chart names the
 * month to date.
 */
export function costAxisLabels(months: readonly string[], today?: string): string[] {
  return monthAxisLabels(months, today === undefined ? null : today.slice(0, 7)).map((l) => l.replace(/ '\d\d/, ''));
}

const RANGE_VALUES = new Set(RANGE_OPTIONS.map((o) => o.value));
const DEFAULT_RANGE: DateRange = '180d';

const TOP_ROUTES_LIMIT = 10;

const ROUTE_SORT_OPTIONS: SelectOption[] = [
  { value: 'count', label: 'Shipment count' },
  { value: 'cost', label: 'Total cost' }
];

const RISK_LABELS: Record<StockoutRisk, string> = { high: 'High', medium: 'Medium', low: 'Low', unknown: 'Unknown' };
const RISK_ORDER: readonly StockoutRisk[] = ['high', 'medium', 'low', 'unknown'];

/** The Analytics page (plan §8.6): chart set, metrics section, and the calculation reference. */
export function AnalyticsPage() {
  const snapshot = useSnapshot();
  const route = useHashRoute();
  const rawRange = route.params.get('range');
  // The range lives in the hash (range=); without it the page opens on 180 days, as before.
  const range = (rawRange !== null && RANGE_VALUES.has(rawRange) ? rawRange : DEFAULT_RANGE) as DateRange;
  const setRange = (v: string) => navigate(buildHash('analytics', v === DEFAULT_RANGE ? {} : { range: v }));
  const rangeLabel = RANGE_OPTIONS.find((o) => o.value === range)?.label;
  const [routeSortBy, setRouteSortBy] = useState<'count' | 'cost'>('count');

  const rangedShipments = filterShipmentsByRange(snapshot.shipments, range, snapshot.today);

  const valueByWarehouse = groupInventoryValue(snapshot.inventory, 'warehouse', snapshot.locations);
  const valueByCategory = groupInventoryValue(snapshot.inventory, 'category', snapshot.locations);
  const statusCounts = countShipmentsByStatus(rangedShipments);
  const costByMonth = shippingCostByMonth(rangedShipments, snapshot.today);
  const costMonthLabels = costAxisLabels(costByMonth.map((d) => d.month), snapshot.today);
  const onTimeByMonth = onTimeVsDelayedByMonth(rangedShipments);
  const routes = topRoutes(rangedShipments, snapshot.locations, TOP_ROUTES_LIMIT, routeSortBy);

  const { metrics } = snapshot;

  // Stage figures for the range: the Dashboard's KPI function over the shipments in range.
  const kpis = computeKpis(snapshot.inventory, rangedShipments);
  const rate = kpis.onTimeRate;
  const tone = onTimeTone(rate);
  const belowTarget = tone === 'warning' || tone === 'critical';
  // The gauge keeps its colours and marks the target; below it only the number turns amber (DESIGN.md "Target tone").
  const gaugeStyle = { ['--rate' as string]: `${((rate ?? 0) * 100).toFixed(2)}%`, ['--target' as string]: `${ON_TIME_TARGET * 100}%` } as CSSProperties;
  // "8 not measurable": the range's delivered shipments the rate leaves out (the Dashboard says it too).
  const notMeasurable = notMeasurableNote(rangedShipments);

  return (
    <div className="page">
      <PageStage title="Analytics" variant="compact">
        <div className="analytics-stage">
          <SelectField label="Range" value={range} options={RANGE_OPTIONS} onChange={setRange} />
          <section className="figure-stage__group" aria-labelledby="analytics-range">
            <h2 className="figure-stage__label" id="analytics-range">
              {`Range: ${rangeLabel}`}
            </h2>
            <ul className="figure-stage__figures">
              <Figure
                value={formatPercent(rate)}
                label="On-time rate"
                tone={targetFigureTone(tone)}
                detail={`${kpis.onTimeCount} of ${kpis.onTimeCount + kpis.lateCount} delivered on time${notMeasurable === null ? '' : ` · ${notMeasurable}`}${belowTarget ? ` · below the ${formatPercent(ON_TIME_TARGET, 0)} target` : ''}`}
              >
                {/* The gauge is decoration (aria-hidden); being under target is also said in words. */}
                {rate !== null && <span className={`stage-gauge stage-gauge--${tone}`} style={gaugeStyle} aria-hidden="true" />}
              </Figure>
              <Figure
                value={displayMoneySummary(kpis.totalShippingCostCents)}
                label="Shipping cost"
                detail={kpis.averageShippingCostCents === null ? 'No shipments' : `avg ${displayMoneyTable(kpis.averageShippingCostCents, 'price')} per shipment`}
              />
              <Figure value={formatDays(kpis.averageDeliveryDays)} label="Avg delivery" detail="ship date to delivery" />
              <Figure value={kpis.totalShipments.toLocaleString('en-US')} label="Shipments in range" detail={`${kpis.deliveredShipments.toLocaleString('en-US')} delivered`} />
            </ul>
          </section>
        </div>
      </PageStage>

      <div className="page-floor">
        <section className="page-section">
          <SectionHeader title="Charts" />

          <div className="chart-grid">
            <ChartFrame
              title="Inventory value by warehouse"
              isEmpty={valueByWarehouse.length === 0}
              table={{ columns: ['Warehouse', 'Value'], rows: valueByWarehouse.map((d) => [d.label, displayMoneyTable(d.valueCents, 'amount')]) }}
            >
              <BarChart
                data={valueByWarehouse.map((d) => ({ key: d.key, label: d.label, shortLabel: d.key.replace(/^WH-/, ''), value: d.valueCents / 100 }))}
                orientation="vertical"
                valueFormat={(n) => displayMoneyTable(Math.round(n * 100), 'amount')}
                tickFormat={(n) => formatCentsAxis(Math.round(n * 100))}
                ariaLabel="Inventory value by warehouse"
              />
            </ChartFrame>
            <ChartFrame
              title="Inventory value by category"
              isEmpty={valueByCategory.length === 0}
              table={{ columns: ['Category', 'Value'], rows: valueByCategory.map((d) => [d.label, displayMoneyTable(d.valueCents, 'amount')]) }}
            >
              <BarChart
                data={valueByCategory.map((d) => ({ key: d.key, label: d.label, value: d.valueCents / 100 }))}
                orientation="horizontal"
                valueFormat={(n) => displayMoneyTable(Math.round(n * 100), 'amount')}
                tickFormat={(n) => formatCentsAxis(Math.round(n * 100))}
                ariaLabel="Inventory value by category"
              />
            </ChartFrame>
            <ChartFrame
              title="Shipment status"
              subtitle={`Range: ${RANGE_OPTIONS.find((o) => o.value === range)?.label}`}
              isEmpty={rangedShipments.length === 0}
              table={{ columns: ['Status', 'Count'], rows: statusCounts.map((d) => [statusLabel(d.status as ShipmentStatus), d.count]) }}
            >
              <ShareBar
                data={statusCounts.map((d) => ({
                  key: d.status,
                  label: statusLabel(d.status as ShipmentStatus),
                  value: d.count,
                  tone: STATUS_TONE[d.status as ShipmentStatus],
                  mark: STATUS_MARK[d.status as ShipmentStatus]
                }))}
                valueFormat={(n) => n.toLocaleString('en-US')}
                ariaLabel="Shipments by status"
              />
            </ChartFrame>
            <ChartFrame
              title="Shipping cost over time"
              subtitle={`Range: ${RANGE_OPTIONS.find((o) => o.value === range)?.label}`}
              isEmpty={costByMonth.length === 0}
              note={partialMonthNote(costByMonth.map((d) => d.month), snapshot.today)}
              table={{ columns: ['Month', 'Total cost', 'Shipments'], rows: costByMonth.map((d) => [monthTableLabel(d.month, snapshot.today), displayMoneyTable(d.totalCents, 'amount'), d.count]) }}
            >
              <LineChart
                points={costByMonth.map((d, i) => ({ label: monthTooltipLabel(d.month, snapshot.today), axisLabel: costMonthLabels[i], value: d.totalCents / 100 }))}
                valueFormat={(n) => displayMoneyTable(Math.round(n * 100), 'amount')}
                tickFormat={(n) => formatCentsAxis(Math.round(n * 100))}
                ariaLabel="Shipping cost by month"
              />
            </ChartFrame>
            <ChartFrame
              title="On-time vs delayed by month"
              subtitle={`Range: ${RANGE_OPTIONS.find((o) => o.value === range)?.label}`}
              isEmpty={onTimeByMonth.length === 0}
              note={partialMonthNote(onTimeByMonth.map((d) => d.month), snapshot.today)}
              table={{ columns: ['Month', 'On time', 'Delayed'], rows: onTimeByMonth.map((d) => [monthTableLabel(d.month, snapshot.today), d.onTime, d.delayed]) }}
            >
              <StackedBarChart
                categories={onTimeByMonth.map((d) => monthTooltipLabel(d.month, snapshot.today))}
                axisLabels={monthAxisLabels(onTimeByMonth.map((d) => d.month), snapshot.today.slice(0, 7))}
                series={[
                  { name: 'On time', values: onTimeByMonth.map((d) => d.onTime), tone: 'neutral' }, // ink: on time is the norm
                  { name: 'Delayed', values: onTimeByMonth.map((d) => d.delayed), tone: 'critical' }
                ]}
                valueFormat={(n) => n.toLocaleString('en-US')}
                tickFormat={formatCompactNumber}
                ariaLabel="On-time vs delayed shipments by month"
              />
            </ChartFrame>
            <ChartFrame
              title="Top shipping routes"
              subtitle={`Range: ${RANGE_OPTIONS.find((o) => o.value === range)?.label}`}
              isEmpty={routes.length === 0}
              controls={<SelectField label="Sort by" value={routeSortBy} options={ROUTE_SORT_OPTIONS} onChange={(v) => setRouteSortBy(v as 'count' | 'cost')} />}
              table={{ columns: ['Route', 'Shipments', 'Total cost'], rows: routes.map((r) => [r.label, r.count, displayMoneyTable(r.totalCostCents, 'amount')]) }}
            >
              <BarChart
                data={routes.map((r) => ({ key: r.routeKey, label: r.label, shortLabel: routeShortLabel(r), value: routeSortBy === 'count' ? r.count : r.totalCostCents / 100 }))}
                orientation="horizontal"
                valueFormat={(n) => (routeSortBy === 'count' ? n.toLocaleString('en-US') : displayMoneyTable(Math.round(n * 100), 'amount'))}
                tickFormat={(n) => (routeSortBy === 'count' ? formatCompactNumber(n) : formatCentsAxis(Math.round(n * 100)))}
                ariaLabel="Top shipping routes"
              />
            </ChartFrame>
          </div>
        </section>

        <section className="page-section">
          <SectionHeader title="Metrics" />
          {/* Cost, delivery time and on-time rate lead the page (stage); the metrics keep what only they show. */}
          <div className="analytics-figure">
            <p className="analytics-figure__value">{metrics.inventoryTurnover === null ? '—' : `${metrics.inventoryTurnover.toFixed(2)}×`}</p>
            <p className="analytics-figure__label">Inventory turnover (annualized, est.)</p>
            <p className="analytics-figure__detail">
              {`DIO ${formatDays(metrics.daysInventoryOutstanding)} · ${metrics.turnoverCoverage.itemsWithUsage} of ${metrics.turnoverCoverage.totalItems} items have usage data`}
            </p>
          </div>
          <div className="metrics-panels">
            <section className="analytics-panel" aria-labelledby="analytics-risk">
              <h3 className="analytics-panel__title" id="analytics-risk">
                Stockout risk distribution
              </h3>
              <ul className="risk-summary">
                {RISK_ORDER.map((risk) => (
                  <li key={risk} className={`risk-summary__item risk-summary__item--${risk}`}>
                    <span className="risk-summary__label">{RISK_LABELS[risk]}</span>
                    <span className="risk-summary__value">{metrics.stockoutRiskCounts[risk]}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="analytics-panel" aria-labelledby="analytics-utilization">
              <h3 className="analytics-panel__title" id="analytics-utilization">
                Warehouse utilization
              </h3>
              <ul className="meter-list">
                {metrics.warehouseUtilization.map((w) => {
                  if (w.utilization === null) {
                    return (
                      <li key={w.code} className="meter-list__item">
                        <span className="meter-list__label">{w.name}</span>
                        <span
                          className="meter meter--neutral"
                          role="meter"
                          aria-valuenow={0}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuetext={`Capacity unknown (${w.units.toLocaleString('en-US')} units stored)`}
                        >
                          <span className="meter__bar" style={{ width: '0%' }} />
                        </span>
                        <span className="meter-list__value">—</span>
                      </li>
                    );
                  }
                  const percent = w.utilization * 100;
                  // Only the number carries the tone, from 90%: amber, then red over capacity; the bar stays ink gray.
                  const tone = utilizationTone(w.utilization);
                  return (
                    <li key={w.code} className="meter-list__item">
                      <span className="meter-list__label">{w.name}</span>
                      <span
                        className="meter meter--neutral"
                        role="meter"
                        aria-valuenow={Math.round(percent * 10) / 10}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuetext={`${w.units.toLocaleString('en-US')} / ${w.capacityUnits.toLocaleString('en-US')} units (${formatPercent(w.utilization)})`}
                      >
                        <span className="meter__bar" style={{ width: `${Math.min(percent, 100)}%` }} />
                      </span>
                      <span className={tone === 'neutral' ? 'meter-list__value' : `meter-list__value meter-list__value--${tone}`}>{formatPercent(w.utilization)}</span>
                    </li>
                  );
                })}
              </ul>
            </section>
          </div>
        </section>

        <section className="page-section analytics-formulas" aria-labelledby="analytics-formulas">
          <SectionHeader title="How these are calculated" id="analytics-formulas" />
          <dl className="formula-list">
            {METRIC_DEFINITIONS.map((def) => (
              <div key={def.id} className="formula-list__item">
                <dt>{def.name}</dt>
                <dd>
                  <code className="formula-list__formula">{def.formula}</code>
                  <p className="formula-list__notes">{def.notes}</p>
                </dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </div>
  );
}
