// The adapter registry. The ONLY list of adapters is `adapters/index.ts` (one registration line per adapter); this
// module validates descriptors, stores adapters in registration order and answers questions about them. There is no
// global instance here: pipelines receive a registry explicitly, so a test can register a toy adapter into its own
// registry without editing any file under src/.

import { LIMIT_CEILINGS } from './limits';
import { matchesSignature } from './detect/bytes';
import type { AdapterDescriptor, AdapterLookup, FormatAdapter, YieldKind } from './types';

export class RegistryError extends Error {}

const ID_FORMAT = /^[a-z0-9][a-z0-9-]{1,39}$/;
const VERSION_FORMAT = /^\d+\.\d+\.\d+$/;
const YIELDS: readonly YieldKind[] = ['tables', 'records', 'positioned-text', 'images-only'];
const STATUSES = ['stable', 'experimental', 'refusal'] as const;
const REF_KINDS = ['line', 'cell', 'path', 'page', 'segment', 'record'] as const;

/** Returns a list of problems with a descriptor (empty = valid). Used at registration time. */
export function validateDescriptor(d: AdapterDescriptor): string[] {
  const problems: string[] = [];
  if (typeof d.id !== 'string' || !ID_FORMAT.test(d.id)) problems.push('id must match [a-z0-9][a-z0-9-]{1,39}');
  if (typeof d.version !== 'string' || !VERSION_FORMAT.test(d.version)) problems.push('version must look like 1.0.0');
  if (typeof d.family !== 'string' || d.family.trim() === '') problems.push('family is required');
  if (!(STATUSES as readonly string[]).includes(d.status)) problems.push('status is invalid');
  for (const ext of d.hints?.extensions ?? []) {
    if (!/^\.[a-z0-9]{1,12}$/.test(ext)) problems.push(`extension hint "${ext}" must be lowercase with a leading dot`);
  }
  for (const mime of d.hints?.mimeTypes ?? []) {
    if (!/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(mime)) problems.push(`MIME hint "${mime}" is malformed`);
  }
  for (const sig of d.signatures ?? []) {
    if (!Number.isInteger(sig.offset) || sig.offset < 0 || sig.offset > 4096) problems.push('signature offset must be an integer in 0..4096');
    if (sig.bytes.length === 0 || sig.bytes.length > 32) problems.push('signature must have 1..32 bytes');
    if (sig.bytes.some((b) => !Number.isInteger(b) || b < 0 || b > 255)) problems.push('signature bytes must be 0..255');
    if (sig.mask !== undefined && sig.mask.length !== sig.bytes.length) problems.push('signature mask must have the same length as its bytes');
  }
  if (d.signatures.length === 0 && !d.contentSniff) problems.push('an adapter needs signatures or contentSniff to ever be asked to vote');
  if (!Array.isArray(d.yields) || d.yields.length === 0 || d.yields.some((y) => !YIELDS.includes(y))) problems.push('yields must be a non-empty list of known kinds');
  if (d.status !== 'refusal' && (d.sourceRefKind.length === 0 || d.sourceRefKind.some((k) => !(REF_KINDS as readonly string[]).includes(k)))) {
    problems.push('sourceRefKind must list known kinds');
  }
  if (d.streaming !== 'none' && d.streaming !== 'incremental') problems.push('streaming must be none or incremental');
  const hints = d.resourceHints;
  if (typeof hints?.needsWorker !== 'boolean') problems.push('resourceHints.needsWorker is required');
  const check = (name: string, value: number | undefined, ceiling: number): void => {
    if (value === undefined) return;
    if (!Number.isFinite(value) || value < 1 || value > ceiling) problems.push(`resourceHints.${name} must be within 1..${ceiling}`);
  };
  check('sourceBytes', hints?.sourceBytes, LIMIT_CEILINGS.sourceBytesGlobal);
  check('expandedBytes', hints?.expandedBytes, LIMIT_CEILINGS.expandedEntryBytes);
  check('ratio', hints?.ratio, LIMIT_CEILINGS.expansionRatio);
  check('maxDepth', hints?.maxDepth, LIMIT_CEILINGS.maxDepth);
  check('maxRecords', hints?.maxRecords, LIMIT_CEILINGS.maxNodes);
  return problems;
}

export class AdapterRegistry implements AdapterLookup {
  private readonly adapters: FormatAdapter[] = [];
  private disabled = new Set<string>();

  /** Registers an adapter; throws `RegistryError` when its descriptor is invalid or its id is taken. */
  register(adapter: FormatAdapter): () => void {
    const problems = validateDescriptor(adapter.descriptor);
    if (problems.length > 0) throw new RegistryError(`Invalid adapter "${String(adapter.descriptor.id)}": ${problems.join('; ')}.`);
    if (this.adapters.some((a) => a.descriptor.id === adapter.descriptor.id)) {
      throw new RegistryError(`An adapter with id "${adapter.descriptor.id}" is already registered.`);
    }
    this.adapters.push(adapter);
    return () => this.unregister(adapter.descriptor.id);
  }

  unregister(id: string): void {
    const i = this.adapters.findIndex((a) => a.descriptor.id === id);
    if (i !== -1) this.adapters.splice(i, 1);
  }

  list(): readonly FormatAdapter[] {
    return this.adapters;
  }

  get(id: string): FormatAdapter | undefined {
    return this.adapters.find((a) => a.descriptor.id === id);
  }

  /** Adapters whose signatures match the head, plus every adapter that sniffs content. Registration order. */
  adaptersForSignature(head: Uint8Array): FormatAdapter[] {
    return this.adapters.filter((a) => a.descriptor.contentSniff || a.descriptor.signatures.some((s) => matchesSignature(head, s)));
  }

  /** Families a user can import (not refusal adapters), in registration order. */
  supportedFamilies(): AdapterDescriptor[] {
    return this.adapters.map((a) => a.descriptor).filter((d) => d.status !== 'refusal');
  }

  /** Families that are recognized and explained but never read. */
  refusalFamilies(): AdapterDescriptor[] {
    return this.adapters.map((a) => a.descriptor).filter((d) => d.status === 'refusal');
  }

  /** Flags adapters as disabled (recognized, then refused with "not enabled"). Set at build time only. */
  setDisabled(ids: Iterable<string>): void {
    this.disabled = new Set(ids);
  }

  isDisabled(id: string): boolean {
    return this.disabled.has(id);
  }
}

export function createRegistry(): AdapterRegistry {
  return new AdapterRegistry();
}

/** `registerAdapter(registry, adapter)`: the one-line registration used by `adapters/index.ts` and by tests. */
export function registerAdapter(registry: AdapterRegistry, adapter: FormatAdapter): () => void {
  return registry.register(adapter);
}
