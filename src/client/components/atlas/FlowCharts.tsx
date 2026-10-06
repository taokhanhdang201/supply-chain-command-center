// The Flow chapter's charts. They plot exactly the series the previous Dashboard charts plotted (on-time vs delayed
// by month, shipping cost by month), drawn at the width they are shown at: one baseline hairline, no axes, no gridlines,
// no legend box. Series are labelled directly (or by one inline label row on narrow screens), values are printed on
// the marks, and every figure keeps the "Show data table" accessible equivalent.

import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useElementSize } from '../../hooks/useAtlasHooks';
import type { ChartTable } from '../charts/ChartFrame';
import { MAX_BAR, costHeight, niceMax, reliabilityHeight } from './flowScale';

export interface FlowFigureProps {
  title: string;
  subtitle?: string;
  note?: string | null;
  isEmpty: boolean;
  table: ChartTable;
  children: ReactNode;
}

/** An unboxed figure: title row, the chart, and a text toggle that swaps the chart for its data table. */
export function FlowFigure({ title, subtitle, note, isEmpty, table, children }: FlowFigureProps) {
  const [showTable, setShowTable] = useState(false);
  return (
    <figure className="flow-figure">
      <div className="flow-figure__head">
        <div className="flow-figure__titles">
          <h3 className="flow-figure__title">{title}</h3>
          {subtitle !== undefined && <p className="flow-figure__subtitle">{subtitle}</p>}
        </div>
        {!isEmpty && (
          <button type="button" className="flow-figure__toggle" aria-pressed={showTable} onClick={() => setShowTable((v) => !v)}>
            {showTable ? 'Hide data table' : 'Show data table'}
          </button>
        )}
      </div>
      {isEmpty ? (
        <p className="chart-frame__empty">No data for the selected range</p>
      ) : showTable ? (
        <div className="table-scroll">
          <table className="data-table">
            <caption className="visually-hidden">{title} data</caption>
            <thead>
              <tr>
                {table.columns.map((column) => (
                  <th key={column} scope="col">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td key={j}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          {children}
          {note ? <p className="chart-frame__note">{note}</p> : null}
        </>
      )}
    </figure>
  );
}

/** Chart geometry (all in CSS px; the svg is drawn 1:1 so text is exactly 14px at every width). */
const TOP = 28;
const BOTTOM = 32;
/** Direct series labels need a right margin; below this drawing width they give way to one inline label row. */
const DIRECT_LABEL_MIN_WIDTH = 560;
const DIRECT_LABEL_MARGIN = 96;

export interface ReliabilityDatum {
  label: string;
  axisLabel: string;
  onTime: number;
  delayed: number;
}

export interface ReliabilityChartProps {
  data: readonly ReliabilityDatum[];
  ariaLabel: string;
  valueFormat: (n: number) => string;
}

/** On-time (ink) with the delayed part stacked on top (signal red); the delayed count is written above each bar. */
export function ReliabilityChart({ data, ariaLabel, valueFormat }: ReliabilityChartProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { width } = useElementSize(ref, { width: 640, height: 260 });
  const w = Math.max(280, width);
  const h = reliabilityHeight(w);
  const direct = w >= DIRECT_LABEL_MIN_WIDTH;
  const plotW = w - (direct ? DIRECT_LABEL_MARGIN : 0);
  const plotH = h - TOP - BOTTOM;
  const max = niceMax(Math.max(...data.map((d) => d.onTime + d.delayed), 1));
  const y = (v: number): number => TOP + plotH - (v / max) * plotH;
  const slot = plotW / Math.max(1, data.length);
  const barW = Math.min(MAX_BAR, slot * 0.45);
  const base = y(0);

  const last = data[data.length - 1];
  const lastX = last === undefined ? 0 : slot * (data.length - 1) + slot / 2;
  let onTimeLabelY = last === undefined ? 0 : (y(last.onTime) + base) / 2;
  const delayedLabelY = last === undefined ? 0 : (y(last.onTime + last.delayed) + y(last.onTime)) / 2;
  // Keep the two direct labels a full line apart when the last month's delayed segment is thin.
  if (last !== undefined && last.delayed > 0 && onTimeLabelY - delayedLabelY < 20) onTimeLabelY = delayedLabelY + 20;

  return (
    <div className="flow-chart" ref={ref}>
      {!direct && (
        <p className="flow-chart__key" aria-hidden="true">
          <span className="flow-chart__key-item">
            <i className="flow-chart__swatch flow-chart__swatch--ontime" />
            On time
          </span>
          <span className="flow-chart__key-item">
            <i className="flow-chart__swatch flow-chart__swatch--delayed" />
            Delayed
          </span>
        </p>
      )}
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={ariaLabel}>
        <line x1={0} x2={w} y1={base} y2={base} className="flow-chart__base" />
        {data.map((d, i) => {
          const cx = slot * i + slot / 2;
          const onH = plotH * (d.onTime / max);
          const delH = plotH * (d.delayed / max);
          const top = y(d.onTime + d.delayed);
          return (
            <g key={d.label}>
              <title>{`${d.label}: ${valueFormat(d.onTime)} on time, ${valueFormat(d.delayed)} delayed`}</title>
              <g className="flow-stack">
                <rect x={cx - barW / 2} y={y(d.onTime)} width={barW} height={onH} className="flow-bar flow-bar--ontime" />
                {d.delayed > 0 && <rect x={cx - barW / 2} y={top} width={barW} height={delH} className="flow-bar flow-bar--delayed" />}
              </g>
              {onH >= 24 && (
                <text x={cx} y={y(d.onTime) + onH / 2} dy="0.32em" textAnchor="middle" className="flow-chart__inside">
                  {valueFormat(d.onTime)}
                </text>
              )}
              {d.delayed > 0 && (
                <text x={cx} y={top - 8} textAnchor="middle" className="flow-chart__delayed">
                  {valueFormat(d.delayed)}
                </text>
              )}
              <text x={cx} y={h - 8} textAnchor="middle" className="flow-chart__axis">
                {d.axisLabel}
              </text>
            </g>
          );
        })}
        {direct && last !== undefined && (
          <g className="flow-chart__series" aria-hidden="true">
            <text x={lastX + barW / 2 + 12} y={onTimeLabelY} dy="0.32em" className="flow-chart__series-label">
              On time
            </text>
            {last.delayed > 0 && (
              <text x={lastX + barW / 2 + 12} y={delayedLabelY} dy="0.32em" className="flow-chart__series-label flow-chart__series-label--delayed">
                Delayed
              </text>
            )}
          </g>
        )}
      </svg>
    </div>
  );
}

export interface CostDatum {
  label: string;
  axisLabel: string;
  cents: number;
}

export interface CostChartProps {
  data: readonly CostDatum[];
  ariaLabel: string;
  /** Direct labels and tooltips, e.g. "$102.3K". */
  valueFormat: (cents: number) => string;
}

/** Shipping cost by month as one ink line; the first, last, highest and lowest months carry a dot and a value. */
export function CostChart({ data, ariaLabel, valueFormat }: CostChartProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { width } = useElementSize(ref, { width: 640, height: 260 });
  const w = Math.max(280, width);
  const h = costHeight(w);
  const plotH = h - TOP - BOTTOM;
  const max = niceMax(Math.max(...data.map((d) => d.cents), 1));
  const y = (v: number): number => TOP + plotH - (v / max) * plotH;
  const slot = w / Math.max(1, data.length);
  const x = (i: number): number => slot * i + slot / 2;
  const line = data.map((d, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(d.cents).toFixed(1)}`).join(' ');

  const cents = data.map((d) => d.cents);
  const highIndex = cents.indexOf(Math.max(...cents));
  const lowIndex = cents.indexOf(Math.min(...cents));
  const labelled = new Set<number>([0, data.length - 1, highIndex, lowIndex]);
  // The lowest month's value hangs below its dot, so it can never touch the value above a neighbouring higher month.
  const below = (i: number): boolean => i === lowIndex && i !== highIndex && y(cents[i] as number) + 12 + 14 < y(0) - 4;

  return (
    <div className="flow-chart" ref={ref}>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={ariaLabel}>
        <line x1={0} x2={w} y1={y(0)} y2={y(0)} className="flow-chart__base" />
        <path d={line} fill="none" pathLength={1} className="flow-cost__line" />
        {data.map((d, i) => (
          <g key={d.label}>
            <title>{`${d.label}: ${valueFormat(d.cents)}`}</title>
            <circle cx={x(i)} cy={y(d.cents)} r={12} className="flow-cost__hit" />
            {labelled.has(i) && (
              <>
                <circle cx={x(i)} cy={y(d.cents)} r={4} className="flow-cost__dot" />
                <text
                  x={x(i)}
                  y={below(i) ? y(d.cents) + 24 : y(d.cents) - 12}
                  textAnchor={i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle'}
                  className="flow-chart__value"
                >
                  {valueFormat(d.cents)}
                </text>
              </>
            )}
            <text x={x(i)} y={h - 8} textAnchor="middle" className="flow-chart__axis">
              {d.axisLabel}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
