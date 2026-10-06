// Value mappings (ke-hoach 7.5, 7.6): the DISTINCT source values of the status and warehouse columns are mapped onto the
// existing canonical values, shown with counts, and never guessed. Status words in English, Vietnamese, Spanish, German
// and French are proposed; words with several plausible meanings ("arrived", "on hold"...) and unknown words must be
// chosen by the user. Warehouses resolve only by exact known code or exact known name (case, diacritics, whitespace and
// separator insensitive); anything else needs an explicit choice or fails. Shipment locations stay free text: only the
// recognized/unmapped counts are computed. Pure and deterministic.

import type { ShipmentStatus } from '../../types';
import { SHIPMENT_STATUSES } from '../../types';
import { LOCATIONS, WAREHOUSES, WAREHOUSE_CODES } from '../../reference/locations';
import { resolveLocation } from '../../domain/shipments';
import { foldText } from './normalizeHeader';

/** Case, diacritics, hyphen/underscore/space and punctuation-insensitive form of a value. */
export function valueKey(text: string): string {
  return foldText(text)
    .replace(/[_\-./\\‐-―−]+/g, ' ')
    .replace(/[^\p{L}\p{N} ]+/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---- status -----------------------------------------------------------------------------------------------------------

const STATUS_TERMS: ReadonlyArray<readonly [ShipmentStatus, readonly string[]]> = [
  ['in_transit', ['in transit', 'shipped', 'dispatched', 'en route', 'on the way', 'out for delivery', 'departed', 'en transito', 'unterwegs', 'dang van chuyen', 'en transit', 'en cours']],
  ['delivered', ['delivered', 'completed', 'complete', 'received', 'pod', 'entregado', 'geliefert', 'da giao', 'livre']],
  ['pending', ['pending', 'booked', 'created', 'open', 'planned', 'scheduled', 'awaiting pickup', 'processing', 'new', 'pendiente', 'offen', 'cho xu ly', 'en attente']],
  ['cancelled', ['cancelled', 'canceled', 'void', 'cancelado', 'storniert', 'da huy', 'annule']]
];

/** Words that look like a status but have several plausible meanings: never proposed, the user must choose. */
export const AMBIGUOUS_STATUS_WORDS: readonly string[] = ['arrived', 'picked up', 'loaded', 'on hold', 'exception', 'delayed', 'returned', 'partially delivered', 'closed', 'rejected'];

const STATUS_TABLE: ReadonlyMap<string, ShipmentStatus> = new Map(STATUS_TERMS.flatMap(([target, terms]) => terms.map((t): [string, ShipmentStatus] => [valueKey(t), target])));
const AMBIGUOUS_SET: ReadonlySet<string> = new Set(AMBIGUOUS_STATUS_WORDS.map(valueKey));
for (const s of SHIPMENT_STATUSES) (STATUS_TABLE as Map<string, ShipmentStatus>).set(valueKey(s), s);

export interface StatusClass {
  target: ShipmentStatus | null;
  /** Looks like a status word (mapped or ambiguous): used as profile evidence. */
  statusLike: boolean;
  ambiguous: boolean;
  /** The value is one of the four canonical statuses in some case/separator variant. */
  canonical: boolean;
}

export function classifyStatus(value: string): StatusClass {
  const key = valueKey(value);
  const target = STATUS_TABLE.get(key) ?? null;
  const canonical = target !== null && valueKey(target) === key;
  const ambiguous = target === null && AMBIGUOUS_SET.has(key);
  return { target, statusLike: target !== null || ambiguous, ambiguous, canonical };
}

export interface ValueMapEntry<T extends string> {
  source: string;
  count: number;
  /** The proposed target; null = the user must choose. */
  target: T | null;
  state: 'mapped' | 'choose';
  evidence: string;
}

export type DistinctValue = readonly [value: string, count: number];

/** Distinct values with counts in first-occurrence order (blank values are skipped). */
export function distinctValues(values: readonly string[]): DistinctValue[] {
  const counts = new Map<string, number>();
  for (const raw of values) {
    const v = raw.trim();
    if (v === '') continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts.entries()];
}

export function mapStatusValues(distinct: readonly DistinctValue[]): Array<ValueMapEntry<ShipmentStatus>> {
  return distinct.map(([source, count]) => {
    const c = classifyStatus(source);
    if (c.target !== null) {
      return { source, count, target: c.target, state: 'mapped' as const, evidence: c.canonical ? `already the SCC status "${c.target}"` : `"${source}" is a known word for "${c.target}"` };
    }
    return {
      source,
      count,
      target: null,
      state: 'choose' as const,
      evidence: c.ambiguous ? `"${source}" has more than one possible meaning; choose the SCC status it stands for` : `"${source}" is not a known status word; choose the SCC status it stands for`
    };
  });
}

// ---- warehouses -------------------------------------------------------------------------------------------------------

const WAREHOUSE_TABLE: ReadonlyMap<string, { code: string; by: 'code' | 'alias' | 'name' }> = (() => {
  const table = new Map<string, { code: string; by: 'code' | 'alias' | 'name' }>();
  for (const w of WAREHOUSES) {
    table.set(valueKey(w.name), { code: w.code, by: 'name' });
    table.set(valueKey(w.code.replace(/^WH-/, '')), { code: w.code, by: 'alias' });
    table.set(valueKey(w.code), { code: w.code, by: 'code' });
  }
  return table;
})();

export interface WarehouseClass {
  code: string | null;
  by: 'code' | 'alias' | 'name' | null;
}

export function classifyWarehouse(value: string): WarehouseClass {
  const hit = WAREHOUSE_TABLE.get(valueKey(value));
  return hit === undefined ? { code: null, by: null } : { code: hit.code, by: hit.by };
}

export function mapWarehouseValues(distinct: readonly DistinctValue[]): Array<ValueMapEntry<string>> {
  return distinct.map(([source, count]) => {
    const c = classifyWarehouse(source);
    if (c.code !== null) {
      const how = c.by === 'code' ? 'the known warehouse code' : c.by === 'name' ? 'the known warehouse name' : 'a short form of the known warehouse code';
      return { source, count, target: c.code, state: 'mapped' as const, evidence: `"${source}" is ${how} ${c.code}` };
    }
    const known = WAREHOUSE_CODES.join(', ');
    return {
      source,
      count,
      target: null,
      state: 'choose' as const,
      evidence: `"${source}" is not one of SCC's known warehouses (${known}). Choose one of them for these rows, or fix the file.`
    };
  });
}

// ---- shipment locations (free text) -----------------------------------------------------------------------------------

export interface LocationSummary {
  totalRows: number;
  recognizedRows: number;
  unmappedRows: number;
  /** Distinct unrecognized values with counts, most frequent first (ties in first-occurrence order). They import as typed. */
  unmapped: Array<{ value: string; count: number }>;
  /** Exact known short forms that can be rewritten to the canonical code (shown as a visible value mapping, never applied silently). */
  rewrites: Array<{ from: string; to: string; count: number }>;
}

/** "Locations recognized: 812 of 845 rows; 33 will appear as unmapped routes" (7.6). Nothing is dropped or hidden. */
export function summarizeLocations(values: readonly string[]): LocationSummary {
  const distinct = distinctValues(values);
  let recognized = 0;
  let total = 0;
  const unmapped: Array<{ value: string; count: number }> = [];
  const rewrites: Array<{ from: string; to: string; count: number }> = [];
  for (const [value, count] of distinct) {
    total += count;
    if (resolveLocation(value, LOCATIONS) !== null) {
      recognized += count;
      continue;
    }
    const alias = classifyWarehouse(value);
    if (alias.code !== null) {
      recognized += count;
      rewrites.push({ from: value, to: alias.code, count });
      continue;
    }
    unmapped.push({ value, count });
  }
  unmapped.sort((a, b) => b.count - a.count);
  return { totalRows: total, recognizedRows: recognized, unmappedRows: total - recognized, unmapped, rewrites };
}
