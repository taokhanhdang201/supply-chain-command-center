// V1.5 tester: adversarial X-SCC-Column-Map header (server, real sockets). Property under test: a hostile or malformed
// map can only be rejected; it never yields a 200, never changes the store, is never reflected, and never crashes the server.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { INV_ALT, INV_FIELDS, INV_TEMPLATE, SHP_ALT, SHP_FIELDS, post, rawPost, startServer, statusOf, type TestServer } from './v15.helpers';
import { parseColumnMapHeader } from '../../src/shared/mapping/columnMapHeader';

let srv: TestServer;
beforeAll(async () => { srv = await startServer(); });
afterAll(async () => { await srv.close(); });

const MAP = 'X-SCC-Column-Map';
const good = INV_FIELDS.join(',');

async function expectRejected(headers: Record<string, string>, codes: string[], kind: 'inventory' | 'shipments' = 'inventory') {
  const v = srv.store.getVersion();
  const res = await post(srv, kind, kind === 'inventory' ? INV_ALT : SHP_ALT, headers);
  const body = await res.json();
  expect(res.status, JSON.stringify(body)).not.toBe(200);
  const code = body.error?.code === 'VALIDATION_FAILED' ? body.errors[0].code : body.error?.code;
  expect(codes).toContain(code);
  expect(srv.store.getVersion()).toBe(v);
  return { res, body };
}

describe('X-SCC-Column-Map: hostile values are only ever rejected', () => {
  it.each([
    ['__proto__'],
    ['constructor'],
    ['prototype'],
    ['toString'],
    ['sku,__proto__'],
    [good.replace('sku', '__proto__')],
    ['SKU,' + good.split(',').slice(1).join(',')],
    [good.replace(/,/g, ', ')],
    [' ' + good.replace(/,/g, ' , ')],
    ['{"sku":0}'],
    ['["sku"]'],
    ['sku;product_name'],
    ['sku|product_name'],
    [good.replace('sku', 'sku\t')],
    ['../../etc/passwd'],
    ['<script>alert(1)</script>'],
    ['=cmd|calc'],
    [good.replace('quantity', 'quantity;DROP TABLE')],
    ['s'.repeat(33)],
    ['nonexistent_field'],
    ['sku,product_name,category,warehouse,quantity,reorder_point,unit_cost,avg_daily_usage,shipment_id'], // wrong kind's field
    ['sku,sku_,category,warehouse,quantity,reorder_point,unit_cost,avg_daily_usage,lead_time_days']
  ])('rejects %j with 400 INVALID_COLUMN_MAP', async (value) => {
    const { body } = await expectRejected({ [MAP]: value }, ['INVALID_COLUMN_MAP']);
    // never reflected back
    expect(JSON.stringify(body)).not.toContain(value.length > 3 ? value : '\u0000none');
  });

  it('a shipment field on an inventory upload, and the reverse, is INVALID_COLUMN_MAP', async () => {
    await expectRejected({ [MAP]: SHP_FIELDS.join(',') }, ['INVALID_COLUMN_MAP']);
    await expectRejected({ [MAP]: INV_FIELDS.join(',') }, ['INVALID_COLUMN_MAP'], 'shipments');
  });

  it('over 1024 chars, and over 50 entries, are rejected with 400', async () => {
    await expectRejected({ [MAP]: 'sku,'.repeat(300) + 'sku' }, ['INVALID_COLUMN_MAP']);
    await expectRejected({ [MAP]: ','.repeat(51) }, ['INVALID_COLUMN_MAP']);
    // exactly at the entry cap: 50 entries is accepted by the parser but the length mismatch (9 columns) still blocks
    await expectRejected({ [MAP]: ','.repeat(49) }, ['INVALID_MAPPING']);
  });

  it('a 100 KB header is refused by the transport (431 or closed) and the server keeps serving', async () => {
    const v = srv.store.getVersion();
    const raw = await rawPost(srv.port, 'inventory', `${MAP}: ${'a'.repeat(100_000)}\r\n`, INV_ALT);
    const status = statusOf(raw);
    expect([0, 400, 431]).toContain(status);
    expect(srv.store.getVersion()).toBe(v);
    expect((await fetch(`${srv.url}/api/health`)).status).toBe(200);
  });

  it('wrong length: too short, too long, trailing comma, leading comma -> 422 INVALID_MAPPING', async () => {
    for (const m of ['sku', INV_FIELDS.slice(0, 8).join(','), good + ',', good + ',lead_time_days', ',' + good]) {
      await expectRejected({ [MAP]: m }, ['INVALID_MAPPING']);
    }
  });

  it('an empty header value is a one-entry map (length mismatch), never "no map", never 200', async () => {
    await expectRejected({ [MAP]: '' }, ['INVALID_MAPPING', 'INVALID_COLUMN_MAP']);
  });

  it('empty entries mean "do not import": all-empty is MISSING_COLUMNS; blanking one required field is MISSING_COLUMNS', async () => {
    await expectRejected({ [MAP]: ','.repeat(8) }, ['MISSING_COLUMNS']);
    await expectRejected({ [MAP]: good.replace('sku', '') }, ['MISSING_COLUMNS']);
  });

  it('repeating a field (two columns onto one field) is DUPLICATE_COLUMNS, whichever pair and even for optional fields', async () => {
    await expectRejected({ [MAP]: good.replace('product_name', 'sku') }, ['DUPLICATE_COLUMNS']);
    await expectRejected({ [MAP]: good.replace('category', 'sku') }, ['DUPLICATE_COLUMNS']);
    await expectRejected({ [MAP]: good.replace('lead_time_days', 'avg_daily_usage') }, ['DUPLICATE_COLUMNS']);
  });

  it('mapping a column onto a required field the file already provides canonically is blocked when it would create a duplicate', async () => {
    // canonical template + a second column also mapped to sku
    const csv = 'sku,product_name,category,warehouse,quantity,reorder_point,unit_cost,avg_daily_usage,lead_time_days,Item Code\nAAA-1,P,Cat,WH-DFW,1,1,1.00,1,1,BBB-2\n';
    const v = srv.store.getVersion();
    const res = await post(srv, 'inventory', csv, { [MAP]: good + ',sku' });
    expect(res.status).toBe(422);
    expect((await res.json()).errors[0].code).toBe('DUPLICATE_COLUMNS');
    expect(srv.store.getVersion()).toBe(v);
  });

  it('a duplicated header line (two X-SCC-Column-Map lines, even both valid) is rejected, not merged or first-wins', async () => {
    const v = srv.store.getVersion();
    const raw = await rawPost(srv.port, 'inventory', `${MAP}: ${good}\r\n${MAP}: ${good}\r\n`, INV_ALT);
    expect(statusOf(raw)).toBe(400);
    expect(raw).toContain('INVALID_COLUMN_MAP');
    expect(srv.store.getVersion()).toBe(v);
  });

  it('header name is case-insensitive (HTTP semantics) and a valid map still works', async () => {
    const raw = await rawPost(srv.port, 'inventory', `x-scc-COLUMN-map: ${good}\r\n`, INV_ALT);
    expect(statusOf(raw)).toBe(200);
  });
});

describe('X-SCC-Column-Map: CR/LF, NUL and non-ASCII (raw socket; fetch itself refuses to send them)', () => {
  it('fetch (undici) refuses CR/LF/NUL in a header value client-side, so the browser client cannot produce them', async () => {
    for (const v of ['sku\r\nX-Evil: 1', 'sku\nX-Evil: 1', 'sku\u0000', 'ѕku']) {
      await expect(post(srv, 'inventory', INV_ALT, { [MAP]: v })).rejects.toBeTruthy();
    }
  });

  it('CRLF injection over a raw socket: the injected line is just another header, never part of the map, and the request is still governed by the real map', async () => {
    const v = srv.store.getVersion();
    // "Map: sku" then an injected X-Evil header: the map is only "sku" -> 422 length mismatch
    const raw = await rawPost(srv.port, 'inventory', `${MAP}: sku\r\nX-Evil: ${good}\r\n`, INV_ALT);
    expect(statusOf(raw)).toBe(422);
    expect(raw).toContain('INVALID_MAPPING');
    expect(srv.store.getVersion()).toBe(v);
  });

  it('bare LF, obs-fold continuation and NUL inside the value never produce a 200 and never change the store', async () => {
    const v = srv.store.getVersion();
    const attempts = [
      `${MAP}: sku\nX-Evil: 1\r\n`,
      `${MAP}: ${good.slice(0, 20)}\r\n ${good.slice(20)}\r\n`,
      `${MAP}: ${good.slice(0, 20)}\r\n\t${good.slice(20)}\r\n`,
      `${MAP}: ${good.slice(0, 20)}\u0000${good.slice(20)}\r\n`
    ];
    for (const a of attempts) {
      const raw = await rawPost(srv.port, 'inventory', a, INV_ALT);
      expect(statusOf(raw), a).not.toBe(200);
    }
    expect(srv.store.getVersion()).toBe(v);
  });

  it('non-ASCII bytes in the value (latin-1 lookalikes, UTF-8 Cyrillic s, zero-width space) are rejected', async () => {
    const v = srv.store.getVersion();
    const cyr = Buffer.from(good.replace('sku', 'ѕku'), 'utf-8').toString('latin1'); // raw UTF-8 bytes on the wire
    for (const val of [good.replace('sku', 's­ku'), good.replace('sku', 'skü'), cyr, good.replace('sku', 'sku​')]) {
      const raw = await rawPost(srv.port, 'inventory', `${MAP}: ${val}\r\n`, INV_ALT);
      // rejected either by Node's own parser (bare 400, no body) or by the whitelist (400 INVALID_COLUMN_MAP); never accepted
      expect(statusOf(raw)).toBe(400);
    }
    expect(srv.store.getVersion()).toBe(v);
  });
});

describe('parseColumnMapHeader unit adversaries', () => {
  it('never throws and never returns anything but a whitelist-clean map', () => {
    const nasty = ['', ',', '__proto__', 'constructor', '\u0000', 'sku\n', 'ＳＫＵ', 'sku'.repeat(400), ',,,,,', 'sku,sku', 'sku ', ' sku', 'SKku'];
    for (const n of nasty) {
      const r = parseColumnMapHeader(n, 'inventory');
      if (r.ok) for (const e of r.map) expect(e === null || INV_FIELDS.includes(e)).toBe(true);
    }
    expect(parseColumnMapHeader('sku', 'inventory')).toEqual({ ok: true, map: ['sku'] });
    expect(parseColumnMapHeader('', 'inventory')).toEqual({ ok: true, map: [null] });
  });

  it('a valid identity map on the canonical template is byte-equivalent to no map (same status, rowCount, warnings)', async () => {
    const a = await (await post(srv, 'inventory', INV_TEMPLATE)).json();
    const b = await (await post(srv, 'inventory', INV_TEMPLATE, { [MAP]: good })).json();
    expect(b.rowCount).toBe(a.rowCount);
    expect(b.warnings).toEqual(a.warnings);
  });
});
