// V1.5 tester: alias dictionary, ambiguity, canonical fast path and V1 parity (unit level, adversarial).

import { describe, it, expect } from 'vitest';
import { lookupAlias, normalizeAliasKey } from '../../src/shared/mapping/aliases';
import { analyzeImportFile, suggestMapping, requiresMappingStep, validateMapping } from '../../src/shared/mapping/columnMapping';
import { importInventoryCsv } from '../../src/shared/csv/importInventory';
import { importShipmentsCsv } from '../../src/shared/csv/importShipments';
import { INV_FIELDS, SHP_FIELDS, INV_TEMPLATE, SHP_TEMPLATE } from './v15.helpers';

const asg = (kind: 'inventory' | 'shipments', headers: string[]) => suggestMapping(kind, headers).columns;

describe('§7 no magic auto-mapping', () => {
  it.each([
    ['inventory', 'Cost'], ['inventory', 'COST'], ['inventory', ' cost '], ['inventory', 'Avg Usage'],
    ['shipments', 'Cost'], ['shipments', 'Date'], ['shipments', 'DATE'], ['shipments', 'Location']
  ] as const)('%s "%s" is undecided/ambiguous, never auto-assigned', (kind, header) => {
    const [c] = asg(kind, [header]);
    expect(c?.assignment).toEqual({ type: 'undecided' });
    expect(c?.reason).toBe('ambiguous');
  });

  it.each([
    ['inventory', ['Total Cost']], ['inventory', ['Purchase Cost']], ['inventory', ['Cost Price']], ['inventory', ['Amount']],
    ['inventory', ['Name']], ['inventory', ['Stock']], ['inventory', ['Usage']], ['inventory', ['Lead']], ['inventory', ['ID']], ['inventory', ['Number']],
    ['shipments', ['Total Cost']], ['shipments', ['Delivery']], ['shipments', ['Time']], ['shipments', ['ID']], ['shipments', ['Est Delivery Date']], ['shipments', ['Dest']]
  ] as const)('%s %j (not in the table) is never guessed: ignore, not a field', (kind, headers) => {
    const [c] = asg(kind, [...headers]);
    expect(c?.assignment.type).not.toBe('field');
  });

  it('a file with an alias-named header set and NO ambiguous column still needs the panel (never straight to the server)', () => {
    for (const [kind, h] of [
      ['inventory', ['Material Number', 'Item Description', 'Category', 'Plant', 'On Hand Qty', 'Reorder Level', 'Unit Price']],
      ['shipments', ['Load ID', 'Origin Location', 'Destination Location', 'Transporter', 'Shipment Status', 'Dispatch Date', 'ETA', 'Delivered Date', 'Freight Cost']]
    ] as const) {
      expect(requiresMappingStep(suggestMapping(kind, h))).toBe(true);
    }
  });

  it('two different columns whose aliases hit the same field are both left undecided (no first-wins)', () => {
    const cols = asg('inventory', ['sku', 'Qty', 'On Hand', 'Available Qty']);
    expect(cols.map((c) => c.assignment.type)).toEqual(['field', 'undecided', 'undecided', 'undecided']);
    const v = validateMapping('inventory', cols.map((c) => c.assignment));
    expect(v.valid).toBe(false);
  });

  it('"Cost" together with "Unit Cost" (exact): "Cost" is not silently reassigned to unit_cost', () => {
    const cols = asg('inventory', ['unit_cost', 'Cost']);
    expect(cols[0]?.assignment).toEqual({ type: 'field', field: 'unit_cost' });
    expect(cols[1]?.assignment.type).not.toBe('field');
  });

  it('"Cost" together with alias "Price": "Price" is suggested, "Cost" stays undecided (user must decide; choosing unit_cost then shows Duplicate)', () => {
    const cols = asg('inventory', ['Price', 'Cost']);
    expect(cols[0]?.assignment).toEqual({ type: 'field', field: 'unit_cost' });
    expect(cols[1]?.assignment).toEqual({ type: 'undecided' });
    const chosen = [cols[0]!.assignment, { type: 'field', field: 'unit_cost' } as const];
    const v = validateMapping('inventory', chosen);
    expect(v.statuses).toEqual(['duplicate', 'duplicate']);
    expect(v.valid).toBe(false);
  });

  it('shipments "Date" next to canonical ship_date/estimated_delivery/actual_delivery does not silently become one of them', () => {
    const cols = asg('shipments', ['ship_date', 'Date']);
    expect(cols[1]?.assignment.type).not.toBe('field');
  });

  it('ambiguous wording data: each ambiguous header exposes its candidate list (UI shows it)', () => {
    expect(lookupAlias('shipments', 'Date')).toEqual({ type: 'ambiguous', candidates: ['ship_date', 'estimated_delivery', 'actual_delivery'] });
    const cost = lookupAlias('inventory', 'Cost');
    expect(cost.type).toBe('ambiguous');
  });
});

describe('lookalikes, whitespace, case: alias lookup is exact-match on a normalized key', () => {
  it.each([
    'Ѕku', 'ѕku', 'ЅKU', 'ｓｋｕ', 'ＳＫＵ', 'sku​', '​sku', 's​ku', 'Materiaⅼ Number', 'Mаterial Number', 'Plаnt', 'İtem Code',
    'item​code', 'Item​Code', 'On Hand Qty\u0000', 'Unit Prіce', 'qty‮', 'Qty.x', 'Quantity Qty'
  ])('%j does not resolve to a field', (h) => {
    const l = lookupAlias('inventory', h);
    expect(l.type).not.toBe('unique');
  });

  it('whitespace variants of a real alias do resolve (trim, collapse, NBSP, tabs, - _ . /) and are all reviewable in the panel', () => {
    for (const h of ['  Material Number  ', 'material   number', 'MATERIAL\tNUMBER', 'Material_Number', 'material-number', 'Material.Number', 'Material/Number', 'Material Number', '﻿Material Number']) {
      expect(lookupAlias('inventory', h)).toEqual({ type: 'unique', field: 'sku' });
      expect(requiresMappingStep(suggestMapping('inventory', [h]))).toBe(true);
    }
  });

  it('normalizeAliasKey never returns leading/trailing space and is idempotent', () => {
    for (const h of ['', ' ', '--', '_ _', 'A  B', ' a-b_c.d/e(f) ', '((x))']) {
      const k = normalizeAliasKey(h);
      expect(k).toBe(k.trim());
      expect(normalizeAliasKey(k)).toBe(k);
    }
  });

  it('prototype-ish header text is inert', () => {
    for (const h of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf', '__defineGetter__']) {
      expect(lookupAlias('inventory', h)).toEqual({ type: 'none' });
      const cols = asg('shipments', [h, h]);
      expect(cols.every((c) => c.assignment.type === 'ignore')).toBe(true);
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('huge / empty / duplicate headers do not throw', () => {
    expect(() => suggestMapping('inventory', ['', '', 'x'.repeat(100_000), 'sku', 'sku'])).not.toThrow();
    const many = Array.from({ length: 50 }, (_, i) => `col${i}`);
    expect(() => suggestMapping('shipments', many)).not.toThrow();
  });
});

describe('§13 canonical files: no friction, identical to V1', () => {
  const inv = INV_TEMPLATE.split('\n');
  const variants: [string, string][] = [
    ['template', INV_TEMPLATE],
    ['UPPER CASE headers', [INV_FIELDS.join(',').toUpperCase(), ...inv.slice(1)].join('\n')],
    ['Mixed_Case', [INV_FIELDS.map((f) => f[0]!.toUpperCase() + f.slice(1)).join(','), ...inv.slice(1)].join('\n')],
    ['spaces instead of underscores', [INV_FIELDS.join(',').replace(/_/g, ' '), ...inv.slice(1)].join('\n')],
    ['hyphens', [INV_FIELDS.join(',').replace(/_/g, '-'), ...inv.slice(1)].join('\n')],
    ['padded cells', [INV_FIELDS.map((f) => ` ${f} `).join(','), ...inv.slice(1)].join('\n')],
    ['BOM', '﻿' + INV_TEMPLATE],
    ['CRLF', INV_TEMPLATE.replace(/\n/g, '\r\n')],
    ['BOM + CRLF + UPPER', '﻿' + [INV_FIELDS.join(',').toUpperCase(), ...inv.slice(1)].join('\r\n')],
    ['different column order', (() => { const order = [...INV_FIELDS].reverse(); const idx = order.map((f) => INV_FIELDS.indexOf(f)); return ['sku,product_name,category,warehouse,quantity,reorder_point,unit_cost,avg_daily_usage,lead_time_days', 'ELC-9001,Wireless Barcode Scanner,Electronics,WH-DFW,120,40,89.50,6.5,14'].map((l) => { const c = l.split(','); return idx.map((i) => c[i]).join(','); }).join('\n').replace(/^.*\n/, order.join(',') + '\n') + '\n'; })()],
    ['optional columns omitted', 'sku,product_name,category,warehouse,quantity,reorder_point,unit_cost\nELC-9001,Scanner,Electronics,WH-DFW,120,40,89.50\n'],
    ['unknown extra column', INV_TEMPLATE.replace('lead_time_days', 'lead_time_days,notes').replace(/\n(.*)\n/, '\n$1,x\n').replace(/\n(?!$)([^\n]*)\n?$/, '\n$1,x\n')]
  ];

  it.each(variants)('%s -> direct (no mapping step)', (_n, csv) => {
    expect(analyzeImportFile('inventory', csv).mode).toBe('direct');
  });

  it('shipments canonical variants -> direct', () => {
    const lines = SHP_TEMPLATE.split('\n');
    for (const csv of [SHP_TEMPLATE, '﻿' + SHP_TEMPLATE, SHP_TEMPLATE.replace(/\n/g, '\r\n'), [SHP_FIELDS.join(',').toUpperCase(), ...lines.slice(1)].join('\n'), [SHP_FIELDS.join(',').replace(/_/g, ' '), ...lines.slice(1)].join('\n')]) {
      expect(analyzeImportFile('shipments', csv).mode).toBe('direct');
    }
  });

  it('for every direct variant the V1 importer (no map) result equals the identity-map result (rows and warnings)', () => {
    for (const [, csv] of variants) {
      const stripped = csv.replace(/^﻿/, '');
      const header = stripped.split(/\r?\n/)[0]!.split(',');
      const v1 = importInventoryCsv(csv);
      // identity map only exists for headers that are fully canonical after normalization; skip the omitted/extra cases
      if (header.length !== INV_FIELDS.length) continue;
      const identity = header.map((h) => h.trim().toLowerCase().replace(/[\s-]+/g, '_'));
      const viaMap = importInventoryCsv(csv, undefined, identity);
      expect(viaMap).toEqual(v1);
    }
    expect(importShipmentsCsv(SHP_TEMPLATE, undefined, SHP_FIELDS)).toEqual(importShipmentsCsv(SHP_TEMPLATE));
  });

  it('a file V1 accepts (canonical + junk column) still uploads directly and V1 warns about the ignored column', () => {
    const csv = 'sku,product_name,category,warehouse,quantity,reorder_point,unit_cost,notes\nAAA-1,P,C,WH-DFW,1,1,1.00,hello\n';
    expect(analyzeImportFile('inventory', csv).mode).toBe('direct');
    const r = importInventoryCsv(csv);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.join(' ')).toMatch(/notes/);
  });

  it('documented behaviour change vs V1 (plan D3): exact-duplicate canonical headers now open the panel instead of V1 DUPLICATE_COLUMNS 422; the server still rejects them', () => {
    const csv = 'sku,sku,product_name,category,warehouse,quantity,reorder_point,unit_cost\nA-1,A-2,P,C,WH-DFW,1,1,1.00\n';
    expect(analyzeImportFile('inventory', csv).mode).toBe('map');
    const r = importInventoryCsv(csv);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe('DUPLICATE_COLUMNS');
  });

  it('V1 behaviour with NO map for an alias-named file is the unchanged MISSING_COLUMNS rejection', () => {
    const r = importInventoryCsv('Material Number,Item Description,Category,Plant,On Hand Qty,Reorder Level,Unit Price\nM-1,P,C,WH-DFW,1,1,1.00\n');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe('MISSING_COLUMNS');
  });
});
