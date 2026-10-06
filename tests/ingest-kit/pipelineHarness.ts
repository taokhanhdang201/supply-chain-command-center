// Drives the pipeline the way the UI will: analyze, read the preview, answer what it asks (acknowledge CHECK columns,
// confirm structural rows, pick formats), analyze again until Confirm would be enabled or nothing more can be answered.

import { createDefaultRegistry } from '../../src/shared/ingest/adapters';
import { analyzeFile, type Analysis, type Decisions, type PipelineEnv, type PipelineInput } from '../../src/shared/ingest/pipeline';
import type { AdapterLookup, IngestError, Result } from '../../src/shared/ingest/types';
import type { Fixture } from '../fixtures/ingest/corpus45';

export const defaultRegistry = createDefaultRegistry();

export interface Answers {
  /** Decisions to start from (for example adapter options of a file that needs a confirmation). */
  base?: Decisions;
  warehouse?: Array<[string, string]>;
  status?: Array<[string, string]>;
  constants?: Array<[string, string]>;
  numberPreset?: Decisions['numberPreset'];
  datePreset?: Decisions['datePreset'];
  kind?: Decisions['kind'];
  /** Do not confirm structural rows (keep total rows in the data). */
  keepStructural?: boolean;
}

export function inputOf(f: Fixture, decisions?: Decisions, extra: Partial<PipelineInput> = {}): PipelineInput {
  return { bytes: f.bytes, fileName: f.hints.fileName, decisions, ...extra };
}

export async function analyze(input: PipelineInput, env: Partial<PipelineEnv> = {}, registry: AdapterLookup = defaultRegistry): Promise<Result<Analysis>> {
  return analyzeFile(input, { registry, ...env });
}

/** Re-runs the analysis, answering every question the preview asks, until Confirm is enabled or no answer helps. */
export async function settle(input: PipelineInput, answers: Answers = {}, env: Partial<PipelineEnv> = {}, registry: AdapterLookup = defaultRegistry): Promise<Result<Analysis>> {
  let decisions: Decisions = { ...answers.base };
  if (answers.kind !== undefined) decisions = { ...decisions, kind: answers.kind };
  if (answers.numberPreset !== undefined) decisions = { ...decisions, numberPreset: answers.numberPreset };
  if (answers.datePreset !== undefined) decisions = { ...decisions, datePreset: answers.datePreset };
  if (answers.constants !== undefined) decisions = { ...decisions, constants: new Map(answers.constants) };
  if (answers.warehouse !== undefined) decisions = { ...decisions, warehouseChoices: new Map(answers.warehouse) };
  if (answers.status !== undefined) decisions = { ...decisions, statusChoices: new Map(answers.status) };
  let last: Result<Analysis> = { ok: false, error: { code: 'INTERNAL', stage: 'read', message: 'not run' } as IngestError };
  for (let i = 0; i < 5; i++) {
    last = await analyzeFile({ ...input, decisions }, { registry, ...env });
    if (!last.ok || last.value.preview.canConfirm) return last;
    const p = last.value.preview;
    const next: Decisions = {
      ...decisions,
      acknowledgedColumns: p.columns.filter((c) => c.state === 'check').map((c) => c.index),
      acknowledgedChoices: p.choices.filter((c) => c.status === 'needs-confirmation').map((c) => c.key),
      excludedRows: answers.keepStructural === true ? decisions.excludedRows : (p.structure?.structuralRows ?? []).map((r) => r.rowIndex)
    };
    if (JSON.stringify([next.acknowledgedColumns, next.acknowledgedChoices, next.excludedRows]) === JSON.stringify([decisions.acknowledgedColumns, decisions.acknowledgedChoices, decisions.excludedRows])) return last;
    decisions = next;
  }
  return last;
}

export function blockerCodes(result: Result<Analysis>): string[] {
  return result.ok ? result.value.preview.blockers.map((b) => b.code) : ['ERROR:' + result.error.code];
}

export function must(result: Result<Analysis>): Analysis {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}
