// The synonym dictionary loader. The data lives in plain per-language files (en, vi, es, de, fr): rows of
// `[phrase, example]` grouped by dataset kind, field and strength. `buildDictionary` turns them into lookup tables. It
// is deterministic (entries are sorted before indexing, so the insertion order of the data never matters) and
// extendable: a new language or phrase is a new row plus a corpus example; `validateDictionary` (run by a test) rejects
// ambiguous data. Nothing is fetched or evaluated; nothing here uses a clock or randomness.

import type { ImportKind } from '../../../types';
import { fieldsOf, IMPORT_KINDS } from '../../canonical/schemaRegistry';
import { foldText, keyOf } from '../normalizeHeader';
import { de } from './de';
import { en } from './en';
import { es } from './es';
import { fr } from './fr';
import { vi } from './vi';

export type Strength = 'strong' | 'medium' | 'weak';
export type LanguageCode = 'en' | 'vi' | 'es' | 'de' | 'fr';

/** `[phrase, example]`: the phrase as a person would write it; the example is a real-looking header that contains it. */
export type PhraseExample = readonly [phrase: string, example: string];

export interface FieldPhrases {
  kind: ImportKind;
  field: string;
  strong?: readonly PhraseExample[];
  medium?: readonly PhraseExample[];
  weak?: readonly PhraseExample[];
  /** Why a weak or medium phrase is not trusted more ("may identify an order rather than a shipment"). */
  note?: string;
}

export interface AmbiguousPhrase {
  kind: ImportKind;
  phrase: string;
  example: string;
  candidates: readonly string[];
}

export interface DictionaryFile {
  language: LanguageCode;
  /** Every language file is machine-drafted and must be reviewed by a native speaker. */
  reviewStatus: 'needs native review';
  version: string;
  groups: readonly FieldPhrases[];
  ambiguous: readonly AmbiguousPhrase[];
}

export const LANGUAGE_ORDER: readonly LanguageCode[] = ['en', 'vi', 'es', 'de', 'fr'];
export const DICTIONARY_FILES: readonly DictionaryFile[] = [en, vi, es, de, fr];

export interface PhraseRecord {
  kind: ImportKind;
  field: string;
  strength: Strength;
  phrase: string;
  key: string;
  /** The words of `key` (precomputed: the mapper compares them for every column). */
  tokens: string[];
  language: LanguageCode;
  example: string;
  note?: string;
}

export type DictionaryHit =
  | { type: 'phrase'; record: PhraseRecord }
  | { type: 'ambiguous'; kind: ImportKind; phrase: string; key: string; language: LanguageCode; candidates: readonly string[] };

export interface Dictionary {
  version: string;
  /** Exact lookup of a normalized header key within one dataset kind. */
  lookup(kind: ImportKind, key: string): DictionaryHit | null;
  /** All phrase records of one field, sorted by language order then phrase. */
  recordsFor(kind: ImportKind, field: string): readonly PhraseRecord[];
  /** True when `key` is an exact hit (canonical name, any synonym of any strength, or an ambiguous phrase) in ANY kind and language. */
  recognizesKey(key: string): boolean;
  /** Tokens that occur in the phrases of exactly one field of the kind (discriminative) and are not generic. */
  isDiscriminativeToken(kind: ImportKind, token: string): boolean;
  records(): readonly PhraseRecord[];
}

/** Words that occur in many phrases of many fields and therefore never identify a field by themselves. */
export const GENERIC_TOKENS: ReadonlySet<string> = new Set([
  'id', 'no', 'number', 'num', 'ref', 'reference', 'code', 'date', 'name', 'type', 'value', 'amount', 'total', 'unit', 'item', 'day', 'time'
]);

const STRENGTH_RANK: Record<Strength, number> = { weak: 1, medium: 2, strong: 3 };

function langRank(code: LanguageCode): number {
  return LANGUAGE_ORDER.indexOf(code);
}

function compareRecords(a: PhraseRecord, b: PhraseRecord): number {
  const text = (x: string, y: string): number => (x < y ? -1 : x > y ? 1 : 0);
  return (
    langRank(a.language) - langRank(b.language) ||
    text(a.key, b.key) ||
    text(a.phrase, b.phrase) ||
    text(a.kind, b.kind) ||
    text(a.field, b.field) ||
    text(a.strength, b.strength)
  );
}

export function flatten(files: readonly DictionaryFile[]): { records: PhraseRecord[]; ambiguous: Array<Extract<DictionaryHit, { type: 'ambiguous' }>> } {
  const records: PhraseRecord[] = [];
  const ambiguous: Array<Extract<DictionaryHit, { type: 'ambiguous' }>> = [];
  for (const file of files) {
    for (const g of file.groups) {
      for (const strength of ['strong', 'medium', 'weak'] as const) {
        for (const [phrase, example] of g[strength] ?? []) {
          const key = keyOf(phrase);
          const record: PhraseRecord = { kind: g.kind, field: g.field, strength, phrase, key, tokens: key.split(' '), language: file.language, example };
          if (g.note !== undefined) record.note = g.note;
          records.push(record);
        }
      }
    }
    for (const a of file.ambiguous) {
      ambiguous.push({ type: 'ambiguous', kind: a.kind, phrase: a.phrase, key: keyOf(a.phrase), language: file.language, candidates: a.candidates });
    }
  }
  records.sort(compareRecords);
  ambiguous.sort((a, b) => langRank(a.language) - langRank(b.language) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return { records, ambiguous };
}

/** Problems that make a dictionary unsafe (criterion 50). Empty = valid. */
export function validateDictionary(files: readonly DictionaryFile[]): string[] {
  const problems: string[] = [];
  const seen = new Map<string, { field: string; strength: Strength; language: LanguageCode }>();
  const strongField = new Map<string, string>();
  const ambiguousKeys = new Set<string>();
  const fieldNames = new Map<ImportKind, Set<string>>(IMPORT_KINDS.map((k) => [k, new Set(fieldsOf(k).map((f) => f.name))]));
  for (const file of files) {
    if (file.reviewStatus !== 'needs native review') problems.push(`${file.language}: reviewStatus must be "needs native review"`);
    for (const g of file.groups) {
      if (!fieldNames.get(g.kind)?.has(g.field)) problems.push(`${file.language}: unknown field ${g.kind}.${g.field}`);
      for (const strength of ['strong', 'medium', 'weak'] as const) {
        for (const [phrase, example] of g[strength] ?? []) {
          const where = `${file.language}/${g.kind}.${g.field}/${strength} "${phrase}"`;
          if (phrase !== phrase.trim().toLowerCase().normalize('NFC') || /\s{2,}/.test(phrase)) problems.push(`${where}: phrase is not normalized (lowercase, trimmed, single spaces, NFC)`);
          const key = keyOf(phrase);
          if (key === '') problems.push(`${where}: phrase has no content`);
          if (example.trim() === '') problems.push(`${where}: missing corpus example`);
          else if (!keyOf(example).includes(key) && keyOf(example) !== key) problems.push(`${where}: example "${example}" does not contain the phrase`);
          const id = `${g.kind}|${key}`;
          const prior = seen.get(id);
          if (prior !== undefined && prior.field !== g.field) {
            problems.push(`${where}: phrase already defined for ${prior.field} (${prior.strength}, ${prior.language})`);
          }
          seen.set(id, { field: g.field, strength, language: file.language });
          if (strength === 'strong') {
            const other = strongField.get(id);
            if (other !== undefined && other !== g.field) problems.push(`${where}: STRONG for both ${other} and ${g.field} (also after diacritic folding)`);
            strongField.set(id, g.field);
          }
        }
      }
    }
    for (const a of file.ambiguous) {
      const where = `${file.language}/ambiguous "${a.phrase}"`;
      if (a.phrase !== a.phrase.trim().toLowerCase().normalize('NFC')) problems.push(`${where}: phrase is not normalized`);
      if (a.candidates.length === 0) problems.push(`${where}: no candidates`);
      for (const c of a.candidates) if (!fieldNames.get(a.kind)?.has(c)) problems.push(`${where}: unknown candidate ${c}`);
      if (a.example.trim() === '') problems.push(`${where}: missing corpus example`);
      ambiguousKeys.add(`${a.kind}|${keyOf(a.phrase)}`);
    }
  }
  for (const id of ambiguousKeys) if (seen.has(id)) problems.push(`"${id}" is both ambiguous and a mapped phrase`);
  for (const kind of IMPORT_KINDS) {
    for (const f of fieldsOf(kind)) {
      const canonical = `${kind}|${keyOf(f.name)}`;
      const prior = seen.get(canonical);
      if (prior !== undefined && prior.field !== f.name) problems.push(`${kind}: the canonical name of ${f.name} is also a phrase of ${prior.field}`);
    }
  }
  return problems;
}

export function buildDictionary(files: readonly DictionaryFile[] = DICTIONARY_FILES): Dictionary {
  const { records, ambiguous } = flatten(files);
  const table = new Map<string, DictionaryHit>();
  const byField = new Map<string, PhraseRecord[]>();
  const recognized = new Set<string>();
  // Ambiguous phrases first so they win over nothing else (validation forbids overlap anyway).
  for (const a of ambiguous) {
    const id = `${a.kind}|${a.key}`;
    if (!table.has(id)) table.set(id, a);
    recognized.add(a.key);
  }
  for (const r of records) {
    const id = `${r.kind}|${r.key}`;
    const existing = table.get(id);
    if (existing === undefined) table.set(id, { type: 'phrase', record: r });
    else if (existing.type === 'phrase' && STRENGTH_RANK[r.strength] > STRENGTH_RANK[existing.record.strength]) table.set(id, { type: 'phrase', record: r });
    recognized.add(r.key);
    const fieldId = `${r.kind}|${r.field}`;
    const list = byField.get(fieldId) ?? [];
    list.push(r);
    byField.set(fieldId, list);
  }
  for (const kind of IMPORT_KINDS) {
    for (const f of fieldsOf(kind)) {
      const key = keyOf(f.name);
      recognized.add(key);
    }
  }
  const tokenFields = new Map<string, Set<string>>();
  for (const r of records) {
    for (const token of r.key.split(' ')) {
      const id = `${r.kind}|${token}`;
      const set = tokenFields.get(id) ?? new Set<string>();
      set.add(r.field);
      tokenFields.set(id, set);
    }
  }
  for (const kind of IMPORT_KINDS) {
    for (const f of fieldsOf(kind)) {
      for (const token of keyOf(f.name).split(' ')) {
        const id = `${kind}|${token}`;
        const set = tokenFields.get(id) ?? new Set<string>();
        set.add(f.name);
        tokenFields.set(id, set);
      }
    }
  }
  const version = files
    .map((f) => `${f.language}@${f.version}`)
    .sort()
    .join('+');
  return {
    version,
    lookup: (kind, key) => table.get(`${kind}|${key}`) ?? null,
    recordsFor: (kind, field) => byField.get(`${kind}|${field}`) ?? [],
    recognizesKey: (key) => recognized.has(key),
    isDiscriminativeToken: (kind, token) => !GENERIC_TOKENS.has(token) && (tokenFields.get(`${kind}|${token}`)?.size ?? 0) === 1,
    records: () => records
  };
}

let defaultDictionary: Dictionary | null = null;

/** The shared dictionary built from the five language files (built once). */
export function defaultDict(): Dictionary {
  defaultDictionary ??= buildDictionary();
  return defaultDictionary;
}

/** True when a header cell is an exact hit in any dictionary (used as evidence by delimiter detection). */
export function recognizesHeader(text: string): boolean {
  const key = keyOf(text);
  return key !== '' && defaultDict().recognizesKey(key);
}

/** Folded text of a phrase, exported for tests that check diacritic folding collisions. */
export function foldedKey(phrase: string): string {
  return foldText(keyOf(phrase));
}
