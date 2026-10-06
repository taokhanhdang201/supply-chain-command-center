// Deterministic alias dictionary for flexible column mapping (V1.5). Lookup is an exact match on a normalized key:
// no fuzzy, token, substring or edit-distance matching, so a suggestion is always explainable from this table.
// Keys are held in `Map`s (never plain objects) because header text is user content.

import type { ImportKind } from '../types';
import { INVENTORY_COLUMNS, SHIPMENT_COLUMNS } from '../csv/schemas';

/** Alias key: trim, lowercase, and collapse whitespace and `_ - . / ( )` runs to one space. Other characters are kept. */
export function normalizeAliasKey(header: string): string {
  return header.trim().toLowerCase().replace(/[\s_\-./()]+/g, ' ').trim();
}

export type AliasLookup =
  | { type: 'unique'; field: string }
  | { type: 'ambiguous'; candidates: readonly string[] }
  | { type: 'none' };

type AliasTable = readonly (readonly [field: string, aliases: readonly string[]])[];
type AmbiguousTable = readonly (readonly [key: string, candidates: readonly string[]])[];

/** Unique inventory aliases (besides each canonical name, which is an implicit alias of itself). */
export const INVENTORY_ALIASES: AliasTable = [
  ['sku', ['item code', 'product id', 'material number', 'material code']],
  ['product_name', ['product', 'item description', 'product description']],
  ['category', ['product category']],
  ['warehouse', ['wh', 'plant', 'plant code', 'location']],
  ['quantity', ['qty', 'on hand', 'on hand qty', 'available qty', 'stock qty', 'inventory balance', 'available stock']],
  ['reorder_point', ['reorder level', 'rop']],
  ['unit_cost', ['unit price', 'price', 'standard cost']],
  ['avg_daily_usage', ['daily usage', 'daily consumption', 'average daily demand', 'average daily usage']],
  ['lead_time_days', ['lead time', 'supplier lead time']]
];

/** Unique shipment aliases. */
export const SHIPMENT_ALIASES: AliasTable = [
  ['shipment_id', ['shipment number', 'load id']],
  ['origin', ['origin location', 'from']],
  ['destination', ['destination location', 'to']],
  ['carrier', ['transporter', 'logistics provider']],
  ['status', ['shipment status']],
  ['ship_date', ['shipping date', 'dispatch date']],
  ['estimated_delivery', ['eta', 'expected delivery']],
  ['actual_delivery', ['delivery date', 'delivered date']],
  ['shipping_cost', ['freight cost', 'transport cost']]
];

/** Inventory headers with several plausible meanings: never auto-assigned, even with a single candidate. */
export const INVENTORY_AMBIGUOUS: AmbiguousTable = [
  ['cost', ['unit_cost']],
  ['avg usage', ['avg_daily_usage']]
];

/** Shipment headers with several plausible meanings. */
export const SHIPMENT_AMBIGUOUS: AmbiguousTable = [
  ['cost', ['shipping_cost']],
  ['date', ['ship_date', 'estimated_delivery', 'actual_delivery']],
  ['location', ['origin', 'destination']]
];

interface KindTables {
  unique: Map<string, string>;
  ambiguous: Map<string, readonly string[]>;
}

function buildTables(columns: readonly { name: string }[], aliases: AliasTable, ambiguous: AmbiguousTable): KindTables {
  const unique = new Map<string, string>();
  for (const { name } of columns) unique.set(normalizeAliasKey(name), name);
  for (const [field, list] of aliases) {
    for (const alias of list) unique.set(normalizeAliasKey(alias), field);
  }
  return { unique, ambiguous: new Map(ambiguous) };
}

const TABLES: ReadonlyMap<ImportKind, KindTables> = new Map<ImportKind, KindTables>([
  ['inventory', buildTables(INVENTORY_COLUMNS, INVENTORY_ALIASES, INVENTORY_AMBIGUOUS)],
  ['shipments', buildTables(SHIPMENT_COLUMNS, SHIPMENT_ALIASES, SHIPMENT_AMBIGUOUS)]
]);

/** Looks a header up in the kind's alias tables: ambiguous first, then unique, else none. */
export function lookupAlias(kind: ImportKind, header: string): AliasLookup {
  const tables = TABLES.get(kind);
  if (tables === undefined) return { type: 'none' };
  const key = normalizeAliasKey(header);
  const candidates = tables.ambiguous.get(key);
  if (candidates !== undefined) return { type: 'ambiguous', candidates };
  const field = tables.unique.get(key);
  if (field !== undefined) return { type: 'unique', field };
  return { type: 'none' };
}
