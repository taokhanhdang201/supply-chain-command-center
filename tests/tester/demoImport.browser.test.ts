// Demo import, end to end in real Chromium against the real server (its own seed-42 store, since importing changes
// the data): "Try a sample" takes the shipments and the inventory samples through Columns and Preview to a successful
// import, and the figures on the Dashboard, Shipments, Routes, Alerts and Inventory change; the sample with errors is
// blocked with its problems grouped by column; at 390px nothing scrolls sideways; "Restore sample data" asks first and
// brings both datasets back to seed 42.
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

describe('demo import with the samples (real Chromium, real server)', () => {
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

  /** What a page leads with: its stage figures (the Dashboard: its hero). */
  const lead = async (page: any, hash: string): Promise<string> => {
    await page.goto(`${base}/#/${hash}`);
    await page.waitForTimeout(600);
    const sel = hash === '' ? '.hero' : '.figure-stage';
    return ((await page.locator(sel).first().innerText()) as string).replace(/\s+/g, ' ');
  };

  const trySample = async (page: any, name: RegExp) => {
    await page.getByText('Try a sample').click();
    await page.getByRole('button', { name }).click();
    await page.waitForFunction(() => document.querySelector('.ingest-headline') !== null && document.querySelector('[data-ingest-card]')?.getAttribute('aria-busy') === 'false');
  };

  const PAGES = ['', 'shipments', 'routes', 'alerts', 'inventory'] as const;

  it('imports the shipments and then the inventory sample in a few clicks, and every page changes', async () => {
    const { ctx, page } = await open(1440, 'import');
    const before: Record<string, string> = {};
    for (const p of PAGES) before[p] = await lead(page, p);

    await page.goto(`${base}/#/import`);
    await trySample(page, /^Shipments sample/);
    expect(await page.locator('[aria-current="step"]').textContent()).toBe('Preview');
    expect(await page.getByText('All 9 columns matched.').count()).toBe(1);
    expect(await page.locator('.ingest-headline').textContent()).toBe(`${SEED7.shipments.length} rows · 0 errors · replaces 480 current shipments`);
    const ship = page.getByRole('button', { name: `Import ${SEED7.shipments.length} shipments` });
    expect(await ship.isEnabled()).toBe(true);
    await ship.click();
    await page.getByText(/All views are updated\./).waitFor();
    expect(await page.locator('[aria-current="step"]').textContent()).toBe('Import');
    expect(await page.getByRole('link', { name: 'View shipments' }).getAttribute('href')).toBe('#/shipments');

    await trySample(page, /^Inventory sample/);
    await page.getByRole('button', { name: `Import ${SEED7.inventory.length} inventory items` }).click();
    await page.getByText(/All views are updated\./).waitFor();
    expect(await page.getByRole('link', { name: 'View inventory' }).getAttribute('href')).toBe('#/inventory');

    for (const p of PAGES) expect(await lead(page, p), `#/${p} after the sample imports`).not.toBe(before[p]);
    await page.goto(`${base}/#/import`);
    await page.waitForTimeout(400);
    const sources = ((await page.locator('.import-sources').innerText()) as string).replace(/\s+/g, ' ');
    expect(sources).toMatch(/360 Inventory rows Sample data \(seed 7\)/);
    expect(sources).toMatch(/480 Shipment rows Sample data \(seed 7\)/);
    await ctx.close();
  });

  it('the sample with errors is blocked: the Import button is locked and the problems are grouped by column', async () => {
    const { ctx, page } = await open(1440, 'import');
    await trySample(page, /^Sample with errors/);
    expect(await page.locator('.ingest-headline').textContent()).toMatch(/^20 rows · 7 errors · /);
    expect(await page.getByRole('button', { name: 'Import 20 shipments' }).isDisabled()).toBe(true);
    const groups = await page.locator('.ingest-error-groups__where').allTextContents();
    expect(groups).toEqual(['ship_date: 3 rows, lines 5, 10, 16', 'shipment_id: 2 rows, lines 7, 13', 'shipping_cost: 2 rows, lines 12, 19']);
    expect(await page.locator('.ingest-error-groups').evaluate((e: Element) => e.closest('.banner')?.className)).toContain('banner--critical');
    await ctx.close();
  });

  it('at 390px the drop area is a "Choose CSV file" button, the sample menu fits, and nothing scrolls sideways', async () => {
    const { ctx, page } = await open(390, 'import');
    const sideways = () =>
      page.evaluate(() => ({
        page: document.documentElement.scrollWidth - window.innerWidth,
        inner: [...document.querySelectorAll('.page *')]
          .filter((e) => e.scrollWidth > e.clientWidth + 1 && !['visible', 'hidden', 'clip'].includes(getComputedStyle(e).overflowX))
          .map((e) => String((e as HTMLElement).className))
      }));
    expect(((await page.locator('.ingest-card .dropzone').innerText()) as string).trim()).toBe('Choose CSV file');
    await page.getByText('Try a sample').click();
    const box = await page.getByRole('button', { name: /^Shipments sample/ }).boundingBox();
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    await page.getByText('Try a sample').click();
    for (const name of [/^Shipments sample/, /^Sample with errors/]) {
      await trySample(page, name);
      const m = await sideways();
      expect(m.page, String(name)).toBeLessThanOrEqual(0);
      expect(m.inner, String(name)).toEqual([]);
    }
    await ctx.close();
  });

  it('"Restore sample data" asks first, then brings both datasets back to seed 42', async () => {
    const { ctx, page } = await open(1440, 'import');
    await page.getByRole('button', { name: 'Restore sample data' }).click();
    expect(await page.getByText(/Sample data \(seed 7\)/).count()).toBeGreaterThan(0); // nothing changed yet
    await page.getByRole('button', { name: 'Replace data' }).click();
    await page.getByText('Sample data restored.').waitFor();
    const sources = ((await page.locator('.import-sources').innerText()) as string).replace(/\s+/g, ' ');
    expect(sources).toMatch(/360 Inventory rows Sample data \(seed 42\)/);
    expect(sources).toMatch(/480 Shipment rows Sample data \(seed 42\)/);
    await ctx.close();
  });
});
