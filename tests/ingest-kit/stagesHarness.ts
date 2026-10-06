// Runs the M2 stages on a fixture the way the pipeline will (M3 wires them together): detect -> read -> structure ->
// map -> presets -> normalize -> value maps. Returns everything the tests compare with the fixture's ground truth.

import { createDefaultRegistry } from '../../src/shared/ingest/adapters';
import { detectFormat, makeHints } from '../../src/shared/ingest/detect/arbiter';
import { recognizesHeader } from '../../src/shared/ingest/mapping/dictionary';
import { detectStructure, applyStructure, columnCells, type StructuredTable } from '../../src/shared/ingest/structure/detectStructure';
import { proposeForTable, type MappingProposal } from '../../src/shared/ingest/mapping/report';
import { detectDatePreset, detectNumberPreset, type PresetOutcome } from '../../src/shared/ingest/normalize/detectPreset';
import { normalizeNumber, type NumberPreset } from '../../src/shared/ingest/normalize/numbers';
import { normalizeDate, type DatePreset } from '../../src/shared/ingest/normalize/dates';
import { dateContext, fieldsOf, isDateField, isNumberField, numberContext } from '../../src/shared/ingest/canonical/schemaRegistry';
import { classifyStatus, classifyWarehouse } from '../../src/shared/ingest/mapping/valueMaps';
import type { RawTable } from '../../src/shared/ingest/types';
import { makeCtx, sourceOf } from './corpus';
import type { Fixture } from '../fixtures/ingest/corpus45';

export interface StageRun {
  table: RawTable;
  structured: StructuredTable;
  proposal: MappingProposal;
  numberOutcome: PresetOutcome<NumberPreset>;
  dateOutcome: PresetOutcome<DatePreset>;
  /** Canonical rows (field -> canonical text) built from the MATCHED/CHECK columns; unresolved values stay as written. */
  rows: Array<Record<string, string>>;
  mappedFields: Map<string, number>;
}

const registry = createDefaultRegistry();

export async function readFixture(f: Fixture, extraOptions: Record<string, string> = {}): Promise<RawTable> {
  const detection = detectFormat(f.bytes, makeHints(f.hints.fileName), registry);
  if (detection.chosen === null) throw new Error(`${f.name}: ${detection.error?.message}`);
  const adapter = registry.get(detection.chosen.adapterId)!;
  const ctx = makeCtx({ registry, descriptor: adapter.descriptor, hints: { fileName: f.hints.fileName, extension: f.hints.extension }, recognizeHeader: recognizesHeader });
  const result = await adapter.read(sourceOf(f.bytes), { tableIndex: 0, options: { ...f.options, ...extraOptions } }, { maxRows: 100_000 }, ctx);
  if (!result.ok) throw new Error(`${f.name}: ${result.error.message}`);
  if (result.value.kind !== 'tables') throw new Error('expected tables');
  return result.value.tables[0]!;
}

export async function runStages(f: Fixture, extraOptions: Record<string, string> = {}): Promise<StageRun> {
  const table = await readFixture(f, extraOptions);
  const detection = detectStructure(table, recognizesHeader);
  const structured = applyStructure(table, detection.headerRowIndex, detection.structuralRows.map((s) => s.rowIndex), detection);
  const proposal = proposeForTable(f.kind, structured);

  const mappedFields = new Map<string, number>();
  for (const c of proposal.columns) if ((c.state === 'matched' || c.state === 'check') && c.field !== null) mappedFields.set(c.field, c.index);

  const numberCells: string[] = [];
  const dateCells: string[] = [];
  for (const field of fieldsOf(f.kind)) {
    const idx = mappedFields.get(field.name);
    if (idx === undefined) continue;
    const texts = columnCells(structured, idx).filter((c) => c.t === 'text').map((c) => c.v);
    if (isNumberField(field)) numberCells.push(...texts);
    if (isDateField(field)) dateCells.push(...texts);
  }
  const numberOutcome = detectNumberPreset(numberCells);
  const dateOutcome = detectDatePreset(dateCells);
  const numberPreset: NumberPreset = numberOutcome.kind === 'unique' || numberOutcome.kind === 'equivalent' ? numberOutcome.preset : 'plain';
  const datePreset: DatePreset = dateOutcome.kind === 'unique' || dateOutcome.kind === 'equivalent' ? dateOutcome.preset : 'iso';

  const rows = structured.rows.map((row) => {
    const out: Record<string, string> = {};
    for (const field of fieldsOf(f.kind)) {
      const idx = mappedFields.get(field.name);
      if (idx === undefined) {
        out[field.name] = '';
        continue;
      }
      const cell = row[idx] ?? { v: '', t: 'empty' as const };
      const raw = cell.v.trim();
      if (isNumberField(field)) {
        const r = normalizeNumber(raw, numberPreset, numberContext(field));
        out[field.name] = r.ok ? r.value : raw;
      } else if (isDateField(field)) {
        const r = normalizeDate(raw, datePreset, dateContext(field));
        out[field.name] = r.ok ? r.value : raw;
      } else if (field.valueKind === 'status') {
        out[field.name] = classifyStatus(raw).target ?? raw;
      } else if (field.valueKind === 'warehouse') {
        out[field.name] = classifyWarehouse(raw).code ?? (f.warehouseMap?.find(([v]) => v === raw)?.[1] ?? raw);
      } else {
        out[field.name] = raw;
      }
    }
    return out;
  });
  return { table, structured, proposal, numberOutcome, dateOutcome, rows, mappedFields };
}

/** V1 writes avg_daily_usage with up to two decimals; money is two decimals: compare numerically as cents. */
export function sameNumber(a: string, b: string): boolean {
  if (a === b) return true;
  const n = Number(a);
  const m = Number(b);
  return !Number.isNaN(n) && !Number.isNaN(m) && Math.abs(n - m) < 1e-9;
}
