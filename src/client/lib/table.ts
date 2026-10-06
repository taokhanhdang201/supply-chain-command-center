// Pure client-side table helpers (plan §8.4): sorting, search matching, and pagination over server-derived rows.
// The dataset is capped at 20,000 rows per type, so doing this client-side is cheap.

export type SortDirection = 'asc' | 'desc';

export interface SortState {
  key: string;
  direction: SortDirection;
}

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/** Compares two nullable sort values; nulls always sort last regardless of direction. */
export function compareNullable(a: string | number | null, b: string | number | null, dir: SortDirection): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  let cmp: number;
  if (typeof a === 'number' && typeof b === 'number') {
    cmp = a - b;
  } else {
    cmp = collator.compare(String(a), String(b));
  }
  return dir === 'asc' ? cmp : -cmp;
}

/** Returns a new, stably sorted copy of `rows` by the value `getValue` extracts. */
export function sortRows<T>(rows: readonly T[], getValue: (r: T) => string | number | null, dir: SortDirection): T[] {
  return rows
    .map((row, index) => ({ row, index, value: getValue(row) }))
    .sort((a, b) => {
      const cmp = compareNullable(a.value, b.value, dir);
      return cmp !== 0 ? cmp : a.index - b.index;
    })
    .map((entry) => entry.row);
}

/** True when every whitespace-separated term in `query` appears (case-insensitively) in some haystack. */
export function matchesSearch(haystacks: ReadonlyArray<string | null>, query: string): boolean {
  const trimmed = query.trim();
  if (trimmed === '') return true;
  const terms = trimmed.toLowerCase().split(/\s+/);
  const lowerHaystacks = haystacks.filter((h): h is string => h !== null).map((h) => h.toLowerCase());
  return terms.every((term) => lowerHaystacks.some((h) => h.includes(term)));
}

export interface PaginatedResult<T> {
  rows: T[];
  page: number;
  pageCount: number;
  total: number;
  start: number;
  end: number;
}

/** Paginates `rows`, clamping `page` into `[1, max(1, pageCount)]`. `start`/`end` are 1-based, both 0 when empty. */
export function paginate<T>(rows: readonly T[], page: number, pageSize: number): PaginatedResult<T> {
  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const clampedPage = Math.min(Math.max(1, page), pageCount);
  if (total === 0) {
    return { rows: [], page: clampedPage, pageCount, total, start: 0, end: 0 };
  }
  const startIndex = (clampedPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, total);
  return {
    rows: rows.slice(startIndex, endIndex),
    page: clampedPage,
    pageCount,
    total,
    start: startIndex + 1,
    end: endIndex
  };
}
