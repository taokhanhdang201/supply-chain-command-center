// The flow state machine of the universal import card. It drives the pipeline through an `IngestRunner` (a module Worker
// in the browser, the inline runner where no Worker exists), keeps the user's decisions as plain data, re-runs the
// analysis after every decision (the pipeline applies the decisions on top of its deterministic proposal) and uploads the
// canonical CSV through the unchanged `importCsv(kind, file)` only after Confirm. File content and names are never
// logged; every text shown comes from the message catalogue or from the preview model.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ImportIssue, ImportKind } from '../../shared/types';
import type { ApiError } from '../api/apiClient';
import type { LimitConfig } from '../../shared/ingest/limits';
import { resolveLimits, sourceTooLarge } from '../../shared/ingest/limits';
import { ingestError } from '../../shared/ingest/messages';
import type { IngestError } from '../../shared/ingest/types';
import type { Analysis, Decisions, PipelineInput, PipelineStage } from '../../shared/ingest/pipeline';
import type { DatePreset } from '../../shared/ingest/normalize/dates';
import type { NumberPreset } from '../../shared/ingest/normalize/numbers';
import { InlineRunner, WorkerRunner, type IngestRunner } from './runner';
import { countOf } from './importStory';
import { useData, useSnapshot } from '../state/DataContext';

export type FlowPhase = 'idle' | 'reading' | 'review' | 'uploading';
export type FocusTarget = 'picker' | 'heading' | 'banner' | null;

export interface FlowResult {
  tone: 'success' | 'critical';
  title: string;
  warnings?: string[];
  issues?: ImportIssue[];
  totalErrors?: number;
  /** What was imported; `version` is what the server needs to undo it (absent once undone or when it cannot be). */
  imported?: { kind: ImportKind; rowCount: number; label: string; version?: number };
  /** The import was taken back. */
  undone?: boolean;
}

export interface SourceInfo {
  name: string;
  size: number;
  origin: 'file' | 'paste';
}

export interface FlowProgress {
  stage: PipelineStage;
  fraction: number;
}

export interface UseIngestFlowOptions {
  /** Tests inject a runner; the app picks a module worker when the browser has one. */
  runner?: IngestRunner;
}

export interface IngestFlow {
  phase: FlowPhase;
  /** An analysis is running (the previous one stays visible until it finishes). */
  busy: boolean;
  source: SourceInfo | null;
  analysis: Analysis | null;
  error: IngestError | null;
  progress: FlowProgress | null;
  decisions: Decisions;
  result: FlowResult | null;
  focus: FocusTarget;
  clearFocus(): void;
  startFile(file: File, presetKind?: ImportKind): void;
  startPaste(text: string): void;
  /** Cancel: stops the work (the worker is terminated), clears the flow and returns focus to the file picker. */
  cancel(): void;
  /** Clears the flow without moving focus (a new file was chosen). */
  reset(): void;
  confirm(): Promise<void>;
  /** Takes the last import back (one step); says plainly when the data changed since and it cannot. */
  undo(): Promise<void>;
  /** An undo is on its way to the server. */
  undoing: boolean;
  setOption(key: string, value: string): void;
  acknowledgeChoice(key: string): void;
  setTable(index: number): void;
  setHeaderRow(rowIndex: number | undefined): void;
  setExcluded(rowIndex: number, excluded: boolean): void;
  setKind(kind: ImportKind | undefined): void;
  assign(columnIndex: number, field: string | null | undefined): void;
  acknowledgeColumn(columnIndex: number): void;
  setNumberPreset(preset: NumberPreset | undefined): void;
  setDatePreset(preset: DatePreset | undefined): void;
  /** The date format of one column (canonical field name). */
  setDatePresetFor(field: string, preset: DatePreset | undefined): void;
  setStatus(source: string, target: string | undefined): void;
  setWarehouse(source: string, target: string | undefined): void;
  setConstant(field: string, value: string | undefined): void;
}

const NO_DECISIONS: Decisions = {};

/** What each kind of decision invalidates (the later stages are re-derived from the pipeline's proposal). */
function keepOptionsOnly(d: Decisions): Decisions {
  const next: Decisions = {};
  if (d.options !== undefined) next.options = d.options;
  if (d.acknowledgedChoices !== undefined) next.acknowledgedChoices = d.acknowledgedChoices;
  return next;
}

function keepFromTable(d: Decisions): Decisions {
  const next = keepOptionsOnly(d);
  if (d.tableIndex !== undefined) next.tableIndex = d.tableIndex;
  if (d.headerRow !== undefined) next.headerRow = d.headerRow;
  if (d.excludedRows !== undefined) next.excludedRows = d.excludedRows;
  return next;
}

function withMap<V>(map: ReadonlyMap<string, V> | undefined, key: string, value: V | undefined): Map<string, V> | undefined {
  const next = new Map(map ?? []);
  if (value === undefined) next.delete(key);
  else next.set(key, value);
  return next.size === 0 ? undefined : next;
}

function setOrDrop<K extends keyof Decisions>(d: Decisions, key: K, value: Decisions[K] | undefined): Decisions {
  const next = { ...d };
  if (value === undefined) delete next[key];
  else next[key] = value;
  return next;
}

async function readBytes(file: File): Promise<Uint8Array> {
  if (typeof file.arrayBuffer === 'function') return new Uint8Array(await file.arrayBuffer());
  return new Promise<Uint8Array>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(new Error('read'));
    reader.readAsArrayBuffer(file);
  });
}

function defaultRunner(): IngestRunner {
  return typeof Worker === 'undefined' ? new InlineRunner() : new WorkerRunner();
}

export function useIngestFlow(options: UseIngestFlowOptions = {}): IngestFlow {
  const snapshot = useSnapshot();
  const { api, refresh } = useData();
  const [phase, setPhase] = useState<FlowPhase>('idle');
  const [busy, setBusy] = useState(false);
  const [source, setSource] = useState<SourceInfo | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [error, setError] = useState<IngestError | null>(null);
  const [progress, setProgress] = useState<FlowProgress | null>(null);
  const [decisions, setDecisions] = useState<Decisions>(NO_DECISIONS);
  const [result, setResult] = useState<FlowResult | null>(null);
  const [focus, setFocus] = useState<FocusTarget>(null);
  const [undoing, setUndoing] = useState(false);

  const bytesRef = useRef<Uint8Array | null>(null);
  const nameRef = useRef('');
  const runId = useRef(0);
  const cancelRun = useRef<(() => void) | null>(null);
  const runnerRef = useRef<IngestRunner | null>(options.runner ?? null);
  const mounted = useRef(true);
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  if (options.runner !== undefined) runnerRef.current = options.runner;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      runId.current += 1;
      cancelRun.current?.();
    };
  }, []);

  const limitConfig = useCallback((): LimitConfig => ({ payloadBytes: snapshotRef.current.limits.maxUploadBytes, maxImportRows: snapshotRef.current.limits.maxRows }), []);

  const analyze = useCallback(
    (next: Decisions): void => {
      const bytes = bytesRef.current;
      if (bytes === null) return;
      cancelRun.current?.();
      const id = ++runId.current;
      setDecisions(next);
      setBusy(true);
      setPhase('reading');
      setProgress({ stage: 'detect', fraction: 0 });
      const snap = snapshotRef.current;
      const job: PipelineInput = {
        bytes,
        fileName: nameRef.current,
        decisions: next,
        limitConfig: limitConfig(),
        current: { inventory: { label: snap.dataSources.inventory.label, rowCount: snap.dataSources.inventory.rowCount }, shipments: { label: snap.dataSources.shipments.label, rowCount: snap.dataSources.shipments.rowCount } }
      };
      const onProgress = (stage: PipelineStage, fraction: number): void => {
        if (id === runId.current && mounted.current) setProgress({ stage, fraction });
      };
      const custom = options.runner !== undefined;
      const runner = runnerRef.current ?? (runnerRef.current = defaultRunner());
      let handle = runner.run(job, onProgress);
      cancelRun.current = () => handle.cancel();
      void (async () => {
        let outcome = await handle.promise;
        // A browser without module workers: adapters that need no worker still run inline (the inline runner refuses the others).
        if (!outcome.ok && outcome.error.code === 'BROWSER_UNSUPPORTED' && !custom && id === runId.current && runner instanceof WorkerRunner) {
          const inline = new InlineRunner();
          handle = inline.run(job, onProgress);
          cancelRun.current = () => handle.cancel();
          outcome = await handle.promise;
        }
        if (id !== runId.current || !mounted.current) return;
        cancelRun.current = null;
        setBusy(false);
        setProgress(null);
        if (outcome.ok) {
          setAnalysis(outcome.value);
          setError(null);
          setPhase('review');
        } else if (outcome.error.code !== 'CANCELLED') {
          setError(outcome.error);
          setPhase('review');
        }
      })();
    },
    [limitConfig, options.runner]
  );

  const begin = useCallback(
    (bytes: Uint8Array, name: string, info: SourceInfo, presetKind: ImportKind | undefined): void => {
      bytesRef.current = bytes;
      nameRef.current = name;
      setSource(info);
      setAnalysis(null);
      setError(null);
      setResult(null);
      analyze(presetKind === undefined ? NO_DECISIONS : { kind: presetKind });
    },
    [analyze]
  );

  const startFile = useCallback(
    (file: File, presetKind?: ImportKind): void => {
      const id = ++runId.current;
      cancelRun.current?.();
      cancelRun.current = null;
      setResult(null);
      setAnalysis(null);
      const info: SourceInfo = { name: file.name, size: file.size, origin: 'file' };
      const tooLarge = sourceTooLarge(resolveLimits(limitConfig()), null, file.size);
      if (tooLarge !== null) {
        bytesRef.current = null;
        setSource(info);
        setError(tooLarge);
        setBusy(false);
        setPhase('review');
        return;
      }
      setSource(info);
      setError(null);
      setBusy(true);
      setPhase('reading');
      void (async () => {
        let bytes: Uint8Array;
        try {
          bytes = await readBytes(file);
        } catch {
          if (id !== runId.current || !mounted.current) return;
          setBusy(false);
          setError(ingestError('READ_FAILED', 'read'));
          setPhase('review');
          return;
        }
        if (id !== runId.current || !mounted.current) return;
        begin(bytes, file.name, info, presetKind);
      })();
    },
    [begin, limitConfig]
  );

  const startPaste = useCallback(
    (text: string): void => {
      ++runId.current;
      cancelRun.current?.();
      const bytes = new TextEncoder().encode(text);
      begin(bytes, 'Pasted data', { name: 'Pasted data', size: bytes.length, origin: 'paste' }, undefined);
    },
    [begin]
  );

  const reset = useCallback((): void => {
    runId.current += 1;
    cancelRun.current?.();
    cancelRun.current = null;
    bytesRef.current = null;
    setPhase('idle');
    setBusy(false);
    setSource(null);
    setAnalysis(null);
    setError(null);
    setProgress(null);
    setDecisions(NO_DECISIONS);
    setResult(null);
  }, []);

  const cancel = useCallback((): void => {
    reset();
    setFocus('picker');
  }, [reset]);

  const confirm = useCallback(async (): Promise<void> => {
    const current = analysis;
    if (current === null || !current.preview.canConfirm || current.canonical === null || current.kind === null || busy || error !== null) return;
    const kind = current.kind;
    setPhase('uploading');
    try {
      const file = new File([current.canonical.csv], current.canonical.fileName, { type: 'text/csv' });
      const outcome = await api.importCsv(kind, file);
      if (!mounted.current) return;
      bytesRef.current = null;
      runId.current += 1;
      setResult({
        tone: 'success',
        title: `${countOf(kind, outcome.rowCount)} from ${outcome.dataSource.label}.`,
        warnings: outcome.warnings,
        imported: { kind, rowCount: outcome.rowCount, label: outcome.dataSource.label, ...(outcome.undo === undefined ? {} : { version: outcome.undo.version }) }
      });
      setPhase('idle');
      setSource(null);
      setAnalysis(null);
      setDecisions(NO_DECISIONS);
      setFocus('banner');
      await refresh();
    } catch (err) {
      if (!mounted.current) return;
      const apiErr = err as ApiError;
      setResult({
        tone: 'critical',
        title: typeof apiErr.message === 'string' && apiErr.message !== '' ? apiErr.message : ingestError('INTERNAL', 'read').message,
        issues: Array.isArray(apiErr.issues) && apiErr.issues.length > 0 ? apiErr.issues : undefined,
        totalErrors: apiErr.totalErrors
      });
      setPhase('review');
      setFocus('banner');
    }
  }, [analysis, api, busy, error, refresh]);

  const undo = useCallback(async (): Promise<void> => {
    const imported = result?.imported;
    if (imported?.version === undefined || undoing) return;
    setUndoing(true);
    try {
      await api.undoImport(imported.version);
      if (!mounted.current) return;
      setResult({ tone: 'success', title: `Nothing from ${imported.label} was kept.`, undone: true });
      setFocus('banner');
      await refresh();
    } catch (err) {
      if (!mounted.current) return;
      const apiErr = err as ApiError;
      const message = typeof apiErr.message === 'string' && apiErr.message !== '' ? apiErr.message : ingestError('INTERNAL', 'read').message;
      // the import stays; it just cannot be taken back any more
      setResult({ tone: 'critical', title: message, imported: { kind: imported.kind, rowCount: imported.rowCount, label: imported.label } });
      setFocus('banner');
    } finally {
      if (mounted.current) setUndoing(false);
    }
  }, [api, refresh, result, undoing]);

  const change = useCallback((next: Decisions): void => analyze(next), [analyze]);

  return {
    phase,
    busy,
    source,
    analysis,
    error,
    progress,
    decisions,
    result,
    focus,
    clearFocus: () => setFocus(null),
    startFile,
    startPaste,
    cancel,
    reset,
    confirm,
    undo,
    undoing,
    setOption: (key, value) => change({ ...keepOptionsOnly(decisions), options: withMap(decisions.options, key, value) }),
    acknowledgeChoice: (key) => change({ ...decisions, acknowledgedChoices: [...new Set([...(decisions.acknowledgedChoices ?? []), key])] }),
    setTable: (index) => change({ ...keepOptionsOnly(decisions), tableIndex: index }),
    setHeaderRow: (rowIndex) => change(setOrDrop({ ...keepOptionsOnly(decisions), ...(decisions.tableIndex === undefined ? {} : { tableIndex: decisions.tableIndex }) }, 'headerRow', rowIndex)),
    setExcluded: (rowIndex, excluded) => {
      const set = new Set(decisions.excludedRows ?? []);
      if (excluded) set.add(rowIndex);
      else set.delete(rowIndex);
      // excluding rows does not change the columns, so every other decision stays
      change({ ...decisions, excludedRows: set.size === 0 ? undefined : [...set].sort((a, b) => a - b) });
    },
    setKind: (kind) => change(setOrDrop(keepFromTable(decisions), 'kind', kind)),
    assign: (columnIndex, field) => {
      const map = new Map(decisions.assignments ?? []);
      if (field === undefined) map.delete(columnIndex);
      else map.set(columnIndex, field);
      change({ ...decisions, assignments: map.size === 0 ? undefined : map });
    },
    acknowledgeColumn: (columnIndex) => change({ ...decisions, acknowledgedColumns: [...new Set([...(decisions.acknowledgedColumns ?? []), columnIndex])] }),
    setNumberPreset: (preset) => change(setOrDrop(decisions, 'numberPreset', preset)),
    setDatePreset: (preset) => change(setOrDrop(decisions, 'datePreset', preset)),
    setDatePresetFor: (field, preset) => change({ ...decisions, datePresets: withMap(decisions.datePresets, field, preset) }),
    setStatus: (src, target) => change({ ...decisions, statusChoices: withMap(decisions.statusChoices, src, target) }),
    setWarehouse: (src, target) => change({ ...decisions, warehouseChoices: withMap(decisions.warehouseChoices, src, target) }),
    setConstant: (field, value) => change({ ...decisions, constants: withMap(decisions.constants, field, value === undefined || value.trim() === '' ? undefined : value) })
  };
}

/**
 * Moves focus to a panel's heading when the panel opens (ke-hoach 6.3), unless the user is already working inside another
 * panel of the card (then the next panel simply appears after it in reading order and focus is not taken away).
 */
export function usePanelFocus(headingRef: { current: HTMLElement | null }): void {
  useEffect(() => {
    const heading = headingRef.current;
    // a panel folded away behind the details link does not take focus from the question shown above it
    if (heading === null || heading.closest('details:not([open])') !== null) return;
    const active = typeof document === 'undefined' ? null : document.activeElement;
    const inside = active !== null && active !== document.body && active.closest('[data-ingest-panel]') !== null;
    if (!inside) heading.focus();
    // runs once, when the panel opens
  }, [headingRef]);
}
