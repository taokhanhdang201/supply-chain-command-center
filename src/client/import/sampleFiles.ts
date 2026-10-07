// The demo files, built in the browser from the existing sample-data generator (with a seed other than the one the app
// starts with, so an import visibly changes every page): the carrier export behind "No file? Try one.", and under "More" an
// inventory file and a short shipments file with a few broken rows. They go through the same flow as a chosen file.

import { generateSampleData } from '../../shared/sample/generateSampleData';
import { INVENTORY_COLUMNS, SHIPMENT_COLUMNS } from '../../shared/csv/schemas';
import type { DayString, ImportKind, InventoryRecord, ShipmentRecord } from '../../shared/types';

/** The seed of the demo samples: the app starts on seed 42, so seed 7 changes every figure. */
export const SAMPLE_SEED = 7;

export type SampleId = 'shipments' | 'inventory' | 'errors' | 'carrier-export';

/** The secondary samples under "More" (the main demo is "No file? Try one.", the carrier export). */
export const MORE_SAMPLES: ReadonlyArray<{ id: SampleId; label: string }> = [
  { id: 'errors', label: 'Try a file with errors' },
  { id: 'inventory', label: 'Try an inventory file' }
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

/** The demo's file name; the server keeps it as the data-source label. */
export const CARRIER_EXPORT_NAME = 'carrier-export.csv';

/** The demo: a carrier's own export of the seed 7 shipments, the way real exports look. */
export const CARRIER_EXPORT_HEADER = ['Load ID', 'From', 'To', 'Transporter', 'Shipment Status', 'Dispatch Date', 'ETA', 'Delivered Date', 'Freight Cost'] as const;

/** 15.03.2026 */
const dayDotMonth = (iso: string): string => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
/** 3/15/2026 (no leading zeros) */
const monthSlashDay = (iso: string): string => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}/${iso.slice(0, 4)}`;
/** "$1,812.40" */
const dollars = (cents: number): string => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Carrier words for the statuses. Every other in-transit shipment says "Arrived", which can mean in transit (at a
 * terminal) or delivered: SCC asks instead of guessing. "Booked" is a known word for pending.
 */
function carrierStatus(status: string, inTransitIndex: number): string {
  if (status === 'in_transit') return inTransitIndex % 2 === 0 ? 'Arrived' : 'In transit';
  return { pending: 'Booked', delivered: 'Delivered', cancelled: 'Cancelled' }[status] ?? status;
}

/** How many shipments of the demo say "Arrived" (the demo's one question). */
export function arrivedCount(shipments: readonly ShipmentRecord[]): number {
  return Math.ceil(shipments.filter((s) => s.status === 'in_transit').length / 2);
}

function carrierExportCsv(shipments: readonly ShipmentRecord[]): string {
  // A value that needs no quotes gets a space on each side, as some exports write them; quoted values cannot carry one.
  const cell = (v: string): string => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : ` ${v} `);
  let inTransit = 0;
  const rows = shipments.map((r) => {
    const status = carrierStatus(r.status, r.status === 'in_transit' ? inTransit++ : 0);
    return [r.shipmentId, r.origin, r.destination, r.carrier, status, r.shipDate, r.estimatedDelivery === null ? '' : dayDotMonth(r.estimatedDelivery), r.actualDelivery === null ? '' : monthSlashDay(r.actualDelivery), dollars(r.shippingCostCents)].map(cell).join(',');
  });
  return [CARRIER_EXPORT_HEADER.map((h) => ` ${h} `).join(','), ...rows].join('\n') + '\n';
}

/** Builds one sample as a File, ready for the import flow. Everything happens in the browser. */
export function buildSampleFile(id: SampleId, today: DayString, seed = SAMPLE_SEED): File {
  const data = generateSampleData({ seed, today });
  if (id === 'carrier-export') {
    return new File([carrierExportCsv(data.shipments)], CARRIER_EXPORT_NAME, { type: 'text/csv' });
  }
  if (id === 'inventory') {
    return new File([toCsv(INVENTORY_HEADER, data.inventory.map(inventoryRow))], sampleFileName('inventory', seed), { type: 'text/csv' });
  }
  if (id === 'shipments') {
    return new File([toCsv(SHIPMENT_HEADER, data.shipments.map(shipmentRow))], sampleFileName('shipments', seed), { type: 'text/csv' });
  }
  return new File([errorSampleCsv(data.shipments)], 'sample-shipments-with-errors.csv', { type: 'text/csv' });
}
