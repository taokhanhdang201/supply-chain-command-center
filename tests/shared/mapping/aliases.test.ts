import { describe, it, expect } from 'vitest';
import {
  INVENTORY_ALIASES,
  INVENTORY_AMBIGUOUS,
  SHIPMENT_ALIASES,
  SHIPMENT_AMBIGUOUS,
  lookupAlias,
  normalizeAliasKey
} from '../../../src/shared/mapping/aliases';
import { INVENTORY_COLUMNS, SHIPMENT_COLUMNS } from '../../../src/shared/csv/schemas';

const invNames = new Set(INVENTORY_COLUMNS.map((c) => c.name));
const shpNames = new Set(SHIPMENT_COLUMNS.map((c) => c.name));

describe('normalizeAliasKey', () => {
  it('collapses case, whitespace and punctuation runs', () => {
    expect(normalizeAliasKey('On-Hand_Qty.')).toBe('on hand qty');
    expect(normalizeAliasKey('  Lead Time (Days) ')).toBe('lead time days');
    expect(normalizeAliasKey('Unit.Cost')).toBe('unit cost');
    expect(normalizeAliasKey('Cost ($)')).toBe('cost $');
    expect(normalizeAliasKey('')).toBe('');
  });
});

describe('alias tables', () => {
  it('only target fields that exist in the kind schema', () => {
    for (const [field] of INVENTORY_ALIASES) expect(invNames.has(field)).toBe(true);
    for (const [field] of SHIPMENT_ALIASES) expect(shpNames.has(field)).toBe(true);
    for (const [, cands] of [...INVENTORY_AMBIGUOUS]) for (const c of cands) expect(invNames.has(c)).toBe(true);
    for (const [, cands] of SHIPMENT_AMBIGUOUS) for (const c of cands) expect(shpNames.has(c)).toBe(true);
  });

  it('holds only normalized keys, with no key repeated or in both the unique and ambiguous tables', () => {
    for (const [aliases, ambiguous] of [
      [INVENTORY_ALIASES, INVENTORY_AMBIGUOUS],
      [SHIPMENT_ALIASES, SHIPMENT_AMBIGUOUS]
    ] as const) {
      const uniqueKeys = aliases.flatMap(([, list]) => list);
      const ambiguousKeys = ambiguous.map(([k]) => k);
      for (const key of [...uniqueKeys, ...ambiguousKeys]) expect(normalizeAliasKey(key)).toBe(key);
      expect(new Set(uniqueKeys).size).toBe(uniqueKeys.length);
      expect(ambiguousKeys.filter((k) => uniqueKeys.includes(k))).toEqual([]);
    }
  });

  it('resolves every inventory alias (and each canonical name) to its field', () => {
    for (const [field, list] of INVENTORY_ALIASES) {
      for (const alias of [...list, field]) expect(lookupAlias('inventory', alias)).toEqual({ type: 'unique', field });
    }
    expect(lookupAlias('inventory', 'Material Number')).toEqual({ type: 'unique', field: 'sku' });
    expect(lookupAlias('inventory', 'Lead Time Days')).toEqual({ type: 'unique', field: 'lead_time_days' });
    expect(lookupAlias('inventory', 'Qty')).toEqual({ type: 'unique', field: 'quantity' });
  });

  it('resolves every shipment alias (and each canonical name) to its field', () => {
    for (const [field, list] of SHIPMENT_ALIASES) {
      for (const alias of [...list, field]) expect(lookupAlias('shipments', alias)).toEqual({ type: 'unique', field });
    }
    expect(lookupAlias('shipments', 'ETA')).toEqual({ type: 'unique', field: 'estimated_delivery' });
    expect(lookupAlias('shipments', 'Load ID')).toEqual({ type: 'unique', field: 'shipment_id' });
  });

  it('never resolves uncertain headers, and does no fuzzy matching', () => {
    expect(lookupAlias('inventory', 'Cost')).toEqual({ type: 'ambiguous', candidates: ['unit_cost'] });
    expect(lookupAlias('shipments', 'Cost')).toEqual({ type: 'ambiguous', candidates: ['shipping_cost'] });
    expect(lookupAlias('shipments', 'Date')).toEqual({ type: 'ambiguous', candidates: ['ship_date', 'estimated_delivery', 'actual_delivery'] });
    expect(lookupAlias('shipments', 'Location')).toEqual({ type: 'ambiguous', candidates: ['origin', 'destination'] });
    expect(lookupAlias('inventory', 'Location')).toEqual({ type: 'unique', field: 'warehouse' });
    expect(lookupAlias('inventory', 'Total Cost')).toEqual({ type: 'none' });
    expect(lookupAlias('inventory', 'quantit')).toEqual({ type: 'none' });
    expect(lookupAlias('inventory', '__proto__')).toEqual({ type: 'none' });
    expect(lookupAlias('inventory', 'constructor')).toEqual({ type: 'none' });
  });
});
