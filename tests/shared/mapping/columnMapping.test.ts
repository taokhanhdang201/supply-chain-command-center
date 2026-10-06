import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  analyzeImportFile,
  deterministicSuggester,
  previewImport,
  requiresMappingStep,
  suggestMapping,
  toColumnMap,
  validateMapping,
  type Assignment
} from '../../../src/shared/mapping/columnMapping';

const read = (p: string): string => readFileSync(resolve(process.cwd(), p), 'utf-8');
const INV_ALT = read('tests/fixtures/import/inventory_alt_schema.csv');
const SHP_ALT = read('tests/fixtures/import/shipments_alt_schema.csv');
const INV_TEMPLATE = read('public/templates/inventory-template.csv');
const SHP_TEMPLATE = read('public/templates/shipments-template.csv');

const INV_FIELDS = ['sku', 'product_name', 'category', 'warehouse', 'quantity', 'reorder_point', 'unit_cost', 'avg_daily_usage', 'lead_time_days'];
const SHP_FIELDS = ['shipment_id', 'origin', 'destination', 'carrier', 'status', 'ship_date', 'estimated_delivery', 'actual_delivery', 'shipping_cost'];
const INV_ALT_HEADERS = INV_ALT.split('\n')[0]!.split(',');
const SHP_ALT_HEADERS = SHP_ALT.split('\n')[0]!.split(',');
const COMPANY_B = 'Item Code,Product Description,Category,Warehouse,Available Stock,ROP,Cost,Avg Usage,Lead Time'.split(',');

const field = (f: string): Assignment => ({ type: 'field', field: f });
const fields = (list: readonly string[]): Assignment[] => list.map(field);
const assignmentsOf = (headers: readonly string[], kind: 'inventory' | 'shipments' = 'inventory'): Assignment[] =>
  suggestMapping(kind, headers).columns.map((c) => c.assignment);

describe('suggestMapping', () => {
  it('marks a canonical inventory header row all exact', () => {
    const s = suggestMapping('inventory', INV_FIELDS);
    expect(s.columns.map((c) => c.reason)).toEqual(Array(9).fill('exact'));
    expect(s.columns.map((c) => c.assignment)).toEqual(fields(INV_FIELDS));
  });

  it('marks a canonical shipments header row all exact', () => {
    const s = suggestMapping('shipments', SHP_FIELDS);
    expect(s.columns.map((c) => c.reason)).toEqual(Array(9).fill('exact'));
  });

  it('suggests the alt inventory aliases', () => {
    const s = suggestMapping('inventory', INV_ALT_HEADERS);
    expect(s.columns.map((c) => c.assignment)).toEqual(fields(INV_FIELDS));
    expect(s.columns.map((c) => c.reason)).toEqual(['alias', 'alias', 'exact', 'alias', 'alias', 'alias', 'alias', 'alias', 'alias']);
  });

  it('suggests the alt shipments aliases', () => {
    const s = suggestMapping('shipments', SHP_ALT_HEADERS);
    expect(s.columns.map((c) => c.assignment)).toEqual(fields(SHP_FIELDS));
  });

  it('leaves the ambiguous Cost and Avg Usage columns undecided', () => {
    const s = suggestMapping('inventory', COMPANY_B);
    expect(s.columns.map((c) => c.assignment)).toEqual([
      field('sku'),
      field('product_name'),
      field('category'),
      field('warehouse'),
      field('quantity'),
      field('reorder_point'),
      { type: 'undecided' },
      { type: 'undecided' },
      field('lead_time_days')
    ]);
    expect(s.columns[6]).toMatchObject({ reason: 'ambiguous', candidates: ['unit_cost'] });
    expect(s.columns[7]).toMatchObject({ reason: 'ambiguous', candidates: ['avg_daily_usage'] });
  });

  it('lets an exact column claim its field before an alias does', () => {
    const s = suggestMapping('inventory', ['unit_cost', 'Price', 'Cost']);
    expect(s.columns[0]?.assignment).toEqual(field('unit_cost'));
    expect(s.columns[1]).toMatchObject({ assignment: { type: 'ignore' }, reason: 'none' });
    expect(s.columns[2]).toMatchObject({ assignment: { type: 'ignore' }, reason: 'none' });
  });

  it('makes two aliases for the same field both undecided', () => {
    const s = suggestMapping('inventory', ['Qty', 'On Hand']);
    expect(s.columns.map((c) => c.assignment)).toEqual([{ type: 'undecided' }, { type: 'undecided' }]);
    expect(s.columns.map((c) => c.reason)).toEqual(['ambiguous', 'ambiguous']);
  });

  it('ignores an unknown column without guessing', () => {
    const s = suggestMapping('inventory', ['Warehouse Notes', 'Total Cost', '']);
    expect(s.columns.map((c) => c.assignment)).toEqual([{ type: 'ignore' }, { type: 'ignore' }, { type: 'ignore' }]);
  });

  it('is deterministic and does not mutate its input', () => {
    const headers = Object.freeze([...INV_ALT_HEADERS]);
    expect(suggestMapping('inventory', headers)).toEqual(suggestMapping('inventory', headers));
    expect(headers).toEqual(INV_ALT_HEADERS);
  });
});

describe('requiresMappingStep', () => {
  it('is false for canonical headers with an extra unknown column', () => {
    expect(requiresMappingStep(suggestMapping('inventory', [...INV_FIELDS, 'Notes']))).toBe(false);
    expect(requiresMappingStep(suggestMapping('inventory', INV_FIELDS.map((f) => f.toUpperCase().replace(/_/g, ' '))))).toBe(false);
  });

  it('is true when an optional column uses an alias instead of the canonical name', () => {
    expect(requiresMappingStep(suggestMapping('inventory', [...INV_FIELDS.slice(0, 8), 'Lead Time']))).toBe(true);
  });

  it('is true when no header is recognizable', () => {
    expect(requiresMappingStep(suggestMapping('shipments', ['a', 'b', 'c']))).toBe(true);
  });
});

describe('validateMapping', () => {
  it('accepts a complete unique mapping', () => {
    const v = validateMapping('inventory', fields(INV_FIELDS));
    expect(v).toMatchObject({ valid: true, duplicateFields: [], missingRequired: [], undecidedCount: 0 });
    expect(v.statuses).toEqual(Array(9).fill('mapped'));
  });

  it('flags a field chosen twice as duplicate', () => {
    const v = validateMapping('inventory', [...fields(INV_FIELDS.slice(0, 8)), field('quantity')]);
    expect(v.valid).toBe(false);
    expect(v.duplicateFields).toEqual(['quantity']);
    expect(v.statuses[4]).toBe('duplicate');
    expect(v.statuses[8]).toBe('duplicate');
  });

  it('flags missing required fields in schema order', () => {
    const v = validateMapping('inventory', [{ type: 'ignore' }, ...fields(INV_FIELDS.slice(1, 7)), { type: 'ignore' }, { type: 'ignore' }]);
    expect(v.missingRequired).toEqual(['sku']);
    expect(v.valid).toBe(false);
    expect(v.statuses[0]).toBe('unmapped');
  });

  it('reports an undecided column as ambiguous and blocks', () => {
    const v = validateMapping('inventory', assignmentsOf(COMPANY_B));
    expect(v.undecidedCount).toBe(2);
    expect(v.statuses[6]).toBe('ambiguous');
    expect(v.valid).toBe(false);
  });

  it('stays valid when the optional inventory fields are not imported', () => {
    const v = validateMapping('inventory', [...fields(INV_FIELDS.slice(0, 7)), { type: 'ignore' }, { type: 'ignore' }]);
    expect(v.valid).toBe(true);
  });

  it('requires actual_delivery as a column for shipments', () => {
    const v = validateMapping('shipments', [...fields(SHP_FIELDS.slice(0, 7)), { type: 'ignore' }, field('shipping_cost')]);
    expect(v.missingRequired).toEqual(['actual_delivery']);
    expect(v.valid).toBe(false);
  });
});

describe('toColumnMap', () => {
  it('maps fields to names and ignore/undecided to null', () => {
    expect(toColumnMap([field('sku'), { type: 'ignore' }, { type: 'undecided' }, field('warehouse')])).toEqual(['sku', null, null, 'warehouse']);
  });
});

describe('analyzeImportFile', () => {
  it('sends both canonical templates direct', () => {
    expect(analyzeImportFile('inventory', INV_TEMPLATE)).toEqual({ mode: 'direct' });
    expect(analyzeImportFile('shipments', SHP_TEMPLATE)).toEqual({ mode: 'direct' });
  });

  it('opens the mapping step for the alt fixture with the sample rows untouched', () => {
    const a = analyzeImportFile('inventory', INV_ALT);
    expect(a.mode).toBe('map');
    if (a.mode !== 'map') return;
    expect(a.headers).toEqual(INV_ALT_HEADERS);
    expect(a.dataRowCount).toBe(4);
    expect(a.sampleRows).toHaveLength(4);
    expect(a.sampleRows[1]).toEqual(['MAT-10002', 'Bolt, M8 x 40mm', 'Fasteners', 'WH-ATL', '5000', '1200', '0.18', '250', '7']);
  });

  it('goes direct for NUL bytes, malformed CSV and empty text', () => {
    expect(analyzeImportFile('inventory', `Material Number\u0000,Plant\n1,2\n`)).toEqual({ mode: 'direct' });
    expect(analyzeImportFile('inventory', 'Material Number,Plant\n"unterminated,1\n')).toEqual({ mode: 'direct' });
    expect(analyzeImportFile('inventory', '')).toEqual({ mode: 'direct' });
  });
});

describe('previewImport', () => {
  it('reports ok with the row count and warnings, or the canonical-column errors', () => {
    const ok = previewImport('inventory', INV_ALT, INV_FIELDS);
    expect(ok).toEqual({ ok: true, rowCount: 4, warnings: [] });
    const bad = previewImport('inventory', INV_ALT.replace('WH-DFW', 'WH-NOPE'), INV_FIELDS);
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.totalErrors).toBe(1);
      expect(bad.errors[0]).toMatchObject({ line: 2, column: 'warehouse', code: 'UNKNOWN_WAREHOUSE' });
    }
  });
});

describe('deterministicSuggester', () => {
  it('returns the same suggestion as suggestMapping', async () => {
    await expect(deterministicSuggester.suggest('inventory', COMPANY_B)).resolves.toEqual(suggestMapping('inventory', COMPANY_B));
  });
});
