// The gzip wrapper adapter: a single gzip-compressed file (depth 1) whose content is read by another registered
// adapter that declares itself `wrappable`. Decompression is streamed through `DecompressionStream` with running byte
// counters, an expansion-ratio cap and an output cap that can never exceed the inner family's own source limit, so gzip
// cannot be used to get around layer (a). Nothing is written to disk and nothing is evaluated.

import type { ByteSource, Ctx, FormatAdapter, Hints, ProbeResult, ReadOptions, Result, Selection, ExtractionResult } from '../../types';
import { ingestError } from '../../messages';
import { expandedTooLarge, expansionBomb, exceedsRatio, limitsForAdapter, sourceTooLarge } from '../../limits';
import { byteSourceFrom, headOf, readAll, startsWithBytes } from '../../detect/bytes';
import { detectFormat, makeHints } from '../../detect/arbiter';

export const GZIP_ADAPTER_ID = 'gzip';
const GZIP_MAGIC = [0x1f, 0x8b, 0x08] as const;

interface Unwrapped {
  inner: FormatAdapter;
  innerSource: ByteSource;
  innerHints: Hints;
  innerCtx: Ctx;
  compressed: number;
  expanded: number;
}

async function gunzip(bytes: Uint8Array, maxOut: number, ctx: Ctx): Promise<Result<Uint8Array>> {
  if (typeof DecompressionStream === 'undefined') return { ok: false, error: ingestError('BROWSER_UNSUPPORTED', 'read') };
  const stream = new DecompressionStream('gzip');
  const writer = stream.writable.getWriter();
  const writing = writer
    .write(bytes.slice())
    .then(() => writer.close())
    .catch(() => undefined);
  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const stop = async (): Promise<void> => {
    await reader.cancel().catch(() => undefined);
    await writer.abort().catch(() => undefined);
  };
  try {
    for (;;) {
      if (ctx.signal.aborted) {
        await stop();
        return { ok: false, error: ingestError('CANCELLED', 'read') };
      }
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (exceedsRatio(ctx.limits, bytes.length, total)) {
        await stop();
        return { ok: false, error: expansionBomb() };
      }
      if (total > maxOut) {
        await stop();
        return { ok: false, error: expandedTooLarge(maxOut) };
      }
      chunks.push(value);
    }
  } catch {
    await stop();
    return { ok: false, error: ingestError('PACKED_DAMAGED', 'read') };
  }
  await writing;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return { ok: true, value: out };
}

const unwrapCache = new WeakMap<ByteSource, Promise<Result<Unwrapped>>>();

async function unwrap(src: ByteSource, ctx: Ctx): Promise<Result<Unwrapped>> {
  const cached = unwrapCache.get(src);
  if (cached !== undefined) return cached;
  const pending = doUnwrap(src, ctx);
  unwrapCache.set(src, pending);
  void pending.then((r) => {
    if (!r.ok) unwrapCache.delete(src); // never cache a failure (it may be a cancellation)
  });
  return pending;
}

async function doUnwrap(src: ByteSource, ctx: Ctx): Promise<Result<Unwrapped>> {
  if (ctx.depth >= 1) return { ok: false, error: ingestError('PACKED_NESTED', 'probe') };
  const tooLarge = sourceTooLarge(ctx.limits, null, src.size);
  if (tooLarge !== null) return { ok: false, error: tooLarge };
  if (src.size === 0) return { ok: false, error: ingestError('EMPTY_FILE', 'probe') };

  // The output may never exceed the largest source limit of any adapter that could read it.
  let innerMax = 0;
  for (const a of ctx.registry.list()) {
    if (a.descriptor.wrappable) innerMax = Math.max(innerMax, limitsForAdapter(ctx.limits, a.descriptor).sourceBytes);
  }
  const maxOut = Math.min(ctx.limits.expandedEntryBytes, ctx.limits.sourceBytesGlobal, innerMax > 0 ? innerMax : ctx.limits.expandedEntryBytes);

  const out = await gunzip(readAll(src), maxOut, ctx);
  if (!out.ok) return out;
  const bytes = out.value;
  if (bytes.length === 0) return { ok: false, error: ingestError('EMPTY_FILE', 'probe') };
  if (startsWithBytes(bytes, GZIP_MAGIC)) return { ok: false, error: ingestError('PACKED_NESTED', 'probe') };

  const name = ctx.hints?.fileName ?? null;
  const innerName = name !== null && /\.gz$/i.test(name) ? name.slice(0, -3) : name;
  const innerHints = makeHints(innerName);
  const detection = detectFormat(headOf(byteSourceFrom(bytes)), innerHints, ctx.registry, bytes.length, [GZIP_ADAPTER_ID]);
  if (detection.outcome !== 'chosen' || detection.chosen === null) {
    const family = detection.outcome === 'refused' && detection.chosen !== null ? detection.chosen.family : 'a file of an unknown type';
    return { ok: false, error: ingestError('PACKED_INNER_UNSUPPORTED', 'probe', { family }) };
  }
  const inner = ctx.registry.get(detection.chosen.adapterId);
  if (inner === undefined || !inner.descriptor.wrappable) {
    return { ok: false, error: ingestError('PACKED_INNER_UNSUPPORTED', 'probe', { family: detection.chosen.family }) };
  }
  const innerLimits = limitsForAdapter(ctx.limits, inner.descriptor);
  const innerSource = byteSourceFrom(bytes);
  const tooBig = sourceTooLarge(innerLimits, inner.descriptor, bytes.length);
  if (tooBig !== null) return { ok: false, error: tooBig };
  return {
    ok: true,
    value: {
      inner,
      innerSource,
      innerHints,
      innerCtx: { ...ctx, limits: innerLimits, depth: ctx.depth + 1, hints: innerHints },
      compressed: src.size,
      expanded: bytes.length
    }
  };
}

export const gzipAdapter: FormatAdapter = {
  descriptor: {
    id: GZIP_ADAPTER_ID,
    version: '1.0.0',
    family: 'Gzip-compressed file',
    status: 'stable',
    hints: { extensions: ['.gz'], mimeTypes: ['application/gzip', 'application/x-gzip'] },
    signatures: [{ offset: 0, bytes: GZIP_MAGIC }],
    contentSniff: false,
    yields: ['tables'],
    multiTable: false,
    hierarchical: false,
    typedCells: false,
    streaming: 'none',
    // The wrapper hands back whatever the inner adapter produces.
    sourceRefKind: ['line', 'cell', 'path', 'page', 'segment', 'record'],
    wrappable: false,
    resourceHints: { needsWorker: true },
    messages: {}
  },

  detect(head: Uint8Array) {
    if (startsWithBytes(head, GZIP_MAGIC)) {
      return { confidence: 1, evidenceClass: 'magic' as const, evidence: ['gzip signature (1F 8B 08)'] };
    }
    return { confidence: 0, evidenceClass: 'none' as const, evidence: [] };
  },

  async probe(src: ByteSource, ctx: Ctx, options: Record<string, string> = {}): Promise<Result<ProbeResult>> {
    const unwrapped = await unwrap(src, ctx);
    if (!unwrapped.ok) return unwrapped;
    const u = unwrapped.value;
    const result = await u.inner.probe(u.innerSource, u.innerCtx, options);
    if (!result.ok) return result;
    const kb = (n: number): string => `${(n / 1024).toFixed(1)} KB`;
    return {
      ok: true,
      value: {
        ...result.value,
        evidence: [`gzip-compressed (${kb(u.compressed)} compressed, ${kb(u.expanded)} uncompressed)`, ...result.value.evidence],
        facts: { ...result.value.facts, compressed: 'gzip', expandedBytes: u.expanded }
      }
    };
  },

  async read(src: ByteSource, sel: Selection, opts: ReadOptions, ctx: Ctx): Promise<Result<ExtractionResult>> {
    const unwrapped = await unwrap(src, ctx);
    if (!unwrapped.ok) return unwrapped;
    const u = unwrapped.value;
    return u.inner.read(u.innerSource, sel, opts, u.innerCtx);
  }
};
