// A donut chart with an accessible legend showing label, value and percentage (plan §8.5).

import { useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { ChartTone } from './StackedBarChart';
import { ChartTooltip } from './ChartTooltip';

export interface DonutDatum {
  key: string;
  label: string;
  value: number;
  tone?: ChartTone;
}

export interface DonutChartProps {
  data: DonutDatum[];
  valueFormat: (n: number) => string;
  ariaLabel: string;
  onSelect?: (key: string) => void;
}

const SIZE = 220;
const CENTER = SIZE / 2;
const RADIUS = 80;
const STROKE_WIDTH = 32;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

const PALETTE = ['chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5', 'chart-6'];

function colorFor(datum: DonutDatum, index: number): string {
  return datum.tone ? `var(--${datum.tone})` : `var(--${PALETTE[index % PALETTE.length]})`;
}

function handleActivationKey(e: KeyboardEvent<SVGGElement>, run: () => void): void {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    run();
  }
}

/** A donut chart with an accessible legend (label, value, percentage). Renders an empty message when total is 0. */
export function DonutChart({ data, valueFormat, ariaLabel, onSelect }: DonutChartProps) {
  const [hovered, setHovered] = useState<string | null>(null);
  const total = data.reduce((sum, d) => sum + d.value, 0);

  if (total === 0) {
    return <p className="chart__empty">No data</p>;
  }

  let cumulative = 0;
  const segments = data.map((d, i) => {
    const fraction = d.value / total;
    const dash = fraction * CIRCUMFERENCE;
    const offset = -cumulative * CIRCUMFERENCE;
    cumulative += fraction;
    return { datum: d, dash, offset, color: colorFor(d, i), percent: fraction * 100 };
  });

  const hoveredSegment = segments.find((s) => s.datum.key === hovered) ?? null;

  return (
    <div className="chart chart--donut">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} width="100%" role="img" aria-label={ariaLabel}>
        <g role="list" transform={`rotate(-90 ${CENTER} ${CENTER})`}>
          {segments.map((s) => (
            <g
              key={s.datum.key}
              role="listitem"
              tabIndex={0}
              aria-label={`${s.datum.label}: ${valueFormat(s.datum.value)}`}
              className={onSelect ? 'chart__mark chart__mark--selectable' : 'chart__mark'}
              onMouseEnter={() => setHovered(s.datum.key)}
              onMouseLeave={() => setHovered(null)}
              onFocus={() => setHovered(s.datum.key)}
              onBlur={() => setHovered(null)}
              onClick={() => onSelect?.(s.datum.key)}
              onKeyDown={(e) => handleActivationKey(e, () => onSelect?.(s.datum.key))}
            >
              <circle
                cx={CENTER}
                cy={CENTER}
                r={RADIUS}
                fill="none"
                stroke={s.color}
                strokeWidth={STROKE_WIDTH}
                strokeDasharray={`${s.dash} ${CIRCUMFERENCE - s.dash}`}
                strokeDashoffset={s.offset}
              />
            </g>
          ))}
        </g>
      </svg>
      {hoveredSegment !== null && (
        <ChartTooltip xPercent={50} yPercent={50}>
          {hoveredSegment.datum.label}: {valueFormat(hoveredSegment.datum.value)}
        </ChartTooltip>
      )}
      <ul className="chart__legend">
        {segments.map((s) => (
          <li key={s.datum.key} className="chart__legend-item">
            <span className="chart__legend-swatch" style={{ background: s.color }} aria-hidden="true" />
            <span className="chart__legend-label">{s.datum.label}</span>
            <span className="chart__legend-value">
              {valueFormat(s.datum.value)} ({s.percent.toFixed(1)}%)
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
