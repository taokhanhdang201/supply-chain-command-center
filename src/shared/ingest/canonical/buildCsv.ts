// The canonical CSV builder: turns a structured table plus the user's decisions into the exact payload the unchanged
// server contract accepts: canonical headers in schema order, UTF-8, comma, ISO dates, dot decimals, canonical statuses
// and warehouse codes, file-wide constants where the policy allows them (5.3) and present-but-empty columns for unknown
// optional fields. Nothing is derived or invented. Values that cannot be normalized are passed through RAW, so the V1
// importers (the authority) report them quoting the user's own text. `lineToSource[]` is built by parsing the produced
// CSV, so multi-line cells can never shift a reference.

import type { ImportKind } from '../../types';
import { parseCsv } from '../../csv/parseCsv';
import type { RawCell, RawTable, SourceRef } from '../types';
import type { StructuredTable } from '../structure/detectStructure';
import { dateContext, fieldsOf, isDateField, isNumberField, numberContext, type FieldInfo } from './schemaRegistry';
import { normalizeNumber, type NumberPreset } from '../normalize/numbers';
import { normalizeDate, type DatePreset } from '../normalize/dates';
import { blankKind } from '../normalize/text';
import { classifyStatus, classifyWarehouse } from '../mapping/valueMaps';

export interface BuildInput {
  kind: ImportKind;
  table: RawTable;
  structured: StructuredTable;
  /** Canonical field -> column index in `structured.headers`. */
  assignment: ReadonlyMap<string, number>;
  numberPreset: NumberPreset;
  datePreset: DatePreset;
  /** The user's choices: trimmed source word -> canonical status / warehouse code (they win over the known words). */
  statusChoices: ReadonlyMap<string, string>;
  warehouseChoices: ReadonlyMap<string, string>;
  /** Number of cells of the header row, when the names come from a row of the data (rows of another width are structural defects). */
  headerWidth?: number;
  /** One file-wide constant per field (only fields whose policy allows a constant; the pipeline enforces it). */
  constants: ReadonlyMap<string, string>;
}

export interface BuildStats {
  /** Placeholder values read as blank in optional numeric/date fields. */
  placeholders: number;
  /** Date values whose time of day was dropped ("dates are taken as written"). */
  timestampsStripped: number;
  /** Amounts whose USD marker was stripped. */
  markersStripped: number;
  /** Source rows dropped because every mapped value was empty. */
  blankRows: number;
}

/** A data row whose width differs from the header (V1's FIELD_COUNT): never padded or truncated silently. */
export interface RaggedRow {
  sourceRowIndex: number;
  expected: number;
  found: number;
}

export interface BuildOutput {
  /** Rows left out of the CSV because their width differs from the header; they are reported as problems. */
  ragged: RaggedRow[];
  csv: string;
  bytes: number;
  rowCount: number;
  /** Index = physical line of the canonical CSV (1-based; index 0 unused): where that line came from in the user's file. */
  lineToSource: Array<SourceRef | undefined>;
  /** Physical line of the canonical CSV on which each data row starts. */
  rowLines: number[];
  /** Canonical text per data row, in schema order. */
  canonicalRows: string[][];
  /** The user's raw text per data row and canonical column ('' for constants and missing columns). */
  rawRows: string[][];
  /** Index into `table.rows` of each data row. */
  sourceRowIndex: number[];
  stats: BuildStats;
}

function quoteCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

const encoder = new TextEncoder();

interface Cooked {
  value: string;
  raw: string;
}

function cook(field: FieldInfo, cell: RawCell | undefined, input: BuildInput, stats: BuildStats): Cooked {
  if (cell === undefined || cell.t === 'empty') return { value: '', raw: '' };
  const raw = cell.v.trim();
  if (raw === '') return { value: '', raw: '' };
  if (isNumberField(field)) {
    if (cell.t === 'number') return { value: cell.v, raw };
    const r = normalizeNumber(raw, input.numberPreset, numberContext(field));
    if (!r.ok) return { value: raw, raw };
    if (r.blank === 'placeholder') stats.placeholders++;
    if (r.marker === 'USD') stats.markersStripped++;
    return { value: r.value, raw };
  }
  if (isDateField(field)) {
    if (cell.t === 'date') return { value: cell.v.slice(0, 10), raw };
    const r = normalizeDate(raw, input.datePreset, dateContext(field));
    if (!r.ok) return { value: raw, raw };
    if (r.blank === 'placeholder') stats.placeholders++;
    if (r.timeStripped) stats.timestampsStripped++;
    return { value: r.value, raw };
  }
  if (field.valueKind === 'status') {
    const chosen = input.statusChoices.get(raw);
    return { value: chosen ?? classifyStatus(raw).target ?? raw, raw };
  }
  if (field.valueKind === 'warehouse') {
    const chosen = input.warehouseChoices.get(raw);
    return { value: chosen ?? classifyWarehouse(raw).code ?? raw, raw };
  }
  if (blankKind(raw) === 'placeholder' && field.unknownAllowed) return { value: '', raw };
  return { value: raw, raw };
}

export function buildCanonicalCsv(input: BuildInput): BuildOutput {
  const fields = fieldsOf(input.kind);
  const stats: BuildStats = { placeholders: 0, timestampsStripped: 0, markersStripped: 0, blankRows: 0 };
  const canonicalRows: string[][] = [];
  const rawRows: string[][] = [];
  const sourceRowIndex: number[] = [];
  const ragged: RaggedRow[] = [];

  input.structured.rows.forEach((row, i) => {
    const width = input.headerWidth;
    if (width !== undefined && (row.length < width || (row.length > width && row.slice(width).some((c) => c.v.trim() !== '')))) {
      ragged.push({ sourceRowIndex: input.structured.sourceRowIndex[i] as number, expected: width, found: row.length });
      return;
    }
    const cooked = fields.map((field): Cooked => {
      const column = input.assignment.get(field.name);
      if (column !== undefined) return cook(field, row[column], input, stats);
      const constant = input.constants.get(field.name);
      return constant !== undefined ? { value: constant, raw: '' } : { value: '', raw: '' };
    });
    // A source row with nothing in any mapped column is an empty record (skipped, as V1 skips blank rows).
    const hasValue = fields.some((f, k) => input.assignment.has(f.name) && (cooked[k] as Cooked).value !== '');
    if (!hasValue) {
      stats.blankRows++;
      return;
    }
    canonicalRows.push(cooked.map((c) => c.value));
    rawRows.push(cooked.map((c) => c.raw));
    sourceRowIndex.push(input.structured.sourceRowIndex[i] as number);
  });

  const header = fields.map((f) => f.name).join(',');
  const csv = `${[header, ...canonicalRows.map((r) => r.map(quoteCell).join(','))].join('\n')}\n`;

  const lineToSource: Array<SourceRef | undefined> = [];
  const headerRef = input.table.origin(Math.max(0, input.structured.headerRowIndex));
  lineToSource[1] = headerRef;
  const rowLines: number[] = [];
  const parsed = parseCsv(csv, { maxRows: canonicalRows.length + 2, maxColumns: fields.length + 1 });
  if (parsed.ok && parsed.records.length === canonicalRows.length + 1) {
    parsed.records.forEach((record, k) => {
      if (k === 0) return;
      rowLines.push(record.line);
      lineToSource[record.line] = input.table.origin(sourceRowIndex[k - 1] as number);
    });
  } else {
    // Defensive fallback (the CSV is ours and always parses): count the lines each record occupies.
    let line = 2;
    canonicalRows.forEach((r, k) => {
      lineToSource[line] = input.table.origin(sourceRowIndex[k] as number);
      rowLines.push(line);
      line += 1 + r.reduce((n, v) => n + (v.match(/\r\n|\r|\n/g)?.length ?? 0), 0);
    });
  }
  return { ragged, csv, bytes: encoder.encode(csv).length, rowCount: canonicalRows.length, lineToSource, rowLines, canonicalRows, rawRows, sourceRowIndex, stats };
}
