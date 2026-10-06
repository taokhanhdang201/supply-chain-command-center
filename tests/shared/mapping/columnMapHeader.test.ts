import { describe, it, expect } from 'vitest';
import { COLUMN_MAP_HEADER, parseColumnMapHeader, serializeColumnMap } from '../../../src/shared/mapping/columnMapHeader';

describe('column map header', () => {
  it('serializes fields comma-separated, with empty for an ignored column (header name is lowercase for Node)', () => {
    expect(COLUMN_MAP_HEADER).toBe('x-scc-column-map');
    expect(serializeColumnMap(['sku', null, 'warehouse'])).toBe('sku,,warehouse');
  });

  it('round-trips through parse', () => {
    const map = ['sku', null, 'warehouse', 'quantity', null];
    const parsed = parseColumnMapHeader(serializeColumnMap(map), 'inventory');
    expect(parsed).toEqual({ ok: true, map });
  });

  it('rejects a field from the wrong kind', () => {
    expect(parseColumnMapHeader('sku,shipping_cost', 'inventory')).toEqual({ ok: false });
    expect(parseColumnMapHeader('shipment_id,sku', 'shipments')).toEqual({ ok: false });
  });

  it('rejects prototype names, uppercase, spaces and JSON', () => {
    for (const bad of ['__proto__', 'constructor', 'toString', 'SKU', 'sku ,quantity', ' sku', '["sku"]', '{"a":"sku"}', 'sku;quantity', 'sku\tquantity']) {
      expect(parseColumnMapHeader(bad, 'inventory')).toEqual({ ok: false });
    }
  });

  it('rejects a value over 1024 characters', () => {
    expect(parseColumnMapHeader(','.repeat(1025), 'inventory')).toEqual({ ok: false });
    expect(parseColumnMapHeader('sku,'.repeat(300), 'inventory')).toEqual({ ok: false });
  });

  it('rejects more than 50 entries and accepts exactly 50', () => {
    expect(parseColumnMapHeader(','.repeat(50), 'inventory')).toEqual({ ok: false });
    const fifty = parseColumnMapHeader(','.repeat(49), 'inventory');
    expect(fifty.ok && fifty.map.length).toBe(50);
  });

  it('turns empty entries into null', () => {
    expect(parseColumnMapHeader(',,', 'inventory')).toEqual({ ok: true, map: [null, null, null] });
  });

  it('rejects a ", "-joined value (duplicate header lines are joined that way by Node)', () => {
    expect(parseColumnMapHeader('sku, product_name', 'inventory')).toEqual({ ok: false });
  });
});
