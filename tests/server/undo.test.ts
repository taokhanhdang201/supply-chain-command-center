// One-step Undo (decision e): an import returns the store version right after it; POST /api/undo with that version restores
// the data from before the import, only while nothing changed since. A later import, a restore or a second undo makes it
// stale, and the server says so plainly instead of undoing someone else's change.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createAppServer } from '../../src/server/app';
import { createApiHandler } from '../../src/server/api';
import { createDataStore } from '../../src/server/store';
import type { AppConfig } from '../../src/server/config';
import { createSampleDataset } from '../../src/shared/sample/generateSampleData';
import type { Snapshot } from '../../src/shared/types';

const TODAY = '2026-06-15';
const shipmentsCsv = fs.readFileSync(path.resolve('public/templates/shipments-template.csv'), 'utf-8');
const inventoryCsv = fs.readFileSync(path.resolve('public/templates/inventory-template.csv'), 'utf-8');
const config: AppConfig = { port: 0, host: '127.0.0.1', seed: 42, todayOverride: TODAY, maxUploadBytes: 2_097_152, mode: 'test' };

let server: http.Server;
let port: number;

function send(method: string, pathname: string, headers: Record<string, string> = {}, body?: string): Promise<{ status: number; json: any }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, method, path: pathname, headers }, (res) => {
      let text = '';
      res.on('data', (c) => (text += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, json: text === '' ? null : JSON.parse(text) }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

const importFile = (kind: 'shipments' | 'inventory', csv: string) => send('POST', `/api/import/${kind}`, { 'Content-Type': 'text/csv', 'X-SCC-Request': '1' }, csv);
const undo = (version: number | string) => send('POST', '/api/undo', { 'X-SCC-Request': '1', 'X-SCC-Undo-Version': String(version) });
const snapshot = async (): Promise<Snapshot> => (await send('GET', '/api/snapshot')).json as Snapshot;

beforeEach(async () => {
  const build = () => createSampleDataset(42, TODAY, '2026-06-15T00:00:00.000Z');
  const api = createApiHandler({ config, store: createDataStore(build()), getToday: () => TODAY, createSampleDataset: build, now: () => new Date('2026-06-15T12:00:00.000Z') });
  server = createAppServer({ config, api });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('POST /api/undo', () => {
  it('takes the last import back, once', async () => {
    const before = await snapshot();
    const imported = await importFile('shipments', shipmentsCsv);
    expect(imported.status).toBe(200);
    expect(typeof imported.json.undo.version).toBe('number');
    expect((await snapshot()).dataSources.shipments.kind).toBe('import');

    expect((await undo(imported.json.undo.version)).status).toBe(200);
    const after = await snapshot();
    expect(after.dataSources.shipments).toEqual(before.dataSources.shipments);
    expect(after.shipments.map((s) => s.shipmentId)).toEqual(before.shipments.map((s) => s.shipmentId));

    const again = await undo(imported.json.undo.version);
    expect(again.status).toBe(409);
    expect(again.json.error.code).toBe('UNDO_STALE');
  });

  it('refuses to undo an import that a later import followed, and says why', async () => {
    const first = await importFile('shipments', shipmentsCsv);
    const second = await importFile('inventory', inventoryCsv);
    const stale = await undo(first.json.undo.version);
    expect(stale.status).toBe(409);
    expect(stale.json.error.message).toBe('This import can no longer be undone: the data changed after it. Use Restore sample data to start over.');
    expect((await snapshot()).dataSources.inventory.kind).toBe('import'); // nothing was changed
    // the latest import can still be taken back, one step only: shipments stay imported
    expect((await undo(second.json.undo.version)).status).toBe(200);
    const s = await snapshot();
    expect(s.dataSources.inventory.kind).toBe('sample');
    expect(s.dataSources.shipments.kind).toBe('import');
  });

  it('refuses after Restore sample data', async () => {
    const imported = await importFile('shipments', shipmentsCsv);
    expect((await send('POST', '/api/reset', { 'X-SCC-Request': '1' })).status).toBe(200);
    expect((await undo(imported.json.undo.version)).status).toBe(409);
  });

  it('needs the version, the request header and POST', async () => {
    await importFile('shipments', shipmentsCsv);
    const missing = await send('POST', '/api/undo', { 'X-SCC-Request': '1' });
    expect(missing.status).toBe(400);
    expect(missing.json.error.code).toBe('INVALID_UNDO');
    expect((await undo('1e3')).status).toBe(400);
    expect((await send('POST', '/api/undo', { 'X-SCC-Undo-Version': '1' })).status).toBe(403);
    expect((await send('GET', '/api/undo')).status).toBe(405);
    expect((await snapshot()).dataSources.shipments.kind).toBe('import'); // none of these changed anything
  });

  it('with nothing imported there is nothing to undo', async () => {
    const r = await undo(1);
    expect(r.status).toBe(409);
    expect((await snapshot()).dataSources.shipments.kind).toBe('sample');
  });
});
