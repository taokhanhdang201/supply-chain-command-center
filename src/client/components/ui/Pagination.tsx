import { PAGE_SIZE_OPTIONS } from '../../../shared/constants';
import { SelectField } from './SelectField';

export interface PaginationProps {
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
  start: number;
  end: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}

/** Previous/Next page controls, a page-size select, and a live "Showing X-Y of N" summary. */
export function Pagination({ page, pageCount, pageSize, total, start, end, onPageChange, onPageSizeChange }: PaginationProps) {
  const summary = total === 0 ? 'Showing 0 of 0' : `Showing ${start}–${end} of ${total}`;

  return (
    <div className="pagination">
      <div className="pagination__nav">
        <button type="button" className="button button--sm" onClick={() => onPageChange(page - 1)} disabled={page <= 1}>
          Previous
        </button>
        <span className="pagination__page">
          Page {page} of {pageCount}
        </span>
        <button type="button" className="button button--sm" onClick={() => onPageChange(page + 1)} disabled={page >= pageCount}>
          Next
        </button>
      </div>
      <SelectField
        label="Rows per page"
        value={String(pageSize)}
        options={PAGE_SIZE_OPTIONS.map((n) => ({ value: String(n), label: String(n) }))}
        onChange={(value) => onPageSizeChange(Number(value))}
      />
      <p className="pagination__summary" aria-live="polite">
        {summary}
      </p>
    </div>
  );
}
