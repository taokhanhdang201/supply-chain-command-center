// Header evidence (E1-E4, E7), value fit (E5) and the composition into a confidence C for every (column, field) pair
// (ke-hoach 4.2-4.4). The best header evidence counts (they are not summed). Everything is a pure function of the header
// text, the column profile and the dictionary: no network, no model, no clock, no randomness. Every score comes with
// human-readable evidence lines so it can be reproduced by hand.

import type { ImportKind } from '../../types';
import type { FieldInfo } from '../canonical/schemaRegistry';
import { fieldsOf } from '../canonical/schemaRegistry';
import { defaultDict, GENERIC_TOKENS, type Dictionary, type PhraseRecord } from './dictionary';
import { keyOf, normalizeHeader, type NormalizedHeader } from './normalizeHeader';
import { fitFor, looksLike, type ColumnProfile } from '../structure/profile';

// ---- named constants (all unit-tested at their boundaries) ---------------------------------------------------------------

export const STRENGTH_EXACT = 1.0;
export const STRENGTH_STRONG = 0.92;
export const STRENGTH_MEDIUM = 0.75;
export const STRENGTH_WEAK = 0.55;
export const SIMILARITY_CAP = 0.6;
export const SIMILARITY_MIN = 0.5;
export const SPELLING_CAP = 0.55;
export const WEIGHT_HEADER = 0.6;
export const WEIGHT_PROFILE = 0.4;
/** A header this sure whose values do not fit is distrusted (C is multiplied by MISMATCH_FACTOR). */
export const MISMATCH_HEADER_MIN = 0.9;
export const MISMATCH_PROFILE_MAX = 0.5;
export const MISMATCH_FACTOR = 0.75;
/** No values to look at is no evidence against the header (a header-only file can still be matched). */
export const P_NO_VALUES = 0.85;
export const PROFILE_ONLY_CAP = 0.7;
export const PROFILE_ONLY_FACTOR = 0.75;
export const MATCH_MIN_CONFIDENCE = 0.85;
export const MATCH_MIN_MARGIN = 0.25;
export const CHECK_MIN_CONFIDENCE = 0.55;
export const COMPETING_WINDOW = 0.15;
/** Below this a column has no usable evidence for any field: it is "not imported". */
export const CHOOSE_FLOOR = 0.35;
export const EPS = 1e-9;

export type HeaderEvidenceKind = 'exact' | 'strong' | 'medium' | 'weak' | 'similar' | 'spelling' | 'none';

export interface HeaderEvidence {
  kind: HeaderEvidenceKind;
  /** H in [0, 1]. */
  strength: number;
  line: string;
  warnings: string[];
}

export interface PairScore {
  field: string;
  /** Header evidence strength H. */
  h: number;
  hKind: HeaderEvidenceKind;
  /** Value fit P in [0, 1], or null when the column has no values. */
  p: number | null;
  /** Confidence C in [0, 1]. */
  c: number;
  profileOnly: boolean;
  evidence: string[];
  warnings: string[];
}

const NONE: HeaderEvidence = { kind: 'none', strength: 0, line: '', warnings: [] };

// ---- E4: Damerau-Levenshtein (optimal string alignment) ------------------------------------------------------------------

export function editDistance(a: string, b: string, limit = 3): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  const prev2: number[] = [];
  let prev: number[] = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur: number[] = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min((prev[j] as number) + 1, (cur[j - 1] as number) + 1, (prev[j - 1] as number) + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, (prev2[j - 2] as number) + 1);
      cur[j] = v;
    }
    prev2.length = 0;
    prev2.push(...prev);
    prev = cur;
  }
  return prev[b.length] as number;
}

/**
 * E4 works word by word: the same number of words, every word equal or within Damerau-Levenshtein 1 (length >= 5) or 2
 * (length >= 9), at least one word differing. Short words must match exactly ("po" is not a typo of "pro").
 */
export function sameWordsSpelledAlike(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  let differs = false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] as string;
    const y = b[i] as string;
    if (x === y) continue;
    const limit = Math.min(x.length, y.length) >= 9 ? 2 : Math.min(x.length, y.length) >= 5 ? 1 : 0;
    if (limit === 0 || editDistance(x, y, limit) > limit) return false;
    differs = true;
  }
  return differs;
}

// ---- E3: weighted token-set similarity ----------------------------------------------------------------------------------

function tokenWeight(dict: Dictionary, kind: ImportKind, token: string): number {
  if (dict.isDiscriminativeToken(kind, token)) return 2;
  return GENERIC_TOKENS.has(token) ? 0.5 : 1;
}

function weightedJaccard(dict: Dictionary, kind: ImportKind, a: readonly string[], b: readonly string[]): { score: number; sharedSpecific: boolean } {
  const sa = new Set(a);
  const sb = new Set(b);
  let inter = 0;
  let union = 0;
  let sharedSpecific = false;
  for (const t of new Set([...sa, ...sb])) {
    const w = tokenWeight(dict, kind, t);
    union += w;
    if (sa.has(t) && sb.has(t)) {
      inter += w;
      if (!GENERIC_TOKENS.has(t)) sharedSpecific = true;
    }
  }
  return { score: union === 0 ? 0 : inter / union, sharedSpecific };
}

const STRENGTH_VALUE: Record<PhraseRecord['strength'], number> = { strong: STRENGTH_STRONG, medium: STRENGTH_MEDIUM, weak: STRENGTH_WEAK };
const STRENGTH_LABEL: Record<PhraseRecord['strength'], string> = { strong: 'a strong synonym', medium: 'a plausible synonym', weak: 'a weak synonym' };

/** H for one (header, field). E1 exact name, E2 dictionary, E3 similar wording, E4 spelling; the best one counts. */
export function headerEvidence(kind: ImportKind, header: NormalizedHeader, field: FieldInfo, dict: Dictionary = defaultDict()): HeaderEvidence {
  if (header.key === '') return NONE;
  // E7: a weight column is never a cost or a quantity, whatever its words say.
  const weightHint = header.hints.find((h) => h.kind === 'weight');
  if (weightHint !== undefined && (field.valueKind === 'money' || field.valueKind === 'integer' || field.valueKind === 'decimal')) {
    return { kind: 'none', strength: 0, line: `the unit "${weightHint.text}" says this is a weight, not ${field.name}`, warnings: [] };
  }
  const canonicalKey = keyOf(field.name);
  if (header.key === canonicalKey) {
    return { kind: 'exact', strength: STRENGTH_EXACT, line: `header "${header.raw.trim()}" is the exact SCC field name ${field.name} (+${STRENGTH_EXACT.toFixed(2)})`, warnings: [] };
  }
  const hit = dict.lookup(kind, header.key);
  if (hit !== null && hit.type === 'phrase' && hit.record.field === field.name) {
    const r = hit.record;
    const warnings: string[] = [];
    if (r.strength === 'weak') warnings.push(r.note ?? 'this header is only a weak synonym');
    if (r.strength === 'medium') warnings.push('this header is only a plausible synonym');
    const value = STRENGTH_VALUE[r.strength];
    const line = `header "${header.raw.trim()}" is ${STRENGTH_LABEL[r.strength]} of ${field.name} (${r.language}: "${r.phrase}", +${value.toFixed(2)})`;
    return { kind: r.strength, strength: value, line, warnings };
  }
  if (hit !== null && hit.type === 'ambiguous') return NONE; // the column is handled as ambiguous by the caller

  // E3 and E4 against every phrase of this field (and its canonical name), best one wins.
  const records = dict.recordsFor(kind, field.name);
  let bestSimilar = 0;
  let similarPhrase = '';
  let bestSpelling = 0;
  let spellingPhrase = '';
  const candidates: Array<{ key: string; tokens: readonly string[]; strength: PhraseRecord['strength'] | 'exact' }> = [
    { key: canonicalKey, tokens: canonicalKey.split(' '), strength: 'exact' },
    ...records.map((r) => ({ key: r.key, tokens: r.tokens, strength: r.strength }))
  ];
  const headerTokens = new Set(header.tokens);
  for (const c of candidates) {
    const ctokens = c.tokens;
    // cheap pre-checks: similar wording needs a shared word, a spelling slip needs the same number of words
    const shares = ctokens.some((t) => headerTokens.has(t));
    const sameLength = ctokens.length === header.tokens.length;
    if (!shares && !sameLength) continue;
    const { score, sharedSpecific } = shares ? weightedJaccard(dict, kind, header.tokens, ctokens) : { score: 0, sharedSpecific: false };
    if (sharedSpecific && score >= SIMILARITY_MIN) {
      const value = Math.min(SIMILARITY_CAP, SIMILARITY_CAP * score);
      if (value > bestSimilar + EPS) {
        bestSimilar = value;
        similarPhrase = c.key;
      }
    }
    if (c.strength === 'strong' || c.strength === 'medium' || c.strength === 'exact') {
      if (sameWordsSpelledAlike(header.tokens, ctokens)) {
        const value = SPELLING_CAP * (c.strength === 'medium' ? 0.9 : 1);
        if (value > bestSpelling + EPS) {
          bestSpelling = value;
          spellingPhrase = c.key;
        }
      }
    }
  }
  if (bestSpelling >= bestSimilar && bestSpelling > 0) {
    return { kind: 'spelling', strength: bestSpelling, line: `header "${header.raw.trim()}" is spelled like "${spellingPhrase}", a phrase of ${field.name} (+${bestSpelling.toFixed(2)})`, warnings: ['the spelling differs from the known phrase'] };
  }
  if (bestSimilar > 0) {
    return { kind: 'similar', strength: bestSimilar, line: `header "${header.raw.trim()}" shares words with "${similarPhrase}", a phrase of ${field.name} (+${bestSimilar.toFixed(2)})`, warnings: ['only the wording is similar'] };
  }
  return NONE;
}

// ---- E5: value evidence lines ------------------------------------------------------------------------------------------------

function pct(part: number): string {
  return `${Math.round(part * 100)}%`;
}

function valueLine(field: FieldInfo, p: ColumnProfile): string {
  const n = p.nonBlank;
  const k = (rate: number): string => `${Math.round(rate * n)} of ${n}`;
  switch (field.valueKind) {
    case 'id':
      return `values: ${k(p.idLikeRate)} look like IDs, ${pct(p.uniqueRate)} unique`;
    case 'integer':
      return `values: ${k(p.integerRate)} are whole numbers`;
    case 'decimal':
    case 'money':
      return `values: ${k(p.numericRate)} are numbers`;
    case 'date':
      return `values: ${k(p.dateRate)} are dates`;
    case 'status':
      return `values: ${p.distinct} distinct value(s), ${k(p.statusLikeRate)} look like status words`;
    case 'warehouse':
      return `values: ${k(p.warehouseRate)} match a known warehouse code or name`;
    case 'location':
      return `values: ${k(p.locationRate)} match a known location; the rest is taken as typed text`;
    case 'text':
      return `values: ${k(p.textRate)} are text, ${p.distinct} distinct`;
  }
}

// ---- composition (4.4) ---------------------------------------------------------------------------------------------------------

const round = (x: number): number => Math.round(x * 10000) / 10000;

export function scorePair(kind: ImportKind, header: NormalizedHeader, profile: ColumnProfile, field: FieldInfo, dict: Dictionary = defaultDict()): PairScore {
  const he = headerEvidence(kind, header, field, dict);
  const p = fitFor(field, profile);
  const evidence: string[] = [];
  const warnings = [...he.warnings];
  if (he.line !== '') evidence.push(he.line);
  if (he.strength > 0) {
    const effectiveP = p ?? P_NO_VALUES;
    evidence.push(p === null ? 'values: the column has no values to check (no evidence against the header)' : valueLine(field, profile));
    let c = WEIGHT_HEADER * he.strength + WEIGHT_PROFILE * effectiveP;
    if (he.strength >= MISMATCH_HEADER_MIN && effectiveP < MISMATCH_PROFILE_MAX) {
      c *= MISMATCH_FACTOR;
      warnings.push(`the header says ${field.name} but the values do not look like ${field.name}`);
    } else if (he.strength < MISMATCH_HEADER_MIN && effectiveP < MISMATCH_PROFILE_MAX) {
      warnings.push(`the values do not look like ${field.name}`);
    }
    c = Math.max(0, Math.min(1, c));
    evidence.push(`confidence C = ${WEIGHT_HEADER} x ${he.strength.toFixed(2)} + ${WEIGHT_PROFILE} x ${effectiveP.toFixed(2)}${c < WEIGHT_HEADER * he.strength + WEIGHT_PROFILE * effectiveP - EPS ? ' x 0.75' : ''} = ${round(c).toFixed(2)}`);
    return { field: field.name, h: he.strength, hKind: he.kind, p, c, profileOnly: false, evidence, warnings };
  }

  // Profile only (no header evidence): allowed for fields whose values identify them; anything else is just a hint.
  const like = looksLike(profile);
  const allowed =
    (field.valueKind === 'status' && like.status) ||
    (field.valueKind === 'warehouse' && like.warehouse) ||
    (field.valueKind === 'location' && like.location);
  if (p === null || !allowed) return { field: field.name, h: 0, hKind: 'none', p, c: 0, profileOnly: false, evidence: he.line === '' ? [] : [he.line], warnings: [] };
  const c = Math.min(PROFILE_ONLY_CAP, PROFILE_ONLY_FACTOR * p);
  evidence.push(valueLine(field, profile));
  evidence.push(`no header evidence; confidence from the values alone C = min(${PROFILE_ONLY_CAP}, ${PROFILE_ONLY_FACTOR} x ${p.toFixed(2)}) = ${round(c).toFixed(2)}`);
  warnings.push('the suggestion rests on the values only (the header says nothing)');
  return { field: field.name, h: 0, hKind: 'none', p, c, profileOnly: true, evidence, warnings };
}

/** All pair scores of one column for one dataset kind, in schema order. */
export function scoreColumn(kind: ImportKind, rawHeader: string, profile: ColumnProfile, dict: Dictionary = defaultDict()): PairScore[] {
  const header = normalizeHeader(rawHeader);
  return fieldsOf(kind).map((f) => scorePair(kind, header, profile, f, dict));
}
