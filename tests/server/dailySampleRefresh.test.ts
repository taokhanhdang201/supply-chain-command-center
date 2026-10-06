// The sample's dates are relative to the day it was built. The API rebuilds it on the first request of a new day
// (lazy, no timer), only while BOTH sources are still the sample, and "day" is the same `localToday(new Date())` the
// server's snapshot uses (vitest runs with TZ=America/Chicago, so UTC midnight is not local midnight).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createAppServer } from '../../src/server/app';
import { createApiHandler } from '../../src/server/api';
import { createDataStore } from '../../src/server/store';
import type { AppConfig } from '../../src/server/config';
import { addDays, localToday } from '../../src/shared/dates';
import { createSampleDataset } from '../../src/shared/sample/generateSampleData';
import type { Snapshot } from '../../src/shared/types';

const shipmentsCsv = fs.readFileSync(path.resolve('public/templates/shipments-template.csv'), 'utf-8');
const config: AppConfig = { port: 0, host: '127.0.0.1', seed: 42, todayOverride: null, maxUploadBytes: 2_097_152, mode: 'test' };

let server: http.Server;
let port: number;
let build: ReturnType<typeof vi.fn<(today?: string) => ReturnType<typeof createSampleDataset>>>;

function at(date: Date): void {
  vi.setSystemTime(date);
}

function send(method: string, pathname: string, headers: Record<string, string> = {}, body?: string): Promise<{ status: number; json: unknown }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, method, path: pathname, headers }, (res) => {
      let text = '';
      res.on('data', (c) => (text += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, json: JSON.parse(text) }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

const snapshot = async (): Promise<Snapshot> => (await send('GET', '/api/snapshot')).json as Snapshot;
const bySeverity = (s: Snapshot) => ['critical', 'warning', 'info'].map((v) => s.alerts.filter((a) => a.severity === v).length);

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  at(new Date(2026, 9, 6, 12, 0, 0)); // local noon, Oct 6
  build = vi.fn((today: string = localToday(new Date())) => createSampleDataset(42, today, new Date().toISOString()));
  const sampleDay = localToday(new Date());
  const store = createDataStore(createSampleDataset(42, sampleDay, new Date().toISOString()));
  const api = createApiHandler({ config, store, getToday: () => localToday(new Date()), createSampleDataset: build, sampleDay });
  server = createAppServer({ config, api });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  vi.useRealTimers();
});

describe('daily sample refresh', () => {
  it('(a) a new day with both sources still the sample rebuilds it, and the numbers equal day +0', async () => {
    const day0 = await snapshot();
    expect(day0.today).toBe('2026-10-06');

    for (const [offset, date] of [[1, new Date(2026, 9, 7, 9, 0, 0)], [30, new Date(2026, 10, 5, 9, 0, 0)]] as const) {
      at(date);
      const later = await snapshot();
      expect(later.today).toBe(addDays('2026-10-06', offset));
      expect(later.kpis).toEqual(day0.kpis);
      expect(bySeverity(later)).toEqual(bySeverity(day0));
      for (const s of day0.shipments.slice(0, 20)) {
        expect(later.shipments.find((x) => x.shipmentId === s.shipmentId)?.shipDate, s.shipmentId).toBe(addDays(s.shipDate, offset));
      }
    }
    expect(build.mock.calls.map((c) => c[0])).toEqual(['2026-10-07', '2026-11-05']);
  });

  it('(b) once shipments were imported, a new day rebuilds nothing; Restore brings the sample back for the current day', async () => {
    const before = await snapshot();
    const imported = await send('POST', '/api/import/shipments', { 'Content-Type': 'text/csv', 'X-SCC-Request': '1' }, shipmentsCsv);
    expect(imported.status).toBe(200);

    at(new Date(2026, 9, 8, 9, 0, 0));
    const after = await snapshot();
    expect(build).not.toHaveBeenCalled();
    expect(after.dataSources.shipments.kind).toBe('import');
    expect(after.dataSources.inventory).toEqual(before.dataSources.inventory); // the sample inventory is untouched too

    expect((await send('POST', '/api/reset', { 'X-SCC-Request': '1' })).status).toBe(200);
    expect(build.mock.calls.map((c) => c[0])).toEqual(['2026-10-08']);
    expect((await snapshot()).dataSources.shipments.kind).toBe('sample');
    at(new Date(2026, 9, 8, 22, 0, 0));
    await snapshot();
    expect(build).toHaveBeenCalledTimes(1); // Restore recorded the day it built for
  });

  it('(c) many requests on the same day rebuild nothing; on a new day, exactly once', async () => {
    for (let i = 0; i < 5; i += 1) await send('GET', i % 2 === 0 ? '/api/snapshot' : '/api/health');
    expect(build).not.toHaveBeenCalled();
    at(new Date(2026, 9, 7, 8, 0, 0));
    for (let i = 0; i < 5; i += 1) await send('GET', i % 2 === 0 ? '/api/snapshot' : '/api/health');
    expect(build).toHaveBeenCalledTimes(1);
  });

  it('(d) the day turns at local midnight, the snapshot\'s own day, not at UTC midnight', async () => {
    const utcMidnightPassed = new Date('2026-10-07T00:30:00Z'); // 19:30 on Oct 6 in America/Chicago
    expect(utcMidnightPassed.toISOString().slice(0, 10)).toBe('2026-10-07');
    expect(localToday(utcMidnightPassed)).toBe('2026-10-06');
    at(utcMidnightPassed);
    expect((await snapshot()).today).toBe('2026-10-06');
    at(new Date(2026, 9, 6, 23, 59, 59, 999));
    expect((await snapshot()).today).toBe('2026-10-06');
    expect(build).not.toHaveBeenCalled();

    at(new Date(2026, 9, 7, 0, 0, 0, 0));
    const next = await snapshot();
    expect(next.today).toBe('2026-10-07');
    expect(build.mock.calls.map((c) => c[0])).toEqual(['2026-10-07']);
  });
});
