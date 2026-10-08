import { PAGE_SIZE_OPTIONS } from '../../../shared/constants';
import { Button } from './Button';
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

/** A "Pagination" nav: Previous/Next (36px, level with the page-size select), the page-size select, and a live
 *  "Showing X-Y of N" summary on the same row. */
export function Pagination({ page, pageCount, pageSize, total, start, end, onPageChange, onPageSizeChange }: PaginationProps) {
  const summary = total === 0 ? 'Showing 0 of 0' : `Showing ${start}–${end} of ${total}`;

  return (
    <nav className="pagination" aria-label="Pagination">
      <div className="pagination__nav">
        <Button onClick={() => onPageChange(page - 1)} disabled={page <= 1}>
          Previous
        </Button>
        <span className="pagination__page">
          Page {page} of {pageCount}
        </span>
        <Button onClick={() => onPageChange(page + 1)} disabled={page >= pageCount}>
          Next
        </Button>
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
    </nav>
  );
}
