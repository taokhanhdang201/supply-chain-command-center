// V1.5 tester (round 2): real-browser focus check after a FAILED mapped import (V15-R2-BUG-1). jsdom does not blur a
// button that becomes disabled, so this needs a real browser.
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
import { DEFAULT_INGEST_LIMITS } from '../../src/server/ingestLimits';
import { createStaticHandler } from '../../src/server/staticFiles';
import { createSampleDataset } from '../../src/shared/sample/generateSampleData';

const PW_DIR = process.env.SCC_PW_DIR ? path.resolve(process.env.SCC_PW_DIR) : process.cwd();
const CHROME = process.env.SCC_CHROME || undefined;

describe('Focus after a failed mapped import (real Chromium)', () => {
  let server: ReturnType<typeof createAppServer>;
  let base = '';
  let browser: any;

  beforeAll(async () => {
    expect(fs.existsSync(path.resolve('dist/client/index.html')), 'run `npm run build` first').toBe(true);
    if (CHROME !== undefined) expect(fs.existsSync(CHROME), `SCC_CHROME does not exist: ${CHROME}`).toBe(true);
    const config = { port: 0, host: '127.0.0.1', seed: 42, todayOverride: '2026-06-15', maxUploadBytes: 2_097_152, mode: 'test' as const };
    const make = () => createSampleDataset(42, '2026-06-15', '2026-06-15T00:00:00.000Z');
    // maxRows 3 (below the fixture's 4 rows): the client preview uses the default limit and passes, so only the server
    // rejects after Confirm. (V2 sends non-UTF-8 files to the universal card before this panel, so invalid UTF-8 no longer works.)
    const api = createApiHandler({ config, store: createDataStore(make()), getToday: () => '2026-06-15', createSampleDataset: make, ingestLimits: { ...DEFAULT_INGEST_LIMITS, maxRows: 3 } });
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

  it('after a server-side rejection (row limit the browser preview does not apply) the panel stays open and keyboard focus is not lost to <body>', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(`${base}/#/import`);
    // the per-kind cards are in the Column guide (closed by default); the Inventory tab is selected
    await page.getByText('Column guide').click();
    await page.getByLabel('Choose inventory CSV file').setInputFiles(path.resolve('tests/fixtures/import/inventory_alt_schema.csv'));
    await page.getByRole('button', { name: 'Import', exact: true }).first().click();
    await page.getByRole('heading', { name: /Map columns for/ }).waitFor();
    const confirm = page.getByRole('button', { name: 'Confirm and import' });
    await confirm.focus();
    await page.keyboard.press('Enter');
    await page.locator('.banner--critical').first().waitFor();
    expect(await page.locator('.mapping-panel').count()).toBe(1);
    const tag = await page.evaluate(() => document.activeElement?.tagName);
    await ctx.close();
    expect(tag).not.toBe('BODY');
  });
});
