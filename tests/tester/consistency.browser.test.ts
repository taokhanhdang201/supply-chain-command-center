// Lô 9, commit 16 (end of Phase 1, fix round 1): one system across the pages, in a real browser. Inventory names keep one line
// at 1440; one h1 (ink, type, baseline) on every page with a page band and on the Dashboard, whose first screen does not move;
// rendered text uses 400, 500 and 600 only; one heading type on paper; Top alerts rows inside a phone's margin; Analytics
// labels and details in line.
// OPT-IN (`*.browser.test.ts`). Run: npm run build && SCC_PW_DIR=<dir with playwright> npm run test:browser
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

describe('Lô 9 consistency across pages (real Chromium)', () => {
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

  const open = async (w: number, hash: string) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: w < 500 ? 844 : 900 }, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await page.goto(`${base}/#/${hash}`);
    await page.waitForSelector('main h1');
    return { ctx, page };
  };

  // The product cell was capped at 180px, so 9 of the first 25 names took two lines (rows 76px, not 56). The longest sample
  // name is about 218px; with the cap gone the product takes the width the other columns leave. The ledger still never
  // scrolls sideways (v16 "inventory: the ledger never scrolls sideways").
  it('inventory at 1440: every product name sits on one line, and the ledger does not scroll sideways', async () => {
    for (const hash of ['inventory', 'inventory?q=Lightweight%20Moisture']) {
      const { ctx, page } = await open(1440, hash);
      const m = await page.evaluate(() => {
        const names = [...document.querySelectorAll('.inventory-ledger tbody td.data-table__col--product')].map((td) => {
          const r = document.createRange();
          r.selectNodeContents(td.firstChild as Node); // the name's text node; the category follows in its own span
          return { name: (td.firstChild as Node).textContent, lines: r.getClientRects().length };
        });
        const s = document.querySelector('.inventory-ledger .table-scroll') as HTMLElement;
        return { names, extra: s.scrollWidth - s.clientWidth };
      });
      await ctx.close();
      expect(m.names.length, `#/${hash}: rows`).toBeGreaterThan(0);
      for (const n of m.names) expect(n.lines, `#/${hash}: ${n.name}`).toBe(1);
      expect(m.extra, `#/${hash}: sideways`).toBeLessThanOrEqual(1);
    }
  });

  // One h1: the page band's h1 and the Dashboard's are one type in one ink on one 30px line, 40px under the top bar, so the
  // title does not jump between pages (at HEAD: Dashboard 116.0, Routes 126.4, the others 118.4). The Dashboard's first screen
  // does not move: the 6px its line gains come out of the gap under it (the map stays at 56 + 40 + 48 = 144).
  it('one h1 at 1440: one baseline, ink and type on the Dashboard and the five band pages; the Dashboard map stays put', async () => {
    const seen: Array<{ hash: string; baseline: number; color: string; type: string }> = [];
    for (const hash of ['', 'inventory', 'shipments', 'routes', 'analytics', 'alerts']) {
      const { ctx, page } = await open(1440, hash);
      const h = await page.evaluate(() => {
        const h1 = document.querySelector('main h1') as HTMLElement;
        const probe = document.createElement('span');
        probe.style.display = 'inline-block';
        probe.style.verticalAlign = 'baseline';
        h1.prepend(probe);
        const baseline = probe.getBoundingClientRect().top;
        probe.remove();
        const s = getComputedStyle(h1);
        return { baseline, color: s.color, type: `${s.fontSize}/${s.fontWeight}/${s.lineHeight}` };
      });
      seen.push({ hash, ...h });
      if (hash === '') {
        const mapTop = await page.evaluate(() => Math.round((document.querySelector('.situation__map') as HTMLElement).getBoundingClientRect().top));
        expect(mapTop, 'the map under the 48px title row').toBe(144);
      }
      await ctx.close();
    }
    for (const s of seen) {
      expect(Math.abs(s.baseline - seen[1]!.baseline), `#/${s.hash}: baseline ${s.baseline}`).toBeLessThanOrEqual(0.5);
      expect(s.color, `#/${s.hash}: ink`).toBe('rgb(237, 233, 224)');
      expect(s.type, `#/${s.hash}: type`).toBe('24px/600/30px');
    }
  }, 60_000);

  // Spec §1: weights 400, 500 and 600 only (the design ratchet counts the stylesheets; this counts what is drawn).
  it('rendered text uses only the weights 400, 500 and 600 on every page at 1440', async () => {
    for (const hash of ['', 'inventory', 'shipments', 'routes', 'analytics', 'alerts', 'import', 'nope']) {
      const { ctx, page } = await open(1440, hash);
      const off = await page.evaluate(() => {
        document.querySelectorAll('details').forEach((d) => {
          d.open = true;
        });
        return [...document.querySelectorAll('body *')]
          .filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? '').trim() !== ''))
          .filter((e) => !['400', '500', '600'].includes(getComputedStyle(e).fontWeight))
          .map((e) => `${e.tagName.toLowerCase()}.${e.className} ${getComputedStyle(e).fontWeight}`);
      });
      await ctx.close();
      expect(off, `#/${hash}`).toEqual([]);
    }
  }, 60_000);

  // One heading type on paper (critic: four kinds): a section h2, the line over a table and an empty state's title are lg at
  // 500 in the display face, no wider stretch. The Top alerts title is the owner's one larger heading (36/600). The Import
  // cards' titles wait for Phase 2.
  it('one heading type on paper: section titles, the line over a table and an empty state title are 24px / 500 display', async () => {
    for (const hash of ['', 'routes', 'analytics', 'inventory', 'shipments', 'alerts', 'inventory?q=zzzz']) {
      const { ctx, page } = await open(1440, hash);
      const heads = await page.evaluate(() =>
        [...document.querySelectorAll('h2, .table-summary, .empty-state__title')]
          .filter((h) => !h.closest('.surface-stage, .scene--dark') && !h.classList.contains('attention__title') && h.getBoundingClientRect().width > 1)
          .map((h) => {
            const s = getComputedStyle(h);
            return { text: (h.textContent ?? '').trim().slice(0, 32), type: `${s.fontSize}/${s.fontWeight}/${s.fontStretch}/${s.fontFamily.split(',')[0]}` };
          })
      );
      await ctx.close();
      expect(heads.length, `#/${hash}: headings to check`).toBeGreaterThan(0);
      for (const h of heads) expect(h.type, `#/${hash} "${h.text}"`).toBe('24px/500/100%/"Archivo Variable"');
    }
    const { ctx, page } = await open(1440, '');
    expect(await page.evaluate(() => { const s = getComputedStyle(document.querySelector('.attention__title') as Element); return `${s.fontSize}/${s.fontWeight}`; })).toBe('36px/600');
    await ctx.close();
  }, 60_000);

  // The kind rows and the five rows bled 12px into the margin for their hover tint, so on a phone their rules began at x=4.
  it('Dashboard at 390: the Top alerts rows and their rules stay inside the 16px margin', async () => {
    const { ctx, page } = await open(390, '');
    const rows = await page.evaluate(() =>
      [...document.querySelectorAll('.attention .kind-row, .attention .queue-row')].map((r) => {
        const b = r.getBoundingClientRect();
        return [Math.round(b.left), Math.round(b.right)];
      })
    );
    await ctx.close();
    expect(rows.length).toBeGreaterThan(5);
    for (const [l, r] of rows) {
      expect(l, 'left').toBeGreaterThanOrEqual(16);
      expect(r, 'right').toBeLessThanOrEqual(374);
    }
  });

  // Each band figure is a grid in a row of figures; a taller neighbour (the on-time gauge, a detail on two lines) stretched its
  // rows, so the On-time label sat 4px lower and its detail 6px higher than the others at 1440, and a phone row spaced its
  // details 35px and 17px apart.
  it('Analytics: the range labels share a line and so do their details, at 1440 and 390', async () => {
    for (const w of [1440, 390]) {
      const { ctx, page } = await open(w, 'analytics');
      const rows: Array<Array<{ label: number; detail: number }>> = await page.evaluate(() => {
        const byRow = new Map<number, Array<{ label: number; detail: number }>>();
        for (const f of document.querySelectorAll('.analytics-stage .stage-figure')) {
          const top = Math.round(f.getBoundingClientRect().top);
          const label = (f.querySelector('.stage-figure__label') as HTMLElement).getBoundingClientRect().top;
          const detail = (f.querySelector('.stage-figure__detail') as HTMLElement).getBoundingClientRect().top;
          byRow.set(top, [...(byRow.get(top) ?? []), { label, detail }]);
        }
        return [...byRow.values()];
      });
      await ctx.close();
      expect(rows.flat().length, `${w}: four figures`).toBe(4);
      for (const row of rows) {
        const spread = (k: 'label' | 'detail') => Math.max(...row.map((f) => f[k])) - Math.min(...row.map((f) => f[k]));
        expect(spread('label'), `${w}: labels`).toBeLessThanOrEqual(0.5);
        expect(spread('detail'), `${w}: details`).toBeLessThanOrEqual(0.5);
      }
    }
  });
});
