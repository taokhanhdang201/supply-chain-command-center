// V1.5 tester: real-browser layout regression for the Import page while a mapping panel is open (V15-BUG-1 / R-1).
// jsdom cannot lay out CSS grid, so this drives real Chromium through Playwright against the built app (dist/client).
// OPT-IN: the `*.browser.test.ts` suffix is excluded from the default `npm test` (vitest.config.ts). Run it with
//   npm run build && npm run test:browser
// Environment (no machine-specific paths are hard-coded):
//   SCC_PW_DIR  directory to resolve the `playwright` package from (default: this repo's node_modules, then normal resolution)
//   SCC_CHROME  path to a Chromium/Chrome executable (default: the browser Playwright itself installed, PLAYWRIGHT_BROWSERS_PATH honoured)
// If Playwright, the browser or dist/client is missing, the suite FAILS with an explanatory message (it is opt-in, so a
// missing prerequisite must not look like a pass).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createAppServer } from '../../src/server/app';
import { createApiHandler } from '../../src/server/api';
import { createDataStore } from '../../src/server/store';
import { createStaticHandler } from '../../src/server/staticFiles';
import { createSampleDataset } from '../../src/shared/sample/generateSampleData';
import { INV_ALT, SHP_ALT } from './v15.helpers';

const PW_DIR = process.env.SCC_PW_DIR ? path.resolve(process.env.SCC_PW_DIR) : process.cwd();
const CHROME = process.env.SCC_CHROME || undefined;

describe('Import page layout with a mapping panel open (real Chromium)', () => {
  let server: ReturnType<typeof createAppServer>;
  let base = '';
  let browser: any;

  beforeAll(async () => {
    expect(fs.existsSync(path.resolve('dist/client/index.html')), 'run `npm run build` first').toBe(true);
    if (CHROME !== undefined) expect(fs.existsSync(CHROME), `SCC_CHROME does not exist: ${CHROME}`).toBe(true);
    const config = { port: 0, host: '127.0.0.1', seed: 42, todayOverride: '2026-06-15', maxUploadBytes: 2_097_152, mode: 'test' as const };
    const make = () => createSampleDataset(42, '2026-06-15', '2026-06-15T00:00:00.000Z');
    const api = createApiHandler({ config, store: createDataStore(make()), getToday: () => '2026-06-15', createSampleDataset: make });
    const staticHandler = createStaticHandler(path.resolve('dist/client'));
    server = createAppServer({ config, api, fallback: (req, res, p) => staticHandler(req, res, p) });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    let chromium: any;
    try {
      chromium = createRequire(path.join(PW_DIR, 'noop.js'))('playwright').chromium;
    } catch {
      throw new Error(`Playwright not found from ${PW_DIR}. Install it (npm i --no-save playwright) or set SCC_PW_DIR to a directory that has it.`);
    }
    browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    server?.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  });

  // Demo layout: the two per-kind cards live in the tabs of the "Column guide" (closed by default), one card per tab.
  async function openGuideTab(page: any, kind: 'inventory' | 'shipments') {
    const guide = page.locator('.column-guide');
    if (!(await guide.evaluate((d: HTMLDetailsElement) => d.open))) await page.getByText('Column guide').click();
    await page.getByRole('tab', { name: kind === 'inventory' ? 'Inventory' : 'Shipments' }).click();
  }

  const cardWidths = (page: any) =>
    page.evaluate(() =>
      [...document.querySelectorAll('.column-guide [role="tabpanel"] > .card')].map((c) => {
        const r = c.getBoundingClientRect();
        return { title: c.querySelector('h2')?.textContent, width: Math.round(r.width), container: Math.round((document.querySelector('.column-guide') as HTMLElement).getBoundingClientRect().width) };
      })
    ) as Promise<{ title?: string | null; width: number; container: number }[]>;

  async function openPanel(kind: 'inventory' | 'shipments', width: number) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(`${base}/#/import`);
    await openGuideTab(page, kind);
    const csv = kind === 'inventory' ? INV_ALT : SHP_ALT;
    await page.getByLabel(`Choose ${kind} CSV file`).setInputFiles({ name: `${kind}.csv`, mimeType: 'text/csv', buffer: Buffer.from(csv) });
    // the hidden tab's card is out of the accessibility tree, so the one visible "Import" is this card's
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    await page.getByRole('heading', { name: /Map columns for/ }).waitFor();
    const cards = await cardWidths(page);
    await ctx.close();
    return cards;
  }

  it.each(['inventory', 'shipments'] as const)('1440px: with the %s mapping panel open, its card keeps the full guide width (never squeezed into a narrow column)', async (kind) => {
    const cards = await openPanel(kind, 1440);
    const card = cards.find((c) => c.title === (kind === 'inventory' ? 'Inventory' : 'Shipments'))!;
    // V1 asked for at least half of a two-card row; in a tab the card has the whole width to itself.
    expect(card.width, JSON.stringify(cards)).toBeGreaterThanOrEqual(card.container - 20);
  });

  it('1440px: with no panel open each tab shows its card at the full guide width', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(`${base}/#/import`);
    await openGuideTab(page, 'inventory');
    const inventory = (await cardWidths(page)).find((c) => c.title === 'Inventory')!;
    await openGuideTab(page, 'shipments');
    const shipments = (await cardWidths(page)).find((c) => c.title === 'Shipments')!;
    await ctx.close();
    expect(inventory.width).toBeGreaterThan(500);
    expect(shipments.width).toBeGreaterThan(500);
  });
});
