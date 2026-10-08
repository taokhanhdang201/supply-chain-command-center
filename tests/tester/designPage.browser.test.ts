// The design reference (#/_design) exists in development builds only. Against the production build
// (dist/client): the hash reads as "Page not found", and no built file carries the page's code or its stylesheet.
// OPT-IN: the `*.browser.test.ts` suffix is excluded from the default `npm test` (vitest.config.ts). Run it with
//   npm run build && SCC_PW_DIR=<dir with playwright> npm run test:browser
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

const PW_DIR = process.env.SCC_PW_DIR ? path.resolve(process.env.SCC_PW_DIR) : process.cwd();
const CHROME = process.env.SCC_CHROME || undefined;
const TODAY = '2026-09-28';
/** Strings only the design page has: its class prefix (DesignPage.tsx and design.css) and its h1. */
const MARKERS = ['design-sheet', 'Design system'];

describe('#/_design is development only (production build, real Chromium)', () => {
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
    let chromium: any;
    try {
      chromium = createRequire(path.join(PW_DIR, 'noop.js'))('playwright').chromium;
    } catch {
      throw new Error(`Playwright not found from ${PW_DIR}. Set SCC_PW_DIR to a directory that already has the playwright package.`);
    }
    browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    server?.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  });

  it('the design page really carries the markers, so their absence below means something', () => {
    const source = fs.readFileSync(path.resolve('src/client/pages/DesignPage.tsx'), 'utf8') + fs.readFileSync(path.resolve('src/client/styles/design.css'), 'utf8');
    for (const m of MARKERS) expect(source, m).toContain(m);
  });

  it('no file of the production build carries the design page or its stylesheet', () => {
    const root = path.resolve('dist/client');
    const files = fs.readdirSync(root, { recursive: true, encoding: 'utf8' }).filter((f) => /\.(js|css|html)$/.test(f));
    expect(files.some((f) => f.endsWith('.js')) && files.some((f) => f.endsWith('.css'))).toBe(true);
    const found = files.flatMap((f) => {
      const t = fs.readFileSync(path.join(root, f), 'utf8');
      return MARKERS.filter((m) => t.includes(m)).map((m) => `${f}: ${m}`);
    });
    expect(found).toEqual([]);
  });

  it('#/_design reads as "Page not found" in the production build', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e: any) => errors.push(String(e)));
    await page.goto(`${base}/#/_design`);
    await page.waitForSelector('main h1');
    expect(await page.locator('main h1').allTextContents()).toEqual(['Page not found']);
    expect(await page.locator('.design-sheet').count()).toBe(0);
    expect(errors).toEqual([]);
    await ctx.close();
  });

  // The dev page answers any hash that starts with #/_design (AppLayout); in production none of them is a page.
  it.each(['#/_design?x=1', '#/_designer'])('%s reads as "Page not found" in the production build too', async (hash) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(`${base}/${hash}`);
    await page.waitForSelector('main h1');
    expect(await page.locator('main h1').allTextContents()).toEqual(['Page not found']);
    expect(await page.locator('.design-sheet').count()).toBe(0);
    await ctx.close();
  });
});
