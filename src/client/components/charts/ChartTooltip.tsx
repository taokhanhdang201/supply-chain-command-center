import type { ReactNode } from 'react';

export interface ChartTooltipProps {
  xPercent: number;
  yPercent: number;
  children: ReactNode;
}

/** A tooltip positioned by percentage of the chart's viewBox, inside a `position: relative` wrapper. */
export function ChartTooltip({ xPercent, yPercent, children }: ChartTooltipProps) {
  return (
    <div
      className="chart-tooltip"
      role="tooltip"
      style={{ left: `${xPercent}%`, top: `${yPercent}%` }}
    >
      {children}
    </div>
  );
}
