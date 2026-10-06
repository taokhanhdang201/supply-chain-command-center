// The pipeline: stage orchestration for one file, as a pure function of (bytes, hints, registry, decisions, limits).
//   detect -> probe -> read -> flatten -> structure -> map -> presets/value maps/constants -> canonical CSV ->
//   payload limits -> dry-run (the unchanged V1 importers) -> preview model.
// It knows no format: detection, extraction and the format's own choices come from the registered adapters. The user's
// decisions come in as data and are applied on top of the deterministic proposal, never instead of it. Fatal problems
// (unknown type, limits, unreadable file) are returned as an IngestError; everything the user can still resolve
// (choices, columns to check, ambiguous formats, unresolved values) is a BLOCKER in the preview: Confirm stays
// disabled until there are none. Cancellation is an AbortSignal checked between stages; progress is a callback; the
// optional clock enforces the parse and validation time budgets. No clock, network or randomness is used otherwise.

import type { ImportKind } from '../types';
import { SHIPMENT_STATUSES } from '../types';
import { WAREHOUSE_CODES } from '../reference/locations';
import type { AdapterLookup, Ctx, DetectionResult, FormatAdapter, Hints, IngestError, RawTable, ReadOptions, Result } from './types';
import { detectFormat, makeHints } from './detect/arbiter';
import { HEAD_BYTES, byteSourceFrom } from './detect/bytes';
import {
  limitsForAdapter,
  parseTimedOut,
  payloadTooLarge,
  payloadTooManyRows,
  resolveLimits,
  sourceTooLarge,
  tooManyColumns,
  tooManyRows,
  tooManyScanRows,
  validateTimedOut,
  type LimitConfig
} from './limits';
import { ingestError, messageText } from './messages';
import { flattenRecords } from './flatten/records';
import { inferTables, type TableInference } from './flatten/positioned';
import { applyStructure, columnCells, detectStructure, findStructuralRows, type StructuredTable } from './structure/detectStructure';
import { detectDataset, profilesOf, proposeForTable, type MappingProposal } from './mapping/report';
import { recognizesHeader } from './mapping/dictionary';
import { normalizeHeader } from './mapping/normalizeHeader';
import { distinctValues, mapStatusValues, mapWarehouseValues, summarizeLocations, type ValueMapEntry } from './mapping/valueMaps';
import { detectDatePreset, detectNumberPreset, type PresetOutcome } from './normalize/detectPreset';
import { NUMBER_PRESET_LABEL, decideCurrency, scanCurrency, type NumberPreset } from './normalize/numbers';
import { DATE_PRESET_EXAMPLE, type DatePreset } from './normalize/dates';
import { fieldsOf, isDateField, isNumberField, type FieldInfo } from './canonical/schemaRegistry';
import { buildCanonicalCsv, type BuildOutput } from './canonical/buildCsv';
import { dryRun, type DryRunResult } from './validate/dryRun';
import { formatRowRef } from './preview/sourceRef';
import {
  PREVIEW_PROBLEM_ROWS,
  PREVIEW_SAMPLE_ROWS,
  confirmReason,
  restatementText,
  type Blocker,
  type PresetView,
  type PreviewColumn,
  type PreviewModel,
  type ProblemRow,
  type SampleRow
} from './preview/model';

export type PipelineStage = 'detect' | 'probe' | 'read' | 'structure' | 'map' | 'normalize' | 'validate';

/** Everything the user decided so far, as plain data (Maps and arrays survive structured cloning). */
export interface Decisions {
  /** Answers to the adapter's own choices (encoding, separator, ...), keyed like `AdapterChoice.key`. */
  options?: ReadonlyMap<string, string>;
  /** Keys of "needs confirmation" choices the user has acknowledged. */
  acknowledgedChoices?: readonly string[];
  tableIndex?: number;
  /** "Header is on row N" (0-based index into the table rows). */
  headerRow?: number;
  /** Structural rows (repeated headers, totals, footers) the user confirmed to exclude. */
  excludedRows?: readonly number[];
  kind?: ImportKind;
  /** Column index -> canonical field, or null for "Do not import". */
  assignments?: ReadonlyMap<number, string | null>;
  /** CHECK columns the user acknowledged ("Looks right"). */
  acknowledgedColumns?: readonly number[];
  numberPreset?: NumberPreset;
  datePreset?: DatePreset;
  statusChoices?: ReadonlyMap<string, string>;
  warehouseChoices?: ReadonlyMap<string, string>;
  /** File-wide constants for fields whose policy allows one. */
  constants?: ReadonlyMap<string, string>;
}

export interface PipelineInput {
  bytes: Uint8Array;
  fileName: string;
  mimeType?: string | null;
  /** What the server holds now, for the destructive restatement. */
  current?: Partial<Record<ImportKind, { label: string; rowCount: number }>>;
  decisions?: Decisions;
  limitConfig?: LimitConfig;
}

export interface PipelineEnv {
  registry: AdapterLookup & { isDisabled?: (id: string) => boolean };
  signal?: AbortSignal;
  progress?: (stage: PipelineStage, fraction: number) => void;
  /** Milliseconds clock for the time budgets (layer d); without it no budget is enforced. */
  clock?: () => number;
  /** The registered table-inference step for positioned-text sources. */
  inference?: TableInference;
}

export interface Analysis {
  preview: PreviewModel;
  /** The canonical payload when it could be built (present even while blockers remain, never to be sent until canConfirm). */
  canonical: { csv: string; fileName: string; bytes: number; rowCount: number } | null;
  kind: ImportKind | null;
}

const EMPTY = new Map<string, string>();

function fail(error: IngestError): { ok: false; error: IngestError } {
  return { ok: false, error };
}

function emptyPreview(base: Pick<PreviewModel, 'file' | 'choices'> & Partial<PreviewModel>): PreviewModel {
  const blockers = base.blockers ?? [];
  return {
    tables: [],
    structure: null,
    dataset: { kind: null, chosenByUser: false, scores: [] },
    columns: [],
    fields: [],
    presets: { number: null, date: null, currency: { kind: 'ok', markers: [], message: null }, timestampsStripped: 0, placeholders: 0, markersStripped: 0 },
    valueMaps: { status: null, warehouse: null, locations: null },
    constants: [],
    notImported: [],
    sample: { columns: [], rows: [], problemRows: [] },
    counts: { rowsRead: 0, rowsImported: null, excluded: [], rowsWithProblems: 0, columnsMapped: 0, columnsIgnored: 0, columnsConstant: 0, columnsTotal: 0 },
    validation: { ran: false, ok: false, issues: [], totalErrors: 0, warnings: [] },
    restatement: null,
    canConfirm: blockers.length === 0,
    confirmBlockedReason: confirmReason(blockers),
    ...base,
    blockers
  };
}

function presetView<P extends string>(outcome: PresetOutcome<P>, override: P | undefined, defaultPreset: P, describe: (p: P) => string): { view: PresetView<P>; effective: P | null } {
  if (override !== undefined) {
    return { view: { kind: 'unique', preset: override, needsNormalization: true, chosenByUser: true, note: `Chosen by you: ${describe(override)}` }, effective: override };
  }
  switch (outcome.kind) {
    case 'unique':
      return { view: { kind: 'unique', preset: outcome.preset, needsNormalization: outcome.needsNormalization, chosenByUser: false, note: `Detected: ${describe(outcome.preset)}` }, effective: outcome.preset };
    case 'equivalent':
      return { view: { kind: 'equivalent', preset: outcome.preset, needsNormalization: outcome.needsNormalization, chosenByUser: false, note: `Detected: ${describe(outcome.preset)} (the other readings give the same values)` }, effective: outcome.preset };
    case 'ambiguous':
      return { view: { kind: 'ambiguous', candidates: outcome.candidates, preset: null, chosenByUser: false, note: 'These values can be read in more than one way. Choose the format of this file.' }, effective: null };
    case 'mixed':
      return { view: { kind: 'mixed', groups: outcome.groups, preset: null, chosenByUser: false, note: 'The values use different formats. Fix the file or choose the format of most of them.' }, effective: null };
    case 'none':
      return { view: { kind: 'none', preset: defaultPreset, chosenByUser: false, note: 'Nothing to convert.' }, effective: defaultPreset };
  }
}

function textsOf(structured: StructuredTable, index: number): string[] {
  return columnCells(structured, index).filter((c) => c.t === 'text' && c.v.trim() !== '').map((c) => c.v);
}

export async function analyzeFile(input: PipelineInput, env: PipelineEnv): Promise<Result<Analysis>> {
  const decisions: Decisions = input.decisions ?? {};
  const options = decisions.options ?? EMPTY;
  const progress = env.progress ?? (() => undefined);
  const clock = env.clock;
  const started = clock?.() ?? 0;
  const base = resolveLimits(input.limitConfig);
  const cancelled = (): boolean => env.signal?.aborted === true;
  const cancel = () => fail(ingestError('CANCELLED', 'read'));
  const overBudget = (): boolean => clock !== undefined && clock() - started > base.parseBudgetMs;

  // ---- detect ---------------------------------------------------------------------------------------------------------------
  progress('detect', 0.02);
  if (input.bytes.length > base.sourceBytesGlobal) {
    const e = sourceTooLarge(base, null, input.bytes.length);
    if (e !== null) return fail(e);
  }
  const hints: Hints = makeHints(input.fileName, input.mimeType ?? null);
  const detection: DetectionResult = detectFormat(input.bytes.subarray(0, HEAD_BYTES), hints, env.registry, input.bytes.length);
  if (detection.outcome !== 'chosen' || detection.chosen === null) return fail(detection.error ?? ingestError('UNKNOWN_TYPE', 'detect'));
  const adapter = env.registry.get(detection.chosen.adapterId) as FormatAdapter;
  const limits = limitsForAdapter(base, adapter.descriptor, input.limitConfig);
  const tooLarge = sourceTooLarge(limits, adapter.descriptor, input.bytes.length);
  if (tooLarge !== null) return fail(tooLarge);
  if (cancelled()) return cancel();

  const ctx: Ctx = {
    signal: env.signal ?? new AbortController().signal,
    limits,
    registry: env.registry,
    progress: () => undefined,
    clock: clock ?? (() => 0),
    depth: 0,
    hints,
    recognizeHeader: recognizesHeader
  };
  const src = byteSourceFrom(input.bytes);
  const optionRecord: Record<string, string> = {};
  for (const [k, v] of options) optionRecord[k] = v;

  // ---- probe ----------------------------------------------------------------------------------------------------------------
  progress('probe', 0.08);
  const probed = await adapter.probe(src, ctx, optionRecord);
  if (!probed.ok) return probed;
  const probe = probed.value;
  const fileInfo: PreviewModel['file'] = {
    name: input.fileName,
    sizeBytes: input.bytes.length,
    family: detection.chosen.family,
    adapterId: adapter.descriptor.id,
    evidence: [...detection.chosen.evidence, ...probe.evidence],
    notices: [...detection.notices, ...probe.notices]
  };

  const blockers: Blocker[] = [];
  let mustStop = false;
  for (const c of probe.choices) {
    const chosen = options.has(c.key);
    if (c.status === 'choose' && !chosen) {
      blockers.push({ code: 'choose-choice', message: `Choose the ${c.label.toLowerCase()} of this file.`, fatal: false, field: c.key });
      mustStop = true;
    } else if (c.status === 'needs-confirmation' && !chosen) {
      const acknowledged = decisions.acknowledgedChoices?.includes(c.key) === true;
      if (!acknowledged) blockers.push({ code: 'confirm-choice', message: `Confirm the ${c.label.toLowerCase()}: it was guessed, not certain.`, fatal: false, field: c.key });
      // Some guesses must never be applied before the user confirms them (the adapter says the file cannot be read until then).
      if (c.blocksRead === true) mustStop = true;
    }
  }
  if (mustStop) {
    const tables = probe.tables.map((t, i) => ({ name: t.name, hidden: t.hidden, rows: t.rowCountEstimate ?? null, selected: i === (decisions.tableIndex ?? 0) }));
    return { ok: true, value: { preview: emptyPreview({ file: fileInfo, choices: probe.choices, tables, blockers }), canonical: null, kind: null } };
  }
  if (cancelled()) return cancel();

  // ---- read -----------------------------------------------------------------------------------------------------------------
  progress('read', 0.25);
  const readOptions: ReadOptions = { maxRows: limits.maxScanRows };
  const firstVisibleProbe = Math.max(0, probe.tables.findIndex((t) => !t.hidden));
  const readIndex = decisions.tableIndex ?? firstVisibleProbe;
  const extraction = await adapter.read(src, { tableIndex: readIndex, options: optionRecord }, readOptions, ctx);
  if (!extraction.ok) return extraction;
  if (cancelled()) return cancel();
  if (overBudget()) return fail(parseTimedOut());

  let tables: RawTable[];
  const result = extraction.value;
  if (result.kind === 'tables') tables = result.tables;
  else if (result.kind === 'records') tables = flattenRecords(adapter.descriptor.id, result.name, result.records, { maxRows: limits.maxScanRows, maxTables: limits.maxTables });
  else if (result.kind === 'positioned-text') tables = inferTables({ adapterId: adapter.descriptor.id, name: result.name, pages: result.pages }, env.inference);
  else return fail(ingestError('NO_READABLE_TEXT', 'read'));
  if (tables.length === 0) return fail(ingestError('NO_TABLE', 'read'));

  // An adapter that reads one table at a time returns just the selected one; one that returns everything is indexed here.
  const visible = tables.map((t, i) => ({ t, i })).filter((x) => !x.t.hidden);
  const probeTableIndex = tables.length === 1 ? 0 : decisions.tableIndex !== undefined && tables[decisions.tableIndex] !== undefined ? decisions.tableIndex : (visible[0]?.i ?? 0);
  const table = tables[probeTableIndex] as RawTable;
  const visibleCount = Math.max(visible.length, probe.tables.filter((t) => !t.hidden).length);
  // Child tables flattened out of nested records are optional detail, not independent candidates.
  if (visibleCount > 1 && decisions.tableIndex === undefined && result.kind !== 'records') {
    blockers.push({ code: 'choose-table', message: `This file has ${visibleCount} tables. Choose the one to import.`, fatal: false });
  }
  if (table.truncated) return fail(tooManyScanRows(limits));
  if (table.columns !== undefined && table.colCount > limits.maxColumns) return fail(tooManyColumns(limits, 1));

  // ---- structure ------------------------------------------------------------------------------------------------------------
  progress('structure', 0.4);
  const structure = detectStructure(table, recognizesHeader);
  const headerRowIndex = decisions.headerRow ?? structure.headerRowIndex;
  const structuralRows = decisions.headerRow === undefined ? structure.structuralRows : findStructuralRows(table, headerRowIndex);
  const confirmedExclusions = (decisions.excludedRows ?? []).filter((r) => r > headerRowIndex && r < table.rows.length);
  const structured = applyStructure(table, headerRowIndex, confirmedExclusions, { ...structure, headerRowIndex, structuralRows });
  if (structured.rows.length > limits.maxDataRows) return fail(tooManyRows(limits));
  if (structured.rows.length === 0) return fail(ingestError('NO_DATA_ROWS', 'structure'));
  if (structure.confidence === 'choose' && decisions.headerRow === undefined && table.columns === undefined) {
    blockers.push({ code: 'confirm-header', message: `Confirm which row holds the column names (row ${structure.headerRowIndex + 1} looks most likely, but it is not certain).`, fatal: false });
  }
  if (cancelled()) return cancel();

  // ---- map ------------------------------------------------------------------------------------------------------------------
  progress('map', 0.55);
  const profiles = profilesOf(structured);
  const guess = detectDataset(structured, undefined, profiles);
  const kind: ImportKind | null = decisions.kind ?? guess.kind;
  if (kind === null) blockers.push({ code: 'choose-dataset', message: 'Choose whether this is inventory or shipments data.', fatal: false });

  const structurePreview: NonNullable<PreviewModel['structure']> = {
    headerRow: formatRowRef(table.origin(headerRowIndex)),
    confidence: structure.confidence,
    evidence: structure.evidence,
    banners: headerRowIndex,
    structuralRows: structuralRows.map((r) => ({ rowIndex: r.rowIndex, kind: r.kind, label: r.label, where: formatRowRef(table.origin(r.rowIndex)), excluded: confirmedExclusions.includes(r.rowIndex) }))
  };
  const tablesPreview: PreviewModel['tables'] =
    tables.length > probe.tables.length
      ? tables.map((t, i) => ({ name: t.name, hidden: t.hidden, rows: t.rowCount, selected: i === probeTableIndex }))
      : probe.tables.map((t, i) => ({ name: t.name, hidden: t.hidden, rows: t.rowCountEstimate ?? null, selected: i === (tables.length === 1 ? readIndex : probeTableIndex) }));

  const rowsRead = Math.max(0, table.rows.length - (table.columns !== undefined ? 0 : headerRowIndex + 1));
  const excludedSummary = (build: BuildOutput | null): Array<{ reason: string; count: number }> => {
    const out = new Map<string, number>();
    for (const e of structured.excluded) out.set(e.kind, (out.get(e.kind) ?? 0) + 1);
    if (build !== null && build.stats.blankRows > 0) out.set('blank', build.stats.blankRows);
    return [...out.entries()].map(([reason, count]) => ({ reason, count }));
  };

  if (kind === null) {
    const preview = emptyPreview({
      file: fileInfo,
      choices: probe.choices,
      tables: tablesPreview,
      structure: structurePreview,
      dataset: { kind: null, chosenByUser: false, scores: guess.scores },
      columns: structured.headers.map((header, index) => ({ index, header, example: firstValue(structured, index), state: 'ignored', field: null, confidence: null, candidates: [], competingWith: [], evidence: [], warnings: [], chosenByUser: false, acknowledged: false })),
      counts: { rowsRead, rowsImported: null, excluded: excludedSummary(null), rowsWithProblems: 0, columnsMapped: 0, columnsIgnored: 0, columnsConstant: 0, columnsTotal: structured.headers.length },
      blockers
    });
    return { ok: true, value: { preview, canonical: null, kind: null } };
  }

  const proposal: MappingProposal = proposeForTable(kind, structured, undefined, profiles);
  const schema = fieldsOf(kind);
  const fieldByName = new Map<string, FieldInfo>(schema.map((f) => [f.name, f]));

  // Effective mapping: the deterministic proposal with the user's decisions on top.
  const eff = proposal.columns.map((c): PreviewColumn => {
    const override = decisions.assignments?.get(c.index);
    const chosenByUser = override !== undefined;
    let field: string | null = null;
    let state = c.state;
    if (chosenByUser) {
      field = override !== null && fieldByName.has(override) ? override : null;
      state = field === null ? 'ignored' : 'matched';
    } else if (c.state === 'matched' || c.state === 'check') field = c.field;
    const acknowledged = chosenByUser || c.state === 'matched' || decisions.acknowledgedColumns?.includes(c.index) === true;
    return {
      index: c.index,
      header: c.header,
      example: firstValue(structured, c.index),
      state,
      field,
      confidence: c.confidence,
      candidates: c.candidates,
      competingWith: c.competingWith,
      evidence: c.evidence,
      warnings: c.warnings,
      chosenByUser,
      acknowledged
    };
  });
  const label = (h: string): string => (h.trim() === '' ? '(blank)' : h.trim().slice(0, 60));
  for (const c of eff) {
    if (c.chosenByUser) continue;
    if (c.state === 'choose') blockers.push({ code: 'choose-column', message: `Choose an SCC field for the column "${label(c.header)}", or mark it "Do not import".`, fatal: false, columnIndex: c.index });
    else if (c.state === 'check' && !c.acknowledged) blockers.push({ code: 'check-column', message: `Check that the column "${label(c.header)}" is ${c.field}, then confirm it.`, fatal: false, columnIndex: c.index, field: c.field ?? undefined });
  }

  const assignment = new Map<string, number>();
  const fieldStatuses: PreviewModel['fields'] = [];
  const constants = new Map<string, string>();
  for (const f of schema) {
    const cols = eff.filter((c) => c.field === f.name);
    const constantRaw = decisions.constants?.get(f.name)?.trim();
    const constantOk = f.constantAllowed && constantRaw !== undefined && constantRaw !== '' && (f.name !== 'status' || (SHIPMENT_STATUSES as readonly string[]).includes(constantRaw)) && (f.name !== 'warehouse' || WAREHOUSE_CODES.includes(constantRaw));
    let state: 'mapped' | 'pending' | 'missing' = 'missing';
    let unknown = false;
    if (cols.length > 1) {
      blockers.push({ code: 'duplicate-field', message: `${f.name} is chosen for more than one column (${cols.map((c) => `"${label(c.header)}"`).join(', ')}). Keep only one.`, fatal: false, field: f.name });
      state = 'mapped';
      assignment.set(f.name, (cols[0] as PreviewColumn).index);
    } else if (cols.length === 1) {
      state = 'mapped';
      assignment.set(f.name, (cols[0] as PreviewColumn).index);
    } else if (constantOk) {
      constants.set(f.name, constantRaw as string);
    } else if (f.unknownAllowed) {
      unknown = true; // imported as unknown: an empty column is emitted and the consequence is stated by V1's own warnings
    } else if (f.constantAllowed) {
      blockers.push({ code: 'missing-constant', message: `No column provides ${f.name}. Enter one value for the whole file, or map a column to it.`, fatal: false, field: f.name });
    } else {
      blockers.push({ code: 'missing-required', message: `Required field ${f.name} has no column. Found columns: ${structured.headers.map(label).join(', ') || '(none)'}.`, fatal: false, field: f.name });
    }
    if (state === 'missing' && eff.some((c) => c.state === 'choose' && c.candidates.some((x) => x.field === f.name))) state = 'pending';
    const options: Array<'unknown' | 'constant'> = [];
    if (f.unknownAllowed) options.push('unknown');
    if (f.constantAllowed) options.push('constant');
    fieldStatuses.push({
      field: f.name,
      requiredColumn: f.spec.requiredColumn,
      requiredValue: f.spec.requiredValue,
      state,
      columnIndex: assignment.get(f.name) ?? null,
      options,
      blocksImport: state === 'missing' && !unknown && !constants.has(f.name) && options.length === 0,
      label: f.name,
      constant: constants.get(f.name) ?? null,
      unknown
    });
  }

  // ---- presets, currency, value maps ------------------------------------------------------------------------------------------
  progress('normalize', 0.7);
  const numberTexts: string[] = [];
  const dateTexts: string[] = [];
  for (const f of schema) {
    const idx = assignment.get(f.name);
    if (idx === undefined) continue;
    if (isNumberField(f)) numberTexts.push(...textsOf(structured, idx));
    if (isDateField(f)) dateTexts.push(...textsOf(structured, idx));
  }
  const numberOutcome = detectNumberPreset(numberTexts);
  const dateOutcome = detectDatePreset(dateTexts);
  const numberResolved = presetView(numberOutcome, decisions.numberPreset, 'plain' as NumberPreset, (p) => NUMBER_PRESET_LABEL[p]);
  const dateResolved = presetView(dateOutcome, decisions.datePreset, 'iso' as DatePreset, (p) => DATE_PRESET_EXAMPLE[p]);
  if (numberResolved.effective === null) blockers.push({ code: 'choose-number-format', message: messageText('CHOOSE_NUMBER_FORMAT'), fatal: false });
  if (dateResolved.effective === null) blockers.push({ code: 'choose-date-format', message: messageText('CHOOSE_DATE_FORMAT'), fatal: false });

  const currencyMarkers: string[] = [];
  let currencyKind = 'ok' as 'ok' | 'foreign' | 'mixed';
  for (const f of schema.filter((x) => x.valueKind === 'money')) {
    const idx = assignment.get(f.name);
    if (idx === undefined) continue;
    const headerMarkers = normalizeHeader(structured.headers[idx] ?? '').hints.filter((h) => h.kind === 'currency').map((h) => h.text);
    const decision = decideCurrency(scanCurrency(textsOf(structured, idx)), headerMarkers);
    if (decision.kind !== 'ok') {
      currencyKind = decision.kind === 'mixed' || currencyKind === 'mixed' ? 'mixed' : 'foreign';
      for (const m of decision.markers) if (!currencyMarkers.includes(m)) currencyMarkers.push(m);
    }
  }
  const currencyMessage =
    currencyKind === 'ok'
      ? null
      : (currencyKind === 'foreign' ? ingestError('CURRENCY_UNSUPPORTED', 'normalize', { markers: currencyMarkers.join(', ') }) : ingestError('CURRENCY_MIXED', 'normalize', { markers: currencyMarkers.join(', ') })).message;
  if (currencyMessage !== null) blockers.push({ code: 'currency', message: currencyMessage, fatal: true });

  const validStatus = new Set<string>(SHIPMENT_STATUSES);
  const statusChoices = new Map<string, string>();
  for (const [k, v] of decisions.statusChoices ?? EMPTY) if (validStatus.has(v)) statusChoices.set(k, v);
  const warehouseChoices = new Map<string, string>();
  for (const [k, v] of decisions.warehouseChoices ?? EMPTY) if (WAREHOUSE_CODES.includes(v)) warehouseChoices.set(k, v);
  const resolveEntries = (entries: Array<ValueMapEntry<string>>, choices: ReadonlyMap<string, string>): Array<ValueMapEntry<string> & { chosenByUser: boolean }> =>
    entries.map((e) => {
      const choice = choices.get(e.source);
      return choice !== undefined ? { ...e, target: choice, state: 'mapped' as const, evidence: `chosen by you: "${e.source}" is ${choice}`, chosenByUser: true } : { ...e, chosenByUser: false };
    });
  let statusMap: PreviewModel['valueMaps']['status'] = null;
  const statusIdx = assignment.get('status');
  if (statusIdx !== undefined) {
    statusMap = resolveEntries(mapStatusValues(distinctValues(columnCells(structured, statusIdx).map((c) => c.v))), statusChoices);
    const open = statusMap.filter((e) => e.state === 'choose');
    if (open.length > 0) blockers.push({ code: 'choose-status', message: `${open.length} status value${open.length === 1 ? '' : 's'} need an SCC status: ${open.slice(0, 5).map((e) => `"${e.source.slice(0, 30)}"`).join(', ')}.`, fatal: false });
  }
  let warehouseMap: PreviewModel['valueMaps']['warehouse'] = null;
  const warehouseIdx = kind === 'inventory' ? assignment.get('warehouse') : undefined;
  if (warehouseIdx !== undefined) {
    warehouseMap = resolveEntries(mapWarehouseValues(distinctValues(columnCells(structured, warehouseIdx).map((c) => c.v))), warehouseChoices);
    const open = warehouseMap.filter((e) => e.state === 'choose');
    if (open.length > 0) blockers.push({ code: 'choose-warehouse', message: `${open.length} warehouse value${open.length === 1 ? '' : 's'} are not SCC warehouses: choose a known warehouse for ${open.slice(0, 5).map((e) => `"${e.source.slice(0, 30)}"`).join(', ')}, or fix the file.`, fatal: false });
  }
  let locations: PreviewModel['valueMaps']['locations'] = null;
  if (kind === 'shipments') {
    const values = ['origin', 'destination'].flatMap((f) => (assignment.has(f) ? columnCells(structured, assignment.get(f) as number).map((c) => c.v) : []));
    if (values.length > 0) locations = summarizeLocations(values);
  }
  if (cancelled()) return cancel();

  // ---- canonical CSV, payload limits, dry-run ---------------------------------------------------------------------------------
  const build = buildCanonicalCsv({
    kind,
    table,
    structured,
    assignment,
    numberPreset: numberResolved.effective ?? 'plain',
    datePreset: dateResolved.effective ?? 'iso',
    statusChoices,
    warehouseChoices,
    constants,
    headerWidth: table.columns === undefined ? (table.rows[headerRowIndex]?.length ?? 0) : undefined
  });
  if (build.rowCount === 0 && build.ragged.length === 0) blockers.push({ code: 'no-rows', message: 'The file has a header but no data rows.', fatal: true });
  const payloadError = payloadTooLarge(limits, build.bytes) ?? payloadTooManyRows(limits, build.rowCount);
  if (payloadError !== null) blockers.push({ code: 'too-large', message: payloadError.message, fatal: true });

  let validation: DryRunResult | null = null;
  if (blockers.length === 0) {
    progress('validate', 0.9);
    const vStart = clock?.() ?? 0;
    validation = dryRun({
      kind,
      csv: build.csv,
      lineToSource: build.lineToSource,
      rowLines: build.rowLines,
      canonicalRows: build.canonicalRows,
      rawRows: build.rawRows,
      numberPreset: numberResolved.effective ?? 'plain',
      datePreset: dateResolved.effective ?? 'iso',
      limits,
      ragged: build.ragged,
      sourceRowIndex: build.sourceRowIndex,
      originOf: (r) => table.origin(r)
    });
    if (clock !== undefined && clock() - vStart > base.validateBudgetMs) return fail(validateTimedOut());
    if (!validation.ok) {
      blockers.push({ code: 'validation', message: `${validation.totalErrors} problem${validation.totalErrors === 1 ? '' : 's'} found in the data. Nothing will be imported until the file is fixed.`, fatal: false });
    }
  }
  progress('validate', 1);

  // ---- preview model ----------------------------------------------------------------------------------------------------------
  const sampleColumns = schema.filter((f) => assignment.has(f.name) || constants.has(f.name)).map((f) => f.name);
  const colIndex = schema.map((f) => f.name);
  const pick = (row: readonly string[]): string[] => sampleColumns.map((name) => row[colIndex.indexOf(name)] ?? '');
  const sourceOf = (k: number): string => formatRowRef(table.origin(build.sourceRowIndex[k] as number));
  const sampleRows: SampleRow[] = build.canonicalRows.slice(0, PREVIEW_SAMPLE_ROWS).map((row, k) => ({ source: sourceOf(k), raw: pick(build.rawRows[k] as string[]), canonical: pick(row) }));
  const problemRows: ProblemRow[] = [];
  if (validation !== null && !validation.ok) {
    for (const d of validation.issues) {
      if (d.rowIndex === null) continue;
      const k = build.sourceRowIndex.indexOf(d.rowIndex);
      const source = formatRowRef(table.origin(d.rowIndex));
      let row = problemRows.find((p) => p.source === source);
      if (row === undefined) {
        if (problemRows.length >= PREVIEW_PROBLEM_ROWS) continue;
        // a row left out of the CSV for its width has no canonical form: show the cells as written
        row = k >= 0
          ? { source, raw: pick(build.rawRows[k] as string[]), canonical: pick(build.canonicalRows[k] as string[]), issues: [] }
          : { source, raw: (table.rows[d.rowIndex] ?? []).map((c) => c.v), canonical: [], issues: [] };
        problemRows.push(row);
      }
      row.issues.push({ column: d.issue.column, message: d.message });
    }
  }
  const mappedCount = eff.filter((c) => c.field !== null).length;
  const notImported = eff.filter((c) => c.field === null && c.state !== 'choose').map((c) => ({ index: c.index, header: c.header, reason: c.state === 'ignored' && c.chosenByUser ? 'You chose not to import it.' : (c.evidence[0] ?? 'No SCC field matches this column.') }));
  const rowsWithProblems = validation !== null && !validation.ok ? new Set(validation.issues.map((i) => i.rowIndex).filter((r) => r !== null)).size : 0;
  const validationView: PreviewModel['validation'] =
    validation === null
      ? { ran: false, ok: false, issues: [], totalErrors: 0, warnings: [] }
      : validation.ok
        ? { ran: true, ok: true, issues: [], totalErrors: 0, warnings: validation.warnings }
        : { ran: true, ok: false, issues: validation.issues, totalErrors: validation.totalErrors, warnings: validation.warnings };
  const sourceLabel = `${input.fileName}${tables.length > 1 || visibleCount > 1 ? ` > ${table.name}` : ''}`;
  const preview: PreviewModel = {
    file: fileInfo,
    choices: probe.choices,
    tables: tablesPreview,
    structure: structurePreview,
    dataset: { kind, chosenByUser: decisions.kind !== undefined, scores: guess.scores },
    columns: eff,
    fields: fieldStatuses,
    presets: {
      number: numberTexts.length === 0 && decisions.numberPreset === undefined ? null : numberResolved.view,
      date: dateTexts.length === 0 && decisions.datePreset === undefined ? null : dateResolved.view,
      currency: { kind: currencyKind, markers: currencyMarkers, message: currencyMessage },
      timestampsStripped: build.stats.timestampsStripped,
      placeholders: build.stats.placeholders,
      markersStripped: build.stats.markersStripped
    },
    valueMaps: { status: statusMap, warehouse: warehouseMap, locations },
    constants: [...constants.entries()].map(([field, value]) => ({ field, value })),
    notImported,
    sample: { columns: sampleColumns, rows: sampleRows, problemRows },
    counts: {
      rowsRead,
      rowsImported: validation !== null && validation.ok ? validation.rowCount : null,
      excluded: excludedSummary(build),
      rowsWithProblems,
      columnsMapped: mappedCount,
      columnsIgnored: eff.length - mappedCount,
      columnsConstant: constants.size,
      columnsTotal: eff.length
    },
    validation: validationView,
    restatement: build.rowCount > 0 ? restatementText(kind, input.current?.[kind], build.rowCount, sourceLabel) : null,
    blockers,
    canConfirm: blockers.length === 0,
    confirmBlockedReason: confirmReason(blockers)
  };
  return { ok: true, value: { preview, canonical: { csv: build.csv, fileName: input.fileName, bytes: build.bytes, rowCount: build.rowCount }, kind } };
}

function firstValue(structured: StructuredTable, index: number): string {
  for (const row of structured.rows) {
    const v = (row[index]?.v ?? '').trim();
    if (v !== '') return v.length > 60 ? `${v.slice(0, 59)}…` : v;
  }
  return '';
}
