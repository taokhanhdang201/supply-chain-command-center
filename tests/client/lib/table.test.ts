import { describe, it, expect } from 'vitest';
import { compareNullable, matchesSearch, paginate, sortRows } from '../../../src/client/lib/table';

describe('compareNullable', () => {
  it('sorts nulls last ascending', () => {
    expect(compareNullable(null, 1, 'asc')).toBe(1);
    expect(compareNullable(1, null, 'asc')).toBe(-1);
  });

  it('sorts nulls last descending too', () => {
    expect(compareNullable(null, 1, 'desc')).toBe(1);
    expect(compareNullable(1, null, 'desc')).toBe(-1);
  });

  it('treats two nulls as equal', () => {
    expect(compareNullable(null, null, 'asc')).toBe(0);
  });

  it('compares numbers numerically', () => {
    expect(compareNullable(2, 10, 'asc')).toBeLessThan(0);
    expect(compareNullable(2, 10, 'desc')).toBeGreaterThan(0);
  });

  it('compares strings with numeric-aware, case-insensitive collation', () => {
    expect(compareNullable('item2', 'item10', 'asc')).toBeLessThan(0);
    expect(compareNullable('Alpha', 'alpha', 'asc')).toBe(0);
  });
});

describe('sortRows', () => {
  it('returns a stable, sorted copy without mutating the input', () => {
    const input = [
      { id: 'a', v: 2 },
      { id: 'b', v: 1 },
      { id: 'c', v: 1 }
    ];
    const sorted = sortRows(input, (r) => r.v, 'asc');
    expect(sorted.map((r) => r.id)).toEqual(['b', 'c', 'a']);
    expect(input.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('keeps original order for equal values (stability)', () => {
    const input = [
      { id: 'a', v: 1 },
      { id: 'b', v: 1 },
      { id: 'c', v: 1 }
    ];
    expect(sortRows(input, (r) => r.v, 'desc').map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('matchesSearch', () => {
  it('returns true for an empty (or whitespace-only) query', () => {
    expect(matchesSearch(['Widget'], '')).toBe(true);
    expect(matchesSearch(['Widget'], '   ')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(matchesSearch(['Wireless Scanner'], 'SCANNER')).toBe(true);
  });

  it('requires every whitespace-separated term to appear in some haystack', () => {
    expect(matchesSearch(['Wireless Scanner', 'ELC-0001'], 'wireless elc')).toBe(true);
    expect(matchesSearch(['Wireless Scanner'], 'wireless missing')).toBe(false);
  });

  it('ignores null haystacks', () => {
    expect(matchesSearch([null, 'Scanner'], 'scanner')).toBe(true);
    expect(matchesSearch([null], 'anything')).toBe(false);
  });
});

describe('paginate', () => {
  const rows = Array.from({ length: 55 }, (_, i) => i + 1);

  it('returns the first page by default', () => {
    const result = paginate(rows, 1, 25);
    expect(result.rows).toEqual(rows.slice(0, 25));
    expect(result.start).toBe(1);
    expect(result.end).toBe(25);
    expect(result.pageCount).toBe(3);
    expect(result.total).toBe(55);
  });

  it('returns a partial last page with correct start/end', () => {
    const result = paginate(rows, 3, 25);
    expect(result.rows).toEqual(rows.slice(50, 55));
    expect(result.start).toBe(51);
    expect(result.end).toBe(55);
  });

  it('clamps a page number beyond range down to the last page', () => {
    const result = paginate(rows, 99, 25);
    expect(result.page).toBe(3);
  });

  it('clamps a page number below 1 up to 1', () => {
    const result = paginate(rows, 0, 25);
    expect(result.page).toBe(1);
  });

  it('handles an empty row set', () => {
    const result = paginate([], 1, 25);
    expect(result).toEqual({ rows: [], page: 1, pageCount: 1, total: 0, start: 0, end: 0 });
  });
});
