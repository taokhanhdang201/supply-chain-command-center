// Criterion 27: WorkerRunner and InlineRunner behave identically for the same job; the watchdog terminates a deliberately
// looping task within budget + 200 ms; Cancel terminates; the inline fallback is only for needsWorker:false adapters within
// the payload limit; the worker is a same-origin module worker (no blob:/data: workers, no eval). Plus the legacy-first
// routing gate.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Worker as NodeWorker } from 'node:worker_threads';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InlineRunner, WorkerRunner, routeFile, type WorkerLike } from '../../../src/client/ingest/runner';
import { handleIngestMessage } from '../../../src/client/ingest/ingest.worker';
import { createDefaultRegistry } from '../../../src/shared/ingest/adapters';
import type { PipelineInput, PipelineStage } from '../../../src/shared/ingest/pipeline';
import { fixtureByName } from '../../fixtures/ingest/corpus45';
import { gzip, utf8, SAMPLE_COMMA_CSV } from '../../ingest-kit/corpus';

const registry = createDefaultRegistry();

/** Runs the real worker message handler in-process, forcing every message through structured cloning like a Worker would. */
class InProcessWorker implements WorkerLike {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  terminated = false;
  postMessage(message: unknown): void {
    const cloned = structuredClone(message);
    setTimeout(() => {
      if (this.terminated) return;
      void handleIngestMessage(cloned, (reply) => {
        setTimeout(() => {
          if (!this.terminated) this.onmessage?.({ data: structuredClone(reply) });
        }, 0);
      }, registry);
    }, 0);
  }
  terminate(): void {
    this.terminated = true;
  }
}

/** A worker that never answers (its thread is busy forever): the watchdog and Cancel must still get control back. */
class LoopingWorker implements WorkerLike {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  private readonly thread = new NodeWorker('while (true) {}', { eval: true });
  exited: Promise<number>;
  constructor() {
    this.exited = new Promise((res) => this.thread.once('exit', res));
  }
  postMessage(): void {}
  terminate(): void {
    void this.thread.terminate();
  }
}

const fixtureJob = (name: string, decisions?: PipelineInput['decisions']): PipelineInput => {
  const f = fixtureByName(name);
  return { bytes: f.bytes, fileName: f.hints.fileName, decisions };
};

describe('identical behaviour through both runners (criterion 27)', () => {
  const jobs: Array<[string, PipelineInput]> = [
    ['a clean file', fixtureJob('alder_freight.csv')],
    ['a file asking for an encoding confirmation', fixtureJob('casa_verde_es.csv')],
    ['a file with decisions applied', fixtureJob('casa_verde_es.csv', { options: new Map([['encoding', 'windows-1252']]), acknowledgedColumns: [] })],
    ['a file needing a dataset choice', fixtureJob('both_kinds_16_columns.csv')],
    ['an unsupported type', { bytes: utf8('%PDF-1.7\n1 0 obj\n'), fileName: 'scan.pdf' }],
    ['an empty file', { bytes: new Uint8Array(0), fileName: 'empty.csv' }],
    ['a file over the source limit', { bytes: new Uint8Array(3_000_000).fill(65), fileName: 'big.csv' }]
  ];
  for (const [name, job] of jobs) {
    it(`${name}: same result, same progress stages`, async () => {
      const inlineProgress: PipelineStage[] = [];
      const workerProgress: PipelineStage[] = [];
      const inline = await new InlineRunner(registry).run(job, (s) => inlineProgress.push(s)).promise;
      const viaWorker = await new WorkerRunner(() => new InProcessWorker()).run(job, (s) => workerProgress.push(s)).promise;
      expect(viaWorker).toEqual(inline);
      expect(workerProgress).toEqual(inlineProgress);
    });
  }

  it('reports progress in pipeline order and ends at the validation stage', async () => {
    const stages: Array<[PipelineStage, number]> = [];
    const a = await new InlineRunner(registry).run({ ...fixtureJob('alder_freight.csv'), decisions: { acknowledgedColumns: [4] } }, (s, f) => stages.push([s, f])).promise;
    expect(a.ok).toBe(true);
    expect(stages.map(([s]) => s)).toEqual(['detect', 'probe', 'read', 'structure', 'map', 'normalize', 'validate', 'validate']);
    const fractions = stages.map(([, f]) => f);
    expect([...fractions].sort((x, y) => x - y)).toEqual(fractions);
    expect(fractions[fractions.length - 1]).toBe(1);
  });
});

describe('watchdog and Cancel (criterion 27)', () => {
  it('terminates a deliberately looping task within budget + 200 ms and reports the time-out text', async () => {
    const worker = new LoopingWorker();
    const budget = 250;
    const t0 = performance.now();
    const handle = new WorkerRunner(() => worker, { watchdogMs: budget }).run(fixtureJob('alder_freight.csv'));
    const result = await handle.promise;
    const elapsed = performance.now() - t0;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('LIMIT_PARSE_TIME');
      expect(result.error.message).toContain('took too long');
    }
    expect(elapsed).toBeGreaterThanOrEqual(budget - 20);
    expect(elapsed).toBeLessThan(budget + 200);
    writeFileSync(join(tmpdir(), 'scc-ingest-watchdog.json'), JSON.stringify({ budgetMs: budget, elapsedMs: Math.round(elapsed), allowedMs: budget + 200 }));
    // the thread is really gone
    const code = await Promise.race([worker.exited, new Promise<string>((r) => setTimeout(() => r('still running'), 1000))]);
    expect(code).not.toBe('still running');
  });

  it('Cancel terminates the worker and settles with CANCELLED in well under 200 ms', async () => {
    const worker = new LoopingWorker();
    const handle = new WorkerRunner(() => worker, { watchdogMs: 60_000 }).run(fixtureJob('alder_freight.csv'));
    const t0 = performance.now();
    handle.cancel();
    const result = await handle.promise;
    const cancelMs = performance.now() - t0;
    expect(cancelMs).toBeLessThan(200);
    writeFileSync(join(tmpdir(), 'scc-ingest-cancel.json'), JSON.stringify({ cancelMs: Math.round(cancelMs * 10) / 10, budgetMs: 200 }));
    expect(result).toMatchObject({ ok: false, error: { code: 'CANCELLED' } });
    expect(await Promise.race([worker.exited, new Promise<string>((r) => setTimeout(() => r('still running'), 1000))])).not.toBe('still running');
  });

  it('a finished run terminates its worker and ignores later messages; cancel after the result is a no-op', async () => {
    const worker = new InProcessWorker();
    const handle = new WorkerRunner(() => worker).run(fixtureJob('alder_freight.csv'));
    const result = await handle.promise;
    expect(result.ok).toBe(true);
    expect(worker.terminated).toBe(true);
    handle.cancel();
    expect(await handle.promise).toBe(result);
  });

  it('the inline runner honours Cancel too (AbortSignal checked between stages)', async () => {
    const handle = new InlineRunner(registry).run(fixtureJob('alder_freight.csv'));
    handle.cancel();
    const result = await handle.promise;
    expect(result).toMatchObject({ ok: false, error: { code: 'CANCELLED' } });
  });

  it('a worker that cannot be created is reported as "cannot safely read this file type"', async () => {
    const handle = new WorkerRunner(() => {
      throw new Error('no workers here');
    }).run(fixtureJob('alder_freight.csv'));
    const result = await handle.promise;
    expect(result).toMatchObject({ ok: false, error: { code: 'BROWSER_UNSUPPORTED' } });
    expect(!result.ok && result.error.message).toContain('cannot safely read this file type');
  });

  it('a worker error settles the run instead of hanging', async () => {
    const worker = new InProcessWorker();
    worker.postMessage = () => setTimeout(() => worker.onerror?.({ message: 'boom' }), 0);
    const result = await new WorkerRunner(() => worker).run(fixtureJob('alder_freight.csv')).promise;
    expect(result).toMatchObject({ ok: false, error: { code: 'READ_FAILED' } });
  });
});

describe('the inline fallback is only for needsWorker:false adapters within the payload limit', () => {
  it('reads plain delimited text inline', async () => {
    const r = await new InlineRunner(registry).run(fixtureJob('alder_freight.csv')).promise;
    expect(r.ok).toBe(true);
  });
  it('refuses an adapter that needs a worker (gzip) when no worker is available', async () => {
    const r = await new InlineRunner(registry).run({ bytes: gzip(utf8(SAMPLE_COMMA_CSV)), fileName: 'stock.csv.gz' }).promise;
    expect(r).toMatchObject({ ok: false, error: { code: 'BROWSER_UNSUPPORTED' } });
    const viaWorker = await new WorkerRunner(() => new InProcessWorker()).run({ bytes: gzip(utf8(SAMPLE_COMMA_CSV)), fileName: 'stock.csv.gz' }).promise;
    expect(viaWorker.ok).toBe(true);
  });
  it('refuses sources above the canonical payload limit inline', async () => {
    const bytes = utf8('a,b,c\n' + '1,2,3\n'.repeat(400));
    const r = await new InlineRunner(registry).run({ bytes, fileName: 'x.csv', limitConfig: { payloadBytes: 1024 } }).promise;
    expect(r).toMatchObject({ ok: false, error: { code: 'LIMIT_SOURCE_BYTES' } });
  });
});

describe('the worker is a same-origin module worker under the strict CSP (criterion 34)', () => {
  const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  it('is created from a same-origin URL, never from a blob: or data: URL, and uses no eval/Function/WebAssembly', () => {
    const runner = strip(read('src/client/ingest/runner.ts'));
    const worker = strip(read('src/client/ingest/ingest.worker.ts'));
    expect(runner).toContain("new Worker(new URL('./ingest.worker.ts', import.meta.url), { type: 'module' })");
    for (const code of [runner, worker]) {
      expect(code).not.toMatch(/blob:|data:text|createObjectURL|\beval\s*\(|new Function|WebAssembly|importScripts\(|dangerouslySetInnerHTML|XMLHttpRequest|\bfetch\s*\(/);
    }
  });
  it('importing the worker module outside a worker installs no global message handler', () => {
    expect((globalThis as { onmessage?: unknown }).onmessage).toBeUndefined();
  });
  it('the handler ignores anything that is not a run message', async () => {
    const replies: unknown[] = [];
    await handleIngestMessage({ type: 'nope' }, (r) => replies.push(r), registry);
    await handleIngestMessage(null, (r) => replies.push(r), registry);
    await handleIngestMessage('text', (r) => replies.push(r), registry);
    expect(replies).toEqual([]);
  });
});

describe('legacy-first routing gate (3.6, AD-1)', () => {
  const route = (text: string, name = 'data.csv') => routeFile(utf8(text), name, registry).route;
  it('canonical and alias comma files keep the legacy path', () => {
    expect(route(readFileSync(resolve(process.cwd(), 'public/templates/inventory-template.csv'), 'utf8'))).toBe('legacy');
    expect(route(readFileSync(resolve(process.cwd(), 'tests/fixtures/import/inventory_alt_schema.csv'), 'utf8'))).toBe('legacy');
    expect(route(readFileSync(resolve(process.cwd(), 'tests/fixtures/import/shipments_alt_schema.csv'), 'utf8'))).toBe('legacy');
  });
  it('tiny and unrecognizable files keep reaching V1 and its error messages', () => {
    expect(route('a,b\n1,2\n')).toBe('legacy');
    expect(route('sku\nA1\n')).toBe('legacy');
    expect(route('just some words\nmore words\n')).toBe('legacy');
    expect(route('a,b\n1,"5\" pipe\n')).toBe('legacy');
  });
  it('other separators, encodings and formats need the pipeline', () => {
    for (const name of ['casa_verde_es.csv', 'dreilaender_de.tsv', 'fjord_sap_inventory.csv', 'kestrel_paste.tsv']) {
      const f = fixtureByName(name);
      expect(routeFile(f.bytes, name, registry).route, name).toBe('pipeline');
    }
    expect(routeFile(gzip(utf8(SAMPLE_COMMA_CSV)), 'x.csv.gz', registry).route).toBe('pipeline');
    expect(routeFile(utf8('%PDF-1.4'), 'x.pdf', registry).route).toBe('pipeline');
    expect(route('sku;product_name;category;warehouse;quantity;reorder_point;unit_cost\nA1;x;y;WH-DFW;1;2;3\n')).toBe('pipeline');
  });
  it('the alias-named Vietnamese and other comma files are still served by the pipeline only when a choice is needed', () => {
    expect(routeFile(fixtureByName('dai_phat_vi_inventory.csv').bytes, 'dai_phat_vi_inventory.csv', registry).route).toBe('legacy');
  });
});
