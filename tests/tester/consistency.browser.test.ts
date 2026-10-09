// One system across the pages, in a real browser. Inventory names keep one line
// at 1440; one h1 (ink, type, baseline) on every page with a page band and on the Dashboard, whose first screen does not move;
// rendered text uses 400, 500 and 600 only; one heading type on paper; Top alerts rows inside a phone's margin; Analytics
// labels and details in line; a shipment status in one colour on Shipments, the Dashboard and Analytics; one rule per boundary;
// route places, count lines and titles that keep their words; chart rows and warehouse bars that start on one line; Top
// alerts in the page column and the status counts under the figures; one pagination baseline; a muted route arrow.
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

describe('consistency across pages (real Chromium)', () => {
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

  // Weights are 400, 500 and 600 only (DESIGN.md "Type scale"; the design ratchet counts the stylesheets, this counts what is drawn).
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

  // One heading type on paper (there were four kinds): a section h2, the line over a table and an empty state's title are lg at
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

  // One table gives each shipment status its tone (DESIGN.md "Shipment status"): the badge on Shipments, the mark in the
  // Dashboard's recent activity and the swatch of the Analytics status bar draw a status in one colour. On paper --neutral is
  // #4a5360 and --good #1b6e44. In transit was blue on Shipments and Analytics and black on the Dashboard.
  it('a shipment status reads one colour on Shipments, the Dashboard and Analytics', async () => {
    const NEUTRAL = 'rgb(74, 83, 96)';
    const GOOD = 'rgb(27, 110, 68)';
    const expected: Record<string, string> = { pending: NEUTRAL, in_transit: NEUTRAL, delivered: GOOD, cancelled: NEUTRAL };
    const labels: Record<string, string> = { pending: 'Pending', in_transit: 'In transit', delivered: 'Delivered', cancelled: 'Cancelled' };
    for (const status of Object.keys(expected)) {
      const { ctx, page } = await open(1440, `shipments?status=${status}`);
      const colors: string[] = await page.locator('td.data-table__col--status .badge').evaluateAll((els: Element[]) => els.map((e) => getComputedStyle(e).color));
      await ctx.close();
      expect(colors.length, `Shipments ${status}`).toBeGreaterThan(0);
      for (const c of colors) expect(c, `Shipments ${status} badge`).toBe(expected[status]);
    }
    let { ctx, page } = await open(1440, '');
    const marks: Array<{ status: string; color: string }> = await page.locator('.activity svg.status-mark').evaluateAll((els: Element[]) =>
      els.map((e) => {
        const s = getComputedStyle(e);
        return { status: /status-mark--(\w+)/.exec(e.getAttribute('class') ?? '')?.[1] ?? '', color: s.fill === 'none' ? s.stroke : s.fill };
      })
    );
    await ctx.close();
    expect(new Set(marks.map((m) => m.status)).size, 'Dashboard: more than one status').toBeGreaterThan(1);
    for (const m of marks) expect(m.color, `Dashboard ${m.status} mark`).toBe(expected[m.status]);
    ({ ctx, page } = await open(1440, 'analytics'));
    for (const status of Object.keys(expected)) {
      const swatch: string = await page
        .locator('.share-bar__item', { has: page.locator('.share-bar__label', { hasText: new RegExp(`^${labels[status]}$`) }) })
        .locator('.share-bar__swatch')
        .evaluate((e: Element) => getComputedStyle(e).backgroundColor);
      expect(swatch, `Analytics ${status} swatch`).toBe(expected[status]);
    }
    await ctx.close();
  }, 60_000);

  // A route's places keep their line ("Las Vegas, / NV" and "Kansas / City, MO" broke in the Shipments Route column at 1440):
  // each sits in its own box, so a long label breaks at the arrow. The Dashboard's activity route cell is the exception: it ends
  // a long label in an ellipsis, and an inline-block place would be cut whole (the "…" would replace the destination), so from
  // 1280px its places are inline; on a phone, where the cell wraps, they keep their box.
  it("route labels: no place is split across lines on Shipments and Routes, at 1440, 1280 and 390; the Dashboard activity's places are inline from 1280 and boxes at 390", async () => {
    for (const [w, hash] of [[1440, 'shipments'], [1280, 'shipments'], [390, 'shipments'], [1440, 'routes'], [390, 'routes']] as const) {
      const { ctx, page } = await open(w, hash);
      const m = await page.evaluate(() => {
        const lines = (el: Element) => {
          const r = document.createRange();
          r.selectNodeContents(el);
          return new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size;
        };
        const places = [...document.querySelectorAll('.route-label__place')];
        return { count: places.length, split: places.filter((p) => lines(p) > 1).map((p) => p.textContent) };
      });
      await ctx.close();
      expect(m.count, `${w} #/${hash}: places`).toBeGreaterThan(10);
      expect(m.split, `${w} #/${hash}`).toEqual([]);
    }
    for (const [w, display] of [[1280, 'inline'], [390, 'inline-block']] as const) {
      const { ctx, page } = await open(w, '');
      const m = await page.evaluate(() => {
        const places = [...document.querySelectorAll('.activity .route-label__place')];
        return { displays: [...new Set(places.map((p) => getComputedStyle(p).display))], count: places.length };
      });
      await ctx.close();
      expect(m.count, `${w} Dashboard: places in the activity`).toBeGreaterThan(10);
      expect(m.displays, `${w} Dashboard: how the activity's places are drawn`).toEqual([display]);
    }
  }, 60_000);

  // A count line or a title that wraps never leaves one word alone on its last line ("67 alerts · 57 need attention · 10" over
  // "info" on Alerts at 390; "Inventory value by" over "warehouse" on Analytics).
  it('a wrapped count line or title keeps more than one word on its last line, at 390 and 1440', async () => {
    for (const w of [390, 1440]) {
      for (const hash of ['alerts', 'inventory', 'shipments', 'analytics']) {
        const { ctx, page } = await open(w, hash);
        const lonely: string[] = await page.evaluate(() =>
          [...document.querySelectorAll('.table-summary, .section-label, .card__title')].flatMap((el) => {
            const byLine = new Map<number, string>();
            const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
            for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
              const t = n as Text;
              for (let i = 0; i < t.length; i += 1) {
                const r = document.createRange();
                r.setStart(t, i);
                r.setEnd(t, i + 1);
                const rect = r.getClientRects()[0];
                if (rect === undefined) continue;
                const y = Math.round(rect.top);
                byLine.set(y, (byLine.get(y) ?? '') + t.data.charAt(i));
              }
            }
            const lines = [...byLine.entries()].sort((a, b) => a[0] - b[0]).map(([, s]) => s.trim());
            const last = lines[lines.length - 1] ?? '';
            return lines.length > 1 && !/\s/.test(last) ? [`${(el.textContent ?? '').trim()} → "${last}"`] : [];
          })
        );
        await ctx.close();
        expect(lonely, `${w} #/${hash}`).toEqual([]);
      }
    }
  }, 120_000);

  // Analytics: a two-line chart title pushed its chart down, so the charts of a row started at three heights at 1440. The cards
  // of a row share their title row (subgrid), so their bodies start on one line. On a phone "Dallas-Fort / Worth DC" broke in
  // Warehouse utilization: the names take one column as wide as the longest, so each keeps its line and the bars start together.
  it('Analytics: the charts of a row start on one line (1440, 1100); warehouse names keep their line beside bars that start together (390)', async () => {
    for (const w of [1440, 1100]) {
      const { ctx, page } = await open(w, 'analytics');
      const rows: number[][] = await page.evaluate(() => {
        const byRow = new Map<number, number[]>();
        for (const c of document.querySelectorAll('.chart-grid > .card')) {
          const top = Math.round(c.getBoundingClientRect().top);
          byRow.set(top, [...(byRow.get(top) ?? []), (c.querySelector('.card__body') as HTMLElement).getBoundingClientRect().top]);
        }
        return [...byRow.values()];
      });
      await ctx.close();
      expect(rows.flat().length, `${w}: six charts`).toBe(6);
      for (const row of rows) expect(Math.max(...row) - Math.min(...row), `${w}: bodies of one row`).toBeLessThanOrEqual(0.5);
    }
    const { ctx, page } = await open(390, 'analytics');
    const meters: Array<{ name: string | null; lines: number; bar: number }> = await page.evaluate(() =>
      [...document.querySelectorAll('.meter-list__item')].map((li) => {
        const label = li.querySelector('.meter-list__label') as HTMLElement;
        const r = document.createRange();
        r.selectNodeContents(label);
        return {
          name: label.textContent,
          lines: new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size,
          bar: Math.round((li.querySelector('.meter') as HTMLElement).getBoundingClientRect().left)
        };
      })
    );
    await ctx.close();
    expect(meters.length).toBe(5);
    for (const m of meters) expect(m.lines, `${m.name}`).toBe(1);
    expect(new Set(meters.map((m) => m.bar)).size, 'bars start at one x').toBe(1);
  }, 60_000);

  // One rule per boundary (DESIGN.md §5). Measured before: Inventory, Shipments, Alerts and Import drew an ink rule 40px under
  // the band with nothing above it; Analytics drew a chart's or a formula's hairline 24px under its section's rule; a table's
  // last row and the pagination drew two rules 16px apart. A rule: a solid top or bottom border of an element with no side
  // border (a box is not a rule), merged by height, at least half the floor wide.
  it('one rule per boundary: no rule alone under the band, no two rules within 32px (six pages at 1440 and 390)', async () => {
    for (const w of [1440, 390]) {
      for (const hash of ['inventory', 'shipments', 'alerts', 'analytics', 'routes', 'import']) {
        const { ctx, page } = await open(w, hash);
        const m = await page.evaluate(() => {
          const floor = document.querySelector('.page-floor') as HTMLElement;
          const width = floor.clientWidth - 2 * parseFloat(getComputedStyle(floor).paddingLeft);
          const byY = new Map<number, { w: number; what: string[] }>();
          for (const el of floor.querySelectorAll('*')) {
            const s = getComputedStyle(el);
            const r = el.getBoundingClientRect();
            if (r.width < 1 || parseFloat(s.borderLeftWidth) > 0) continue;
            for (const side of ['top', 'bottom'] as const) {
              const style = s.getPropertyValue(`border-${side}-style`);
              const thick = parseFloat(s.getPropertyValue(`border-${side}-width`));
              const color = s.getPropertyValue(`border-${side}-color`);
              if (style !== 'solid' || thick === 0 || /, 0\)$/.test(color)) continue;
              const y = Math.round((side === 'top' ? r.top : r.bottom - 1) + window.scrollY);
              const e = byY.get(y) ?? { w: 0, what: [] };
              e.w += r.width;
              e.what.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]}`);
              byY.set(y, e);
            }
          }
          const rules = [...byY.entries()]
            .filter(([, e]) => e.w >= width / 2)
            .map(([y, e]) => ({ y, what: [...new Set(e.what)].join('+') }))
            .sort((a, b) => a.y - b.y);
          const close: string[] = [];
          for (let i = 1; i < rules.length; i += 1) {
            const a = rules[i - 1]!;
            const b = rules[i]!;
            if (b.y - a.y < 32) close.push(`${a.what} at ${a.y}, ${b.what} at ${b.y}`);
          }
          // Something to read sits above the first rule (a title, a field, a sentence), so it does not stand alone under the band.
          const first = rules[0];
          const above =
            first === undefined ||
            [...floor.querySelectorAll('*')].some((el) => {
              const r = el.getBoundingClientRect();
              const text = [...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? '').trim() !== '');
              return (text || el.matches('input, select, button')) && r.height > 1 && r.bottom + window.scrollY <= first.y + 1;
            });
          return { count: rules.length, close, first: first === undefined ? null : `${first.what} at ${first.y}`, above };
        });
        await ctx.close();
        const where = `${w} #/${hash}`;
        expect(m.count, `${where}: rules found`).toBeGreaterThan(0);
        expect(m.close, `${where}: rules within 32px`).toEqual([]);
        expect(m.above, `${where}: ${m.first} stands alone under the band`).toBe(true);
      }
    }
  }, 120_000);

  // The Top alerts rows and the kinds' total row bled 12px past the page column for their hover tint (the total row's rule began
  // 12px left of the column); on a phone the kinds stopped at 21rem, 22px short of the five rows' rules. The status counts sat
  // on a two-column pitch, off the four figures' columns.
  it('Dashboard: Top alerts keeps to the page column, the status counts sit under the figures; on a phone the kinds end where the rows end', async () => {
    for (const w of [1440, 1100]) {
      const { ctx, page } = await open(w, '');
      const m = await page.evaluate(() => {
        const col = (document.querySelector('.attention .dash') as HTMLElement).getBoundingClientRect();
        const rows = [...document.querySelectorAll('.attention .kind-row, .attention .queue-row')].map((r) => r.getBoundingClientRect());
        return {
          outside: rows.filter((r) => r.left < col.left - 0.5 || r.right > col.right + 0.5).length,
          figures: [...document.querySelectorAll('.signals > .figure')].map((f) => Math.round(f.getBoundingClientRect().left)),
          counts: [...document.querySelectorAll('.status-list__link')].map((a) => Math.round(a.getBoundingClientRect().left))
        };
      });
      await ctx.close();
      expect(m.outside, `${w}: rows past the column`).toBe(0);
      expect(m.counts, `${w}: each count under a figure`).toEqual(m.figures);
    }
    const { ctx, page } = await open(390, '');
    const edges = await page.evaluate(() => ({
      kinds: Math.round((document.querySelector('.attention .kind-row--total') as HTMLElement).getBoundingClientRect().right),
      rows: Math.round((document.querySelector('.attention .queue-row') as HTMLElement).getBoundingClientRect().right)
    }));
    await ctx.close();
    expect(edges.kinds, '390: the kinds end where the five rows end').toBe(edges.rows);
  }, 60_000);

  // The pagination row: "Showing 1–25 of 360" sat about 10px below the page number and the buttons, and "Rows per page" sat over
  // its select. Now one row of 36px controls on one baseline, the label beside its select.
  it('pagination: the summary, the page number and the page-size label share one baseline at 1440', async () => {
    for (const hash of ['inventory', 'shipments', 'alerts']) {
      const { ctx, page } = await open(1440, hash);
      const m = await page.evaluate(() => {
        const nav = document.querySelector('nav[aria-label="Pagination"]') as HTMLElement;
        const baseline = (el: Element) => {
          const probe = document.createElement('span');
          probe.style.display = 'inline-block';
          probe.style.verticalAlign = 'baseline';
          el.prepend(probe);
          const y = probe.getBoundingClientRect().top;
          probe.remove();
          return y;
        };
        const label = nav.querySelector('.select-field__label') as HTMLElement;
        const select = nav.querySelector('select') as HTMLElement;
        return {
          page: baseline(nav.querySelector('.pagination__page') as HTMLElement),
          summary: baseline(nav.querySelector('.pagination__summary') as HTMLElement),
          label: baseline(label),
          beside: label.getBoundingClientRect().right <= select.getBoundingClientRect().left
        };
      });
      await ctx.close();
      expect(Math.abs(m.summary - m.page), `#/${hash}: summary`).toBeLessThanOrEqual(1);
      expect(Math.abs(m.label - m.page), `#/${hash}: label`).toBeLessThanOrEqual(1);
      expect(m.beside, `#/${hash}: the label beside its select`).toBe(true);
    }
  }, 60_000);

  // A route's arrow was the accent on Shipments and Routes (blue, thin enough to read as black) and subtle gray on the Dashboard.
  // It is not a link: muted ink everywhere, #4a5360 on paper and #a9b3c1 on the band.
  it('a route arrow is muted ink on Shipments, Routes (band and paper) and the Dashboard', async () => {
    for (const hash of ['shipments', 'routes', '']) {
      const { ctx, page } = await open(1440, hash);
      const colors: Array<{ band: boolean; color: string }> = await page.locator('.route-arrow').evaluateAll((els: Element[]) =>
        els.map((e) => ({ band: e.closest('.surface-stage') !== null, color: getComputedStyle(e).color }))
      );
      await ctx.close();
      expect(colors.length, `#/${hash}`).toBeGreaterThan(0);
      for (const c of colors) expect(c.color, `#/${hash}`).toBe(c.band ? 'rgb(169, 179, 193)' : 'rgb(74, 83, 96)');
    }
  }, 60_000);
});
