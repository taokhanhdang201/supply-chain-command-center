// A single-series bar chart, vertical or horizontal (plan §8.5). Pure SVG, `viewBox`-driven, no DOM measuring.

import { useState } from 'react';
import type { KeyboardEvent } from 'react';
import { AXIS_FONT_SIZE, BASE_MARGIN, CHART_HEIGHT as HEIGHT, CHART_WIDTH as WIDTH } from './chartMetrics';
import { labelWidth, linearScale, niceTicks, placeTickLabels, tickStride, uniqueAxisLabels, widestLabel } from './scales';
import { ChartTooltip } from './ChartTooltip';

export interface BarDatum {
  key: string;
  label: string;
  value: number;
  /** Compact axis text (e.g. "DFW → BNA" for a route); `label` stays the full name for tooltips, aria and tables. */
  shortLabel?: string;
}

export interface BarChartProps {
  data: BarDatum[];
  orientation: 'vertical' | 'horizontal';
  valueFormat: (n: number) => string;
  ariaLabel: string;
  onSelect?: (key: string) => void;
  /** Formatter for the value-axis tick labels; defaults to `valueFormat`. Callers should pass a compact
   * formatter here (e.g. `formatCentsAxis`) while keeping `valueFormat` at full precision for marks, tooltips and
   * data tables. Tick labels are never truncated: the margin grows to fit them and ticks are thinned (every
   * n-th labelled) when they would otherwise touch (BUG-7/BUG-8). */
  tickFormat?: (n: number) => string;
}

/** Vertical bars: value axis (short, formatted numbers) sits on the left, category labels along the bottom. */
const MARGIN_VERTICAL = BASE_MARGIN;
/** Horizontal bars: category labels (route codes, names) sit on the left, value axis along the bottom. */
const MARGIN_HORIZONTAL = { ...BASE_MARGIN, left: 120 };
/** Upper bound for the category-label margin of horizontal bars (keeps the plot area usable). */
const MAX_LEFT_MARGIN_HORIZONTAL = 200;

function handleActivationKey(e: KeyboardEvent<SVGGElement>, run: () => void): void {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    run();
  }
}

/** A single-series bar chart. Bars are keyboard-focusable list items with a hover/focus tooltip. */
export function BarChart({ data, orientation, valueFormat, tickFormat, ariaLabel, onSelect }: BarChartProps) {
  const formatTick = tickFormat ?? valueFormat;
  const [hovered, setHovered] = useState<string | null>(null);
  const maxValue = Math.max(0, ...data.map((d) => d.value));
  const ticks = niceTicks(maxValue);
  const niceMax = ticks[ticks.length - 1] ?? 1;
  const domainMax = niceMax > 0 ? niceMax : 1;
  const n = data.length;

  const isVertical = orientation === 'vertical';
  const tickLabels = ticks.map((t) => formatTick(t));
  const widestTick = widestLabel(tickLabels, AXIS_FONT_SIZE);
  // Numeric labels are never cut: the value-axis side grows to fit the widest label whole.
  // Horizontal bars: grow the category-label side to fit the widest label whole, up to a cap (longer ones still
  // truncate; the full text stays in the tooltip, aria-label and data table).
  const widestCategory = widestLabel(data.map((d) => d.shortLabel ?? d.label), AXIS_FONT_SIZE);
  const horizontalLeftMargin = Math.min(MAX_LEFT_MARGIN_HORIZONTAL, Math.max(MARGIN_HORIZONTAL.left, Math.ceil(widestCategory) + 24));
  const MARGIN: { top: number; right: number; bottom: number; left: number } = isVertical
    ? { ...MARGIN_VERTICAL, left: Math.max(MARGIN_VERTICAL.left, Math.ceil(widestTick) + 16) }
    : { ...MARGIN_HORIZONTAL, left: horizontalLeftMargin, right: Math.max(MARGIN_HORIZONTAL.right, Math.ceil(widestTick / 2) + 8) };
  const PLOT_WIDTH = WIDTH - MARGIN.left - MARGIN.right;
  // Horizontal value axis: centered labels are placed greedily over up to 3 rows (the bottom margin grows to fit
  // the rows used) and only if a label fits in none of them is it left out. Numeric labels are never cut.
  const MAX_TICK_ROWS = 3;
  const horizontalTickX = ticks.map((t) => MARGIN.left + linearScale([0, domainMax], [0, PLOT_WIDTH])(t));
  const tickRowOf: Array<number | null> = isVertical
    ? []
    : placeTickLabels(horizontalTickX, tickLabels.map((l) => labelWidth(l, AXIS_FONT_SIZE)), MAX_TICK_ROWS);
  const rowsUsed = Math.max(1, ...tickRowOf.map((r) => (r === null ? 0 : r + 1)));
  MARGIN.bottom = BASE_MARGIN.bottom + (rowsUsed - 1) * 16;
  const PLOT_HEIGHT = HEIGHT - MARGIN.top - MARGIN.bottom;
  const valueScale = linearScale(
    [0, domainMax],
    isVertical ? [PLOT_HEIGHT, 0] : [0, PLOT_WIDTH]
  );
  const bandSize = n > 0 ? (isVertical ? PLOT_WIDTH : PLOT_HEIGHT) / n : isVertical ? PLOT_WIDTH : PLOT_HEIGHT;
  const barThickness = Math.min(44, bandSize * 0.6);

  const marks = data.map((d, i) => {
    if (isVertical) {
      const barHeight = PLOT_HEIGHT - valueScale(d.value);
      const x = i * bandSize + (bandSize - barThickness) / 2;
      const y = valueScale(d.value);
      return { datum: d, x: MARGIN.left + x, y: MARGIN.top + y, w: barThickness, h: Math.max(0, barHeight), labelX: MARGIN.left + i * bandSize + bandSize / 2, labelY: MARGIN.top + PLOT_HEIGHT + 16 };
    }
    const barWidth = valueScale(d.value);
    const y = i * bandSize + (bandSize - barThickness) / 2;
    return { datum: d, x: MARGIN.left, y: MARGIN.top + y, w: barWidth, h: barThickness, labelX: MARGIN.left - 8, labelY: MARGIN.top + i * bandSize + bandSize / 2 };
  });

  const hoveredMark = marks.find((m) => m.datum.key === hovered) ?? null;

  const categoryMaxWidth = isVertical ? bandSize - 4 : MARGIN.left - 16;
  const categoryLabels = uniqueAxisLabels(data.map((d) => d.shortLabel ?? d.label), categoryMaxWidth, AXIS_FONT_SIZE);
  // Vertical value axis: ticks stack down the side, so thin them by row height (label width is handled by the
  // margin growing to fit the widest label).
  const tickSpacing = ticks.length > 1 ? Math.abs(valueScale(ticks[1] as number) - valueScale(ticks[0] as number)) : PLOT_HEIGHT;
  const stride = isVertical ? tickStride(tickSpacing, AXIS_FONT_SIZE, 2) : 1;

  return (
    <div className="chart chart--bar">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width="100%" role="img" aria-label={ariaLabel}>
        <g aria-hidden="true">
          {ticks.map((t, i) => {
            const text = isVertical ? (i % stride === 0 ? tickLabels[i] : null) : tickRowOf[i] === null ? null : tickLabels[i];
            if (isVertical) {
              const y = MARGIN.top + valueScale(t);
              return (
                <g key={`tick-${i}`}>
                  <line x1={MARGIN.left} y1={y} x2={MARGIN.left + PLOT_WIDTH} y2={y} stroke="var(--color-border-subtle)" />
                  {text !== null && (
                    <text x={MARGIN.left - 8} y={y} textAnchor="end" dominantBaseline="middle" fontSize={AXIS_FONT_SIZE}>
                      {text}
                    </text>
                  )}
                </g>
              );
            }
            const x = MARGIN.left + valueScale(t);
            return (
              <g key={`tick-${i}`}>
                <line x1={x} y1={MARGIN.top} x2={x} y2={MARGIN.top + PLOT_HEIGHT} stroke="var(--color-border-subtle)" />
                {text !== null && (
                  <text x={x} y={MARGIN.top + PLOT_HEIGHT + 20 + ((tickRowOf[i] ?? 0) * 16)} textAnchor="middle" fontSize={AXIS_FONT_SIZE}>
                    {text}
                  </text>
                )}
              </g>
            );
          })}
        </g>
        {isVertical ? (
          <line x1={MARGIN.left} y1={MARGIN.top + PLOT_HEIGHT} x2={MARGIN.left + PLOT_WIDTH} y2={MARGIN.top + PLOT_HEIGHT} stroke="var(--color-border)" />
        ) : (
          <line x1={MARGIN.left} y1={MARGIN.top} x2={MARGIN.left} y2={MARGIN.top + PLOT_HEIGHT} stroke="var(--color-border)" />
        )}
        <g role="list">
          {marks.map((m, i) => {
            const label = `${m.datum.label}: ${valueFormat(m.datum.value)}`;
            const displayLabel = (categoryLabels[i] as { text: string }).text;
            return (
              <g
                key={m.datum.key}
                role="listitem"
                tabIndex={0}
                aria-label={label}
                className={onSelect ? 'chart__mark chart__mark--selectable' : 'chart__mark'}
                onMouseEnter={() => setHovered(m.datum.key)}
                onMouseLeave={() => setHovered(null)}
                onFocus={() => setHovered(m.datum.key)}
                onBlur={() => setHovered(null)}
                onClick={() => onSelect?.(m.datum.key)}
                onKeyDown={(e) => handleActivationKey(e, () => onSelect?.(m.datum.key))}
              >
                <rect x={m.x} y={m.y} width={m.w} height={m.h} fill="var(--chart-1)" />
                {displayLabel !== m.datum.label && <title>{m.datum.label}</title>}
                {isVertical ? (
                  <text x={m.labelX} y={m.labelY} textAnchor="middle" fontSize={AXIS_FONT_SIZE}>
                    {displayLabel}
                  </text>
                ) : (
                  <text x={m.labelX} y={m.labelY} textAnchor="end" dominantBaseline="middle" fontSize={AXIS_FONT_SIZE}>
                    {displayLabel}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>
      {hoveredMark !== null && (
        <ChartTooltip xPercent={((hoveredMark.x + hoveredMark.w / 2) / WIDTH) * 100} yPercent={(hoveredMark.y / HEIGHT) * 100}>
          {hoveredMark.datum.label}: {valueFormat(hoveredMark.datum.value)}
        </ChartTooltip>
      )}
    </div>
  );
}
