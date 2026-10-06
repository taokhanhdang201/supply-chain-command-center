// The mapping proposal and its deterministic report. `proposeMapping` runs the whole mapper for one dataset kind over
// the headers and column profiles of a structured table; `serializeReport` renders it with a fixed key order and rounded
// numbers, so the same input gives a byte-identical report (SA-5). Nothing here uses a clock, randomness or the network.

import type { ImportKind } from '../../types';
import { IMPORT_KINDS, fieldsOf } from '../canonical/schemaRegistry';
import { profileColumn, type ColumnProfile } from '../structure/profile';
import { columnCells, type StructuredTable } from '../structure/detectStructure';
import { assignColumns, type ColumnInput, type ColumnResult } from './assign';
import { defaultDict, type Dictionary } from './dictionary';
import { normalizeHeader } from './normalizeHeader';
import { scoreColumn } from './score';

export const MAPPING_REPORT_VERSION = 1;

export interface FieldStatus {
  field: string;
  /** The field has a column in V1 terms (requiredColumn) and/or a value per row (requiredValue). */
  requiredColumn: boolean;
  requiredValue: boolean;
  /** mapped = a MATCHED/CHECK column feeds it; pending = a CHOOSE column may; missing = nothing does. */
  state: 'mapped' | 'pending' | 'missing';
  columnIndex: number | null;
  /** What may replace a missing field (5.3): never a derived value. */
  options: Array<'unknown' | 'constant'>;
  /** A missing field with no option rejects the import. */
  blocksImport: boolean;
}

export interface MappingProposal {
  kind: ImportKind;
  dictionaryVersion: string;
  columns: ColumnResult[];
  fields: FieldStatus[];
  /** Columns that will not be imported (no evidence, or their field went to a better column). */
  notImported: number[];
  /** Mean confidence of the mapped required fields over all required fields (0..1): used to pick the dataset. */
  datasetScore: number;
}

export function proposeMapping(kind: ImportKind, headers: readonly string[], profiles: readonly ColumnProfile[], dict: Dictionary = defaultDict()): MappingProposal {
  const inputs: ColumnInput[] = headers.map((header, index) => {
    const normalized = normalizeHeader(header);
    const hit = normalized.key === '' ? null : dict.lookup(kind, normalized.key);
    const profile = profiles[index] ?? profileColumn(header, []);
    return {
      index,
      header,
      normalized,
      scores: scoreColumn(kind, header, profile, dict),
      ambiguous: hit !== null && hit.type === 'ambiguous' ? hit.candidates : null
    };
  });
  const columns = assignColumns(kind, inputs);

  const fields: FieldStatus[] = fieldsOf(kind).map((f) => {
    const mapped = columns.find((c) => (c.state === 'matched' || c.state === 'check') && c.field === f.name);
    const pending = columns.some((c) => c.state === 'choose' && c.candidates.some((x) => x.field === f.name));
    const options: Array<'unknown' | 'constant'> = [];
    if (f.unknownAllowed) options.push('unknown');
    if (f.constantAllowed) options.push('constant');
    const state: FieldStatus['state'] = mapped !== undefined ? 'mapped' : pending ? 'pending' : 'missing';
    const required = f.spec.requiredColumn || f.spec.requiredValue;
    return {
      field: f.name,
      requiredColumn: f.spec.requiredColumn,
      requiredValue: f.spec.requiredValue,
      state,
      columnIndex: mapped?.index ?? null,
      options,
      blocksImport: state === 'missing' && required && options.length === 0
    };
  });

  const requiredFields = fieldsOf(kind).filter((f) => f.spec.requiredColumn);
  const total = requiredFields.reduce((sum, f) => {
    const c = columns.find((x) => (x.state === 'matched' || x.state === 'check') && x.field === f.name);
    return sum + (c?.confidence ?? 0);
  }, 0);
  return {
    kind,
    dictionaryVersion: dict.version,
    columns,
    fields,
    notImported: columns.filter((c) => c.state === 'ignored').map((c) => c.index),
    datasetScore: requiredFields.length === 0 ? 0 : total / requiredFields.length
  };
}

/** Profiles every column of a structured table and proposes the mapping for `kind`. */
export function profilesOf(table: StructuredTable): ColumnProfile[] {
  return table.headers.map((h, i) => profileColumn(h, columnCells(table, i)));
}

export function proposeForTable(kind: ImportKind, table: StructuredTable, dict: Dictionary = defaultDict(), profiles: readonly ColumnProfile[] = profilesOf(table)): MappingProposal {
  return proposeMapping(kind, table.headers, profiles, dict);
}

export const DATASET_MIN_SCORE = 0.7;
export const DATASET_OTHER_MAX = 0.35;

export interface DatasetGuess {
  /** The dataset when one is clearly better; null = ask the user (nothing preselected). */
  kind: ImportKind | null;
  scores: Array<{ kind: ImportKind; score: number }>;
}

/** Which dataset a table is: the best score >= 0.70 while the other is <= 0.35, else the user decides. */
export function detectDataset(table: StructuredTable, dict: Dictionary = defaultDict(), profiles: readonly ColumnProfile[] = profilesOf(table)): DatasetGuess {
  const scores = IMPORT_KINDS.map((kind) => ({ kind, score: proposeForTable(kind, table, dict, profiles).datasetScore }));
  const sorted = [...scores].sort((a, b) => b.score - a.score);
  const top = sorted[0];
  const other = sorted[1];
  const clear = top !== undefined && top.score >= DATASET_MIN_SCORE && (other === undefined || other.score <= DATASET_OTHER_MAX);
  return { kind: clear ? (top as { kind: ImportKind }).kind : null, scores };
}

const r4 = (x: number | null): number | null => (x === null ? null : Math.round(x * 10000) / 10000);

/** Canonical JSON of a proposal: fixed key order, numbers rounded to 4 decimals. Byte-identical for equal input. */
export function serializeReport(p: MappingProposal): string {
  return JSON.stringify({
    version: MAPPING_REPORT_VERSION,
    kind: p.kind,
    dictionaryVersion: p.dictionaryVersion,
    datasetScore: r4(p.datasetScore),
    columns: p.columns.map((c) => ({
      index: c.index,
      header: c.header,
      state: c.state,
      reason: c.reason,
      field: c.field,
      confidence: r4(c.confidence),
      candidates: c.candidates.map((x) => ({ field: x.field, confidence: r4(x.confidence) })),
      competingWith: c.competingWith,
      warnings: c.warnings,
      evidence: c.evidence
    })),
    fields: p.fields.map((f) => ({ field: f.field, state: f.state, columnIndex: f.columnIndex, options: f.options, blocksImport: f.blocksImport })),
    notImported: p.notImported
  });
}
