import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { importInventoryCsv } from '../../../src/shared/csv/importInventory';
import { importShipmentsCsv } from '../../../src/shared/csv/importShipments';
import type { ColumnMap } from '../../../src/shared/csv/importCommon';

const read = (p: string): string => readFileSync(resolve(process.cwd(), p), 'utf-8');
const INV_ALT = read('tests/fixtures/import/inventory_alt_schema.csv');
const SHP_ALT = read('tests/fixtures/import/shipments_alt_schema.csv');
const INV_TEMPLATE = read('public/templates/inventory-template.csv');

const INV_FIELDS = ['sku', 'product_name', 'category', 'warehouse', 'quantity', 'reorder_point', 'unit_cost', 'avg_daily_usage', 'lead_time_days'];
const SHP_FIELDS = ['shipment_id', 'origin', 'destination', 'carrier', 'status', 'ship_date', 'estimated_delivery', 'actual_delivery', 'shipping_cost'];
const INV_HEADER = 'Material Number,Item Description,Category,Plant,On Hand Qty,Reorder Level,Unit Price,Daily Consumption,Supplier Lead Time';

describe('import with a column map', () => {
  it('imports the alt inventory file with exact values preserved', () => {
    const result = importInventoryCsv(INV_ALT, undefined, INV_FIELDS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toEqual([]);
    expect(result.rows).toEqual([
      { sku: 'MAT-10001', productName: 'Hydraulic Pump Seal Kit', category: 'Maintenance', warehouse: 'WH-DFW', quantity: 12, reorderPoint: 40, unitCostCents: 14575, avgDailyUsage: 3.5, leadTimeDays: 21 },
      { sku: 'MAT-10002', productName: 'Bolt, M8 x 40mm', category: 'Fasteners', warehouse: 'WH-ATL', quantity: 5000, reorderPoint: 1200, unitCostCents: 18, avgDailyUsage: 250, leadTimeDays: 7 },
      { sku: 'MAT-10003', productName: 'Nitrile Gloves (Box of 100)', category: 'Safety', warehouse: 'WH-ORD', quantity: 0, reorderPoint: 30, unitCostCents: 940, avgDailyUsage: 4, leadTimeDays: 10 },
      { sku: 'MAT-10004', productName: 'Forklift Battery 48V', category: 'Equipment', warehouse: 'WH-LAX', quantity: 6, reorderPoint: 2, unitCostCents: 425000, avgDailyUsage: 0.1, leadTimeDays: 45 }
    ]);
  });

  it('imports the alt shipments file with exact values preserved', () => {
    const result = importShipmentsCsv(SHP_ALT, undefined, SHP_FIELDS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toEqual([
      { shipmentId: 'LD-50001', origin: 'WH-DFW', destination: 'HOU', carrier: 'Northstar Freight', status: 'delivered', shipDate: '2026-03-02', estimatedDelivery: '2026-03-05', actualDelivery: '2026-03-04', shippingCostCents: 81240 },
      { shipmentId: 'LD-50002', origin: 'WH-LAX', destination: 'Seattle, WA', carrier: 'Summit Express', status: 'in_transit', shipDate: '2026-03-10', estimatedDelivery: '2026-03-15', actualDelivery: null, shippingCostCents: 241000 },
      { shipmentId: 'LD-50003', origin: 'WH-EWR', destination: 'WH-ATL', carrier: 'Keystone Logistics', status: 'pending', shipDate: '2026-06-01', estimatedDelivery: '2026-06-08', actualDelivery: null, shippingCostCents: 150000 }
    ]);
  });

  it('keeps the V1 MISSING_COLUMNS rejection for the alt file when no map is sent', () => {
    const result = importInventoryCsv(INV_ALT);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.code).toBe('MISSING_COLUMNS');
      expect(result.errors[0]?.message).toContain('Found columns: material_number');
    }
  });

  it('gives the same result for the canonical template with no map and with the identity map', () => {
    expect(importInventoryCsv(INV_TEMPLATE, undefined, INV_FIELDS)).toEqual(importInventoryCsv(INV_TEMPLATE));
  });

  it('still runs row validation on mapped columns and reports canonical column names', () => {
    const csv = `${INV_HEADER}\nMAT-1,Widget,Cat,WH-NOPE,12.5,40,1.00,1,7\n`;
    const result = importInventoryCsv(csv, undefined, INV_FIELDS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const byColumn = new Map(result.errors.map((e) => [e.column, e.code]));
    expect(byColumn.get('warehouse')).toBe('UNKNOWN_WAREHOUSE');
    expect(byColumn.get('quantity')).toBe('NOT_INTEGER');
    expect(result.errors.every((e) => e.line === 2)).toBe(true);
  });

  it('keeps the Excel M/D/YYYY date message on a mapped date column', () => {
    const csv = `${SHP_ALT.split('\n')[0]}\nLD-60001,WH-DFW,HOU,Northstar Freight,Delivered,8/15/2026,2026-08-18,2026-08-17,812.40\n`;
    const result = importShipmentsCsv(csv, undefined, SHP_FIELDS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toEqual({
      line: 2,
      column: 'ship_date',
      code: 'INVALID_DATE',
      message:
        '"8/15/2026" looks like Excel changed this date to M/D/YYYY. Dates must be YYYY-MM-DD, e.g. 2026-08-15. Re-download the file and upload it without opening it in Excel.'
    });
  });

  it('keeps physical line numbers exact when an earlier record has a multi-line quoted cell', () => {
    const csv = `${INV_HEADER}\nMAT-1,"Two\nline name",Cat,WH-DFW,1,1,1.00,1,7\nMAT-2,Widget,Cat,WH-DFW,abc,1,1.00,1,7\n`;
    const result = importInventoryCsv(csv, undefined, INV_FIELDS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const codes = result.errors.map((e) => `${e.line}:${e.column}:${e.code}`);
    expect(codes).toContain('2:product_name:CONTROL_CHARS');
    expect(codes).toContain('4:quantity:INVALID_NUMBER');
  });

  it('rejects a map whose length differs from the header with INVALID_MAPPING', () => {
    const result = importInventoryCsv(INV_ALT, undefined, INV_FIELDS.slice(0, 8));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual([
        { line: 1, column: null, code: 'INVALID_MAPPING', message: 'The column mapping lists 8 column(s) but the file header has 9.' }
      ]);
    }
  });

  it('rejects two columns mapped to the same field with DUPLICATE_COLUMNS', () => {
    const map: ColumnMap = ['sku', 'product_name', 'category', 'warehouse', 'quantity', 'quantity', 'unit_cost', 'avg_daily_usage', 'lead_time_days'];
    const result = importInventoryCsv(INV_ALT, undefined, map);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe('DUPLICATE_COLUMNS');
      expect(result.errors[0]?.message).toBe('Field "quantity" is mapped from more than one column.');
    }
  });

  it('blocks a missing required field, and applies the V1 warnings and defaults for missing optional fields', () => {
    const missing = importInventoryCsv(INV_ALT, undefined, [null, 'product_name', 'category', 'warehouse', 'quantity', 'reorder_point', 'unit_cost', 'avg_daily_usage', 'lead_time_days']);
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.errors[0]?.code).toBe('MISSING_COLUMNS');
      expect(missing.errors[0]?.message).toContain('Missing required column(s): sku.');
    }

    const optional = importInventoryCsv(INV_ALT, undefined, ['sku', 'product_name', 'category', 'warehouse', 'quantity', 'reorder_point', 'unit_cost', null, null]);
    expect(optional.ok).toBe(true);
    if (!optional.ok) return;
    expect(optional.rows.every((r) => r.avgDailyUsage === null && r.leadTimeDays === 14)).toBe(true);
    expect(optional.warnings).toEqual([
      'Ignored unmapped column(s): daily_consumption, supplier_lead_time.',
      'Column avg_daily_usage not present; stockout risk and turnover will be unavailable for these items.',
      'Column lead_time_days not present; the default of 14 days is used.'
    ]);
  });

  it('never reads an ignored column, even if it holds control characters or garbage', () => {
    const csv = `${INV_HEADER}\nMAT-1,Widget,Cat,WH-DFW,1,1,1.00,\u0007garbage\u0001,not-a-number\n`;
    const result = importInventoryCsv(csv, undefined, ['sku', 'product_name', 'category', 'warehouse', 'quantity', 'reorder_point', 'unit_cost', null, null]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.warnings[0]).toBe('Ignored unmapped column(s): daily_consumption, supplier_lead_time.');
  });

  it('keeps NUL, column-count and formula/HTML protections with a map', () => {
    const nul = importInventoryCsv(`${INV_HEADER}\nMAT-1,Widget\u0000,Cat,WH-DFW,1,1,1.00,1,7\n`, undefined, INV_FIELDS);
    expect(nul.ok).toBe(false);
    if (!nul.ok) expect(nul.errors[0]?.code).toBe('MALFORMED_CSV');

    const wide = Array.from({ length: 51 }, (_, i) => `c${i}`).join(',');
    const tooMany = importInventoryCsv(`${wide}\n1\n`, undefined, INV_FIELDS);
    expect(tooMany.ok).toBe(false);
    if (!tooMany.ok) expect(tooMany.errors[0]?.code).toBe('TOO_MANY_COLUMNS');

    const literal = importInventoryCsv(`${INV_HEADER}\nMAT-1,=SUM(A1:A9),<img src=x onerror=alert(1)>,WH-DFW,1,1,1.00,1,7\n`, undefined, INV_FIELDS);
    expect(literal.ok).toBe(true);
    if (literal.ok) {
      expect(literal.rows[0]?.productName).toBe('=SUM(A1:A9)');
      expect(literal.rows[0]?.category).toBe('<img src=x onerror=alert(1)>');
    }
  });

  it('rejects an unknown field name in the map with INVALID_MAPPING', () => {
    const map = ['sku', 'product_name', 'category', 'warehouse', 'quantity', 'reorder_point', 'unit_cost', 'avg_daily_usage', 'shipping_cost'];
    const result = importInventoryCsv(INV_ALT, undefined, map);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual([
        { line: 1, column: null, code: 'INVALID_MAPPING', message: 'The column mapping uses unknown field "shipping_cost".' }
      ]);
    }
  });
});
