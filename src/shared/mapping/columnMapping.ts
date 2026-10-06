// Flexible column mapping (V1.5): detects columns, suggests deterministic mappings, validates a user's choices and
// dry-runs the import. It only decides which column feeds which canonical field; every value still goes through the
// unchanged V1 row validation (importInventoryCsv / importShipmentsCsv), on the client for preview and on the server
// for the real import. Suggestions are never trusted: the server re-validates the confirmed map in full.

import type { ImportIssue, ImportKind } from '../types';
import { MAPPING_PREVIEW_ROWS, MAX_IMPORT_COLUMNS, MAX_IMPORT_ROWS } from '../constants';
import { parseCsv } from '../csv/parseCsv';
import { INVENTORY_COLUMNS, SHIPMENT_COLUMNS, type ColumnSpec } from '../csv/schemas';
import { normalizeHeader, type ColumnMap } from '../csv/importCommon';
import { importInventoryCsv } from '../csv/importInventory';
import { importShipmentsCsv } from '../csv/importShipments';
import { lookupAlias } from './aliases';

export type { ColumnMap };

export type Assignment = { type: 'field'; field: string } | { type: 'ignore' } | { type: 'undecided' };
export type SuggestionReason = 'exact' | 'alias' | 'ambiguous' | 'none';

export interface ColumnSuggestion {
  index: number;
  header: string;
  assignment: Assignment;
  reason: SuggestionReason;
  candidates: readonly string[];
}

export interface MappingSuggestion {
  kind: ImportKind;
  columns: readonly ColumnSuggestion[];
}

export type ColumnStatus = 'mapped' | 'unmapped' | 'ambiguous' | 'duplicate';

export interface MappingValidation {
  /** Per source column: field used once → mapped, field shared → duplicate, ignore → unmapped, undecided → ambiguous. */
  statuses: readonly ColumnStatus[];
  duplicateFields: readonly string[];
  missingRequired: readonly string[];
  undecidedCount: number;
  valid: boolean;
}

export type FileAnalysis =
  | { mode: 'direct' }
  | {
      mode: 'map';
      headers: readonly string[];
      suggestion: MappingSuggestion;
      sampleRows: readonly (readonly string[])[];
      dataRowCount: number;
    };

export type ImportPreview =
  | { ok: true; rowCount: number; warnings: readonly string[] }
  | { ok: false; errors: readonly ImportIssue[]; totalErrors: number; warnings: readonly string[] };

/** Extension point for a future (e.g. AI-assisted) suggester. Its output is still validated and user-confirmed. */
export interface MappingSuggester {
  suggest(kind: ImportKind, headers: readonly string[]): Promise<MappingSuggestion>;
}

/** The canonical column specs of an import kind. */
export function columnsForKind(kind: ImportKind): readonly ColumnSpec[] {
  return kind === 'inventory' ? INVENTORY_COLUMNS : SHIPMENT_COLUMNS;
}

/** Suggests an assignment per header: exact names first, then unique aliases; ambiguous or unknown ones are never guessed. */
export function suggestMapping(kind: ImportKind, headers: readonly string[]): MappingSuggestion {
  const names = new Set(columnsForKind(kind).map((c) => c.name));
  const columns: ColumnSuggestion[] = headers.map((header, index) => ({
    index,
    header,
    assignment: { type: 'ignore' },
    reason: 'none',
    candidates: []
  }));

  // Exact (V1-normalized) matches claim their field first. Two exact columns for one field both keep it, so
  // validateMapping flags the duplicate instead of one silently winning.
  const claimed = new Set<string>();
  const exact = new Set<number>();
  headers.forEach((header, i) => {
    const normalized = normalizeHeader(header);
    if (names.has(normalized)) {
      columns[i] = { index: i, header, assignment: { type: 'field', field: normalized }, reason: 'exact', candidates: [] };
      claimed.add(normalized);
      exact.add(i);
    }
  });

  const groups = new Map<string, number[]>();
  headers.forEach((header, i) => {
    if (exact.has(i)) return;
    const found = lookupAlias(kind, header);
    if (found.type === 'unique') {
      if (claimed.has(found.field)) return; // already provided by an exact column: leave as "do not import"
      const group = groups.get(found.field) ?? [];
      group.push(i);
      groups.set(found.field, group);
    } else if (found.type === 'ambiguous') {
      const candidates = found.candidates.filter((c) => !claimed.has(c));
      if (candidates.length > 0) {
        columns[i] = { index: i, header, assignment: { type: 'undecided' }, reason: 'ambiguous', candidates };
      }
    }
  });

  for (const [field, indexes] of groups) {
    for (const i of indexes) {
      const header = headers[i] ?? '';
      columns[i] =
        indexes.length === 1
          ? { index: i, header, assignment: { type: 'field', field }, reason: 'alias', candidates: [field] }
          : { index: i, header, assignment: { type: 'undecided' }, reason: 'ambiguous', candidates: [field] };
    }
  }

  return { kind, columns };
}

/** True when the file is not already plain canonical (an alias, ambiguity, duplicate or missing required field is involved). */
export function requiresMappingStep(suggestion: MappingSuggestion): boolean {
  if (suggestion.columns.some((c) => c.reason === 'alias' || c.reason === 'ambiguous')) return true;
  const assigned = new Map<string, number>();
  for (const c of suggestion.columns) {
    if (c.assignment.type === 'field') assigned.set(c.assignment.field, (assigned.get(c.assignment.field) ?? 0) + 1);
  }
  for (const count of assigned.values()) if (count > 1) return true;
  return columnsForKind(suggestion.kind).some((c) => c.requiredColumn && !assigned.has(c.name));
}

/** Validates the user's current assignments: duplicates, missing required fields and undecided columns block the import. */
export function validateMapping(kind: ImportKind, assignments: readonly Assignment[]): MappingValidation {
  const counts = new Map<string, number>();
  for (const a of assignments) {
    if (a.type === 'field') counts.set(a.field, (counts.get(a.field) ?? 0) + 1);
  }
  const statuses: ColumnStatus[] = assignments.map((a) => {
    if (a.type === 'undecided') return 'ambiguous';
    if (a.type === 'ignore') return 'unmapped';
    return (counts.get(a.field) ?? 0) > 1 ? 'duplicate' : 'mapped';
  });
  const columns = columnsForKind(kind);
  const duplicateFields = columns.filter((c) => (counts.get(c.name) ?? 0) > 1).map((c) => c.name);
  const missingRequired = columns.filter((c) => c.requiredColumn && !counts.has(c.name)).map((c) => c.name);
  const undecidedCount = statuses.filter((s) => s === 'ambiguous').length;
  return {
    statuses,
    duplicateFields,
    missingRequired,
    undecidedCount,
    valid: duplicateFields.length === 0 && missingRequired.length === 0 && undecidedCount === 0
  };
}

/** Converts assignments to the wire/import column map: field → name, ignore and undecided → null. */
export function toColumnMap(assignments: readonly Assignment[]): ColumnMap {
  return assignments.map((a) => (a.type === 'field' ? a.field : null));
}

/**
 * Decides whether an upload needs the mapping step. Anything the client cannot analyze confidently (NUL bytes, malformed
 * CSV, no records) or that is already canonical goes `direct`: the exact V1 request, whose server response is authoritative.
 */
export function analyzeImportFile(kind: ImportKind, text: string): FileAnalysis {
  if (text.includes('\u0000')) return { mode: 'direct' };
  const parsed = parseCsv(text, { maxRows: MAX_IMPORT_ROWS, maxColumns: MAX_IMPORT_COLUMNS });
  if (!parsed.ok || parsed.records.length === 0) return { mode: 'direct' };
  const headers = parsed.records[0]?.fields ?? [];
  const suggestion = suggestMapping(kind, headers);
  if (!requiresMappingStep(suggestion)) return { mode: 'direct' };
  return {
    mode: 'map',
    headers,
    suggestion,
    sampleRows: parsed.records.slice(1, 1 + MAPPING_PREVIEW_ROWS).map((r) => r.fields),
    dataRowCount: parsed.records.length - 1
  };
}

/** Dry-runs the real import (same shared code as the server) with a column map, without storing anything. */
export function previewImport(kind: ImportKind, text: string, columnMap: ColumnMap): ImportPreview {
  const result = kind === 'inventory' ? importInventoryCsv(text, undefined, columnMap) : importShipmentsCsv(text, undefined, columnMap);
  if (result.ok) return { ok: true, rowCount: result.rows.length, warnings: result.warnings };
  return { ok: false, errors: result.errors, totalErrors: result.totalErrors, warnings: result.warnings };
}

/** The only suggester today: the deterministic alias dictionary. */
export const deterministicSuggester: MappingSuggester = {
  suggest: async (kind, headers) => suggestMapping(kind, headers)
};
