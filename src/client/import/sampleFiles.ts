// "Try a sample" for the demo: CSV files built in the browser from the existing sample-data generator (with a seed other
// than the one the app starts with, so an import visibly changes every page), plus a short shipments file with a few
// broken rows that the review blocks. The files go through the same import flow as a file the user chooses.

import { generateSampleData } from '../../shared/sample/generateSampleData';
import { INVENTORY_COLUMNS, SHIPMENT_COLUMNS } from '../../shared/csv/schemas';
import type { DayString, ImportKind, InventoryRecord, ShipmentRecord } from '../../shared/types';

/** The seed of the demo samples: the app starts on seed 42, so seed 7 changes every figure. */
export const SAMPLE_SEED = 7;

export type SampleId = 'shipments' | 'inventory' | 'errors';

export interface SampleOption {
  id: SampleId;
  label: string;
  /** What the sample is for, shown in the menu. */
  note: string;
}

export const SAMPLE_OPTIONS: readonly SampleOption[] = [
  { id: 'shipments', label: 'Shipments sample', note: 'A full shipments file to import' },
  { id: 'inventory', label: 'Inventory sample', note: 'A full inventory file to import' },
  { id: 'errors', label: 'Sample with errors', note: 'A few broken rows: see how errors are reported' }
];

/** A sample file name the server keeps as the data-source label (it allows letters, digits, dot, dash, underscore). */
export function sampleFileName(kind: ImportKind, seed = SAMPLE_SEED): string {
  return `sample-${kind}-seed-${seed}.csv`;
}

const SAMPLE_NAME = /^sample-(inventory|shipments)-seed-(\d+)\.csv$/;

/** The label to show for a data source: a sample file reads "Sample data (seed 7)"; anything else is shown as is. */
export function displaySourceLabel(label: string): string {
  const match = SAMPLE_NAME.exec(label);
  return match === null ? label : `Sample data (seed ${match[2]})`;
}

const money = (cents: number): string => (cents / 100).toFixed(2);

/** One CSV field: quoted only when it holds a comma, a quote or a line break. */
function field(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function toCsv(header: readonly string[], rows: ReadonlyArray<readonly string[]>): string {
  return [header, ...rows].map((r) => r.map(field).join(',')).join('\n') + '\n';
}

// Row builders, in the documented column order (INVENTORY_COLUMNS / SHIPMENT_COLUMNS).
function inventoryRow(r: InventoryRecord): string[] {
  return [r.sku, r.productName, r.category, r.warehouse, String(r.quantity), String(r.reorderPoint), money(r.unitCostCents), r.avgDailyUsage === null ? '' : String(r.avgDailyUsage), String(r.leadTimeDays)];
}

function shipmentRow(r: ShipmentRecord): string[] {
  return [r.shipmentId, r.origin, r.destination, r.carrier, r.status, r.shipDate, r.estimatedDelivery ?? '', r.actualDelivery ?? '', money(r.shippingCostCents)];
}

const INVENTORY_HEADER = INVENTORY_COLUMNS.map((c) => c.name);
const SHIPMENT_HEADER = SHIPMENT_COLUMNS.map((c) => c.name);

/**
 * Rows of the "Sample with errors" file and which data rows (1-based) are broken, and how. Every break is a row error the
 * validation reports. (An unknown status is not one: the review asks how to map it instead, before validating.)
 */
export const ERROR_SAMPLE_ROWS = 20;
export const ERROR_SAMPLE_BROKEN = {
  shipDate: [4, 9, 15], // not a date in YYYY-MM-DD
  shipmentId: [6, 12], // a character an ID may not hold
  shippingCost: [11, 18] // missing
} as const;

function errorSampleCsv(shipments: readonly ShipmentRecord[]): string {
  const rows = shipments.slice(0, ERROR_SAMPLE_ROWS).map(shipmentRow);
  const set = (row: number, column: string, value: (current: string) => string) => {
    const r = rows[row - 1];
    const i = SHIPMENT_HEADER.indexOf(column);
    if (r !== undefined) r[i] = value(r[i] ?? '');
  };
  for (const row of ERROR_SAMPLE_BROKEN.shipDate) set(row, 'ship_date', () => 'next week');
  for (const row of ERROR_SAMPLE_BROKEN.shipmentId) set(row, 'shipment_id', (id) => id.replace('-', '#'));
  for (const row of ERROR_SAMPLE_BROKEN.shippingCost) set(row, 'shipping_cost', () => '');
  return toCsv(SHIPMENT_HEADER, rows);
}

/** Builds one sample as a File, ready for the import flow. Everything happens in the browser. */
export function buildSampleFile(id: SampleId, today: DayString, seed = SAMPLE_SEED): File {
  const data = generateSampleData({ seed, today });
  if (id === 'inventory') {
    return new File([toCsv(INVENTORY_HEADER, data.inventory.map(inventoryRow))], sampleFileName('inventory', seed), { type: 'text/csv' });
  }
  if (id === 'shipments') {
    return new File([toCsv(SHIPMENT_HEADER, data.shipments.map(shipmentRow))], sampleFileName('shipments', seed), { type: 'text/csv' });
  }
  return new File([errorSampleCsv(data.shipments)], 'sample-shipments-with-errors.csv', { type: 'text/csv' });
}
