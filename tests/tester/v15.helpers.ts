// Shared helpers for the V1.5 tester suites (not a test file). Real createAppServer + createApiHandler + real store,
// the same wiring as production, on an ephemeral port.

import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createAppServer } from '../../src/server/app';
import { createApiHandler } from '../../src/server/api';
import { createDataStore, type DataStore } from '../../src/server/store';
import type { AppConfig } from '../../src/server/config';
import { createSampleDataset } from '../../src/shared/sample/generateSampleData';

export const TODAY = '2026-06-15';
export const INV_FIELDS = ['sku', 'product_name', 'category', 'warehouse', 'quantity', 'reorder_point', 'unit_cost', 'avg_daily_usage', 'lead_time_days'];
export const SHP_FIELDS = ['shipment_id', 'origin', 'destination', 'carrier', 'status', 'ship_date', 'estimated_delivery', 'actual_delivery', 'shipping_cost'];

export const read = (p: string): string => fs.readFileSync(path.resolve(process.cwd(), p), 'utf-8');
export const INV_TEMPLATE = read('public/templates/inventory-template.csv');
export const SHP_TEMPLATE = read('public/templates/shipments-template.csv');
export const INV_ALT = read('tests/fixtures/import/inventory_alt_schema.csv');
export const SHP_ALT = read('tests/fixtures/import/shipments_alt_schema.csv');
export const COMPANY_B = 'Item Code,Product Description,Category,Warehouse,Available Stock,ROP,Cost,Avg Usage,Lead Time\nITM-2001,Pallet Wrap Film,Packaging,WH-DFW,300,100,24.99,12,5\n';

export function baseConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return { port: 0, host: '127.0.0.1', seed: 42, todayOverride: TODAY, maxUploadBytes: 2_097_152, mode: 'test', ...overrides };
}

export interface TestServer {
  url: string;
  port: number;
  store: DataStore;
  close: () => Promise<void>;
}

export async function startServer(overrides: Partial<AppConfig> = {}): Promise<TestServer> {
  const config = baseConfig(overrides);
  const make = () => createSampleDataset(42, TODAY, '2026-06-15T00:00:00.000Z');
  const store = createDataStore(make());
  const api = createApiHandler({ config, store, getToday: () => TODAY, createSampleDataset: make, now: () => new Date('2026-06-15T12:00:00.000Z') });
  const server = createAppServer({ config, api });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return { url: `http://127.0.0.1:${port}`, port, store, close: () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }) };
}

export function post(
  srv: TestServer,
  kind: 'inventory' | 'shipments',
  body: BodyInit,
  headers: Record<string, string> = {}
): Promise<Response> {
  return fetch(`${srv.url}/api/import/${kind}`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'X-SCC-Request': '1', ...headers },
    body
  });
}

/** Sends raw bytes over a TCP socket and returns the raw response (status line + headers + body). For header-injection tests. */
export function rawRequest(port: number, raw: Buffer | string, waitMs = 400): Promise<string> {
  return new Promise((resolve) => {
    const sock = net.connect(port, '127.0.0.1', () => sock.write(raw));
    let out = '';
    sock.on('data', (d) => (out += d.toString('latin1')));
    sock.on('error', () => resolve(out));
    sock.on('close', () => resolve(out));
    setTimeout(() => { sock.destroy(); resolve(out); }, waitMs);
  });
}

export function rawPost(port: number, kind: string, extraHeaderLines: string, body: string | Buffer, opts: { host?: string } = {}): Promise<string> {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf-8');
  const head =
    `POST /api/import/${kind} HTTP/1.1\r\nHost: ${opts.host ?? `127.0.0.1:${port}`}\r\nContent-Type: text/csv\r\nX-SCC-Request: 1\r\n` +
    `${extraHeaderLines}Content-Length: ${buf.length}\r\nConnection: close\r\n\r\n`;
  return rawRequest(port, Buffer.concat([Buffer.from(head, 'latin1'), buf]));
}

export const statusOf = (raw: string): number => Number(/^HTTP\/1\.1 (\d{3})/.exec(raw)?.[1] ?? 0);

export async function snapshotOf(srv: TestServer): Promise<Record<string, unknown>> {
  const res = await fetch(`${srv.url}/api/snapshot`);
  return (await res.json()) as Record<string, unknown>;
}

/** Snapshot without the two fields that legitimately differ between imports (labels/timestamps). */
export function comparableSnapshot(snap: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...snap };
  delete copy.dataSources;
  delete copy.generatedAt;
  return copy;
}
