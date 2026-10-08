// Wraps every chart in a Card with a title, an optional "Show data table" toggle that renders an accessible
// `<table>` fallback of the same data, and a shared empty state (plan §8.5).

import { useState } from 'react';
import type { ReactNode } from 'react';
import { Card } from '../ui/Card';

/** The data behind a chart, for its "Show data table" view. The first column names the row (a month, a warehouse, a
 * route); every other column holds a number and is right-aligned. */
export interface ChartTable {
  columns: string[];
  rows: Array<Array<string | number>>;
}

export interface ChartFrameProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  /** Controls that shape the chart (e.g. a "Sort by" select), shown under the title so the title keeps its line. */
  controls?: ReactNode;
  isEmpty: boolean;
  /** Optional small note shown under the chart (e.g. what a "*" on an axis label means). */
  note?: string | null;
  table: ChartTable;
  children: ReactNode;
  /** Extra class name for the surrounding Card (page layout hooks). */
  className?: string;
}

/** A Card frame around a chart: title, optional actions, a data-table toggle, and a shared empty state. */
export function ChartFrame({ title, subtitle, actions, controls, isEmpty, note, table, children, className }: ChartFrameProps) {
  const [showTable, setShowTable] = useState(false);

  const toggle = !isEmpty && (
    <button type="button" className="button button--ghost button--sm" aria-pressed={showTable} onClick={() => setShowTable((v) => !v)}>
      {showTable ? 'Hide data table' : 'Show data table'}
    </button>
  );

  return (
    <Card
      className={className}
      title={title}
      subtitle={subtitle}
      actions={
        actions !== undefined || toggle ? (
          <>
            {actions}
            {toggle}
          </>
        ) : undefined
      }
    >
      {controls !== undefined && <div className="chart-frame__controls">{controls}</div>}
      {isEmpty ? (
        <p className="chart-frame__empty">No data for the selected range</p>
      ) : showTable ? (
        <div className="table-scroll">
          <table className="data-table">
            <caption className="visually-hidden">{title} data</caption>
            <thead>
              <tr>
                {table.columns.map((column, j) => (
                  <th key={column} scope="col" className={j > 0 ? 'data-table__header--right' : undefined}>
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td key={j} className={j > 0 ? 'data-table__cell--right' : undefined}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="chart-frame__chart">
          {children}
          {note ? <p className="chart-frame__note">{note}</p> : null}
        </div>
      )}
    </Card>
  );
}
