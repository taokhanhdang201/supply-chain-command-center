// Design tokens that only a real browser can resolve (Phase 1 commit 4). The select chevron is a data-URI held in the custom
// property --select-chevron: a data-URI cannot read another property, so tokens.css writes one ink for paper (:root) and one for
// the dark bands (.surface-stage), and the dark-band rule that used to override the image is gone. jsdom does not cascade custom
// properties from a stylesheet, so this drives real Chromium through Playwright against the built app (dist/client).
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

describe('Design tokens (real Chromium)', () => {
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

  // The Analytics page has one select in its dark page band (Range) and one on paper (Sort by, in the routes card), so one
  // page shows both inks. The chevron's ink is the only difference between the two images, which are the same drawing.
  it('analytics: the Range select in the dark band has the light chevron, the Sort by select on paper the dark one', async () => {
    const { ctx, page, errors } = await open(1440, 'analytics', { reducedMotion: 'reduce' });
    const read = (name: string) =>
      page.getByRole('combobox', { name, exact: true }).evaluate((el: Element) => ({
        inDarkBand: el.closest('.surface-stage') !== null,
        image: getComputedStyle(el).backgroundImage
      }));
    const band = await read('Range');
    const paper = await read('Sort by');
    await ctx.close();

    expect(band.inDarkBand, 'Range sits in a .surface-stage').toBe(true);
    expect(paper.inDarkBand, 'Sort by sits on paper').toBe(false);
    expect(band.image).toMatch(/^url\("data:image\/svg\+xml,/);
    expect(paper.image).toMatch(/^url\("data:image\/svg\+xml,/);
    expect(band.image).toContain('%23A9B3C1');
    expect(band.image).not.toContain('%234A5360');
    expect(paper.image).toContain('%234A5360');
    expect(paper.image).not.toContain('%23A9B3C1');
    expect(errors).toEqual([]);
  });
});
