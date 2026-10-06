// Shared CSV-import machinery: header normalization/mapping and final issue-list shaping. Header text is mapped
// through a `Map`, never used as a plain-object key, so a header can never trigger prototype pollution.

import type { CsvRecord } from './parseCsv';
import type { ColumnSpec } from './schemas';
import type { ImportIssue } from '../types';
import { MAX_ERRORS_RETURNED } from '../constants';
import { truncateForMessage } from '../format';

/** Normalizes a header cell: trim, lowercase, collapse whitespace/hyphens to underscores. */
export function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

export interface MapHeaderResult {
  ok: true;
  index: Map<string, number>;
  warnings: string[];
}

export type MapHeaderFailure = { ok: false; issues: ImportIssue[] };

/** Position i → canonical field name to read column i as, or null = ignore column i. Length must equal the header's field count. */
export type ColumnMap = readonly (string | null)[];

/**
 * Maps normalized header names to their column index, validating required/duplicate/unknown columns.
 * With a `columnMap` (V1.5, user-confirmed) the header names are not consulted: the map alone decides which column
 * feeds which canonical field. It is re-validated here in full, because the server never trusts the client's map.
 */
export function mapHeader(header: CsvRecord, columns: readonly ColumnSpec[], columnMap?: ColumnMap): MapHeaderResult | MapHeaderFailure {
  if (columnMap !== undefined) return mapHeaderWithColumnMap(header, columns, columnMap);
  const index = new Map<string, number>();
  const duplicateIssues: ImportIssue[] = [];
  const foundNames: string[] = [];

  header.fields.forEach((raw, i) => {
    const name = normalizeHeader(raw);
    foundNames.push(name);
    if (index.has(name)) {
      duplicateIssues.push({ line: 1, column: null, code: 'DUPLICATE_COLUMNS', message: `Column "${name}" appears more than once.` });
      return;
    }
    index.set(name, i);
  });

  if (duplicateIssues.length > 0) {
    return { ok: false, issues: duplicateIssues };
  }

  const required = columns.filter((c) => c.requiredColumn).map((c) => c.name);
  const missing = required.filter((name) => !index.has(name));
  if (missing.length > 0) {
    return {
      ok: false,
      issues: [
        {
          line: 1,
          column: null,
          code: 'MISSING_COLUMNS',
          message: `Missing required column(s): ${missing.join(', ')}. Found columns: ${foundNames.join(', ') || '(none)'}.`
        }
      ]
    };
  }

  const knownNames = new Set(columns.map((c) => c.name));
  const unknown = foundNames.filter((name) => !knownNames.has(name));
  const warnings: string[] = [];
  if (unknown.length > 0) {
    warnings.push(`Ignored unknown column(s): ${unknown.join(', ')}.`);
  }

  return { ok: true, index, warnings };
}

function mapHeaderWithColumnMap(header: CsvRecord, columns: readonly ColumnSpec[], columnMap: ColumnMap): MapHeaderResult | MapHeaderFailure {
  const invalid = (message: string): ImportIssue => ({ line: 1, column: null, code: 'INVALID_MAPPING', message });

  if (columnMap.length !== header.fields.length) {
    return {
      ok: false,
      issues: [invalid(`The column mapping lists ${columnMap.length} column(s) but the file header has ${header.fields.length}.`)]
    };
  }

  const knownNames = new Set(columns.map((c) => c.name));
  const unknownIssues: ImportIssue[] = [];
  for (const entry of columnMap) {
    if (entry !== null && !knownNames.has(entry)) {
      unknownIssues.push(invalid(`The column mapping uses unknown field "${truncateForMessage(entry)}".`));
    }
  }
  if (unknownIssues.length > 0) return { ok: false, issues: unknownIssues };

  const index = new Map<string, number>();
  const counts = new Map<string, number>();
  columnMap.forEach((entry, i) => {
    if (entry === null) return;
    counts.set(entry, (counts.get(entry) ?? 0) + 1);
    if (!index.has(entry)) index.set(entry, i);
  });

  const duplicateIssues: ImportIssue[] = columns
    .filter((c) => (counts.get(c.name) ?? 0) > 1)
    .map((c) => ({ line: 1, column: null, code: 'DUPLICATE_COLUMNS' as const, message: `Field "${c.name}" is mapped from more than one column.` }));
  if (duplicateIssues.length > 0) return { ok: false, issues: duplicateIssues };

  const missing = columns.filter((c) => c.requiredColumn && !index.has(c.name)).map((c) => c.name);
  if (missing.length > 0) {
    const mappedInFileOrder = columnMap.filter((e): e is string => e !== null);
    return {
      ok: false,
      issues: [
        {
          line: 1,
          column: null,
          code: 'MISSING_COLUMNS',
          message: `Missing required column(s): ${missing.join(', ')}. Mapped columns: ${mappedInFileOrder.join(', ') || '(none)'}.`
        }
      ]
    };
  }

  const ignored = header.fields.filter((_, i) => columnMap[i] === null).map((raw) => truncateForMessage(normalizeHeader(raw)));
  const warnings: string[] = [];
  if (ignored.length > 0) {
    warnings.push(`Ignored unmapped column(s): ${ignored.join(', ')}.`);
  }
  return { ok: true, index, warnings };
}

export interface ImportLimits {
  maxRows: number;
  maxColumns: number;
}

export type ImportResult<T> =
  | { ok: true; rows: T[]; warnings: string[] }
  | { ok: false; errors: ImportIssue[]; totalErrors: number; warnings: string[] };

/** Sorts issues by line then column-schema order, and caps the returned list at MAX_ERRORS_RETURNED. */
export function finalizeIssues(issues: ImportIssue[], columnOrder: readonly string[]): { errors: ImportIssue[]; totalErrors: number } {
  const orderOf = (column: string | null): number => {
    if (column === null) return -1;
    const idx = columnOrder.indexOf(column);
    return idx === -1 ? columnOrder.length : idx;
  };
  const sorted = [...issues].sort((a, b) => {
    const lineA = a.line ?? -1;
    const lineB = b.line ?? -1;
    if (lineA !== lineB) return lineA - lineB;
    return orderOf(a.column) - orderOf(b.column);
  });
  return { errors: sorted.slice(0, MAX_ERRORS_RETURNED), totalErrors: sorted.length };
}
