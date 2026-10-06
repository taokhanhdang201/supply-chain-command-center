// Reusable generators and types for the ingestion test kit: byte encoders for the text encodings, gzip helpers,
// a deterministic PRNG, a context factory and the corpus type every adapter's fixtures implement.

import { gzipSync } from 'node:zlib';
import type { AdapterLookup, ByteSource, Ctx, Hints, ResolvedLimits } from '../../src/shared/ingest/types';
import { byteSourceFrom } from '../../src/shared/ingest/detect/bytes';
import { limitsForAdapter, resolveLimits, type LimitConfig } from '../../src/shared/ingest/limits';
import type { AdapterDescriptor } from '../../src/shared/ingest/types';

export interface CorpusEntry {
  name: string;
  bytes: Uint8Array;
  hints?: Partial<Hints>;
  /** User choices passed to probe/read (keyed like AdapterChoice.key). */
  options?: Record<string, string>;
  /** Valid entries are expected to be detected by the adapter's own detect(); default true. */
  detectable?: boolean;
}

export interface AdapterCorpus {
  adapterId: string;
  /** Files the adapter must read successfully. */
  valid: CorpusEntry[];
  /** Files the adapter must handle WITHOUT throwing (an ok result or a structured error). */
  hostile: CorpusEntry[];
}

export const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

export function utf8Bom(text: string): Uint8Array {
  return concat(Uint8Array.of(0xef, 0xbb, 0xbf), utf8(text));
}

export function utf16le(text: string, bom = true): Uint8Array {
  const out = new Uint8Array((text.length + (bom ? 1 : 0)) * 2);
  let o = 0;
  if (bom) {
    out[o++] = 0xff;
    out[o++] = 0xfe;
  }
  for (let i = 0; i < text.length; i++) {
    const u = text.charCodeAt(i);
    out[o++] = u & 0xff;
    out[o++] = u >> 8;
  }
  return out;
}

export function utf16be(text: string, bom = true): Uint8Array {
  const out = new Uint8Array((text.length + (bom ? 1 : 0)) * 2);
  let o = 0;
  if (bom) {
    out[o++] = 0xfe;
    out[o++] = 0xff;
  }
  for (let i = 0; i < text.length; i++) {
    const u = text.charCodeAt(i);
    out[o++] = u >> 8;
    out[o++] = u & 0xff;
  }
  return out;
}

const CP1252_EXTRA = new Map<number, number>([
  [0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84], [0x2026, 0x85], [0x2020, 0x86], [0x2021, 0x87], [0x02c6, 0x88],
  [0x2030, 0x89], [0x0160, 0x8a], [0x2039, 0x8b], [0x0152, 0x8c], [0x017d, 0x8e], [0x2018, 0x91], [0x2019, 0x92], [0x201c, 0x93],
  [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97], [0x02dc, 0x98], [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b],
  [0x0153, 0x9c], [0x017e, 0x9e], [0x0178, 0x9f]
]);

/** Encodes text as Windows-1252 (throws for characters it cannot represent: fixtures must stay representable). */
export function cp1252(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const u = text.charCodeAt(i);
    const mapped = CP1252_EXTRA.get(u);
    if (mapped !== undefined) out[i] = mapped;
    else if (u <= 0xff && !(u >= 0x80 && u <= 0x9f)) out[i] = u;
    else throw new Error(`U+${u.toString(16)} is not representable in Windows-1252`);
  }
  return out;
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function gzip(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(gzipSync(bytes));
}

/** Deterministic PRNG (mulberry32). */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomBytes(rand: () => number, length: number): Uint8Array {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = Math.floor(rand() * 256);
  return out;
}

/** Bit flips, truncation, BOM swaps and byte insertions of `bytes`, deterministic for a given generator. */
export function mutate(rand: () => number, bytes: Uint8Array): Uint8Array {
  const copy = Uint8Array.from(bytes);
  const kind = Math.floor(rand() * 5);
  if (copy.length === 0) return copy;
  switch (kind) {
    case 0: {
      const flips = 1 + Math.floor(rand() * 4);
      for (let i = 0; i < flips; i++) {
        const at = Math.floor(rand() * copy.length);
        copy[at] = (copy[at] as number) ^ (1 << Math.floor(rand() * 8));
      }
      return copy;
    }
    case 1:
      return copy.subarray(0, Math.floor(rand() * copy.length));
    case 2:
      return concat(Uint8Array.of(0xef, 0xbb, 0xbf), copy);
    case 3:
      return concat(Uint8Array.of(0xff, 0xfe), copy);
    default: {
      const at = Math.floor(rand() * copy.length);
      return concat(copy.subarray(0, at), randomBytes(rand, 1 + Math.floor(rand() * 3)), copy.subarray(at));
    }
  }
}

export interface CtxOptions {
  registry: AdapterLookup;
  descriptor?: AdapterDescriptor;
  config?: LimitConfig;
  limits?: Partial<ResolvedLimits>;
  hints?: Partial<Hints>;
  signal?: AbortSignal;
  depth?: number;
  recognizeHeader?: (text: string) => boolean;
}

export function makeHints(partial: Partial<Hints> = {}): Hints {
  return { extension: null, mimeType: null, fileName: null, ...partial };
}

export function makeCtx(opts: CtxOptions): Ctx {
  let limits = resolveLimits(opts.config);
  if (opts.descriptor !== undefined) limits = limitsForAdapter(limits, opts.descriptor, opts.config);
  const ctx: Ctx = {
    signal: opts.signal ?? new AbortController().signal,
    limits: { ...limits, ...opts.limits },
    registry: opts.registry,
    progress: () => undefined,
    clock: () => performance.now(),
    depth: opts.depth ?? 0,
    hints: makeHints(opts.hints)
  };
  if (opts.recognizeHeader !== undefined) ctx.recognizeHeader = opts.recognizeHeader;
  return ctx;
}

export function sourceOf(bytes: Uint8Array): ByteSource {
  return byteSourceFrom(bytes);
}

/** A comma CSV used by several tests. */
export const SAMPLE_COMMA_CSV = 'sku,product_name,category,warehouse,quantity,reorder_point,unit_cost\nELC-9001,Wireless Scanner,Electronics,WH-DFW,120,40,89.50\nELC-9002,Label Printer,Electronics,WH-ATL,60,20,210.00\n';
