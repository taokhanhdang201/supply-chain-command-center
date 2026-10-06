/**
 * Regression: shipments_test_v2.csv (SCC test dataset v2) and ISO dates.
 *
 * Reported symptom on Windows: "ISO dates such as 2026-08-15 are turned into 8/15/2026 before validation,
 * causing 145 date validation errors".
 *
 * Investigation: nothing in the import pipeline rewrites dates. The browser posts the raw File bytes
 * (apiClient.importCsv -> `body: file`), the server decodes them as UTF-8 and parses with parseCsv, and
 * parseDate only matches /^\d{4}-\d{2}-\d{2}$/. The 8/15/2026 values were already inside the file on disk:
 * it had been opened and re-saved by Excel, which rewrites YYYY-MM-DD cells in the Windows locale format
 * (the dataset's own README_TEST_DATA.txt warns about exactly this). 50 rows x 3 date columns minus 5
 * empty actual_delivery cells = the 145 reported errors.
 *
 * These tests pin both halves of that down with the user's real file:
 *  - fixtures/import/shipments_test_v2.iso.csv            the dataset as intended (YYYY-MM-DD, CRLF)
 *  - fixtures/import/shipments_test_v2.excel-resaved.csv  the exact bytes that produced the 145 errors
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { importShipmentsCsv } from '../../src/shared/csv/importShipments';
import { createAppServer } from '../../src/server/app';
import { createApiHandler } from '../../src/server/api';
import { createDataStore } from '../../src/server/store';
import type { AppConfig } from '../../src/server/config';
import { createSampleDataset } from '../../src/shared/sample/generateSampleData';

const TODAY = '2026-09-28';
const FIXTURES = path.resolve('tests/fixtures/import');
const isoBytes = fs.readFileSync(path.join(FIXTURES, 'shipments_test_v2.iso.csv'));
const excelBytes = fs.readFileSync(path.join(FIXTURES, 'shipments_test_v2.excel-resaved.csv'));
const isoText = isoBytes.toString('utf-8');
const excelText = excelBytes.toString('utf-8');

/** The date cells exactly as written in the ISO file: shipmentId -> [ship, estimated, actual]. */
function expectedDatesFromFile(text: string): Map<string, [string, string, string]> {
  const map = new Map<string, [string, string, string]>();
  for (const line of text.split(/\r?\n/).slice(1)) {
    if (line.trim() === '') continue;
    const id = line.slice(0, line.indexOf(','));
    const dates = line.match(/,(\d{4}-\d{2}-\d{2}),(\d{4}-\d{2}-\d{2}),(\d{4}-\d{2}-\d{2})?,/);
    if (!dates) throw new Error(`fixture line without ISO dates: ${line}`);
    map.set(id, [dates[1] ?? '', dates[2] ?? '', dates[3] ?? '']);
  }
  return map;
}

describe('shipments_test_v2.csv: YYYY-MM-DD dates survive import unchanged', () => {
  it('fixture sanity: ISO file uses CRLF, has 50 rows and no M/D/YYYY values', () => {
    expect(isoText.includes('\r\n')).toBe(true);
    expect(expectedDatesFromFile(isoText).size).toBe(50);
    expect(isoText).not.toMatch(/\d{1,2}\/\d{1,2}\/\d{4}/);
  });

  it('importShipmentsCsv accepts the ISO file with zero errors and keeps every date string identical', () => {
    const result = importShipmentsCsv(isoText);
    if (!result.ok) throw new Error(`unexpected errors: ${JSON.stringify(result.errors.slice(0, 5))}`);
    expect(result.rows).toHaveLength(50);
    const expected = expectedDatesFromFile(isoText);
    for (const row of result.rows) {
      const [ship, est, actual] = expected.get(row.shipmentId)!;
      expect(row.shipDate).toBe(ship);
      expect(row.estimatedDelivery).toBe(est);
      expect(row.actualDelivery).toBe(actual === '' ? null : actual);
    }
    expect(result.rows.find((r) => r.shipmentId === 'SHP-000001')).toMatchObject({
      shipDate: '2026-08-15',
      estimatedDelivery: '2026-08-18',
      actualDelivery: '2026-08-18'
    });
  });

  it('the Excel-re-saved bytes are what produce the 145 date errors (the dates are M/D/YYYY in the file itself)', () => {
    expect(excelText).toContain('8/15/2026');
    expect(excelText).not.toMatch(/\b\d{4}-\d{2}-\d{2}\b/);
    const result = importShipmentsCsv(excelText);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.totalErrors).toBe(145);
    expect(result.errors.every((e) => e.code === 'INVALID_DATE')).toBe(true);
    expect(result.errors[0]?.message).toBe(
      '"8/15/2026" looks like Excel changed this date to M/D/YYYY. Dates must be YYYY-MM-DD, e.g. 2026-08-15. ' +
        'Re-download the file and upload it without opening it in Excel.'
    );
    expect(result.errors.every((e) => e.message.includes('looks like Excel changed this date'))).toBe(true);
  });
});

describe('shipments_test_v2.csv over HTTP (same path the Import page uses)', () => {
  let url = '';
  let close: () => Promise<void> = async () => {};

  beforeAll(async () => {
    const config: AppConfig = {
      port: 0,
      host: '127.0.0.1',
      seed: 42,
      todayOverride: TODAY,
      maxUploadBytes: 2_097_152,
      mode: 'test'
    };
    const makeSample = () => createSampleDataset(42, TODAY, '2026-09-28T00:00:00.000Z');
    const api = createApiHandler({
      config,
      store: createDataStore(makeSample()),
      getToday: () => TODAY,
      createSampleDataset: makeSample,
      now: () => new Date('2026-09-28T12:00:00.000Z')
    });
    const server = createAppServer({ config, api });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    close = () => new Promise<void>((resolve) => server.close(() => resolve()));
  });

  afterAll(async () => {
    await close();
  });

  it('POSTing the raw ISO file bytes returns 200 and the snapshot holds the exact YYYY-MM-DD strings', async () => {
    const res = await fetch(`${url}/api/import/shipments`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/csv', 'X-SCC-Request': '1', 'X-SCC-Filename': 'shipments_test_v2.csv' },
      body: new Blob([isoBytes], { type: 'text/csv' })
    });
    expect(res.status).toBe(200);

    const snapshot = await (await fetch(`${url}/api/snapshot`)).json();
    expect(snapshot.shipments).toHaveLength(50);
    const expected = expectedDatesFromFile(isoText);
    for (const s of snapshot.shipments as Array<Record<string, unknown>>) {
      const [ship, est, actual] = expected.get(s.shipmentId as string)!;
      expect(s.shipDate).toBe(ship);
      expect(s.estimatedDelivery).toBe(est);
      expect(s.actualDelivery).toBe(actual === '' ? null : actual);
    }
  });

  it('POSTing the Excel-re-saved bytes returns 422 with 145 INVALID_DATE errors and changes nothing', async () => {
    const before = await (await fetch(`${url}/api/snapshot`)).json();
    const res = await fetch(`${url}/api/import/shipments`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/csv', 'X-SCC-Request': '1' },
      body: new Blob([excelBytes], { type: 'text/csv' })
    });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.totalErrors).toBe(145);
    expect((body.errors as Array<{ code: string }>).every((e) => e.code === 'INVALID_DATE')).toBe(true);
    const after = await (await fetch(`${url}/api/snapshot`)).json();
    expect(after.shipments).toEqual(before.shipments);
  });
});
