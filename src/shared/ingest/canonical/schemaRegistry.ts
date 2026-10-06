// Read-only view of the canonical SCC schemas for the ingestion pipeline. It wraps the existing V1 column specs
// (`INVENTORY_COLUMNS`, `SHIPMENT_COLUMNS`: NOT edited) and adds what the mapper needs to know about each field: the kind of
// value it holds, whether it is discriminative by its values, and the missing-field policy of ke-hoach 5.3 (unknown
// allowed only where the model already allows null/default; file-wide constants only for low-risk descriptors).
// Adding a dataset later means adding one entry here (a model change needs the user's separate approval, 7.1a).

import type { ImportKind } from '../../types';
import { INVENTORY_COLUMNS, SHIPMENT_COLUMNS, type ColumnSpec } from '../../csv/schemas';

export type ValueKind = 'id' | 'text' | 'integer' | 'decimal' | 'money' | 'date' | 'status' | 'warehouse' | 'location';

export interface FieldInfo {
  name: string;
  kind: ImportKind;
  spec: ColumnSpec;
  valueKind: ValueKind;
  /** The values themselves identify the field (status words, known warehouses, known locations). */
  discriminative: boolean;
  /** A column may be omitted and the field imported as unknown (an empty column is emitted). */
  unknownAllowed: boolean;
  /** One file-wide constant typed by the user may fill the field. */
  constantAllowed: boolean;
}

const VALUE_KIND: Record<string, ValueKind> = {
  sku: 'id',
  product_name: 'text',
  category: 'text',
  warehouse: 'warehouse',
  quantity: 'integer',
  reorder_point: 'integer',
  unit_cost: 'money',
  avg_daily_usage: 'decimal',
  lead_time_days: 'integer',
  shipment_id: 'id',
  origin: 'location',
  destination: 'location',
  carrier: 'text',
  status: 'status',
  ship_date: 'date',
  estimated_delivery: 'date',
  actual_delivery: 'date',
  shipping_cost: 'money'
};

const DISCRIMINATIVE = new Set(['status', 'warehouse', 'origin', 'destination']);
const UNKNOWN_ALLOWED = new Set(['estimated_delivery', 'actual_delivery', 'avg_daily_usage', 'lead_time_days']);
const CONSTANT_ALLOWED = new Set(['carrier', 'warehouse', 'origin', 'destination', 'category', 'status', 'lead_time_days']);

function build(kind: ImportKind, specs: readonly ColumnSpec[]): readonly FieldInfo[] {
  return specs.map((spec) => ({
    name: spec.name,
    kind,
    spec,
    valueKind: VALUE_KIND[spec.name] ?? 'text',
    discriminative: DISCRIMINATIVE.has(spec.name),
    unknownAllowed: UNKNOWN_ALLOWED.has(spec.name),
    constantAllowed: CONSTANT_ALLOWED.has(spec.name)
  }));
}

const SCHEMAS: ReadonlyMap<ImportKind, readonly FieldInfo[]> = new Map<ImportKind, readonly FieldInfo[]>([
  ['inventory', build('inventory', INVENTORY_COLUMNS)],
  ['shipments', build('shipments', SHIPMENT_COLUMNS)]
]);

/** Dataset kinds in a fixed order (never iterate a Map of kinds implicitly). */
export const IMPORT_KINDS: readonly ImportKind[] = ['inventory', 'shipments'];

/** Fields of a dataset in canonical schema order. */
export function fieldsOf(kind: ImportKind): readonly FieldInfo[] {
  return SCHEMAS.get(kind) ?? [];
}

export function fieldInfo(kind: ImportKind, name: string): FieldInfo | undefined {
  return fieldsOf(kind).find((f) => f.name === name);
}

/** Canonical column names in schema order (the order of the canonical CSV header). */
export function canonicalColumns(kind: ImportKind): string[] {
  return fieldsOf(kind).map((f) => f.name);
}

export function isNumberField(f: FieldInfo): boolean {
  return f.valueKind === 'integer' || f.valueKind === 'decimal' || f.valueKind === 'money';
}

export function isDateField(f: FieldInfo): boolean {
  return f.valueKind === 'date';
}

/** The number/date normalization context of a field (AD-2, AD-3). */
export function numberContext(f: FieldInfo): { money: boolean; optional: boolean } {
  return { money: f.valueKind === 'money', optional: f.name === 'avg_daily_usage' || f.name === 'lead_time_days' };
}

export function dateContext(f: FieldInfo): { optional: boolean } {
  return { optional: f.name === 'estimated_delivery' || f.name === 'actual_delivery' };
}
