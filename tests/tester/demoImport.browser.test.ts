// Demo import, end to end in real Chromium against the real server (its own seed-42 store, since importing changes
// the data). G1: "No file? Try one." takes the carrier export through its one question to the import in three clicks and
// the figures on the Dashboard, Shipments, Routes, Alerts change; Undo brings them back; the inventory file under More
// changes Inventory; the file with errors stops at "has errors" with its problems grouped by column; at 390px nothing
// scrolls sideways in any state; "Restore sample data" asks first and brings both datasets back to seed 42.
// (Before G1 this file drove the "Try a sample" menu, the step bar and the stage figures, all replaced by the states.)
// OPT-IN (`*.browser.test.ts`). Run: npm run build && npm run test:browser
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createAppServer } from '../../src/server/app';
import { createApiHandler } from '../../src/server/api';
import { createDataStore } from '../../src/server/store';
import { createStaticHandler } from '../../src/server/staticFiles';
import { createSampleDataset, generateSampleData } from '../../src/shared/sample/generateSampleData';

const PW_DIR = process.env.SCC_PW_DIR ? path.resolve(process.env.SCC_PW_DIR) : process.cwd();
const CHROME = process.env.SCC_CHROME || undefined;
const TODAY = '2026-06-15';
const SEED7 = generateSampleData({ seed: 7, today: TODAY });

describe('demo import (real Chromium, real server)', () => {
  let server: ReturnType<typeof createAppServer>;
  let base = '';
  let browser: any;

  beforeAll(async () => {
    expect(fs.existsSync(path.resolve('dist/client/index.html')), 'run `npm run build` first').toBe(true);
    const config = { port: 0, host: '127.0.0.1', seed: 42, todayOverride: TODAY, maxUploadBytes: 2_097_152, mode: 'test' as const };
    const make = () => createSampleDataset(42, TODAY, `${TODAY}T00:00:00.000Z`);
    const api = createApiHandler({ config, store: createDataStore(make()), getToday: () => TODAY, createSampleDataset: make });
    const staticHandler = createStaticHandler(path.resolve('dist/client'));
    server = createAppServer({ config, api, fallback: (req, res, p) => staticHandler(req, res, p) });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const { chromium } = createRequire(path.join(PW_DIR, 'noop.js'))('playwright');
    browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    server?.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  });

  const open = async (w: number, hash: string) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: w < 500 ? 844 : 900 }, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await page.goto(`${base}/#/${hash}`);
    await page.waitForTimeout(400);
    return { ctx, page };
  };

  /** What a page leads with: its stage figures (the Dashboard: its hero). `reload` reads the server afresh (a second tab
   *  that only changes the hash keeps the snapshot it loaded). */
  const lead = async (page: any, hash: string, reload = false): Promise<string> => {
    await page.goto(`${base}/#/${hash}`);
    if (reload) await page.reload();
    await page.waitForTimeout(600);
    const sel = hash === '' ? '.hero' : '.figure-stage';
    return ((await page.locator(sel).first().innerText()) as string).replace(/\s+/g, ' ');
  };

  const idle = (page: any) => page.waitForFunction(() => document.querySelector('[data-ingest-card]')?.getAttribute('aria-busy') === 'false');
  const heading = async (page: any, name: string) => {
    await page.getByRole('heading', { name, exact: true }).waitFor();
    await idle(page);
  };
  const openMore = async (page: any) => {
    if (!(await page.locator('.ingest-more').evaluate((d: HTMLDetailsElement) => d.open))) await page.locator('.ingest-more > summary').click();
  };

  /** Clicks 1 and 2: the demo file and its one question; ends on "Ready". */
  const tryOne = async (page: any) => {
    await page.getByRole('button', { name: 'No file? Try one.' }).click();
    await heading(page, 'What does “Arrived” mean?');
    await page.getByRole('button', { name: 'In transit', exact: true }).click();
    await heading(page, `${SEED7.shipments.length} shipments. Ready.`);
  };

  const SHIPMENT_PAGES = ['', 'shipments', 'routes', 'alerts'] as const;

  it('three clicks import the carrier export and the Dashboard changes; Undo brings it back', async () => {
    const { ctx, page } = await open(1440, 'import');
    const other = await ctx.newPage();
    const before: Record<string, string> = {};
    for (const p of SHIPMENT_PAGES) before[p] = await lead(other, p, true);

    await tryOne(page);
    await page.getByRole('button', { name: 'Use this data' }).click();
    await heading(page, 'Done. Dashboard updated.');
    expect(await page.getByText(`${SEED7.shipments.length} shipments from carrier-export.csv.`).count()).toBe(1);
    for (const p of SHIPMENT_PAGES) expect(await lead(other, p, true), `#/${p} after the import`).not.toBe(before[p]);

    await page.getByRole('button', { name: 'Undo' }).click();
    await heading(page, 'Undone. The data is back as it was.');
    for (const p of SHIPMENT_PAGES) expect(await lead(other, p, true), `#/${p} after Undo`).toBe(before[p]);
    await ctx.close();
  });

  it('the carrier export and the inventory file under More change every page; the top bar names the new sources', async () => {
    const { ctx, page } = await open(1440, 'import');
    const before: Record<string, string> = {};
    for (const p of [...SHIPMENT_PAGES, 'inventory']) before[p] = await lead(page, p);

    await page.goto(`${base}/#/import`);
    await tryOne(page);
    await page.getByRole('button', { name: 'Use this data' }).click();
    await heading(page, 'Done. Dashboard updated.');
    await openMore(page);
    await page.getByRole('button', { name: 'Try an inventory file' }).click();
    await heading(page, `${SEED7.inventory.length} inventory items. Ready.`);
    await page.getByRole('button', { name: 'Use this data' }).click();
    await heading(page, 'Done. Dashboard updated.');

    for (const p of [...SHIPMENT_PAGES, 'inventory']) expect(await lead(page, p), `#/${p} after the imports`).not.toBe(before[p]);
    expect(await page.locator('.topbar__chip').allTextContents()).toEqual(['Inventory: Sample data (seed 7)', 'Shipments: carrier-export.csv']);
    await ctx.close();
  });

  it('the file with errors stops at "has errors", in red, with the problems grouped by column behind "See every problem"', async () => {
    const { ctx, page } = await open(1440, 'import');
    await openMore(page);
    await page.getByRole('button', { name: 'Try a file with errors' }).click();
    await heading(page, '7 rows need fixing.');
    expect(await page.getByText('Lines 5, 7, 10 and 4 more. Nothing was imported.').count()).toBe(1);
    const colors = await page.evaluate(() => {
      const probe = document.createElement('div');
      probe.style.color = 'var(--critical)';
      document.body.append(probe);
      const critical = getComputedStyle(probe).color;
      probe.remove();
      return { critical, border: getComputedStyle(document.querySelector('.ingest-state') as Element).borderLeftColor };
    });
    expect(colors.border).toBe(colors.critical);
    await page.getByText('See every problem').click();
    const groups = await page.locator('.ingest-error-groups__where').allTextContents();
    expect(groups).toEqual(['ship_date: 3 rows, lines 5, 10, 16', 'shipment_id: 2 rows, lines 7, 13', 'shipping_cost: 2 rows, lines 12, 19']);
    expect(await page.getByRole('button', { name: 'Import 20 shipments' }).isDisabled()).toBe(true);
    await ctx.close();
  });

  it('at 390px the waiting state, More, the question, Ready with its details and "has errors" fit, and nothing scrolls sideways', async () => {
    const { ctx, page } = await open(390, 'import');
    const sideways = () =>
      page.evaluate(() => ({
        page: document.documentElement.scrollWidth - window.innerWidth,
        inner: [...document.querySelectorAll('.page *')]
          .filter((e) => e.scrollWidth > e.clientWidth + 1 && !['visible', 'hidden', 'clip'].includes(getComputedStyle(e).overflowX))
          .map((e) => String((e as HTMLElement).className))
      }));
    const fits = async (label: string) => {
      const m = await sideways();
      expect(m.page, label).toBeLessThanOrEqual(0);
      expect(m.inner, label).toEqual([]);
    };
    const drop = ((await page.locator('.ingest-drop').innerText()) as string).replace(/\s+/g, ' ').trim();
    expect(drop).toBe('Drop your file CSV, TSV, TXT or GZ file. Up to 2 MB. Choose a file');
    await fits('waiting');
    await openMore(page);
    const box = await page.getByRole('button', { name: 'Try a file with errors' }).boundingBox();
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    await fits('More open');
    await page.locator('.ingest-more > summary').click();

    await page.getByRole('button', { name: 'No file? Try one.' }).click();
    await heading(page, 'What does “Arrived” mean?');
    await fits('question');
    await page.getByRole('button', { name: 'In transit', exact: true }).click();
    await heading(page, `${SEED7.shipments.length} shipments. Ready.`);
    await fits('ready');
    await page.locator('#ingest-details > summary').click();
    await fits('ready, details open');

    await openMore(page);
    await page.getByRole('button', { name: 'Try a file with errors' }).click();
    await heading(page, '7 rows need fixing.');
    await fits('has errors');
    await ctx.close();
  });

  it('"Restore sample data" asks first, then brings both datasets back to seed 42', async () => {
    const { ctx, page } = await open(1440, 'import');
    await openMore(page);
    await page.getByRole('button', { name: 'Restore sample data' }).click();
    expect(await page.locator('.topbar__chip').allTextContents()).toEqual(['Inventory: Sample data (seed 7)', 'Shipments: carrier-export.csv']); // nothing changed yet
    await page.getByRole('button', { name: 'Replace data' }).click();
    await page.getByText('Sample data restored.').waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll('.topbar__chip')].every((c) => /seed 42/.test(c.textContent ?? '')));
    expect(await page.locator('.topbar__chip').allTextContents()).toEqual(['Inventory: Sample data (seed 42)', 'Shipments: Sample data (seed 42)']);
    await ctx.close();
  });
});
