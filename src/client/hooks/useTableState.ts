// React state for a data table's sort/page/pageSize (plan §8.4). Changing sort or page size resets to page 1;
// pages call `resetPage()` themselves whenever search/filters change.

import { useCallback, useState } from 'react';
import type { SortState } from '../lib/table';
import { DEFAULT_PAGE_SIZE } from '../../shared/constants';

export interface UseTableStateResult {
  sort: SortState;
  setSort: (s: SortState) => void;
  page: number;
  setPage: (p: number) => void;
  pageSize: number;
  setPageSize: (n: number) => void;
  resetPage: () => void;
}

export interface UseTableStateOptions {
  sort: SortState;
  pageSize?: number;
}

/** Manages a table's sort, page, and page-size state. */
export function useTableState(initial: UseTableStateOptions): UseTableStateResult {
  const [sort, setSortState] = useState<SortState>(initial.sort);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeState] = useState(initial.pageSize ?? DEFAULT_PAGE_SIZE);

  const setSort = useCallback((s: SortState): void => {
    setSortState(s);
    setPage(1);
  }, []);

  const setPageSize = useCallback((n: number): void => {
    setPageSizeState(n);
    setPage(1);
  }, []);

  const resetPage = useCallback((): void => {
    setPage(1);
  }, []);

  return { sort, setSort, page, setPage, pageSize, setPageSize, resetPage };
}
