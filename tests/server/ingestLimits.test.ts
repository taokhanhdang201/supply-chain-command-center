// Milestone M4: the approved server ingestion limits (criteria 28-33 and 37). `SCC_MAX_IMPORT_ROWS` is
// read by the new `src/server/ingestLimits.ts`; `config.ts` and `AppConfig` are not touched; every default is today's value.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createAppServer } from '../../src/server/app';
import { createApiHandler } from '../../src/server/api';
import { createDataStore } from '../../src/server/store';
import { loadConfig, type AppConfig } from '../../src/server/config';
import { DEFAULT_INGEST_LIMITS, IngestLimitsError, loadIngestLimits, MAX_IMPORT_ROWS_CEILING, type IngestLimits } from '../../src/server/ingestLimits';
import { DEFAULT_MAX_UPLOAD_BYTES, MAX_ERRORS_RETURNED, MAX_IMPORT_COLUMNS, MAX_IMPORT_ROWS } from '../../src/shared/constants';
import { createSampleDataset } from '../../src/shared/sample/generateSampleData';

const TODAY = '2026-06-15';
const HEAD = 'sku,product_name,category,warehouse,quantity,reorder_point,unit_cost';
const rows = (n: number): string => `${HEAD}\n${Array.from({ length: n }, (_, i) => `S-${100000 + i},Item,Cat,WH-DFW,1,1,1.25`).join('\n')}\n`;

const config = (over: Partial<AppConfig> = {}): AppConfig => ({ port: 0, host: '127.0.0.1', seed: 42, todayOverride: TODAY, maxUploadBytes: 2_097_152, mode: 'test', ...over });

interface Running {
  url: string;
  close: () => Promise<void>;
}

async function start(cfg: AppConfig, ingestLimits?: IngestLimits): Promise<Running> {
  const make = () => createSampleDataset(42, TODAY, '2026-06-15T00:00:00.000Z');
  const store = createDataStore(make());
  const api = createApiHandler({ config: cfg, store, getToday: () => TODAY, createSampleDataset: make, now: () => new Date('2026-06-15T12:00:00.000Z'), ...(ingestLimits === undefined ? {} : { ingestLimits }) });
  const server = createAppServer({ config: cfg, api });
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => new Promise<void>((r) => server.close(() => r())) };
}

const post = (s: Running, csv: string) => fetch(`${s.url}/api/import/inventory`, { method: 'POST', headers: { 'Content-Type': 'text/csv', 'X-SCC-Request': '1' }, body: csv });
const snapshotLimits = async (s: Running) => ((await (await fetch(`${s.url}/api/snapshot`)).json()) as { limits: { maxUploadBytes: number; maxRows: number } }).limits;

describe('SCC_MAX_IMPORT_ROWS parsing (criterion 30)', () => {
  it('unset, empty and whitespace mean the default of 20,000', () => {
    for (const env of [{}, { SCC_MAX_IMPORT_ROWS: undefined }, { SCC_MAX_IMPORT_ROWS: '' }, { SCC_MAX_IMPORT_ROWS: '   ' }]) {
      expect(loadIngestLimits(env).maxRows).toBe(20_000);
      expect(loadIngestLimits(env).warnings).toEqual([]);
    }
  });

  it('accepts integers 1..100,000 at the boundaries and trims spaces', () => {
    expect(loadIngestLimits({ SCC_MAX_IMPORT_ROWS: '1' }).maxRows).toBe(1);
    expect(loadIngestLimits({ SCC_MAX_IMPORT_ROWS: '100000' }).maxRows).toBe(100_000);
    expect(loadIngestLimits({ SCC_MAX_IMPORT_ROWS: ' 5000 ' }).maxRows).toBe(5000);
    expect(loadIngestLimits({ SCC_MAX_IMPORT_ROWS: '20000' }).maxRows).toBe(20_000);
    expect(MAX_IMPORT_ROWS_CEILING).toBe(100_000);
  });

  it('rejects non-integers and out-of-range values with a NAMED error naming the variable and the range', () => {
    for (const bad of ['0', '-1', '100001', '99999999', 'abc', '1.5', '1e3', '0x10', '12 34', '+5', '５００']) {
      const run = () => loadIngestLimits({ SCC_MAX_IMPORT_ROWS: bad });
      expect(run, bad).toThrow(IngestLimitsError);
      expect(run, bad).toThrow(`Invalid SCC_MAX_IMPORT_ROWS "${bad}": expected an integer between 1 and 100000.`);
    }
  });

  it('the error style matches the existing config errors', () => {
    let configMessage = '';
    try {
      loadConfig({ SCC_MAX_UPLOAD_BYTES: 'abc' }, []);
    } catch (e) {
      configMessage = (e as Error).message;
    }
    expect(configMessage).toBe('Invalid SCC_MAX_UPLOAD_BYTES "abc": expected an integer between 1024 and 10485760.');
    expect(() => loadIngestLimits({ SCC_MAX_IMPORT_ROWS: 'abc' })).toThrow(/^Invalid SCC_MAX_IMPORT_ROWS "abc": expected an integer between \d+ and \d+\.$/);
    expect(new IngestLimitsError('x')).toBeInstanceOf(Error);
  });

  it('warns at startup above 20,000 (not performance-validated) and never at or below it', () => {
    expect(loadIngestLimits({ SCC_MAX_IMPORT_ROWS: '20000' }).warnings).toEqual([]);
    expect(loadIngestLimits({ SCC_MAX_IMPORT_ROWS: '19999' }).warnings).toEqual([]);
    const w = loadIngestLimits({ SCC_MAX_IMPORT_ROWS: '20001' }).warnings;
    expect(w).toHaveLength(1);
    expect(w[0]).toContain('SCC_MAX_IMPORT_ROWS is 20001');
    expect(w[0]).toContain('not performance-validated');
    expect(loadIngestLimits({ SCC_MAX_IMPORT_ROWS: '100000' }).warnings).toHaveLength(1);
  });
});

describe('defaults are pinned: no production default was raised (criteria 29, 33)', () => {
  it('the effective defaults equal today\'s values', () => {
    expect(DEFAULT_INGEST_LIMITS).toEqual({ maxRows: 20_000, maxColumns: 50, maxErrorsReturned: 500, requestTimeoutMs: 30_000, defaultUploadBytes: 2_097_152, warnings: [] });
    expect(Object.isFrozen(DEFAULT_INGEST_LIMITS)).toBe(true);
    expect([MAX_IMPORT_ROWS, MAX_IMPORT_COLUMNS, MAX_ERRORS_RETURNED, DEFAULT_MAX_UPLOAD_BYTES]).toEqual([20_000, 50, 500, 2_097_152]);
  });

  it('the other limits are not configurable by this variable and the upload limit is unchanged', () => {
    const l = loadIngestLimits({ SCC_MAX_IMPORT_ROWS: '50000', SCC_MAX_UPLOAD_BYTES: '4096', PORT: '1' });
    expect(l).toMatchObject({ maxRows: 50_000, maxColumns: 50, maxErrorsReturned: 500, requestTimeoutMs: 30_000 });
    expect(loadConfig({}, []).maxUploadBytes).toBe(2_097_152);
    expect(loadConfig({ SCC_MAX_UPLOAD_BYTES: '4096' }, []).maxUploadBytes).toBe(4096);
    expect(loadConfig({ SCC_MAX_IMPORT_ROWS: '5' }, [])).toEqual(loadConfig({}, [])); // config.ts ignores it: AppConfig is untouched
  });

  it('config.ts and the AppConfig type are not modified or coupled to the new module', () => {
    const configSource = readFileSync(resolve(process.cwd(), 'src/server/config.ts'), 'utf8');
    expect(configSource).not.toContain('ingestLimits');
    expect(configSource).not.toContain('MAX_IMPORT_ROWS');
    const limitsSource = readFileSync(resolve(process.cwd(), 'src/server/ingestLimits.ts'), 'utf8');
    expect(limitsSource).not.toMatch(/from\s+['"]\.\/config['"]/);
    expect(Object.keys(loadConfig({}, [])).sort()).toEqual(['host', 'maxUploadBytes', 'mode', 'port', 'seed', 'todayOverride']);
  });
});

describe('the API honours the effective limits (criteria 30, 31, 37)', () => {
  let servers: Running[] = [];
  beforeEach(() => {
    servers = [];
  });
  afterEach(async () => {
    await Promise.all(servers.map((s) => s.close()));
  });
  const run = async (cfg: AppConfig, limits?: IngestLimits): Promise<Running> => {
    const s = await start(cfg, limits);
    servers.push(s);
    return s;
  };

  it('without ingestLimits the behaviour is today\'s: snapshot says 20,000 rows and 2 MiB, 20,000 rows import, 20,001 do not', async () => {
    const s = await run(config());
    expect(await snapshotLimits(s)).toEqual({ maxUploadBytes: 2_097_152, maxRows: 20_000 });
    expect((await post(s, rows(20_000))).status).toBe(200);
    const over = await post(s, rows(20_001));
    expect(over.status).toBe(422);
    const body = (await over.json()) as { errors: Array<{ code: string; message: string }>; totalErrors: number };
    expect(body.errors[0]).toMatchObject({ code: 'TOO_MANY_ROWS', message: 'The file has more than 20000 data rows.' });
    expect(body.totalErrors).toBe(1);
  });

  it('an explicit default limit is byte-identical to no limit at all', async () => {
    const a = await run(config());
    const b = await run(config(), loadIngestLimits({}));
    const bad = rows(3).replace('1.25', 'abc');
    for (const text of [rows(3), bad, rows(20_001), '', 'not a csv']) {
      const ra = await post(a, text);
      const rb = await post(b, text);
      expect(rb.status).toBe(ra.status);
      expect(await rb.text()).toBe(await ra.text());
    }
    expect(await snapshotLimits(b)).toEqual(await snapshotLimits(a));
  });

  it('a configured higher row limit is honoured by the import and reflected in snapshot.limits.maxRows', async () => {
    const s = await run(config(), loadIngestLimits({ SCC_MAX_IMPORT_ROWS: '30000' }));
    expect((await snapshotLimits(s)).maxRows).toBe(30_000);
    const ok = await post(s, rows(25_000));
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { rowCount: number }).rowCount).toBe(25_000);
    const over = await post(s, rows(30_001));
    expect(over.status).toBe(422);
    expect(((await over.json()) as { errors: Array<{ message: string }> }).errors[0]?.message).toBe('The file has more than 30000 data rows.');
  }, 60_000);

  it('a lower limit rejects with the existing wording, and the store is untouched', async () => {
    const s = await run(config(), loadIngestLimits({ SCC_MAX_IMPORT_ROWS: '5' }));
    expect((await snapshotLimits(s)).maxRows).toBe(5);
    expect((await post(s, rows(5))).status).toBe(200);
    const over = await post(s, rows(6));
    expect(over.status).toBe(422);
    const body = (await over.json()) as { error: { code: string; message: string }; errors: Array<{ code: string; message: string }> };
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.errors[0]).toEqual({ line: null, column: null, code: 'TOO_MANY_ROWS', message: 'The file has more than 5 data rows.' });
    const after = (await (await fetch(`${s.url}/api/snapshot`)).json()) as { inventory: unknown[] };
    expect(after.inventory).toHaveLength(5); // the failed import changed nothing: the previous 5-row import is still there
  });

  it('the source-size layer and the row layer stay separate', async () => {
    // a huge row limit does not raise the byte limit ...
    const small = await run(config({ maxUploadBytes: 1024 }), loadIngestLimits({ SCC_MAX_IMPORT_ROWS: '100000' }));
    const tooBig = await post(small, rows(100));
    expect(tooBig.status).toBe(413);
    const text = await tooBig.text();
    // ... and the 413 is exactly what a server without ingestLimits says for the same upload
    const plain = await run(config({ maxUploadBytes: 1024 }));
    const plainResponse = await post(plain, rows(100));
    expect(plainResponse.status).toBe(413);
    expect(await plainResponse.text()).toBe(text);
    // a tiny row limit does not lower the byte limit: bytes are checked first, rows only after the body is accepted
    const rowsOnly = await run(config(), loadIngestLimits({ SCC_MAX_IMPORT_ROWS: '2' }));
    expect((await post(rowsOnly, rows(3))).status).toBe(422);
    expect((await post(rowsOnly, rows(2))).status).toBe(200);
    expect((await snapshotLimits(rowsOnly)).maxUploadBytes).toBe(2_097_152);
  });

  it('the client-visible limit texts and snapshot limit fields are unchanged', async () => {
    const s = await run(config(), loadIngestLimits({ SCC_MAX_IMPORT_ROWS: '20000' }));
    const limits = await snapshotLimits(s);
    expect(Object.keys(limits).sort()).toEqual(['maxRows', 'maxUploadBytes']);
    const oversize = await post(await run(config({ maxUploadBytes: 1024 })), rows(100));
    const err = ((await oversize.json()) as { error: { code: string; message: string } }).error;
    expect(err.code).toBe('FILE_TOO_LARGE');
    expect(err.message.length).toBeGreaterThan(0);
  });

  it('the column limit is still 50 and the error list still 500 (defaults of the importers are unchanged)', async () => {
    const s = await run(config(), loadIngestLimits({ SCC_MAX_IMPORT_ROWS: '1000' }));
    const wide = `${Array.from({ length: 51 }, (_, i) => `c${i}`).join(',')}\n${Array.from({ length: 51 }, () => '1').join(',')}\n`;
    const r = await post(s, wide);
    expect(((await r.json()) as { errors: Array<{ message: string }> }).errors[0]?.message).toBe('Line 1 has more than 50 columns.');
    const bad = `${HEAD}\n${Array.from({ length: 700 }, (_, i) => `S-${100000 + i},Item,Cat,WH-DFW,x,1,1.25`).join('\n')}\n`;
    const r2 = await post(s, bad);
    const body = (await r2.json()) as { errors: unknown[]; totalErrors: number };
    expect(body.errors).toHaveLength(500);
    expect(body.totalErrors).toBe(700);
  });
});
