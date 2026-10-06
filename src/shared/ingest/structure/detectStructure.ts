// Structure detection on a generic RawTable (ke-hoach 7.9): which row is the header (banner/title rows above it are
// skipped), and which later rows are structural (repeated header rows, total/subtotal rows, footers). Structural rows are
// only LISTED; they are excluded from the data only after the user confirms (applyStructure takes the confirmed set).
// Blank rows are already skipped by the adapters. Low confidence is reported so the UI can ask "Header is on row N".
// Nothing here knows a file format: it reads cells and source references only. Pure and deterministic.

import type { RawCell, RawTable } from '../types';
import { blankKind } from '../normalize/text';
import { valueKey } from '../mapping/valueMaps';

export const HEADER_SCAN_ROWS = 50;
export const HEADER_FOLLOW_ROWS = 5;
/** Margins (in score points) between the best and the second-best header candidate. */
export const HEADER_DETECTED_MARGIN = 2;
export const HEADER_CHECK_MARGIN = 1;

export interface HeaderCandidate {
  rowIndex: number;
  score: number;
  recognized: number;
}

export type StructuralKind = 'repeated-header' | 'total' | 'footer';

export interface StructuralRow {
  rowIndex: number;
  kind: StructuralKind;
  /** The first non-empty cell, truncated, for the list shown to the user. */
  label: string;
}

export interface StructureDetection {
  headerRowIndex: number;
  confidence: 'detected' | 'check' | 'choose';
  candidates: HeaderCandidate[];
  /** Rows above the header (titles, filters, blank-ish lines), as indexes into `table.rows`. */
  bannerRows: number[];
  structuralRows: StructuralRow[];
  evidence: string[];
}

const TOTAL_WORDS = /^(grand total|sub total|subtotal|total general|total|gesamtsumme|gesamt|summe|tong cong|tong so|tong|totale|suma|somme)( |$)/;

function text(cell: RawCell | undefined): string {
  return cell === undefined ? '' : cell.v.trim();
}

function nonBlank(row: readonly RawCell[]): string[] {
  return row.map(text).filter((v) => blankKind(v) === null);
}

function isNumberish(cell: RawCell): boolean {
  if (cell.t === 'number') return true;
  return /^[-+$€£]?\s?\d[\d.,\s]*$/.test(cell.v.trim());
}

function isDateish(cell: RawCell): boolean {
  return cell.t === 'date' || /^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}/.test(cell.v.trim());
}

function scoreRow(table: RawTable, index: number, width: number, recognize: (cell: string) => boolean): HeaderCandidate {
  const row = table.rows[index] as RawCell[];
  const cells = row.filter((c) => blankKind(c.v) === null);
  if (cells.length === 0) return { rowIndex: index, score: -Infinity, recognized: 0 };
  let recognized = 0;
  for (const c of cells) if (recognize(c.v.trim())) recognized++;
  const textual = cells.filter((c) => !isNumberish(c) && !isDateish(c)).length / cells.length;
  const density = Math.min(1, cells.length / Math.max(1, width));
  const distinct = new Set(cells.map((c) => valueKey(c.v))).size / cells.length;
  let following = 0;
  let consistent = 0;
  let contrast = 0;
  for (let i = index + 1; i < table.rows.length && following < HEADER_FOLLOW_ROWS; i++) {
    const next = table.rows[i] as RawCell[];
    const nextCells = next.filter((c) => blankKind(c.v) === null);
    if (nextCells.length === 0) continue;
    following++;
    if (nextCells.length >= Math.ceil(cells.length * 0.7)) consistent++;
    const nextTextual = nextCells.filter((c) => !isNumberish(c) && !isDateish(c)).length / nextCells.length;
    if (textual - nextTextual > 0.2) contrast++;
  }
  const followScore = following === 0 ? 0 : consistent / following + 0.5 * (contrast / following);
  // Single-cell rows are banners, not headers: penalize them so a title above a wide header never wins.
  const singleCellPenalty = cells.length === 1 && width > 1 ? 3 : 0;
  const score = 3 * recognized + 2 * textual + 1.5 * density + 1 * distinct + 1.5 * followScore - singleCellPenalty;
  return { rowIndex: index, score, recognized };
}

export function detectStructure(table: RawTable, recognize: (cell: string) => boolean): StructureDetection {
  const evidence: string[] = [];
  const rows = table.rows;
  if (rows.length === 0) return { headerRowIndex: 0, confidence: 'choose', candidates: [], bannerRows: [], structuralRows: [], evidence: ['the table has no rows'] };
  const width = table.colCount;

  // Candidate rows: the first HEADER_SCAN_ROWS rows that are not blank.
  const scored: HeaderCandidate[] = [];
  for (let i = 0; i < rows.length && scored.length < HEADER_SCAN_ROWS; i++) {
    if (nonBlank(rows[i] as RawCell[]).length === 0) continue;
    scored.push(scoreRow(table, i, width, recognize));
  }
  if (scored.length === 0) return { headerRowIndex: 0, confidence: 'choose', candidates: [], bannerRows: [], structuralRows: [], evidence: ['every row of the table is blank'] };
  const ranked = [...scored].sort((a, b) => b.score - a.score || a.rowIndex - b.rowIndex);
  const best = ranked[0] as HeaderCandidate;
  const second = ranked[1];
  const margin = second === undefined ? Infinity : best.score - second.score;

  let confidence: StructureDetection['confidence'];
  if ((best.recognized >= 2 && margin >= HEADER_DETECTED_MARGIN) || margin >= HEADER_DETECTED_MARGIN + 1) confidence = 'detected';
  else if (margin >= HEADER_CHECK_MARGIN) confidence = 'check';
  else confidence = 'choose';
  if (table.columns !== undefined) {
    // The source names its columns itself: there is no header row to find.
    confidence = 'detected';
    evidence.push('the source names its own columns');
  }
  evidence.push(best.recognized > 0 ? `${best.recognized} recognized column name(s) in row ${best.rowIndex + 1}` : `row ${best.rowIndex + 1} looks most like a header`);
  if (best.rowIndex > 0) evidence.push(`${best.rowIndex} row(s) above the header are title or banner rows`);

  const headerRowIndex = best.rowIndex;
  const bannerRows = Array.from({ length: headerRowIndex }, (_, i) => i);
  return {
    headerRowIndex,
    confidence,
    candidates: ranked.slice(0, 3),
    bannerRows,
    structuralRows: findStructuralRows(table, headerRowIndex),
    evidence
  };
}

/** Repeated header rows, total/subtotal rows and trailing footers after `headerRowIndex` (listed, never removed). */
export function findStructuralRows(table: RawTable, headerRowIndex: number): StructuralRow[] {
  const rows = table.rows;
  const header = rows[headerRowIndex] as RawCell[] | undefined;
  if (header === undefined) return [];
  const headerKeys = header.map((c) => valueKey(c.v)).filter((k) => k !== '');
  const headerKeySet = new Set(headerKeys);
  const found = new Map<number, StructuralRow>();
  const label = (row: readonly RawCell[]): string => {
    const first = row.map(text).find((v) => blankKind(v) === null) ?? '';
    return first.length > 60 ? `${first.slice(0, 59)}…` : first;
  };

  for (let i = headerRowIndex + 1; i < rows.length; i++) {
    const row = rows[i] as RawCell[];
    const cells = nonBlank(row);
    if (cells.length === 0) continue;
    const keys = row.map((c) => valueKey(c.v)).filter((k) => k !== '');
    if (headerKeys.length >= 2 && keys.length >= 2 && keys.filter((k) => headerKeySet.has(k)).length >= Math.ceil(headerKeys.length * 0.8)) {
      found.set(i, { rowIndex: i, kind: 'repeated-header', label: label(row) });
      continue;
    }
    const firstKey = valueKey(text(row.find((c) => blankKind(c.v) === null)));
    if (TOTAL_WORDS.test(firstKey) && row.some((c, idx) => isNumberish(c) && blankKind(c.v) === null && idx > 0)) {
      found.set(i, { rowIndex: i, kind: 'total', label: label(row) });
    }
  }

  // Footers: consecutive trailing rows with at most one non-empty cell (notes, "generated by ..."), for wide tables.
  if (headerKeys.length >= 3) {
    for (let i = rows.length - 1; i > headerRowIndex; i--) {
      const cells = nonBlank(rows[i] as RawCell[]);
      if (cells.length === 0) continue;
      if (found.get(i)?.kind === 'total' || found.get(i)?.kind === 'repeated-header') continue;
      if (cells.length <= 1) found.set(i, { rowIndex: i, kind: 'footer', label: label(rows[i] as RawCell[]) });
      else break;
    }
  }
  return [...found.values()].sort((a, b) => a.rowIndex - b.rowIndex);
}

export interface StructuredTable {
  headers: string[];
  /** Data rows after the header with the confirmed exclusions removed (cells as extracted). */
  rows: RawCell[][];
  /** For each entry of `rows`, its index in the source table (for source references). */
  sourceRowIndex: number[];
  headerRowIndex: number;
  excluded: Array<{ rowIndex: number; kind: StructuralKind | 'user' }>;
}

/**
 * Headers of a source that names its own columns. A path column ("route.from.city") is read by its LAST segment when that
 * is unique among the columns (the last segment carries the meaning), else by its full path.
 */
function sourceHeaders(columns: NonNullable<RawTable['columns']>): string[] {
  const last = columns.map((c) => (c.path !== undefined && c.path.length > 0 ? (c.path[c.path.length - 1] as string) : (c.header ?? '')));
  const counts = new Map<string, number>();
  for (const l of last) counts.set(l, (counts.get(l) ?? 0) + 1);
  return columns.map((c, i) => ((counts.get(last[i] as string) ?? 0) === 1 ? (last[i] as string) : (c.header ?? '')));
}

/** Applies the chosen header row and the user-confirmed exclusions. */
export function applyStructure(table: RawTable, headerRowIndex: number, excludedRows: readonly number[] = [], detection?: StructureDetection): StructuredTable {
  const header = (table.rows[headerRowIndex] ?? []) as RawCell[];
  const headers = table.columns !== undefined ? sourceHeaders(table.columns) : header.map((c) => c.v.trim());
  const skip = new Set(excludedRows);
  const kinds = new Map<number, StructuralKind>((detection?.structuralRows ?? findStructuralRows(table, headerRowIndex)).map((s) => [s.rowIndex, s.kind]));
  const rows: RawCell[][] = [];
  const sourceRowIndex: number[] = [];
  const excluded: StructuredTable['excluded'] = [];
  const first = table.columns !== undefined ? 0 : headerRowIndex + 1;
  for (let i = first; i < table.rows.length; i++) {
    const row = table.rows[i] as RawCell[];
    if (skip.has(i)) {
      excluded.push({ rowIndex: i, kind: kinds.get(i) ?? 'user' });
      continue;
    }
    rows.push(row);
    sourceRowIndex.push(i);
  }
  return { headers, rows, sourceRowIndex, headerRowIndex, excluded };
}

/** The cells of column `index` (a missing cell reads as blank). */
export function columnCells(table: StructuredTable, index: number): RawCell[] {
  return table.rows.map((r) => r[index] ?? { v: '', t: 'empty' as const });
}
