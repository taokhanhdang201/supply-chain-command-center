// A single-series line chart over ordered, labelled points (plan §8.5). A single point renders as a dot with no
// connecting path (a path needs at least two points).

import { useState } from 'react';
import { AXIS_FONT_SIZE, BASE_MARGIN, CHART_HEIGHT as HEIGHT, CHART_WIDTH as WIDTH } from './chartMetrics';
import { linearScale, niceTicks, planCategoryLabels, tickStride, widestLabel } from './scales';
import { ChartTooltip } from './ChartTooltip';

export interface LinePoint {
  /** Full label, used for the tooltip and aria-label (e.g. "Sep 2026 (MTD)"). */
  label: string;
  value: number;
  /** Short text shown on the x axis (e.g. "Sep*"); defaults to `label`. */
  axisLabel?: string;
}

export interface LineChartProps {
  points: LinePoint[];
  valueFormat: (n: number) => string;
  ariaLabel: string;
  /** Formatter for the value-axis tick labels; defaults to `valueFormat`. See `BarChart`'s `tickFormat` doc --
   * same idea: compact on the axis, full precision in tooltips/mark labels/data tables. */
  tickFormat?: (n: number) => string;
}

const PLOT_HEIGHT = HEIGHT - BASE_MARGIN.top - BASE_MARGIN.bottom;

/** A single-series line chart. Renders a lone dot (no path) when there is exactly one point. */
export function LineChart({ points, valueFormat, tickFormat, ariaLabel }: LineChartProps) {
  const formatTick = tickFormat ?? valueFormat;
  const [hovered, setHovered] = useState<number | null>(null);

  const maxValue = Math.max(0, ...points.map((p) => p.value));
  const ticks = niceTicks(maxValue);
  const tickLabels = ticks.map((t) => formatTick(t));
  // Numeric labels are never cut: the left margin grows to fit the widest one whole (BUG-8).
  const MARGIN = { ...BASE_MARGIN, left: Math.max(BASE_MARGIN.left, Math.ceil(widestLabel(tickLabels, AXIS_FONT_SIZE)) + 16) };
  const PLOT_WIDTH = WIDTH - MARGIN.left - MARGIN.right;
  const stride = tickStride(ticks.length > 1 ? PLOT_HEIGHT / (ticks.length - 1) : PLOT_HEIGHT, AXIS_FONT_SIZE, 2);
  const niceMax = ticks[ticks.length - 1] ?? 1;
  const domainMax = niceMax > 0 ? niceMax : 1;
  const valueScale = linearScale([0, domainMax], [PLOT_HEIGHT, 0]);

  const n = points.length;
  const marks = points.map((p, i) => {
    const x = MARGIN.left + (n > 1 ? (i / (n - 1)) * PLOT_WIDTH : PLOT_WIDTH / 2);
    const y = MARGIN.top + valueScale(p.value);
    return { point: p, x, y };
  });

  // Category labels: as much room as they can have before touching a neighbour (an edge label only clears half of
  // its neighbour), and two different labels never end up showing the same text (BUG-9).
  const axisTexts = points.map((p) => p.axisLabel ?? p.label);
  const spacing = n > 1 ? PLOT_WIDTH / (n - 1) : PLOT_WIDTH;
  const categoryLabels = planCategoryLabels(axisTexts, spacing, AXIS_FONT_SIZE);

  const pathD = marks.map((m, i) => `${i === 0 ? 'M' : 'L'}${m.x},${m.y}`).join(' ');
  const hoveredMark = hovered !== null ? (marks[hovered] ?? null) : null;

  return (
    <div className="chart chart--line">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width="100%" role="img" aria-label={ariaLabel}>
        <g aria-hidden="true">
          {ticks.map((t, i) => {
            const y = MARGIN.top + valueScale(t);
            return (
              <g key={`tick-${i}`}>
                <line
                  x1={MARGIN.left}
                  y1={y}
                  x2={MARGIN.left + PLOT_WIDTH}
                  y2={y}
                  stroke="var(--color-border-subtle)"
                />
                {i % stride === 0 && (
                  <text x={MARGIN.left - 8} y={y} textAnchor="end" dominantBaseline="middle" fontSize={AXIS_FONT_SIZE}>
                    {tickLabels[i]}
                  </text>
                )}
              </g>
            );
          })}
        </g>
        <line x1={MARGIN.left} y1={MARGIN.top + PLOT_HEIGHT} x2={MARGIN.left + PLOT_WIDTH} y2={MARGIN.top + PLOT_HEIGHT} stroke="var(--color-border)" />
        {n > 1 && <path d={pathD} fill="none" stroke="var(--chart-1)" strokeWidth={2} />}
        <g role="list">
          {marks.map((m, i) => (
            <g
              key={`${m.point.label}-${i}`}
              role="listitem"
              tabIndex={0}
              aria-label={`${m.point.label}: ${valueFormat(m.point.value)}`}
              className="chart__mark"
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
              onFocus={() => setHovered(i)}
              onBlur={() => setHovered(null)}
            >
              <circle cx={m.x} cy={m.y} r={4} fill="var(--chart-1)" />
            </g>
          ))}
        </g>
        {marks.map((m, i) => {
          const textAnchor = i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle';
          const shown = categoryLabels[i];
          if (shown === null || shown === undefined) return null;
          return (
            // `<title>` is a sibling, not a child, of `<text>` here: nesting it inside `<text>` would make the
            // full label part of the `<text>` element's own `textContent`, which is exactly what its rendered
            // width needs to exclude.
            <g key={`label-${i}`}>
              {shown.text !== m.point.label && <title>{m.point.label}</title>}
              <text x={m.x} y={MARGIN.top + PLOT_HEIGHT + 20} textAnchor={textAnchor} fontSize={AXIS_FONT_SIZE}>
                {shown.text}
              </text>
            </g>
          );
        })}
      </svg>
      {hoveredMark !== null && (
        <ChartTooltip xPercent={(hoveredMark.x / WIDTH) * 100} yPercent={(hoveredMark.y / HEIGHT) * 100}>
          {hoveredMark.point.label}: {valueFormat(hoveredMark.point.value)}
        </ChartTooltip>
      )}
    </div>
  );
}
