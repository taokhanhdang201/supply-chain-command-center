// The design reference (#/_design) in a development build, in real Chromium. At a phone width (390) and a desktop width
// (1440) nothing on the sheet reaches past it: the app shell clips sideways overflow (overflow-x: clip), so the page never
// scrolls sideways and a check of the document's width cannot see a block cut at the screen's edge; every element is
// measured instead (a table scrolls inside its own frame and is left out). The page has one h1. Each static state sample
// looks like the live control in that state: the live control is hovered, pressed and focused, and both are read.
// The production build has no design page (designPage.browser.test.ts). This file serves the sources through Vite's
// development middleware in the test process, wired as `npm run dev` wires it (src/server/devVite.ts), so it needs no build.
// OPT-IN (`*.browser.test.ts`). Run: SCC_PW_DIR=<dir with playwright> npm run test:browser
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createServer, type ViteDevServer } from 'vite';
import { createAppServer, type CreateAppServerOptions } from '../../src/server/app';
import { createApiHandler } from '../../src/server/api';
import { createDataStore } from '../../src/server/store';
import { createSampleDataset } from '../../src/shared/sample/generateSampleData';

const PW_DIR = process.env.SCC_PW_DIR ? path.resolve(process.env.SCC_PW_DIR) : process.cwd();
const CHROME = process.env.SCC_CHROME || undefined;
const TODAY = '2026-09-28';

describe('#/_design in a development build (real Chromium)', () => {
  let server: ReturnType<typeof createAppServer>;
  let vite: ViteDevServer | undefined;
  let base = '';
  let browser: any;

  beforeAll(async () => {
    const config = { port: 0, host: '127.0.0.1', seed: 42, todayOverride: TODAY, maxUploadBytes: 2_097_152, mode: 'development' as const };
    const make = () => createSampleDataset(42, TODAY, `${TODAY}T00:00:00.000Z`);
    const api = createApiHandler({ config, store: createDataStore(make()), getToday: () => TODAY, createSampleDataset: make });
    const opts: CreateAppServerOptions = { config, api };
    server = createAppServer(opts);
    // Vite's development middleware on the same server, its hot-reload socket included (the page's client connects to it);
    // kept here so that it is closed after the tests.
    const dev = await createServer({ server: { middlewareMode: true, hmr: { server } }, appType: 'spa', logLevel: 'error' });
    vite = dev;
    opts.fallback = (req, res) => dev.middlewares(req, res);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    let chromium: any;
    try {
      chromium = createRequire(path.join(PW_DIR, 'noop.js'))('playwright').chromium;
    } catch {
      throw new Error(`Playwright not found from ${PW_DIR}. Set SCC_PW_DIR to a directory that already has the playwright package.`);
    }
    browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});
  }, 120_000);

  afterAll(async () => {
    await browser?.close();
    await vite?.close();
    server?.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  });

  const open = async (w: number) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: w < 500 ? 844 : 900 }, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await page.goto(`${base}/#/_design`);
    await page.waitForSelector('.design-sheet', { timeout: 60_000 });
    return { ctx, page };
  };

  it.each([390, 1440])('at %ipx the page has one h1, and every element stays inside the sheet, the sheet inside the screen', async (w) => {
    const { ctx, page } = await open(w);
    const m = await page.evaluate(() => {
      const sheet = (document.querySelector('.design-sheet') as HTMLElement).getBoundingClientRect();
      const out = [...document.querySelectorAll('.design-sheet *')]
        .filter((e) => !e.closest('.table-scroll') || e.classList.contains('table-scroll'))
        .map((e) => ({ e, r: e.getBoundingClientRect() }))
        .filter(({ r }) => r.width > 1 && (r.left < sheet.left - 0.5 || r.right > sheet.right + 0.5))
        .map(({ e, r }) => `${e.tagName.toLowerCase()}.${String(e.className).split(' ')[0]} ${Math.round(r.left)}-${Math.round(r.right)}`);
      return { h1: document.querySelectorAll('h1').length, left: sheet.left, right: sheet.right, width: window.innerWidth, out };
    });
    await ctx.close();
    expect(m.h1, 'one h1').toBe(1);
    expect(m.left, 'the sheet starts inside the screen').toBeGreaterThanOrEqual(0);
    expect(m.right, 'the sheet ends inside the screen').toBeLessThanOrEqual(m.width);
    expect(m.out, 'elements past the sheet').toEqual([]);
  }, 120_000);

  it('each static state sample looks like the live control in that state (hover, press, keyboard focus)', async () => {
    const { ctx, page } = await open(1440);
    const PROPS = ['backgroundColor', 'borderTopColor', 'color', 'filter', 'textDecorationColor', 'outlineStyle', 'outlineWidth', 'outlineColor', 'outlineOffset'];
    /** An element's look, read after two frames (reduced motion still runs a 0.001ms transition). */
    const look = (loc: any): Promise<Record<string, string>> =>
      loc.evaluate(async (e: Element, props: string[]) => {
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const s = getComputedStyle(e) as unknown as Record<string, string>;
        return Object.fromEntries(props.map((p) => [p, s[p] as string]));
      }, PROPS);
    const table = page.getByRole('table', { name: 'Interactive states' });
    /** Column 1 is the live control at rest; 2, 3 and 4 are its hover, pressed and focus copies. */
    const control = (row: string, column: number) =>
      table
        .locator('tbody tr')
        .filter({ has: page.locator('td:first-child', { hasText: new RegExp(`^${row}$`) }) })
        .locator('td')
        .nth(column)
        .locator('button, select');

    // Keyboard focus first, before the mouse is used: after a key press Chromium shows the ring on a scripted focus.
    await page.keyboard.press('Shift');
    for (const row of ['Danger', 'Select']) {
      const live = control(row, 1);
      await live.focus();
      expect(await live.evaluate((e: Element) => e.matches(':focus-visible')), `${row}: the live control shows its ring`).toBe(true);
      expect(await look(live), `${row}: focus`).toEqual(await look(control(row, 4)));
    }
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

    for (const row of ['Primary', 'Secondary', 'Ghost', 'Danger', 'Link']) {
      const live = control(row, 1);
      await live.hover();
      expect(await look(live), `${row}: hover`).toEqual(await look(control(row, 2)));
      await page.mouse.down();
      expect(await look(live), `${row}: pressed`).toEqual(await look(control(row, 3)));
      await page.mouse.up();
    }

    const select = control('Select', 1);
    await select.hover();
    expect(await look(select), 'Select: hover').toEqual(await look(control('Select', 2)));

    const dash = page.locator('.atlas-page a.dash-link');
    await dash.nth(0).hover();
    expect(await look(dash.nth(0)), '.dash-link: hover').toEqual(await look(dash.nth(1)));
    await ctx.close();
  }, 120_000);
});
