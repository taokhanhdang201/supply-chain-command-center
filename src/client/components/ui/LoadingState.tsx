export interface LoadingStateProps {
  kpiCount?: number;
  rowCount?: number;
}

/** A skeleton shown while the initial snapshot loads: skeleton KPI cards + skeleton rows. */
export function LoadingState({ kpiCount = 4, rowCount = 6 }: LoadingStateProps) {
  return (
    <div className="loading-state" role="status" aria-busy="true">
      <span className="visually-hidden">Loading data…</span>
      <div className="loading-state__kpis" aria-hidden="true">
        {Array.from({ length: kpiCount }, (_, i) => (
          <div key={i} className="loading-state__kpi skeleton" />
        ))}
      </div>
      <div className="loading-state__rows" aria-hidden="true">
        {Array.from({ length: rowCount }, (_, i) => (
          <div key={i} className="loading-state__row skeleton" />
        ))}
      </div>
    </div>
  );
}
