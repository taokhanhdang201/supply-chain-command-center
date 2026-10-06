import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import { createAppServer } from '../../src/server/app';
import { createApiHandler } from '../../src/server/api';
import { createDataStore, type DataStore } from '../../src/server/store';
import type { AppConfig } from '../../src/server/config';
import type { Dataset } from '../../src/shared/types';
import { createSampleDataset } from '../../src/shared/sample/generateSampleData';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

const TODAY = '2026-06-15';

function baseConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    port: 0,
    host: '127.0.0.1',
    seed: 42,
    todayOverride: TODAY,
    maxUploadBytes: 2_097_152,
    mode: 'test',
    ...overrides
  };
}

function makeSampleDataset(): Dataset {
  return createSampleDataset(42, TODAY, '2026-06-15T00:00:00.000Z');
}

async function startTestServer(config: AppConfig, store?: DataStore): Promise<{ url: string; store: DataStore; close: () => Promise<void> }> {
  const dataStore = store ?? createDataStore(makeSampleDataset());
  const api = createApiHandler({
    config,
    store: dataStore,
    getToday: () => config.todayOverride ?? TODAY,
    createSampleDataset: makeSampleDataset,
    now: () => new Date('2026-06-15T12:00:00.000Z')
  });
  const server = createAppServer({ config, api });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    store: dataStore,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  };
}

const inventoryCsv = fs.readFileSync(path.resolve('public/templates/inventory-template.csv'), 'utf-8');
const shipmentsCsv = fs.readFileSync(path.resolve('public/templates/shipments-template.csv'), 'utf-8');

describe('api', () => {
  let server: { url: string; store: DataStore; close: () => Promise<void> };

  beforeAll(async () => {
    server = await startTestServer(baseConfig());
  });

  afterAll(async () => {
    await server.close();
  });

  it('GET /api/health returns 200 { status: "ok" }', async () => {
    const res = await fetch(`${server.url}/api/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('rejects a request with a foreign Host header (421, R-11: DNS rebinding)', async () => {
    // `fetch`/undici treat `Host` as a forbidden header and silently override it to the real connection target,
    // so this needs `node:http`'s lower-level API to actually send a mismatched Host (simulating a DNS-rebound
    // request: the TCP connection is to 127.0.0.1, but the attacker's original hostname is still in `Host`).
    const { hostname, port, pathname } = new URL(`${server.url}/api/health`);
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        { hostname, port, path: pathname, headers: { Host: 'evil.example:80' } },
        (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode ?? 0));
        }
      );
      req.on('error', reject);
      req.end();
    });
    expect(status).toBe(421);
  });

  it('GET /api/snapshot returns 200 with security headers and no-store', async () => {
    const res = await fetch(`${server.url}/api/snapshot`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('content-security-policy')).toContain("default-src 'self'");
    const body = await res.json();
    expect(body.today).toBe(TODAY);
    expect(Array.isArray(body.inventory)).toBe(true);
  });

  it('rejects import without the X-SCC-Request header (403)', async () => {
    const res = await fetch(`${server.url}/api/import/inventory`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/csv' },
      body: inventoryCsv
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('rejects import from a foreign Origin (403)', async () => {
    const res = await fetch(`${server.url}/api/import/inventory`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/csv', 'X-SCC-Request': '1', Origin: 'http://evil.example' },
      body: inventoryCsv
    });
    expect(res.status).toBe(403);
  });

  it('rejects the wrong content type (415)', async () => {
    const res = await fetch(`${server.url}/api/import/inventory`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-SCC-Request': '1' },
      body: inventoryCsv
    });
    expect(res.status).toBe(415);
    expect((await res.json()).error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('rejects an empty file (400)', async () => {
    const res = await fetch(`${server.url}/api/import/inventory`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/csv', 'X-SCC-Request': '1' },
      body: '   '
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('EMPTY_FILE');
  });

  it('rejects invalid UTF-8 (400)', async () => {
    const res = await fetch(`${server.url}/api/import/inventory`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/csv', 'X-SCC-Request': '1' },
      body: Buffer.from([0x61, 0xe9, 0x00, 0xff, 0x62])
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('INVALID_ENCODING');
  });

  it('returns 422 with errors for an invalid CSV, and leaves the snapshot unchanged', async () => {
    const before = await (await fetch(`${server.url}/api/snapshot`)).json();
    const res = await fetch(`${server.url}/api/import/inventory`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/csv', 'X-SCC-Request': '1' },
      body: 'sku,product_name\nBAD,x'
    });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(Array.isArray(body.errors)).toBe(true);
    expect(body.totalErrors).toBeGreaterThan(0);
    const after = await (await fetch(`${server.url}/api/snapshot`)).json();
    expect(after.inventory.length).toBe(before.inventory.length);
  });

  it('imports valid inventory CSV, replacing only the inventory dataset', async () => {
    const beforeSnapshot = await (await fetch(`${server.url}/api/snapshot`)).json();
    const shipmentCountBefore = beforeSnapshot.shipments.length;

    const res = await fetch(`${server.url}/api/import/inventory`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/csv; charset=utf-8', 'X-SCC-Request': '1', 'X-SCC-Filename': encodeURIComponent('my file.csv') },
      body: inventoryCsv
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.kind).toBe('inventory');
    expect(body.rowCount).toBe(2);
    expect(body.dataSource.kind).toBe('import');
    expect(body.dataSource.label).toBe('my file.csv');

    const snapshot = await (await fetch(`${server.url}/api/snapshot`)).json();
    expect(snapshot.inventory.length).toBe(2);
    expect(snapshot.shipments.length).toBe(shipmentCountBefore);
    expect(snapshot.dataSources.inventory.kind).toBe('import');
    expect(snapshot.dataSources.shipments.kind).toBe('sample');
  });

  it('unknown import kind returns 404', async () => {
    const res = await fetch(`${server.url}/api/import/unknown`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/csv', 'X-SCC-Request': '1' },
      body: inventoryCsv
    });
    expect(res.status).toBe(404);
  });

  it('GET on an import path returns 405 with Allow header', async () => {
    const res = await fetch(`${server.url}/api/import/inventory`);
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST');
    expect((await res.json()).error.code).toBe('METHOD_NOT_ALLOWED');
  });

  it('unknown /api path returns 404 JSON', async () => {
    const res = await fetch(`${server.url}/api/nope`);
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('NOT_FOUND');
  });

  it('reset restores the full sample dataset (403 without header, 200 with)', async () => {
    const forbidden = await fetch(`${server.url}/api/reset`, { method: 'POST' });
    expect(forbidden.status).toBe(403);

    // Replace shipments with something small first, then reset.
    await fetch(`${server.url}/api/import/shipments`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/csv', 'X-SCC-Request': '1' },
      body: shipmentsCsv
    });
    const res = await fetch(`${server.url}/api/reset`, { method: 'POST', headers: { 'X-SCC-Request': '1' } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const snapshot = await (await fetch(`${server.url}/api/snapshot`)).json();
    expect(snapshot.inventory.length).toBe(360);
    expect(snapshot.shipments.length).toBe(480);
  });
});

describe('api upload size limits', () => {
  let server: { url: string; store: DataStore; close: () => Promise<void> };

  beforeAll(async () => {
    server = await startTestServer(baseConfig({ maxUploadBytes: 1024 }));
  });

  afterAll(async () => {
    await server.close();
  });

  it('rejects an oversize body via Content-Length (413)', async () => {
    const big = 'a'.repeat(2000);
    const res = await fetch(`${server.url}/api/import/inventory`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/csv', 'X-SCC-Request': '1' },
      body: big
    });
    expect(res.status).toBe(413);
    expect((await res.json()).error.code).toBe('FILE_TOO_LARGE');
  });

  it('rejects an oversize body streamed without Content-Length (413)', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 5; i += 1) {
          controller.enqueue(new TextEncoder().encode('a'.repeat(500)));
        }
        controller.close();
      }
    });
    const res = await fetch(`${server.url}/api/import/inventory`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/csv', 'X-SCC-Request': '1' },
      body: stream,
      duplex: 'half'
    } as RequestInit);
    expect(res.status).toBe(413);
  });
});

describe('api internal error handling', () => {
  it('an unexpected exception returns a generic 500 body', async () => {
    const throwingStore: DataStore = {
      getDataset: () => {
        throw new Error('boom');
      },
      getVersion: () => 0,
      replaceInventory: () => undefined,
      replaceShipments: () => undefined,
      replaceAll: () => undefined
    };
    const server = await startTestServer(baseConfig(), throwingStore);
    try {
      const res = await fetch(`${server.url}/api/snapshot`);
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body).toEqual({ ok: false, error: { code: 'INTERNAL', message: 'Internal server error.' } });
    } finally {
      await server.close();
    }
  });
});
