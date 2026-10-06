// Reference test file `tests/client/components/DataTable.test.tsx` covers this component (plan §8.3).

import type { ReactNode } from 'react';
import type { SortDirection, SortState } from '../../lib/table';
import { Icon } from './Icon';

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  sortable?: boolean;
  align?: 'left' | 'right';
  /** Lets this column's cell text wrap instead of the table's default `white-space: nowrap`, for columns that
   * can hold long free-text messages (R-8). */
  wrap?: boolean;
  /** Renders this column's cells in a heavier weight (the row's key figure). Header unaffected. */
  emphasis?: boolean;
  /** With `stackOnPhone`: a short visible label shown before the value when rows stack on phones (e.g. "ETA").
   * Hidden from assistive tech: the column header already names the cell. */
  phoneLabel?: string;
}

export interface DataTableProps<T> {
  caption: string;
  columns: Column<T>[];
  rows: T[];
  rowKey: (r: T) => string;
  sort?: SortState;
  onSortChange?: (s: SortState) => void;
  emptyState?: ReactNode;
  /** Optional extra class name per data row (not applied to the empty-state row). */
  rowClassName?: (row: T) => string | undefined;
  /** On phones each row becomes a stacked record instead of a sideways-scrolling table. The table, row groups, rows,
   * column headers and cells then carry explicit ARIA roles, because CSS grid/block display can drop the native
   * table semantics in some browsers. Each cell also gets a `data-table__col--{key}` class for page layouts. */
  stackOnPhone?: boolean;
}

function ariaSortFor(column: string, sort: SortState | undefined): 'ascending' | 'descending' | 'none' {
  if (!sort || sort.key !== column) return 'none';
  return sort.direction === 'asc' ? 'ascending' : 'descending';
}

/** A sortable, accessible data table over server-derived rows. */
export function DataTable<T>({ caption, columns, rows, rowKey, sort, onSortChange, emptyState, rowClassName, stackOnPhone = false }: DataTableProps<T>) {
  // Explicit roles only for the stacking variant; the plain table keeps its native semantics untouched.
  const role = (r: 'table' | 'rowgroup' | 'row' | 'columnheader' | 'cell') => (stackOnPhone ? r : undefined);
  function handleSortClick(column: Column<T>): void {
    if (!onSortChange) return;
    if (sort && sort.key === column.key) {
      const nextDirection: SortDirection = sort.direction === 'asc' ? 'desc' : 'asc';
      onSortChange({ key: column.key, direction: nextDirection });
    } else {
      onSortChange({ key: column.key, direction: 'asc' });
    }
  }

  return (
    <div className="table-scroll">
      <table className={stackOnPhone ? 'data-table data-table--stack' : 'data-table'} role={role('table')}>
        <caption className="visually-hidden">{caption}</caption>
        <thead role={role('rowgroup')}>
          <tr role={role('row')}>
            {columns.map((column) => {
              const alignClass = column.align === 'right' ? 'data-table__header--right' : '';
              const wrapClass = column.wrap ? 'data-table__cell--wrap' : '';
              const colClass = stackOnPhone ? `data-table__col--${column.key}` : '';
              const className = [alignClass, wrapClass, colClass].filter(Boolean).join(' ') || undefined;
              if (!column.sortable) {
                return (
                  <th key={column.key} className={className} scope="col" role={role('columnheader')}>
                    {column.header}
                  </th>
                );
              }
              const ariaSort = ariaSortFor(column.key, sort);
              return (
                <th key={column.key} className={className} scope="col" aria-sort={ariaSort} role={role('columnheader')}>
                  <button type="button" className="data-table__sort-button" onClick={() => handleSortClick(column)}>
                    {column.header}
                    <Icon name={ariaSort === 'ascending' ? 'chevron-up' : ariaSort === 'descending' ? 'chevron-down' : 'sort'} size={14} />
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody role={role('rowgroup')}>
          {rows.length === 0 ? (
            <tr role={role('row')}>
              <td colSpan={columns.length} role={role('cell')}>
                {emptyState}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={rowKey(row)} className={rowClassName?.(row)} role={role('row')}>
                {columns.map((column) => {
                  const alignClass = column.align === 'right' ? 'data-table__cell--right' : '';
                  const wrapClass = column.wrap ? 'data-table__cell--wrap' : '';
                  const strongClass = column.emphasis ? 'data-table__cell--strong' : '';
                  const colClass = stackOnPhone ? `data-table__col--${column.key}` : '';
                  const className = [alignClass, wrapClass, strongClass, colClass].filter(Boolean).join(' ') || undefined;
                  return (
                    <td key={column.key} className={className} role={role('cell')}>
                      {stackOnPhone && column.phoneLabel !== undefined && (
                        <span className="data-table__phone-label" aria-hidden="true">
                          {column.phoneLabel}
                        </span>
                      )}
                      {column.render(row)}
                    </td>
                  );
                })}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
