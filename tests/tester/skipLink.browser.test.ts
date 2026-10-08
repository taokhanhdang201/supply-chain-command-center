// Skip link: activating it must focus the page's h1 and leave the route alone. It used to write `#main`
// to the hash, which the router read as a route, so the page turned into "Page not found". jsdom has no real focus or
// hash navigation, so this drives real Chromium through Playwright against the built app (dist/client).
// OPT-IN: the `*.browser.test.ts` suffix is excluded from the default `npm test` (vitest.config.ts). Run it with
//   npm run build && npm run test:browser
// Environment (no machine-specific paths are hard-coded):
//   SCC_PW_DIR  directory to resolve the `playwright` package from (default: this repo's node_modules, then normal resolution)
//   SCC_CHROME  path to a Chromium/Chrome executable (default: the browser Playwright itself installed)
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

const PW_DIR = process.env.SCC_PW_DIR ? path.resolve(process.env.SCC_PW_DIR) : process.cwd();
const CHROME = process.env.SCC_CHROME || undefined;
const TODAY = '2026-09-28';

describe('Skip link (real Chromium)', () => {
  let server: ReturnType<typeof createAppServer>;
  let base = '';
  let browser: any;

  beforeAll(async () => {
    expect(fs.existsSync(path.resolve('dist/client/index.html')), 'run `npm run build` first').toBe(true);
    if (CHROME !== undefined) expect(fs.existsSync(CHROME), `SCC_CHROME does not exist: ${CHROME}`).toBe(true);
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

  const open = async (w: number, hash: string, opts: Record<string, unknown> = {}) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: w < 500 ? 844 : 900 }, ...opts });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('console', (m: any) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e: any) => errors.push(String(e)));
    await page.goto(`${base}/#/${hash}`);
    await page.waitForTimeout(500);
    return { ctx, page, errors };
  };

  // The Dashboard h1 is shown at 390 too (it used to be clipped there); the phone case stays.
  it.each([
    { name: 'Shipments', hash: 'shipments', width: 1440 },
    { name: 'Dashboard', hash: '', width: 1440 },
    { name: 'Dashboard', hash: '', width: 390 }
  ])('Enter on the skip link at $width focuses the $name h1 and keeps the hash', async ({ name, hash, width }) => {
    const { ctx, page, errors } = await open(width, hash, { reducedMotion: 'reduce' });
    await page.locator('main h1').waitFor({ state: 'attached' });
    const before: string = await page.evaluate(() => location.hash);
    expect(before).toBe(`#/${hash}`);
    expect(await page.locator('.skip-link').getAttribute('href')).toBe('#main');

    await page.locator('.skip-link').focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);

    const after = await page.evaluate(() => {
      const h1 = document.querySelector('main h1');
      return {
        hash: location.hash,
        h1Focused: document.activeElement === h1,
        h1Text: (h1?.textContent ?? '').trim(),
        mainText: (document.querySelector('main') as HTMLElement | null)?.innerText ?? ''
      };
    });
    await ctx.close();
    expect(after.hash).toBe(before);
    expect(after.h1Focused, 'the page h1 is document.activeElement').toBe(true);
    expect(after.h1Text).toBe(name);
    expect(after.mainText).not.toContain('Page not found');
    expect(errors).toEqual([]);
  });

  // While a page has no h1 (the data is loading, or failed to load) the skip link falls back to <main>, which must take focus
  // without a ring, as the h1 does (base.css). Both states are reached through the app itself, by holding or failing the
  // snapshot request, and the ring is read after the real keyboard path (Enter on the skip link). The `:focus-visible` check
  // proves the page would draw the global ring here: without it an outline of `none` could mean nothing was ever focused.
  it.each([
    { state: 'still loading', waitFor: '.loading-state', fulfill: undefined },
    { state: 'failed to load', waitFor: '.error-state', fulfill: { status: 500, contentType: 'application/json', body: '{"error":{"code":"DOWN","message":"down"}}' } }
  ])('while the data is $state, Enter on the skip link focuses <main> and it shows no focus ring', async ({ waitFor, fulfill }) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e: any) => errors.push(String(e)));
    // A held request is never answered; a failed one gets the server's error status.
    await page.route('**/api/snapshot', (route: any) => (fulfill ? route.fulfill(fulfill) : undefined));
    await page.goto(`${base}/#/shipments`);
    await page.locator(waitFor).waitFor({ state: 'attached' });
    expect(await page.locator('main h1').count(), 'no page is mounted, so there is no h1').toBe(0);

    await page.locator('.skip-link').focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);

    const after = await page.evaluate(() => {
      const main = document.querySelector('main') as HTMLElement;
      return {
        hash: location.hash,
        mainFocused: document.activeElement === main,
        focusVisible: main.matches(':focus-visible'),
        outline: getComputedStyle(main).outlineStyle
      };
    });
    await ctx.close();
    expect(after.mainFocused, '<main> is document.activeElement').toBe(true);
    expect(after.focusVisible, 'keyboard-initiated focus: the global ring would apply').toBe(true);
    expect(after.outline).toBe('none');
    expect(after.hash).toBe('#/shipments');
    expect(errors).toEqual([]);
  });
});
