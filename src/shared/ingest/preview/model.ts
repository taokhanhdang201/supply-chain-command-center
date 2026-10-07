// The preview model: everything the Import UI shows before the user confirms, as plain, structured-cloneable data (it
// crosses the worker boundary). The UI only renders it; the pipeline fills it. File-derived text is carried as data and
// rendered as text by the UI; nothing here is HTML.

import type { ImportKind } from '../../types';
import type { AdapterChoice, SourceRef } from '../types';
import type { ColumnState } from '../mapping/assign';
import type { FieldStatus } from '../mapping/report';
import type { ValueMapEntry, LocationSummary } from '../mapping/valueMaps';
import type { DisplayIssue } from '../validate/dryRun';
import type { StructuralKind } from '../structure/detectStructure';
import type { NumberPreset } from '../normalize/numbers';
import type { DatePreset } from '../normalize/dates';

export const DATASET_LABEL: Record<ImportKind, string> = { inventory: 'Inventory', shipments: 'Shipments' };

/** Rows shown raw-versus-canonical (ke-hoach 6.1 step 5). */
export const PREVIEW_SAMPLE_ROWS = 10;
export const PREVIEW_PROBLEM_ROWS = 10;

export type BlockerCode =
  | 'choose-choice'
  | 'confirm-choice'
  | 'choose-table'
  | 'confirm-header'
  | 'choose-dataset'
  | 'choose-column'
  | 'check-column'
  | 'duplicate-field'
  | 'missing-required'
  | 'missing-constant'
  | 'choose-number-format'
  | 'choose-date-format'
  | 'currency'
  | 'choose-status'
  | 'choose-warehouse'
  | 'too-large'
  | 'validation'
  | 'no-rows';

/** One reason why Confirm is disabled, in plain words (linked to the button by aria-describedby in the UI). */
export interface Blocker {
  code: BlockerCode;
  message: string;
  /** The user cannot resolve it in the panels (for example a refused currency); the file must be fixed. */
  fatal: boolean;
  columnIndex?: number;
  field?: string;
}

export interface PreviewColumn {
  index: number;
  header: string;
  /** The first non-blank value, as written. */
  example: string;
  state: ColumnState;
  field: string | null;
  confidence: number | null;
  candidates: Array<{ field: string; confidence: number | null }>;
  competingWith: number[];
  evidence: string[];
  warnings: string[];
  /** The user picked this assignment (it needs no acknowledgment). */
  chosenByUser: boolean;
  acknowledged: boolean;
}

export type PresetView<P extends string> =
  | { kind: 'unique' | 'equivalent'; preset: P; needsNormalization: boolean; chosenByUser: boolean; note: string }
  | { kind: 'ambiguous'; candidates: P[]; chosenByUser: false; preset: null; note: string }
  | { kind: 'mixed'; groups: Array<{ preset: P; examples: string[] }>; chosenByUser: false; preset: null; note: string }
  | { kind: 'none'; preset: P; chosenByUser: boolean; note: string };

export interface SampleRow {
  source: string;
  raw: string[];
  canonical: string[];
}

export interface ProblemRow extends SampleRow {
  issues: Array<{ column: string | null; message: string }>;
}

export interface PreviewModel {
  file: { name: string; sizeBytes: number; family: string; adapterId: string; evidence: string[]; notices: string[] };
  /** Format-specific choices (encoding, separator, ...) with their current values and evidence. */
  choices: AdapterChoice[];
  tables: Array<{ name: string; hidden: boolean; rows: number | null; selected: boolean }>;
  structure: {
    headerRow: string;
    confidence: 'detected' | 'check' | 'choose';
    evidence: string[];
    banners: number;
    structuralRows: Array<{ rowIndex: number; kind: StructuralKind; label: string; where: string; excluded: boolean }>;
  } | null;
  dataset: { kind: ImportKind | null; chosenByUser: boolean; scores: Array<{ kind: ImportKind; score: number }> };
  columns: PreviewColumn[];
  fields: Array<FieldStatus & { label: string; constant: string | null; unknown: boolean }>;
  presets: {
    number: PresetView<NumberPreset> | null;
    /** One view for the whole file (the first column still open, else the common format). */
    date: PresetView<DatePreset> | null;
    /** The date format of each date column, settled from that column's own values or by the user. */
    dateColumns: Array<{ field: string; header: string; view: PresetView<DatePreset> }>;
    currency: { kind: 'ok' | 'foreign' | 'mixed'; markers: string[]; message: string | null };
    timestampsStripped: number;
    placeholders: number;
    markersStripped: number;
  };
  valueMaps: { status: Array<ValueMapEntry<string> & { chosenByUser: boolean }> | null; warehouse: Array<ValueMapEntry<string> & { chosenByUser: boolean }> | null; locations: LocationSummary | null };
  constants: Array<{ field: string; value: string }>;
  notImported: Array<{ index: number; header: string; reason: string }>;
  sample: { columns: string[]; rows: SampleRow[]; problemRows: ProblemRow[] };
  counts: {
    rowsRead: number;
    rowsImported: number | null;
    excluded: Array<{ reason: string; count: number }>;
    rowsWithProblems: number;
    columnsMapped: number;
    columnsIgnored: number;
    columnsConstant: number;
    columnsTotal: number;
  };
  validation: { ran: boolean; ok: boolean; issues: DisplayIssue[]; totalErrors: number; warnings: string[] };
  /** The destructive restatement shown next to Confirm; null until a dataset and a row count are known. */
  restatement: string | null;
  blockers: Blocker[];
  canConfirm: boolean;
  /** One sentence for aria-describedby: why Confirm is disabled (null when it is enabled). */
  confirmBlockedReason: string | null;
}

function thousands(n: number): string {
  return n.toLocaleString('en-US');
}

/** "This will REPLACE the entire Shipments dataset (1,200 rows from sample data) with 845 rows from Alder Q3.xlsx." (6.1 step 6) */
export function restatementText(kind: ImportKind, current: { label: string; rowCount: number } | undefined, incomingRows: number, sourceLabel: string): string {
  const label = DATASET_LABEL[kind];
  const now = current === undefined ? '' : ` (${thousands(current.rowCount)} rows from ${current.label})`;
  return `This will REPLACE the entire ${label} dataset${now} with ${thousands(incomingRows)} row${incomingRows === 1 ? '' : 's'} from ${sourceLabel}. If any row fails validation nothing is imported.`;
}

export function confirmReason(blockers: readonly Blocker[]): string | null {
  if (blockers.length === 0) return null;
  const first = blockers[0] as Blocker;
  return blockers.length === 1 ? first.message : `${first.message} (and ${blockers.length - 1} more thing${blockers.length === 2 ? '' : 's'} to resolve)`;
}

export type { SourceRef };
