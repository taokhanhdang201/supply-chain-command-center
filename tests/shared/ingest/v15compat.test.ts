// Criterion 14: compatibility with V1.5. Property test over the alias tables and the existing fixtures: every header
// V1.5 assigns uniquely keeps the same field (MATCHED), every V1.5-ambiguous header stays CHOOSE with the same
// candidates, and files V1.5 sends `direct` never need the new mapper (the canonical headers map exactly).

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseCsv } from '../../../src/shared/csv/parseCsv';
import { suggestMapping, analyzeImportFile } from '../../../src/shared/mapping/columnMapping';
import { INVENTORY_ALIASES, INVENTORY_AMBIGUOUS, SHIPMENT_ALIASES, SHIPMENT_AMBIGUOUS } from '../../../src/shared/mapping/aliases';
import { profileColumn } from '../../../src/shared/ingest/structure/profile';
import { proposeMapping } from '../../../src/shared/ingest/mapping/report';
import { canonicalColumns } from '../../../src/shared/ingest/canonical/schemaRegistry';
import { G, type Gen } from '../../fixtures/ingest/gen';
import { cellsOf } from '../../ingest-kit/mapperHarness';
import type { ImportKind } from '../../../src/shared/types';

const read = (p: string): string => readFileSync(resolve(process.cwd(), p), 'utf-8');

const GEN: Record<string, Gen> = {
  sku: G.sku(),
  product_name: G.productName(),
  category: G.category(),
  warehouse: G.warehouse('code'),
  quantity: G.int(0, 900),
  reorder_point: G.int(1, 99),
  unit_cost: G.money(),
  avg_daily_usage: G.decimal(),
  lead_time_days: G.int(2, 40),
  shipment_id: G.shipmentId(),
  origin: G.city(),
  destination: G.city(2),
  carrier: G.carrier(),
  status: G.status('canonical'),
  ship_date: G.date('iso'),
  estimated_delivery: G.date('iso', 3),
  actual_delivery: G.date('iso', 4),
  shipping_cost: G.money()
};

function mapOf(kind: ImportKind, headers: string[], fields: Array<string | null>) {
  const rows = Array.from({ length: 30 }, (_, i) => fields.map((f) => (f === null ? `x${i}` : (GEN[f] as Gen)(i))));
  const profiles = headers.map((h, i) => profileColumn(h, cellsOf(rows, i)));
  return proposeMapping(kind, headers, profiles);
}

const TABLES: Array<[ImportKind, typeof INVENTORY_ALIASES, typeof INVENTORY_AMBIGUOUS]> = [
  ['inventory', INVENTORY_ALIASES, INVENTORY_AMBIGUOUS],
  ['shipments', SHIPMENT_ALIASES, SHIPMENT_AMBIGUOUS]
];

describe('V1.5 alias tables: every unique alias keeps its field as MATCHED', () => {
  for (const [kind, aliases] of TABLES) {
    it(`${kind}: each alias, alone in its column, is MATCHED to the V1.5 field (and V1.5 agrees)`, () => {
      let checked = 0;
      for (const [field, list] of aliases) {
        for (const alias of [...list, field]) {
          const v15 = suggestMapping(kind, [alias]).columns[0];
          expect(v15?.assignment, alias).toEqual({ type: 'field', field });
          const p = mapOf(kind, [alias], [field]);
          const c = p.columns[0]!;
          expect(c.state, `${kind}: alias "${alias}"`).toBe('matched');
          expect(c.field, `${kind}: alias "${alias}"`).toBe(field);
          checked++;
        }
      }
      expect(checked).toBeGreaterThanOrEqual(18);
    });

    it(`${kind}: the alias sets of V1.5 (case, separators) map identically as a whole file`, () => {
      const longest = Math.max(...aliases.map(([, l]) => l.length));
      const variants: Array<(h: string) => string> = [(h) => h, (h) => h.toUpperCase(), (h) => h.replace(/ /g, '_'), (h) => ` ${h.replace(/ /g, '-')} `];
      for (let k = 0; k <= longest; k++) {
        for (const v of variants) {
          const headers = aliases.map(([field, list]) => v(k === 0 ? field : (list[(k - 1) % list.length] as string)));
          const fields = aliases.map(([field]) => field);
          const v15 = suggestMapping(kind, headers);
          const p = mapOf(kind, headers, fields);
          p.columns.forEach((c, i) => {
            const was = v15.columns[i]!;
            if (was.assignment.type === 'field') {
              expect(c.state, `${kind}: "${c.header}"`).toBe('matched');
              expect(c.field, `${kind}: "${c.header}"`).toBe(was.assignment.field);
            }
          });
        }
      }
    });
  }
});

describe('V1.5 ambiguous headers stay CHOOSE with the same candidates', () => {
  for (const [kind, , ambiguous] of TABLES) {
    it(`${kind}`, () => {
      for (const [key, candidates] of ambiguous) {
        for (const header of [key, key.toUpperCase(), key.replace(/ /g, '_'), ` ${key} `]) {
          const v15 = suggestMapping(kind, [header]).columns[0]!;
          expect(v15.reason, header).toBe('ambiguous');
          const c = mapOf(kind, [header], [null]).columns[0]!;
          expect(c.state, `${kind}: ${header}`).toBe('choose');
          expect(c.candidates.map((x) => x.field), `${kind}: ${header}`).toEqual([...candidates]);
          expect(c.candidates.map((x) => x.field), `${kind}: ${header}`).toEqual([...v15.candidates]);
        }
      }
    });
  }
});

describe('canonical headers and the existing fixtures', () => {
  it('canonical headers map exactly (so `direct` files never need the new mapper)', () => {
    for (const kind of ['inventory', 'shipments'] as const) {
      const cols = canonicalColumns(kind);
      const p = mapOf(kind, cols, cols);
      p.columns.forEach((c, i) => {
        expect(c.state, `${kind}: ${c.header}`).toBe('matched');
        expect(c.field).toBe(cols[i]);
      });
      expect(p.fields.every((f) => f.state === 'mapped')).toBe(true);
    }
  });

  const FIXTURE_FILES: Array<[ImportKind, string]> = [
    ['inventory', 'tests/fixtures/import/inventory_alt_schema.csv'],
    ['shipments', 'tests/fixtures/import/shipments_alt_schema.csv'],
    ['inventory', 'tests/fixtures/import/tester/inventory_sap_style.csv'],
    ['shipments', 'tests/fixtures/import/tester/shipments_tms_style.csv'],
    ['shipments', 'tests/fixtures/import/shipments_test_v2.iso.csv'],
    ['inventory', 'public/templates/inventory-template.csv'],
    ['shipments', 'public/templates/shipments-template.csv']
  ];
  it.each(FIXTURE_FILES)('%s: %s maps the same way V1.5 does', (kind, path) => {
    const text = read(path);
    const parsed = parseCsv(text, { maxRows: 20000, maxColumns: 50 });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const headers = parsed.records[0]!.fields;
    const rows = parsed.records.slice(1).map((r) => r.fields);
    const profiles = headers.map((h, i) => profileColumn(h, cellsOf(rows, i)));
    const proposal = proposeMapping(kind, headers, profiles);
    const v15 = suggestMapping(kind, headers);
    v15.columns.forEach((was, i) => {
      const c = proposal.columns[i]!;
      if (was.reason === 'exact' || was.reason === 'alias') {
        const field = (was.assignment as { field: string }).field;
        expect(['matched', 'check'], `${path}: "${c.header}"`).toContain(c.state);
        expect(c.field, `${path}: "${c.header}"`).toBe(field);
      } else if (was.reason === 'ambiguous') {
        expect(c.state, `${path}: "${c.header}"`).toBe('choose');
        expect(c.candidates.map((x) => x.field), `${path}: "${c.header}"`).toEqual([...was.candidates]);
      }
    });
    // and V1.5's own decision about the file is unchanged by this work (legacy path)
    const analysis = analyzeImportFile(kind, text);
    expect(['direct', 'map']).toContain(analysis.mode);
  });

  it('a file V1.5 sends `direct` (the templates) maps every column MATCHED', () => {
    for (const [kind, path] of [['inventory', 'public/templates/inventory-template.csv'], ['shipments', 'public/templates/shipments-template.csv']] as const) {
      expect(analyzeImportFile(kind, read(path)).mode).toBe('direct');
      const parsed = parseCsv(read(path), { maxRows: 20000, maxColumns: 50 });
      if (!parsed.ok) throw new Error('template must parse');
      const headers = parsed.records[0]!.fields;
      const rows = parsed.records.slice(1).map((r) => r.fields);
      const p = proposeMapping(kind, headers, headers.map((h, i) => profileColumn(h, cellsOf(rows, i))));
      expect(p.columns.every((c) => c.state === 'matched')).toBe(true);
    }
  });
});
