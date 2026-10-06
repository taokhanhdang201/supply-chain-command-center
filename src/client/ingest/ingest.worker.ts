// The ingestion Web Worker entry. A real same-origin module worker (no blob: or data: workers, so the strict CSP is
// untouched); it runs the shared pipeline on untrusted bytes away from the page and the server. The message handler is
// exported so tests can drive the exact same code in-process. Minimal local typing: the project's tsconfig has no
// "webworker" lib and is not changed.

import { createDefaultRegistry } from '../../shared/ingest/adapters';
import { analyzeFile } from '../../shared/ingest/pipeline';
import type { Analysis, PipelineInput, PipelineStage } from '../../shared/ingest/pipeline';
import type { AdapterLookup, Result } from '../../shared/ingest/types';

export interface RunMessage {
  type: 'run';
  id: number;
  job: PipelineInput;
}

export type WorkerReply =
  | { type: 'progress'; id: number; stage: PipelineStage; fraction: number }
  | { type: 'result'; id: number; result: Result<Analysis> };

interface WorkerScope {
  onmessage: ((event: { data: unknown }) => void) | null;
  postMessage(message: unknown): void;
}

export async function handleIngestMessage(message: unknown, post: (reply: WorkerReply) => void, registry: AdapterLookup = createDefaultRegistry()): Promise<void> {
  if (typeof message !== 'object' || message === null || (message as RunMessage).type !== 'run') return;
  const { id, job } = message as RunMessage;
  const result = await analyzeFile(job, {
    registry,
    clock: () => performance.now(),
    progress: (stage, fraction) => post({ type: 'progress', id, stage, fraction })
  });
  post({ type: 'result', id, result });
}

// Install the handler only inside a worker (importScripts exists only in worker scopes).
const scope = globalThis as unknown as Partial<WorkerScope> & { importScripts?: unknown };
if (typeof scope.importScripts === 'function') {
  const registry = createDefaultRegistry();
  scope.onmessage = (event) => {
    void handleIngestMessage(event.data, (reply) => (scope as WorkerScope).postMessage(reply), registry);
  };
}
