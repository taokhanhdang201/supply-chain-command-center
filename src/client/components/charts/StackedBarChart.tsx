// A stacked bar chart for a small number of series over shared categories (plan §8.5), e.g. on-time vs delayed
// shipments by month.

import { useState } from 'react';
import { AXIS_FONT_SIZE, BASE_MARGIN, CHART_HEIGHT as HEIGHT, CHART_WIDTH as WIDTH } from './chartMetrics';
import { linearScale, niceTicks, planCategoryLabels, tickStride, widestLabel } from './scales';
import { ChartTooltip } from './ChartTooltip';

export type ChartTone = 'good' | 'warning' | 'critical' | 'info' | 'neutral' | 'muted';

export interface StackedSeries {
  name: string;
  values: number[];
  tone: ChartTone;
}

export interface StackedBarChartProps {
  categories: string[];
  /** Short text shown on the x axis, one per category (e.g. "Apr"); defaults to `categories`. */
  axisLabels?: string[];
  series: StackedSeries[];
  valueFormat: (n: number) => string;
  ariaLabel: string;
  /** Formatter for the value-axis tick labels; defaults to `valueFormat`. See `BarChart`'s `tickFormat` doc --
   * same idea: compact on the axis, full precision in tooltips/mark labels/data tables. */
  tickFormat?: (n: number) => string;
}

const PLOT_HEIGHT = HEIGHT - BASE_MARGIN.top - BASE_MARGIN.bottom;

/** A stacked bar chart: one bar per category, segmented by series. */
export function StackedBarChart({ categories, axisLabels, series, valueFormat, tickFormat, ariaLabel }: StackedBarChartProps) {
  const formatTick = tickFormat ?? valueFormat;
  const [hovered, setHovered] = useState<string | null>(null);

  const totals = categories.map((_, i) => series.reduce((sum, s) => sum + (s.values[i] ?? 0), 0));
  const maxTotal = Math.max(0, ...totals);
  const ticks = niceTicks(maxTotal);
  const tickLabels = ticks.map((t) => formatTick(t));
  // Numeric labels are never cut: the left margin grows to fit the widest one whole (BUG-8).
  const MARGIN = { ...BASE_MARGIN, left: Math.max(BASE_MARGIN.left, Math.ceil(widestLabel(tickLabels, AXIS_FONT_SIZE)) + 16) };
  const PLOT_WIDTH = WIDTH - MARGIN.left - MARGIN.right;
  const stride = tickStride(ticks.length > 1 ? PLOT_HEIGHT / (ticks.length - 1) : PLOT_HEIGHT, AXIS_FONT_SIZE, 2);
  const niceMax = ticks[ticks.length - 1] ?? 1;
  const valueScale = linearScale([0, niceMax > 0 ? niceMax : 1], [0, PLOT_HEIGHT]);

  const n = categories.length;
  const bandWidth = n > 0 ? PLOT_WIDTH / n : PLOT_WIDTH;
  const barWidth = Math.min(48, bandWidth * 0.6);

  interface Segment {
    key: string;
    label: string;
    value: number;
    tone: ChartTone;
    x: number;
    y: number;
    w: number;
    h: number;
  }

  const segments: Segment[] = [];
  categories.forEach((category, i) => {
    let cumulative = 0;
    series.forEach((s) => {
      const value = s.values[i] ?? 0;
      const y = PLOT_HEIGHT - valueScale(cumulative + value);
      const h = valueScale(value);
      segments.push({
        key: `${category}:${s.name}`,
        label: `${s.name}, ${category}`,
        value,
        tone: s.tone,
        x: MARGIN.left + i * bandWidth + (bandWidth - barWidth) / 2,
        y: MARGIN.top + y,
        w: barWidth,
        h: Math.max(0, h)
      });
      cumulative += value;
    });
  });

  // Category centers are `bandWidth` apart, so that is the spacing labels budget against (see LineChart.tsx).
  const axisTexts = categories.map((c, i) => axisLabels?.[i] ?? c);
  const categoryLabels = planCategoryLabels(axisTexts, bandWidth, AXIS_FONT_SIZE);

  const hoveredSegment = segments.find((s) => s.key === hovered) ?? null;

  return (
    <div className="chart chart--stacked-bar">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width="100%" role="img" aria-label={ariaLabel}>
        <g aria-hidden="true">
          {ticks.map((t, i) => {
            const y = MARGIN.top + PLOT_HEIGHT - valueScale(t);
            return (
              <g key={`tick-${i}`}>
                <line x1={MARGIN.left} y1={y} x2={MARGIN.left + PLOT_WIDTH} y2={y} stroke="var(--color-border-subtle)" />
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
        <g role="list">
          {segments.map((s) => (
            <g
              key={s.key}
              role="listitem"
              tabIndex={0}
              aria-label={`${s.label}: ${valueFormat(s.value)}`}
              className="chart__mark"
              onMouseEnter={() => setHovered(s.key)}
              onMouseLeave={() => setHovered(null)}
              onFocus={() => setHovered(s.key)}
              onBlur={() => setHovered(null)}
            >
              <rect x={s.x} y={s.y} width={s.w} height={s.h} fill={`var(--${s.tone})`} />
            </g>
          ))}
        </g>
        {categories.map((category, i) => {
          const textAnchor = i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle';
          const labelX = MARGIN.left + i * bandWidth + bandWidth / 2;
          const shown = categoryLabels[i];
          if (shown === null || shown === undefined) return null;
          return (
            // `<title>` is a sibling, not a child, of `<text>` here -- see LineChart.tsx for why.
            <g key={category}>
              {shown.text !== category && <title>{category}</title>}
              <text x={labelX} y={MARGIN.top + PLOT_HEIGHT + 20} textAnchor={textAnchor} fontSize={AXIS_FONT_SIZE}>
                {shown.text}
              </text>
            </g>
          );
        })}
      </svg>
      {hoveredSegment !== null && (
        <ChartTooltip xPercent={((hoveredSegment.x + hoveredSegment.w / 2) / WIDTH) * 100} yPercent={(hoveredSegment.y / HEIGHT) * 100}>
          {hoveredSegment.label}: {valueFormat(hoveredSegment.value)}
        </ChartTooltip>
      )}
    </div>
  );
}
