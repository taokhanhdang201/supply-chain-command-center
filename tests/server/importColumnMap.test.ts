import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { createAppServer } from '../../src/server/app';
import { createApiHandler } from '../../src/server/api';
import { createDataStore, type DataStore } from '../../src/server/store';
import type { AppConfig } from '../../src/server/config';
import type { Dataset } from '../../src/shared/types';
import { createSampleDataset } from '../../src/shared/sample/generateSampleData';

const TODAY = '2026-06-15';
const MAP_HEADER = 'X-SCC-Column-Map';

const INV_FIELDS = 'sku,product_name,category,warehouse,quantity,reorder_point,unit_cost,avg_daily_usage,lead_time_days';
const SHP_FIELDS = 'shipment_id,origin,destination,carrier,status,ship_date,estimated_delivery,actual_delivery,shipping_cost';

const read = (p: string): string => fs.readFileSync(path.resolve(p), 'utf-8');
const inventoryTemplate = read('public/templates/inventory-template.csv');
const shipmentsTemplate = read('public/templates/shipments-template.csv');
const invAlt = read('tests/fixtures/import/inventory_alt_schema.csv');
const shpAlt = read('tests/fixtures/import/shipments_alt_schema.csv');
const companyB = 'Item Code,Product Description,Category,Warehouse,Available Stock,ROP,Cost,Avg Usage,Lead Time\nITM-2001,Pallet Wrap Film,Packaging,WH-DFW,300,100,24.99,12,5\n';

function baseConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return { port: 0, host: '127.0.0.1', seed: 42, todayOverride: TODAY, maxUploadBytes: 2_097_152, mode: 'test', ...overrides };
}

function makeSampleDataset(): Dataset {
  return createSampleDataset(42, TODAY, '2026-06-15T00:00:00.000Z');
}

async function startTestServer(config: AppConfig): Promise<{ url: string; store: DataStore; close: () => Promise<void> }> {
  const store = createDataStore(makeSampleDataset());
  const api = createApiHandler({
    config,
    store,
    getToday: () => config.todayOverride ?? TODAY,
    createSampleDataset: makeSampleDataset,
    now: () => new Date('2026-06-15T12:00:00.000Z')
  });
  const server = createAppServer({ config, api });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return { url: `http://127.0.0.1:${port}`, store, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

describe('import with X-SCC-Column-Map', () => {
  let server: Awaited<ReturnType<typeof startTestServer>>;

  beforeAll(async () => {
    server = await startTestServer(baseConfig());
  });
  afterAll(async () => {
    await server.close();
  });

  function post(kind: 'inventory' | 'shipments', body: BodyInit, headers: Record<string, string> = {}): Promise<Response> {
    return fetch(`${server.url}/api/import/${kind}`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/csv; charset=utf-8', 'X-SCC-Request': '1', ...headers },
      body
    });
  }

  it('still accepts the canonical inventory template with no header (200)', async () => {
    const res = await post('inventory', inventoryTemplate);
    expect(res.status).toBe(200);
    expect((await res.json()).rowCount).toBe(2);
  });

  it('still accepts the canonical shipments template with no header (200)', async () => {
    const res = await post('shipments', shipmentsTemplate);
    expect(res.status).toBe(200);
    expect((await res.json()).rowCount).toBe(2);
  });

  it('rejects the alt file without a map as V1 did (422 MISSING_COLUMNS) and leaves the store unchanged', async () => {
    const before = server.store.getVersion();
    const res = await post('inventory', invAlt);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.errors[0].code).toBe('MISSING_COLUMNS');
    expect(server.store.getVersion()).toBe(before);
  });

  it('imports the alt inventory file with a map (200) and the snapshot values are right', async () => {
    const res = await post('inventory', invAlt, { [MAP_HEADER]: INV_FIELDS, 'X-SCC-Filename': 'inventory_alt_schema.csv' });
    expect(res.status).toBe(200);
    expect((await res.json()).dataSource.label).toBe('inventory_alt_schema.csv');
    const snap = await (await fetch(`${server.url}/api/snapshot`)).json();
    expect(snap.kpis).toMatchObject({ inventoryRecordCount: 4, totalUnits: 5018, totalInventoryValueCents: 2_814_900, lowStockCount: 2, outOfStockCount: 1 });
  });

  it('imports the alt shipments file with a map (200)', async () => {
    const res = await post('shipments', shpAlt, { [MAP_HEADER]: SHP_FIELDS });
    expect(res.status).toBe(200);
    const snap = await (await fetch(`${server.url}/api/snapshot`)).json();
    expect(snap.kpis).toMatchObject({ totalShipments: 3, deliveredShipments: 1, totalShippingCostCents: 472_240 });
  });

  it('rejects malformed map headers with 400 INVALID_COLUMN_MAP and leaves the store unchanged', async () => {
    const before = server.store.getVersion();
    const bad = [
      '__proto__',
      'constructor',
      'SKU,product_name',
      '["sku"]',
      'sku, product_name',
      'shipping_cost,sku',
      ','.repeat(1100),
      ','.repeat(60),
      'sku,definitely_not_a_field'
    ];
    for (const value of bad) {
      const res = await post('inventory', invAlt, { [MAP_HEADER]: value });
      expect(res.status, value.slice(0, 20)).toBe(400);
      expect((await res.json()).error.code).toBe('INVALID_COLUMN_MAP');
    }
    expect(server.store.getVersion()).toBe(before);
  });

  it('returns 422 for a duplicate or incomplete map, and for Company B without a map', async () => {
    const before = server.store.getVersion();
    const dup = await post('inventory', invAlt, { [MAP_HEADER]: 'sku,product_name,category,warehouse,quantity,quantity,unit_cost,avg_daily_usage,lead_time_days' });
    expect(dup.status).toBe(422);
    expect((await dup.json()).errors[0].code).toBe('DUPLICATE_COLUMNS');

    const missing = await post('inventory', invAlt, { [MAP_HEADER]: ',product_name,category,warehouse,quantity,reorder_point,unit_cost,avg_daily_usage,lead_time_days' });
    expect(missing.status).toBe(422);
    expect((await missing.json()).errors[0].code).toBe('MISSING_COLUMNS');

    const short = await post('inventory', invAlt, { [MAP_HEADER]: 'sku,product_name' });
    expect(short.status).toBe(422);
    expect((await short.json()).errors[0].code).toBe('INVALID_MAPPING');

    const noMap = await post('inventory', companyB);
    expect(noMap.status).toBe(422);
    expect((await noMap.json()).errors[0].code).toBe('MISSING_COLUMNS');
    expect(server.store.getVersion()).toBe(before);
  });

  it('keeps the CSRF checks: a map does not replace X-SCC-Request or a same Origin (403)', async () => {
    const noHeader = await fetch(`${server.url}/api/import/inventory`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/csv', [MAP_HEADER]: INV_FIELDS },
      body: invAlt
    });
    expect(noHeader.status).toBe(403);
    const foreign = await post('inventory', invAlt, { [MAP_HEADER]: INV_FIELDS, Origin: 'http://evil.example' });
    expect(foreign.status).toBe(403);
  });

  it('keeps Content-Type (415), size (413) and UTF-8 (400) checks with a map', async () => {
    const wrongType = await post('inventory', invAlt, { 'Content-Type': 'application/json', [MAP_HEADER]: INV_FIELDS });
    expect(wrongType.status).toBe(415);

    const small = await startTestServer(baseConfig({ maxUploadBytes: 64 }));
    try {
      const big = await fetch(`${small.url}/api/import/inventory`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/csv', 'X-SCC-Request': '1', [MAP_HEADER]: INV_FIELDS },
        body: invAlt
      });
      expect(big.status).toBe(413);
    } finally {
      await small.close();
    }

    const bad = await post('inventory', Buffer.from([0x61, 0xe9, 0x00, 0xff, 0x62]), { [MAP_HEADER]: INV_FIELDS });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.code).toBe('INVALID_ENCODING');
  });

  it('still explains an Excel M/D/YYYY date on a mapped date column (422)', async () => {
    const csv = `${shpAlt.split('\n')[0]}\nLD-60001,WH-DFW,HOU,Northstar Freight,Delivered,8/15/2026,2026-08-18,2026-08-17,812.40\n`;
    const res = await post('shipments', csv, { [MAP_HEADER]: SHP_FIELDS });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.errors[0]).toMatchObject({ line: 2, column: 'ship_date', code: 'INVALID_DATE' });
    expect(body.errors[0].message).toContain('looks like Excel changed this date to M/D/YYYY');
  });

  it('rejects a text column mapped to quantity with INVALID_NUMBER on the canonical column (422)', async () => {
    const res = await post('inventory', invAlt.replace('WH-DFW,12,40', 'WH-DFW,twelve,40'), { [MAP_HEADER]: INV_FIELDS });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.errors[0]).toMatchObject({ line: 2, column: 'quantity', code: 'INVALID_NUMBER' });
    // a tampered map that feeds the Category text column into quantity fails the same way, on the canonical column
    const swapped = 'sku,product_name,quantity,warehouse,category,reorder_point,unit_cost,avg_daily_usage,lead_time_days';
    const res2 = await post('inventory', invAlt, { [MAP_HEADER]: swapped });
    expect(res2.status).toBe(422);
    expect((await res2.json()).errors[0]).toMatchObject({ line: 2, column: 'quantity', code: 'INVALID_NUMBER' });
  });
});
