// A real SCC server on an ephemeral port (the same wiring as tests/server/api.test.ts) so tests can POST a canonical
// payload through the UNCHANGED endpoint and look at the store afterwards.

import type { AddressInfo } from 'node:net';
import { createAppServer } from '../../src/server/app';
import { createApiHandler } from '../../src/server/api';
import { createDataStore, type DataStore } from '../../src/server/store';
import type { AppConfig } from '../../src/server/config';
import { createSampleDataset } from '../../src/shared/sample/generateSampleData';

export const TODAY = '2026-06-15';

export const baseConfig = (overrides: Partial<AppConfig> = {}): AppConfig => ({
  port: 0,
  host: '127.0.0.1',
  seed: 42,
  todayOverride: TODAY,
  maxUploadBytes: 2_097_152,
  mode: 'test',
  ...overrides
});

export interface TestServer {
  url: string;
  store: DataStore;
  close: () => Promise<void>;
}

export async function startServer(config: AppConfig = baseConfig()): Promise<TestServer> {
  const make = () => createSampleDataset(42, TODAY, '2026-06-15T00:00:00.000Z');
  const store = createDataStore(make());
  const api = createApiHandler({ config, store, getToday: () => TODAY, createSampleDataset: make, now: () => new Date('2026-06-15T12:00:00.000Z') });
  const server = createAppServer({ config, api });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return { url: `http://127.0.0.1:${port}`, store, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

/** Uploads exactly like the app's HTTP client does for the default path: raw text/csv body plus the three request headers. */
export async function postCsv(server: TestServer, kind: 'inventory' | 'shipments', csv: string, fileName: string, extraHeaders: Record<string, string> = {}): Promise<Response> {
  return fetch(`${server.url}/api/import/${kind}`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'X-SCC-Request': '1', 'X-SCC-Filename': encodeURIComponent(fileName), ...extraHeaders },
    body: csv
  });
}
