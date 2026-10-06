import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { importInventoryCsv } from '../../../src/shared/csv/importInventory';

const HEADER = 'sku,product_name,category,warehouse,quantity,reorder_point,unit_cost,avg_daily_usage,lead_time_days';

function row(overrides: Partial<Record<string, string>> = {}): string {
  const defaults: Record<string, string> = {
    sku: 'ELC-9001',
    product_name: 'Wireless Barcode Scanner',
    category: 'Electronics',
    warehouse: 'WH-DFW',
    quantity: '120',
    reorder_point: '40',
    unit_cost: '89.50',
    avg_daily_usage: '6.5',
    lead_time_days: '14'
  };
  const merged = { ...defaults, ...overrides };
  return ['sku', 'product_name', 'category', 'warehouse', 'quantity', 'reorder_point', 'unit_cost', 'avg_daily_usage', 'lead_time_days']
    .map((k) => merged[k])
    .join(',');
}

describe('importInventoryCsv', () => {
  it('imports the shipped template with zero errors', () => {
    const text = readFileSync(resolve(process.cwd(), 'public/templates/inventory-template.csv'), 'utf-8');
    const result = importInventoryCsv(text);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rows).toHaveLength(2);
  });

  it('reports missing required columns by name', () => {
    const result = importInventoryCsv('sku,product_name\nELC-9001,Scanner\n');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe('MISSING_COLUMNS');
      expect(result.errors[0]?.message).toContain('category');
      expect(result.errors[0]?.message).toContain('warehouse');
    }
  });

  it('reports a duplicate header column', () => {
    const result = importInventoryCsv(`${HEADER},sku\n${row()},ELC-9001\n`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('DUPLICATE_COLUMNS');
  });

  it('warns about an unknown extra column', () => {
    const result = importInventoryCsv(`${HEADER},notes\n${row()},hello\n`);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.warnings.some((w) => w.includes('notes'))).toBe(true);
  });

  it('defaults optional columns when absent and warns', () => {
    const smallHeader = 'sku,product_name,category,warehouse,quantity,reorder_point,unit_cost';
    const smallRow = 'ELC-9001,Scanner,Electronics,WH-DFW,120,40,89.50';
    const result = importInventoryCsv(`${smallHeader}\n${smallRow}\n`);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rows[0]?.avgDailyUsage).toBeNull();
      expect(result.rows[0]?.leadTimeDays).toBe(14);
      expect(result.warnings.some((w) => w.includes('avg_daily_usage'))).toBe(true);
      expect(result.warnings.some((w) => w.includes('lead_time_days'))).toBe(true);
    }
  });

  it('normalizes header case and spacing variants', () => {
    const weirdHeader = 'SKU , Product Name,Category,Warehouse,Quantity,Reorder Point,Unit Cost';
    const smallRow = 'ELC-9001,Scanner,Electronics,WH-DFW,120,40,89.50';
    const result = importInventoryCsv(`${weirdHeader}\n${smallRow}\n`);
    expect(result.ok).toBe(true);
  });

  it('rejects a negative quantity', () => {
    const result = importInventoryCsv(`${HEADER}\n${row({ quantity: '-5' })}\n`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('NEGATIVE');
  });

  it('rejects a decimal quantity', () => {
    const result = importInventoryCsv(`${HEADER}\n${row({ quantity: '1.5' })}\n`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('NOT_INTEGER');
  });

  it('rejects an invalid unit_cost', () => {
    const result = importInventoryCsv(`${HEADER}\n${row({ unit_cost: '$12' })}\n`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('INVALID_NUMBER');
  });

  it('rejects a unit_cost with too many decimals', () => {
    const result = importInventoryCsv(`${HEADER}\n${row({ unit_cost: '12.345' })}\n`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('TOO_MANY_DECIMALS');
  });

  it('rejects an unknown warehouse', () => {
    const result = importInventoryCsv(`${HEADER}\n${row({ warehouse: 'WH-XXX' })}\n`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('UNKNOWN_WAREHOUSE');
  });

  it('rejects a duplicate SKU + warehouse (case-insensitive) with the first-seen line', () => {
    const text = `${HEADER}\n${row()}\n${row({ sku: 'elc-9001' })}\n`;
    const result = importInventoryCsv(text);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const dup = result.errors.find((e) => e.code === 'DUPLICATE_ID');
      expect(dup?.message).toContain('first seen on line 2');
    }
  });

  it('allows the same SKU in a different warehouse', () => {
    const text = `${HEADER}\n${row()}\n${row({ warehouse: 'WH-ATL' })}\n`;
    const result = importInventoryCsv(text);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rows).toHaveLength(2);
  });

  it('reports FIELD_COUNT for a short row', () => {
    const result = importInventoryCsv(`${HEADER}\nELC-9001,Scanner\n`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('FIELD_COUNT');
  });

  it('tolerates empty trailing fields beyond the header length', () => {
    const result = importInventoryCsv(`${HEADER}\n${row()},,\n`);
    expect(result.ok).toBe(true);
  });

  it('rejects a non-empty extra trailing field', () => {
    const result = importInventoryCsv(`${HEADER}\n${row()},extra\n`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('FIELD_COUNT');
  });

  it('collects errors across many rows, sorted by line then column', () => {
    const text = `${HEADER}\n${row({ sku: 'ELC-9001', quantity: '-1' })}\n${row({ sku: 'ELC-9002', unit_cost: 'bad' })}\n`;
    const result = importInventoryCsv(text);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toHaveLength(2);
      expect(result.errors[0]?.line).toBe(2);
      expect(result.errors[1]?.line).toBe(3);
    }
  });

  it('truncates the error list at 500 and reports the full totalErrors count', () => {
    const rows = Array.from({ length: 600 }, (_, i) => row({ sku: `ELC-${String(9000 + i)}`, quantity: '-1' })).join('\n');
    const result = importInventoryCsv(`${HEADER}\n${rows}\n`);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toHaveLength(500);
      expect(result.totalErrors).toBe(600);
    }
  });

  it('reports NO_DATA_ROWS for a header-only file', () => {
    const result = importInventoryCsv(`${HEADER}\n`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('NO_DATA_ROWS');
  });

  it('reports EMPTY_FILE for an empty string', () => {
    const result = importInventoryCsv('');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('EMPTY_FILE');
  });

  it('reports EMPTY_FILE for a whitespace-only string', () => {
    const result = importInventoryCsv('   \n  \n');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('EMPTY_FILE');
  });

  it('reports MALFORMED_CSV for a NUL byte', () => {
    const result = importInventoryCsv(`${HEADER}\n${row()}\u0000\n`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('MALFORMED_CSV');
  });
});
