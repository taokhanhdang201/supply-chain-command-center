// Detection arbitration. Every registered adapter that matches a signature or sniffs content is asked to vote; the
// arbiter ranks votes by evidence class (magic > container > sniff > hint), applies extension hints only to break exact
// ties, and refuses ambiguity. It has no format list, no switch on extension and no fixed probe order: candidates and
// order come from the registry. Pure and deterministic (same bytes and hints, same answer).

import type {
  AdapterLookup,
  DetectionCandidate,
  DetectionResult,
  DetectionVote,
  EvidenceClass,
  FormatAdapter,
  Hints
} from '../types';
import { ingestError, extensionMismatchNotice, unsupportedTypeMessage } from '../messages';
import { HEAD_BYTES, extensionOf, matchesSignature } from './bytes';

const CLASS_RANK: Record<EvidenceClass, number> = { magic: 4, container: 3, sniff: 2, hint: 1, none: 0 };
const TIE_EPSILON = 0.001;

export function makeHints(fileName: string | null, mimeType: string | null = null): Hints {
  return { extension: extensionOf(fileName), mimeType: mimeType === null || mimeType === '' ? null : mimeType.toLowerCase(), fileName };
}

function isCandidateFor(adapter: FormatAdapter, head: Uint8Array): boolean {
  const d = adapter.descriptor;
  return d.contentSniff || d.signatures.some((s) => matchesSignature(head, s));
}

function safeVote(adapter: FormatAdapter, head: Uint8Array, hints: Hints): DetectionVote | null {
  try {
    const vote = adapter.detect(head, hints);
    if (vote === null || typeof vote !== 'object') return null;
    const confidence = Number(vote.confidence);
    if (!(confidence > 0) || vote.evidenceClass === 'none' || !(vote.evidenceClass in CLASS_RANK)) return null;
    return { confidence: Math.min(1, confidence), evidenceClass: vote.evidenceClass, evidence: Array.isArray(vote.evidence) ? vote.evidence.map(String) : [] };
  } catch {
    return null; // detect must never throw; a misbehaving adapter simply abstains
  }
}

function compare(a: DetectionCandidate, b: DetectionCandidate): number {
  const byClass = CLASS_RANK[b.evidenceClass] - CLASS_RANK[a.evidenceClass];
  if (byClass !== 0) return byClass;
  if (Math.abs(b.confidence - a.confidence) > TIE_EPSILON) return b.confidence - a.confidence;
  return a.adapterId < b.adapterId ? -1 : a.adapterId > b.adapterId ? 1 : 0;
}

/**
 * Detects the format of `head` (the first bytes; `size` is the whole file size). `exclude` removes adapters from the
 * vote (a wrapper uses it to detect what is inside itself without recursing into itself).
 */
export function detectFormat(
  head: Uint8Array,
  hints: Hints,
  registry: AdapterLookup & { isDisabled?: (id: string) => boolean },
  size: number = head.length,
  exclude: readonly string[] = []
): DetectionResult {
  if (size === 0) {
    return { outcome: 'empty', candidates: [], chosen: null, notices: [], error: ingestError('EMPTY_FILE', 'detect') };
  }
  const window = head.length > HEAD_BYTES ? head.subarray(0, HEAD_BYTES) : head;
  const descriptorOf = new Map<string, FormatAdapter['descriptor']>();
  const candidates: DetectionCandidate[] = [];
  for (const adapter of registry.list()) {
    const d = adapter.descriptor;
    if (exclude.includes(d.id) || !isCandidateFor(adapter, window)) continue;
    const vote = safeVote(adapter, window, hints);
    if (vote === null) continue;
    descriptorOf.set(d.id, d);
    candidates.push({ adapterId: d.id, family: d.family, status: d.status, evidenceClass: vote.evidenceClass, confidence: vote.confidence, evidence: vote.evidence });
  }
  candidates.sort(compare);

  const unknown = (): DetectionResult => ({
    outcome: 'unknown',
    candidates,
    chosen: null,
    notices: [],
    error: ingestError('UNKNOWN_TYPE', 'detect', {}, { message: unsupportedTypeMessage(registry, null) })
  });
  if (candidates.length === 0) return unknown();

  // Two different adapters with magic evidence: a polyglot. Refused as ambiguous/unsafe.
  const magic = candidates.filter((c) => c.evidenceClass === 'magic');
  if (magic.length > 1) {
    return { outcome: 'ambiguous', candidates, chosen: null, notices: [], error: ingestError('AMBIGUOUS_FILE', 'detect') };
  }

  let top = candidates[0] as DetectionCandidate;
  const tied = candidates.filter((c) => c.evidenceClass === top.evidenceClass && Math.abs(c.confidence - top.confidence) <= TIE_EPSILON);
  if (tied.length > 1) {
    const readable = tied.filter((c) => c.status !== 'refusal');
    if (readable.length === 0) {
      top = tied[0] as DetectionCandidate; // all refusals: deterministic by id
    } else {
      // The extension hint may break an exact tie, and only a tie.
      const byHint = readable.filter((c) => hints.extension !== null && (descriptorOf.get(c.adapterId)?.hints.extensions.includes(hints.extension) ?? false));
      if (byHint.length === 1) top = byHint[0] as DetectionCandidate;
      else return { outcome: 'ambiguous', candidates, chosen: null, notices: [], error: ingestError('AMBIGUOUS_FILE', 'detect') };
    }
  }

  const notices: string[] = [];
  const chosenDescriptor = descriptorOf.get(top.adapterId);
  if (hints.extension !== null && chosenDescriptor !== undefined && !chosenDescriptor.hints.extensions.includes(hints.extension)) {
    const claimedElsewhere = registry.list().some((a) => a.descriptor.id !== top.adapterId && a.descriptor.hints.extensions.includes(hints.extension as string));
    if (claimedElsewhere) notices.push(extensionMismatchNotice(hints.extension, top.family));
  }

  if (registry.isDisabled?.(top.adapterId) === true) {
    return {
      outcome: 'disabled',
      candidates,
      chosen: top,
      notices,
      error: ingestError('NOT_ENABLED', 'detect', { family: top.family })
    };
  }

  if (top.status === 'refusal' && chosenDescriptor !== undefined) {
    return {
      outcome: 'refused',
      candidates,
      chosen: top,
      notices,
      error: ingestError('UNKNOWN_TYPE', 'detect', {}, { message: unsupportedTypeMessage(registry, chosenDescriptor) })
    };
  }
  return { outcome: 'chosen', candidates, chosen: top, notices };
}
