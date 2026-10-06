// V1.5 tester: value preservation, existing validation through the map, Excel date message, line numbers,
// and a seeded differential fuzz (mapped import must equal the canonical import of the same data).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { importInventoryCsv } from '../../src/shared/csv/importInventory';
import { importShipmentsCsv } from '../../src/shared/csv/importShipments';
import { INV_FIELDS, SHP_FIELDS, post, startServer, type TestServer } from './v15.helpers';

const EXCEL_MSG = (raw: string, iso: string) =>
  `"${raw}" looks like Excel changed this date to M/D/YYYY. Dates must be YYYY-MM-DD, e.g. ${iso}. Re-download the file and upload it without opening it in Excel.`;

const INV_ALT_HEAD = 'Material Number,Item Description,Category,Plant,On Hand Qty,Reorder Level,Unit Price,Daily Consumption,Supplier Lead Time';
const SHP_ALT_HEAD = 'Load ID,Origin Location,Destination Location,Transporter,Shipment Status,Dispatch Date,ETA,Delivered Date,Freight Cost';
const INV_CANON_HEAD = INV_FIELDS.join(',');
const SHP_CANON_HEAD = SHP_FIELDS.join(',');

function both(kind: 'inventory' | 'shipments', altHead: string, rows: string) {
  const canon = kind === 'inventory' ? INV_CANON_HEAD : SHP_CANON_HEAD;
  const fields = kind === 'inventory' ? INV_FIELDS : SHP_FIELDS;
  const imp = kind === 'inventory' ? importInventoryCsv : importShipmentsCsv;
  return { viaMap: imp(altHead + '\n' + rows, undefined, fields), canonical: imp(canon + '\n' + rows) };
}

describe('§14/§15.13 values are byte-identical after mapping', () => {
  const rows = [
    '00123-A,"Bolt, M8 x 40mm",Fasteners,WH-DFW,0012,0040,0.10,0.10,007',
    'ZZ-9999,"He said ""hi"", ok",Ünïcode ✓,WH-ATL,5000,1200,1000000.00,250.50,7',
    '007,  padded name  ,Cat,WH-ORD,0,0,0.00,0,1',
    'ABC-005,=SUM(A1),Cat,WH-LAX,1,1,1.05,1,1',
    'AAA-1,<img src=x onerror=alert(1)>,Cat,WH-EWR,1,1,99999.99,0.1,1'
  ].join('\n') + '\n';

  it('inventory: mapped records deep-equal canonical records (leading zeros, 0.10, 1000000.00, quoted commas/quotes, unicode, padding)', () => {
    const { viaMap, canonical } = both('inventory', INV_ALT_HEAD, rows);
    expect(viaMap.ok).toBe(true);
    expect(viaMap).toEqual(canonical);
    if (viaMap.ok && canonical.ok) {
      const j = JSON.stringify(viaMap.rows);
      expect(viaMap.rows).toHaveLength(5);
      expect(viaMap.rows[2]).toMatchObject({ sku: '007', quantity: 0, unitCostCents: 0 });
      expect(viaMap.rows[0]).toMatchObject({ sku: '00123-A', productName: 'Bolt, M8 x 40mm' });
      expect(j).toContain('He said \\"hi\\", ok');
      expect(j).toContain('Ünïcode ✓');
      expect(j).toContain('=SUM(A1)');
    }
  });

  it('inventory: exact cents for 0.10 / 1000000.00 / 99999.99 (no float drift through the map)', () => {
    const valid = '00123-A,P,C,WH-DFW,12,40,0.10,0.10,7\nZZ-9999,Q,C,WH-ATL,5,1,1000000.00,1,7\nAAA-1,R,C,WH-ORD,1,1,99999.99,1,1\n';
    const r = importInventoryCsv(INV_ALT_HEAD + '\n' + valid, undefined, INV_FIELDS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows.map((x) => x.unitCostCents)).toEqual([10, 100000000, 9999999]);
    expect(r.rows.map((x) => x.sku)).toEqual(['00123-A', 'ZZ-9999', 'AAA-1']);
  });

  it('shipments: dates, ids, quoted commas and costs are preserved (2026-02-29 style edge dates are rejected identically)', () => {
    const ok =
      'LD-00001,WH-DFW,"Seattle, WA",Northstar Freight,Delivered,2026-03-02,2026-03-05,2026-03-04,0.10\n' +
      'LD-00002,WH-LAX,HOU,Summit Express,In Transit,2024-02-29,2026-03-15,,1000000.00\n';
    const { viaMap, canonical } = both('shipments', SHP_ALT_HEAD, ok);
    expect(viaMap).toEqual(canonical);
    const bad = 'LD-00003,WH-LAX,HOU,X Co,Pending,2026-02-29,2026-03-15,,1.00\n';
    const b = both('shipments', SHP_ALT_HEAD, bad);
    expect(b.viaMap).toEqual(b.canonical);
    expect(b.viaMap.ok).toBe(false);
  });

  it('column order does not matter: any permutation + ignored junk columns gives the same rows as the canonical file', () => {
    const cells = '00123-A,"Bolt, M8",Fasteners,WH-DFW,12,40,0.10,0.10,7'.match(/("[^"]*"|[^,]+)/g)!;
    const canon = importInventoryCsv(INV_CANON_HEAD + '\n' + cells.join(',') + '\n');
    let seed = 12345;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    for (let t = 0; t < 200; t++) {
      const order = INV_FIELDS.map((_, i) => i).sort(() => rnd() - 0.5);
      const cols: (string | null)[] = order.map((i) => INV_FIELDS[i]!);
      const vals = order.map((i) => cells[i]!);
      // sprinkle 0-3 junk columns at random positions
      for (let j = Math.floor(rnd() * 4); j > 0; j--) { const p = Math.floor(rnd() * (cols.length + 1)); cols.splice(p, 0, null); vals.splice(p, 0, 'junk"' .replace('"', '') + j); }
      const head = cols.map((c, i) => (c === null ? `Junk ${i}` : `Source ${c} ${i}`)).join(',');
      const r = importInventoryCsv(head + '\n' + vals.join(',') + '\n', undefined, cols);
      expect(r.ok).toBe(true);
      if (r.ok && canon.ok) expect(r.rows).toEqual(canon.rows);
    }
  });
});

describe('§15.9/10/11 existing validation still runs on mapped data (same code, same messages, same lines)', () => {
  it('invalid values: identical issues (line, column, code, message) to the canonical import of the same rows; column is the canonical field', () => {
    const rows = [
      'A-1,P,C,WH-XXX,1,1,1.00,1,1',   // bad warehouse
      'A-2,P,C,WH-DFW,abc,1,1.00,1,1', // bad quantity
      'A-3,P,C,WH-DFW,1,1,-5,1,1',     // negative cost
      'a 3,P,C,WH-DFW,1,1,1.00,1,1',   // bad id
      ',P,C,WH-DFW,1,1,1.00,1,1',      // missing sku
      'A-6,P,C,WH-DFW,1.5,1,1.00,1,1', // non-integer qty
      'A-7,P,C,WH-DFW,1,1,1.00,1,1e3'  // bad lead time
    ].join('\n') + '\n';
    const { viaMap, canonical } = both('inventory', INV_ALT_HEAD, rows);
    expect(viaMap.ok).toBe(false);
    expect(viaMap).toEqual(canonical);
    if (!viaMap.ok) {
      const byLine = new Map(viaMap.errors.map((e) => [e.line, e]));
      expect(byLine.get(2)?.column).toBe('warehouse');
      expect(byLine.get(3)?.column).toBe('quantity');
      expect(byLine.get(4)?.column).toBe('unit_cost');
      expect(byLine.get(6)?.column).toBe('sku');
    }
  });

  it('invalid statuses / dates / costs on shipments: identical issues; Excel M/D/YYYY gives the exact helpful message on line 2, column ship_date', () => {
    const rows =
      'LD-60001,WH-DFW,HOU,Northstar Freight,Delivered,8/15/2026,2026-08-18,2026-08-17,812.40\n' +
      'LD-60002,WH-DFW,HOU,Northstar Freight,Teleported,2026-08-15,2026-08-18,,812.40\n' +
      'LD-60003,WH-DFW,HOU,Northstar Freight,Pending,2026-08-15,12/1/2026,,-1\n' +
      'LD-60004,WH-DFW,HOU,Northstar Freight,Pending,2026-08-15,2026-08-18,3/4/2026,abc\n';
    const { viaMap, canonical } = both('shipments', SHP_ALT_HEAD, rows);
    expect(viaMap.ok).toBe(false);
    expect(viaMap).toEqual(canonical);
    if (!viaMap.ok) {
      const first = viaMap.errors.find((e) => e.line === 2)!;
      expect(first).toMatchObject({ line: 2, column: 'ship_date', code: 'INVALID_DATE', message: EXCEL_MSG('8/15/2026', '2026-08-15') });
      expect(viaMap.errors.find((e) => e.line === 4 && e.column === 'estimated_delivery')?.message).toBe(EXCEL_MSG('12/1/2026', '2026-12-01'));
      expect(viaMap.errors.find((e) => e.line === 5 && e.column === 'actual_delivery')?.message).toBe(EXCEL_MSG('3/4/2026', '2026-03-04'));
    }
  });

  it('all Excel variants (M/D/YYYY, MM/DD/YYYY, single digits) keep the message through the map; ISO still passes; YYYY/MM/DD is a plain invalid date', () => {
    for (const [raw, iso] of [['8/15/2026', '2026-08-15'], ['08/15/2026', '2026-08-15'], ['1/2/2026', '2026-01-02'], ['12/31/2026', '2026-12-31']] as const) {
      const r = importShipmentsCsv(SHP_ALT_HEAD + `\nLD-1,WH-DFW,HOU,X Co,Pending,${raw},2026-09-01,,1.00\n`, undefined, SHP_FIELDS);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors[0]?.message).toBe(EXCEL_MSG(raw, iso));
    }
    const slash = importShipmentsCsv(SHP_ALT_HEAD + '\nLD-1,WH-DFW,HOU,X Co,Pending,2026/08/15,2026-09-01,,1.00\n', undefined, SHP_FIELDS);
    expect(slash.ok).toBe(false);
  });

  it('line numbers stay physical through multi-line quoted cells, BOM and CRLF (map path == canonical path)', () => {
    const rows = 'A-1,"line one\nline two",C,WH-DFW,1,1,1.00,1,1\r\nA-2,P,C,WH-DFW,zzz,1,1.00,1,1\r\n';
    const alt = '﻿' + INV_ALT_HEAD + '\r\n' + rows;
    const canon = '﻿' + INV_CANON_HEAD + '\r\n' + rows;
    const a = importInventoryCsv(alt, undefined, INV_FIELDS);
    const c = importInventoryCsv(canon);
    expect(a.ok).toBe(false);
    expect(a).toEqual(c);
  });

  it('an ignored column is never validated or read (garbage, control chars, formula), matching V1 unknown-column behaviour, and produces a warning', () => {
    const head = INV_ALT_HEAD + ',Notes';
    const map = [...INV_FIELDS, null];
    const r = importInventoryCsv(head + '\nA-1,P,C,WH-DFW,1,1,1.00,1,1,"=HYPERLINK(""http://evil"")\u0001\u0007"\n', undefined, map);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.join(' ')).toMatch(/notes/i);
  });

  it('a control character / NUL in a MAPPED column is still rejected; formula text in mapped text is kept literal', () => {
    const r = importInventoryCsv(INV_ALT_HEAD + '\nA-1,"P\u0001Q",C,WH-DFW,1,1,1.00,1,1\n', undefined, INV_FIELDS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatchObject({ line: 2, column: 'product_name', code: 'CONTROL_CHARS' });
    const f = importInventoryCsv(INV_ALT_HEAD + '\nA-1,=1+1,C,WH-DFW,1,1,1.00,1,1\n', undefined, INV_FIELDS);
    expect(JSON.stringify(f)).toContain('=1+1');
  });

  it('server: 501+ row errors are capped exactly as in V1 through the map (totalErrors preserved)', () => {
    const rows = Array.from({ length: 600 }, (_, i) => `A-${i + 100},P,C,WH-XXX,1,1,1.00,1,1`).join('\n') + '\n';
    const { viaMap, canonical } = both('inventory', INV_ALT_HEAD, rows);
    expect(viaMap).toEqual(canonical);
  });

  it('too many rows / columns limits still apply with a map', () => {
    const wide = Array.from({ length: 51 }, (_, i) => `c${i}`);
    const r = importInventoryCsv(wide.join(',') + '\n' + wide.join(',') + '\n', undefined, wide.map(() => null));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe('TOO_MANY_COLUMNS');
    const many = INV_ALT_HEAD + '\n' + 'A-1,P,C,WH-DFW,1,1,1.00,1,1\n'.repeat(20001);
    const m = importInventoryCsv(many, undefined, INV_FIELDS);
    expect(m.ok).toBe(false);
    if (!m.ok) expect(m.errors[0]?.code).toBe('TOO_MANY_ROWS');
  });
});

describe('server: seeded differential fuzz (alias+map vs canonical) including invalid rows', () => {
  let srv: TestServer;
  beforeAll(async () => { srv = await startServer(); });
  afterAll(async () => { await srv.close(); });

  // 600 sequential HTTP round trips by design. Measured ~13-14 ms each on a Windows dev machine (a bare node:http server
  // costs the same, so it is the loopback round trip, not the app): ~8.5 s alone, beyond the 5 s default. 30 s keeps
  // headroom for the parallel full suite.
  it('300 random files: status and body issues are identical for alias+map and for the canonical rename', { timeout: 30_000 }, async () => {
    let seed = 987654;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    const pick = <T,>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)]!;
    const good = ['A-1,P,C,WH-DFW,1,1,1.00,1,1', 'B-22,"Q, r",C,WH-ATL,10,5,0.10,2.5,7', '007,N,C,WH-ORD,0,0,1000000.00,0,0'];
    const bad = ['a b,P,C,WH-DFW,1,1,1.00,1,1', 'A-1,P,C,WH-NOPE,1,1,1.00,1,1', 'A-1,P,C,WH-DFW,x,1,1.00,1,1', 'A-1,P,C,WH-DFW,1,1,1.00,1,-3', ',P,C,WH-DFW,1,1,1.00,1,1', 'A-1,P\u0002,C,WH-DFW,1,1,1.00,1,1'];
    for (let t = 0; t < 300; t++) {
      const n = 1 + Math.floor(rnd() * 5);
      const rows = Array.from({ length: n }, () => (rnd() < 0.7 ? pick(good) : pick(bad)));
      const body = rows.join('\n') + '\n';
      const a = await post(srv, 'inventory', INV_ALT_HEAD + '\n' + body, { 'X-SCC-Column-Map': INV_CANON_HEAD });
      const c = await post(srv, 'inventory', INV_CANON_HEAD + '\n' + body);
      expect(a.status).toBe(c.status);
      const ja = await a.json(); const jc = await c.json();
      expect(ja.errors ?? null).toEqual(jc.errors ?? null);
      expect(ja.rowCount ?? null).toBe(jc.rowCount ?? null);
    }
  });
});
