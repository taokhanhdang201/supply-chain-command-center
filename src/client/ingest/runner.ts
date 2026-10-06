// Runners for the ingestion pipeline. `WorkerRunner` is the production path: a fresh same-origin module worker per run,
// a watchdog that terminates it when the wall-clock budget is exceeded (a bug in an adapter can never hang the page),
// and Cancel = terminate. `InlineRunner` runs the same code in the calling thread; it is the fallback ONLY for adapters
// that declare `needsWorker: false` and only for sources within the canonical payload limit, and it is what the tests
// use. Both return the same `Result<Analysis>` for the same job (proved by a shared test). The legacy-first routing gate
// lives here too: files V1 handles today keep going to the unchanged V1 flow.

import type { AdapterLookup, Result } from '../../shared/ingest/types';
import { analyzeFile, type Analysis, type PipelineInput, type PipelineStage } from '../../shared/ingest/pipeline';
import { ingestError } from '../../shared/ingest/messages';
import { detectFormat, makeHints } from '../../shared/ingest/detect/arbiter';
import { HEAD_BYTES } from '../../shared/ingest/detect/bytes';
import { limitsForAdapter, parseTimedOut, resolveLimits } from '../../shared/ingest/limits';
import { recognizesHeader } from '../../shared/ingest/mapping/dictionary';
import { DELIMITED_ADAPTER_ID } from '../../shared/ingest/adapters/delimited/adapter';
import { decodeText, detectEncoding } from '../../shared/ingest/adapters/delimited/encoding';
import { detectDelimiter, legacyGate } from '../../shared/ingest/adapters/delimited/sniff';
import { createDefaultRegistry } from '../../shared/ingest/adapters';
import type { RunMessage, WorkerReply } from './ingest.worker';

export type { PipelineInput as IngestJob } from '../../shared/ingest/pipeline';
export type ProgressFn = (stage: PipelineStage, fraction: number) => void;

export interface RunHandle {
  promise: Promise<Result<Analysis>>;
  /** Stops the work (the worker is terminated) and settles the promise with a CANCELLED error. */
  cancel(): void;
}

export interface IngestRunner {
  run(job: PipelineInput, onProgress?: ProgressFn): RunHandle;
}

// ---- worker transport ------------------------------------------------------------------------------------------------------

/** The part of a Worker the runner uses (a real Worker, or a test double). */
export interface WorkerLike {
  postMessage(message: unknown): void;
  terminate(): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

/** The production worker: a same-origin module worker built by Vite. No blob: or data: URLs. */
export function createBrowserWorker(): WorkerLike {
  return new Worker(new URL('./ingest.worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike;
}

export interface WorkerRunnerOptions {
  /** Wall-clock budget of one run; default: the parse plus validation budgets of layer (d). */
  watchdogMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

let nextId = 1;

export class WorkerRunner implements IngestRunner {
  constructor(
    private readonly createWorker: () => WorkerLike = createBrowserWorker,
    private readonly options: WorkerRunnerOptions = {}
  ) {}

  run(job: PipelineInput, onProgress?: ProgressFn): RunHandle {
    const id = nextId++;
    const limits = resolveLimits(job.limitConfig);
    const watchdogMs = this.options.watchdogMs ?? limits.parseBudgetMs + limits.validateBudgetMs;
    const setTimer = this.options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    const clearTimer = this.options.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    let settle: (r: Result<Analysis>) => void = () => undefined;
    const promise = new Promise<Result<Analysis>>((resolve) => {
      settle = resolve;
    });
    let worker: WorkerLike | null = null;
    let done = false;
    let timer: unknown = null;
    const finish = (result: Result<Analysis>): void => {
      if (done) return;
      done = true;
      if (timer !== null) clearTimer(timer);
      const w = worker;
      worker = null;
      if (w !== null) {
        w.onmessage = null;
        w.onerror = null;
        w.terminate();
      }
      settle(result);
    };
    try {
      worker = this.createWorker();
    } catch {
      finish({ ok: false, error: ingestError('BROWSER_UNSUPPORTED', 'read') });
      return { promise, cancel: () => undefined };
    }
    worker.onmessage = (event) => {
      const reply = event.data as WorkerReply;
      if (reply === null || typeof reply !== 'object' || reply.id !== id) return;
      if (reply.type === 'progress') onProgress?.(reply.stage, reply.fraction);
      else if (reply.type === 'result') finish(reply.result);
    };
    worker.onerror = () => finish({ ok: false, error: ingestError('READ_FAILED', 'read') });
    timer = setTimer(() => finish({ ok: false, error: parseTimedOut() }), watchdogMs);
    const message: RunMessage = { type: 'run', id, job };
    worker.postMessage(message);
    return { promise, cancel: () => finish({ ok: false, error: ingestError('CANCELLED', 'read') }) };
  }
}

// ---- inline fallback ---------------------------------------------------------------------------------------------------------

export class InlineRunner implements IngestRunner {
  constructor(
    private readonly registry: AdapterLookup & { isDisabled?: (id: string) => boolean } = createDefaultRegistry(),
    private readonly clock: () => number = () => performance.now()
  ) {}

  run(job: PipelineInput, onProgress?: ProgressFn): RunHandle {
    const controller = new AbortController();
    const limits = resolveLimits(job.limitConfig);
    const promise = (async (): Promise<Result<Analysis>> => {
      // Inline only for adapters that need no worker, and only within the canonical payload limit.
      const detection = detectFormat(job.bytes.subarray(0, HEAD_BYTES), makeHints(job.fileName, job.mimeType ?? null), this.registry, job.bytes.length);
      if (detection.outcome === 'chosen' && detection.chosen !== null) {
        const adapter = this.registry.get(detection.chosen.adapterId);
        if (adapter !== undefined && adapter.descriptor.resourceHints.needsWorker) {
          onProgress?.('detect', 0.02); // same first step as the pipeline, so both runners report alike
          return { ok: false, error: ingestError('BROWSER_UNSUPPORTED', 'read') };
        }
        if (adapter !== undefined && job.bytes.length > limitsForAdapter(limits, adapter.descriptor, job.limitConfig).payloadBytes) {
          onProgress?.('detect', 0.02);
          return { ok: false, error: ingestError('LIMIT_SOURCE_BYTES', 'limits', { size: job.bytes.length, limit: limits.payloadBytes }, { limit: 'sourceBytes' }) };
        }
      }
      await Promise.resolve();
      return analyzeFile(job, { registry: this.registry, signal: controller.signal, clock: this.clock, progress: onProgress });
    })();
    return {
      promise,
      cancel: () => controller.abort()
    };
  }
}

// ---- legacy-first routing (ke-hoach 3.6, Addendum AD-1 gate) ---------------------------------------------------------------

export interface Route {
  route: 'legacy' | 'pipeline';
  reason: string;
}

/**
 * Decides, from the bytes alone, whether a file keeps going through the unchanged V1 flow (strict UTF-8 text that V1
 * handles or rejects exactly as today) or needs the pipeline (other separators, encodings, formats, or a choice).
 */
export function routeFile(bytes: Uint8Array, fileName: string, registry: AdapterLookup = createDefaultRegistry()): Route {
  const detection = detectFormat(bytes.subarray(0, HEAD_BYTES), makeHints(fileName), registry, bytes.length);
  if (detection.outcome !== 'chosen' || detection.chosen === null || detection.chosen.adapterId !== DELIMITED_ADAPTER_ID) {
    return { route: 'pipeline', reason: 'the file is not plain delimited text' };
  }
  const encoding = detectEncoding(bytes, true);
  if (encoding.encoding !== 'utf-8') return { route: 'pipeline', reason: 'the text is not UTF-8' };
  const decoded = decodeText(bytes, 'utf-8');
  if (!decoded.ok) return { route: 'pipeline', reason: 'the text is not valid UTF-8' };
  const decision = detectDelimiter(decoded.text, recognizesHeader);
  const route = legacyGate(decision, true);
  return { route, reason: `separator decision: ${decision.kind}` };
}
