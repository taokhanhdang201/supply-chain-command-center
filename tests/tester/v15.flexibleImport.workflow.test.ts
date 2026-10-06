// V1.5 tester file H (plan §9.2): end-to-end workflow through the real HTTP server, using the client-side shared code
// (analyzeImportFile -> validateMapping -> toColumnMap) exactly as ImportPage does, then POST with X-SCC-Column-Map.
// Covers requirements §15.12, 15.16, 15.17, 15.18-20 and the §16 realistic flow at the server/analytics level.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  analyzeImportFile,
  suggestMapping,
  toColumnMap,
  validateMapping
} from '../../src/shared/mapping/columnMapping';
import { serializeColumnMap } from '../../src/shared/mapping/columnMapHeader';
import {
  COMPANY_B, INV_ALT, INV_FIELDS, INV_TEMPLATE, SHP_ALT, SHP_FIELDS, SHP_TEMPLATE,
  comparableSnapshot, post, snapshotOf, startServer, type TestServer
} from './v15.helpers';

let srv: TestServer;
beforeEach(async () => { srv = await startServer(); });
afterEach(async () => { await srv.close(); });

/** What ImportPage does: analyze, take the suggestion as-is, validate, and serialize the header. */
function clientMap(kind: 'inventory' | 'shipments', text: string): string {
  const a = analyzeImportFile(kind, text);
  if (a.mode !== 'map') throw new Error('expected the mapping step');
  const assignments = a.suggestion.columns.map((c) => c.assignment);
  const v = validateMapping(kind, assignments);
  expect(v.valid).toBe(true);
  return serializeColumnMap(toColumnMap(assignments));
}

describe('V1.5 workflow (tester file H)', () => {
  it('§15.16 inventory: alt-schema file -> suggestions -> confirm -> import -> snapshot KPIs are right', async () => {
    const header = clientMap('inventory', INV_ALT);
    expect(header).toBe(INV_FIELDS.join(','));
    const res = await post(srv, 'inventory', INV_ALT, { 'X-SCC-Column-Map': header, 'X-SCC-Filename': 'inventory_alt_schema.csv' });
    expect(res.status).toBe(200);
    expect((await res.json()).rowCount).toBe(4);
    const snap = (await snapshotOf(srv)) as any;
    expect(snap.dataSources.inventory.label).toBe('inventory_alt_schema.csv');
    expect(snap.dataSources.inventory.rowCount).toBe(4);
    // Plan §9.1 expected KPIs (TODAY 2026-06-15): 4 rows, 5018 units, $28,149.00, 2 low stock, 1 out of stock.
    expect(snap.kpis).toMatchObject({ inventoryRecordCount: 4, totalUnits: 5018, totalInventoryValueCents: 2814900, lowStockCount: 2, outOfStockCount: 1 });
    const skus = snap.inventory.map((r: any) => r.sku).sort();
    expect(skus).toEqual(['MAT-10001', 'MAT-10002', 'MAT-10003', 'MAT-10004']);
    expect(JSON.stringify(snap.inventory)).toContain('Bolt, M8 x 40mm');
  });

  it('§15.16 shipments: alt-schema file -> suggestions -> confirm -> import -> KPIs are right', async () => {
    const header = clientMap('shipments', SHP_ALT);
    expect(header).toBe(SHP_FIELDS.join(','));
    const res = await post(srv, 'shipments', SHP_ALT, { 'X-SCC-Column-Map': header });
    expect(res.status).toBe(200);
    expect((await res.json()).rowCount).toBe(3);
    const snap = (await snapshotOf(srv)) as any;
    expect(snap.kpis).toMatchObject({ totalShipments: 3, deliveredShipments: 1, totalShippingCostCents: 472240 }); // 812.40 + 2410.00 + 1500.00
    expect(JSON.stringify(snap.shipments)).toContain('Seattle, WA');
  });

  it('§15.12 analytics unchanged: alt file + map produces a snapshot deep-equal to the canonically renamed file (no map), including a shuffled column order', async () => {
    const canonInv = INV_ALT.replace(/^[^\n]*/, INV_FIELDS.join(','));
    const canonShp = SHP_ALT.replace(/^[^\n]*/, SHP_FIELDS.join(','));
    // Shuffled: reverse every row's column order; the map is reversed accordingly.
    const reverseCsv = (csv: string) =>
      csv.trimEnd().split('\n').map((l) => {
        // fixtures contain quoted commas only in single fields; parse minimally
        const cells: string[] = []; let cur = ''; let q = false;
        for (const ch of l) { if (ch === '"') { q = !q; cur += ch; } else if (ch === ',' && !q) { cells.push(cur); cur = ''; } else cur += ch; }
        cells.push(cur);
        return cells.reverse().join(',');
      }).join('\n') + '\n';

    const a = srv;
    const b = await startServer();
    const c = await startServer();
    try {
      // A: alias + explicit map
      expect((await post(a, 'inventory', INV_ALT, { 'X-SCC-Column-Map': INV_FIELDS.join(',') })).status).toBe(200);
      expect((await post(a, 'shipments', SHP_ALT, { 'X-SCC-Column-Map': SHP_FIELDS.join(',') })).status).toBe(200);
      // B: canonical rename, no map header at all (V1 path)
      expect((await post(b, 'inventory', canonInv)).status).toBe(200);
      expect((await post(b, 'shipments', canonShp)).status).toBe(200);
      // C: reversed column order + reversed map
      expect((await post(c, 'inventory', reverseCsv(INV_ALT), { 'X-SCC-Column-Map': [...INV_FIELDS].reverse().join(',') })).status).toBe(200);
      expect((await post(c, 'shipments', reverseCsv(SHP_ALT), { 'X-SCC-Column-Map': [...SHP_FIELDS].reverse().join(',') })).status).toBe(200);
      const sa = comparableSnapshot(await snapshotOf(a));
      const sb = comparableSnapshot(await snapshotOf(b));
      const sc = comparableSnapshot(await snapshotOf(c));
      expect(sa).toEqual(sb);
      expect(sc).toEqual(sb);
      // sanity: the snapshot is not trivially empty
      expect(JSON.stringify(sa).length).toBeGreaterThan(2000);
    } finally {
      await b.close();
      await c.close();
    }
  });

  it('§15.17 canonical templates: analyzeImportFile says direct (no panel) and the plain V1 request returns 200', async () => {
    expect(analyzeImportFile('inventory', INV_TEMPLATE).mode).toBe('direct');
    expect(analyzeImportFile('shipments', SHP_TEMPLATE).mode).toBe('direct');
    expect((await post(srv, 'inventory', INV_TEMPLATE)).status).toBe(200);
    expect((await post(srv, 'shipments', SHP_TEMPLATE)).status).toBe(200);
  });

  it('§15.18-20 ambiguous / duplicate / missing mappings can never import through the server, with the map absent or tampered', async () => {
    const version = () => srv.store.getVersion();
    const v0 = version();
    const bad = async (body: string, kind: 'inventory' | 'shipments', headers: Record<string, string> = {}) => {
      const res = await post(srv, kind, body, headers);
      expect([400, 422]).toContain(res.status);
      expect(version()).toBe(v0);
      return res.json();
    };
    // alias-named files with NO map are never accepted (V1 MISSING_COLUMNS)
    expect((await bad(INV_ALT, 'inventory')).errors[0].code).toBe('MISSING_COLUMNS');
    expect((await bad(SHP_ALT, 'shipments')).errors[0].code).toBe('MISSING_COLUMNS');
    expect((await bad(COMPANY_B, 'inventory')).errors[0].code).toBe('MISSING_COLUMNS');
    // Company B: Cost/Avg Usage are undecided on the client -> the mapping is invalid and never serialized
    const a = analyzeImportFile('inventory', COMPANY_B);
    expect(a.mode).toBe('map');
    if (a.mode === 'map') {
      const v = validateMapping('inventory', a.suggestion.columns.map((c) => c.assignment));
      expect(v.valid).toBe(false);
      expect(v.undecidedCount).toBe(2);
    }
    // tampered: two columns onto sku, missing sku, all-empty, wrong length
    const dup = ['sku', 'sku', ...INV_FIELDS.slice(2)].join(',');
    expect((await bad(INV_ALT, 'inventory', { 'X-SCC-Column-Map': dup })).errors[0].code).toBe('DUPLICATE_COLUMNS');
    const noSku = ['', ...INV_FIELDS.slice(1)].join(',');
    expect((await bad(INV_ALT, 'inventory', { 'X-SCC-Column-Map': noSku })).errors[0].code).toBe('MISSING_COLUMNS');
    expect((await bad(INV_ALT, 'inventory', { 'X-SCC-Column-Map': ',,,,,,,,' })).errors[0].code).toBe('MISSING_COLUMNS');
    expect((await bad(INV_ALT, 'inventory', { 'X-SCC-Column-Map': 'sku' })).errors[0].code).toBe('INVALID_MAPPING');
    // inventory fields on a shipments upload and vice versa
    expect((await bad(SHP_ALT, 'shipments', { 'X-SCC-Column-Map': INV_FIELDS.join(',') })).error.code).toBe('INVALID_COLUMN_MAP');
  });

  it('§15.11 HTML and formula strings in mapped text columns are stored literally, never altered or executed', async () => {
    const csv =
      'Material Number,Item Description,Category,Plant,On Hand Qty,Reorder Level,Unit Price\n' +
      'MAT-1,"=cmd|\'/c calc\'!A1",Misc,WH-DFW,5,1,1.00\n' +
      'MAT-2,<img src=x onerror=alert(1)>,Misc,WH-ATL,5,1,1.00\n';
    const a = analyzeImportFile('inventory', csv);
    expect(a.mode).toBe('map');
    const header = clientMap('inventory', csv);
    const res = await post(srv, 'inventory', csv, { 'X-SCC-Column-Map': header });
    // V1 behaviour for these values is authoritative: whatever V1 does with them canonically, the map path must do the same.
    const canon = csv.replace(/^[^\n]*/, 'sku,product_name,category,warehouse,quantity,reorder_point,unit_cost');
    const srv2 = await startServer();
    try {
      const res2 = await post(srv2, 'inventory', canon);
      expect(res.status).toBe(res2.status);
      const j1 = await res.json(); const j2 = await res2.json();
      expect(j1.errors ?? null).toEqual(j2.errors ?? null);
      if (res.status === 200) {
        const s1 = JSON.stringify(await snapshotOf(srv)); const s2 = JSON.stringify(await snapshotOf(srv2));
        expect(s1).toContain('<img src=x onerror=alert(1)>'); // stored literally, no HTML encoding or stripping
        expect(comparableSnapshot(JSON.parse(s1))).toEqual(comparableSnapshot(JSON.parse(s2)));
      }
    } finally { await srv2.close(); }
  });
});
