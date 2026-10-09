// V1.6 tester: real-browser regression for the visual redesign (values, workflows, responsive, a11y).
// OPT-IN (`*.browser.test.ts`). Run: npm run build && SCC_PW_DIR=<dir with playwright> SCC_CHROME=<chrome> npm run test:browser
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

describe('V1.6 redesign (real Chromium)', () => {
  let server: ReturnType<typeof createAppServer>;
  let base = '';
  let browser: any;
  const external: string[] = [];

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

  const open = async (w: number, hash: string, opts: Record<string, unknown> = {}) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: w < 500 ? 844 : 900 }, ...opts });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('console', (m: any) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e: any) => errors.push(String(e)));
    page.on('request', (r: any) => { if (!r.url().startsWith(base)) external.push(r.url()); });
    await page.goto(`${base}/#/${hash}`);
    await page.waitForTimeout(500);
    return { ctx, page, errors };
  };
  const text = async (page: any) => (await page.locator('main').innerText()).replace(/\s+/g, ' ');

  it('dashboard keeps every V1.5 value (money shown as DESIGN.md "Money" says)', async () => {
    const { ctx, page, errors } = await open(1440, '');
    const t = (await text(page)).toLowerCase();
    for (const v of ['$32.6m', '$8.0m', '258,475 units in 360 records', '480', '34 active · 13 cancelled', '85.6%', '364 of 425 delivered on time', '73', '12 overdue · 61 delivered late', '20', '6 out of stock', '$600.1k', 'avg $1,285 per shipment', '3.1 days', '57', '67 total · 10 info', 'pending 14', 'in transit 20', 'delivered 433', 'cancelled 13', 'shp-100065', '$908.19'])
      expect(t, v).toContain(v);
    // DESIGN.md "Money": the same cents as summaries ($32.6M, the $8.0M rack, avg $1,285) and a shipment cost to the cent
    // ($908.19); tests/client/lib/displayMoney.test.ts proves the cents. The old strings are gone.
    for (const v of ['$32.64m', 'avg $1,285.04']) expect(t, `no ${v}`).not.toContain(v);
    expect(await page.getByLabel('Range').inputValue()).toBe('180d');
    expect(errors).toEqual([]);
    await ctx.close();
  });

  // V2 Atlas Dashboard. Counts are for the seed-42 sample dataset at TODAY: 30 mapped lanes, and 16 of the 20 in-transit
  // shipments have a mapped route and an estimated delivery (12 of them past it, which is the 12 overdue on the KPI).
  it('atlas dashboard: lanes, transit dots, warehouse links and status links come from the data', async () => {
    const { ctx, page, errors } = await open(1440, '', { reducedMotion: 'reduce' });
    expect(await page.locator('.atlas__lane').count()).toBe(30);
    expect(await page.locator('.atlas__dot').count()).toBe(16);
    expect(await page.locator('.atlas__dot--overdue').count()).toBe(12);
    expect(await page.locator('.atlas__warehouse').count()).toBe(5);
    expect(await page.locator('.atlas__warehouse').first().getAttribute('href')).toMatch(/^#\/inventory\?warehouse=WH-/);
    expect(await page.getByRole('link', { name: /^Delivered 433/ }).getAttribute('href')).toBe('#/shipments?status=delivered');
    expect(await page.locator('.rack').count()).toBe(5);
    // The deleted callout's sentence lives in the atlas description now; nothing visible carries it.
    expect(await text(page)).not.toContain('Most delayed lane');
    expect(await page.getByRole('group', { name: /^Network atlas\./ }).getAttribute('aria-label')).toMatch(/Most delayed lane, .*: \d+ of \d+ shipments delayed \(\d+%\)/);
    expect(errors).toEqual([]);
    await ctx.close();
  });

  it('atlas dashboard: with motion allowed the lanes draw in and the dots travel; with reduced motion nothing animates', async () => {
    const animated = await open(1440, '', { reducedMotion: 'no-preference' });
    expect(await animated.page.locator('.atlas--animate').count()).toBe(1);
    expect(await animated.page.locator('animateMotion').count()).toBe(16);
    expect(await animated.page.locator('.atlas__lane').first().evaluate((e: Element) => getComputedStyle(e).animationName)).toBe('atlas-draw');
    await animated.ctx.close();

    const still = await open(1440, '', { reducedMotion: 'reduce' });
    expect(await still.page.locator('.atlas--animate').count()).toBe(0);
    expect(await still.page.locator('animateMotion').count()).toBe(0);
    expect(await still.page.locator('.atlas__lane').first().evaluate((e: Element) => getComputedStyle(e).animationName)).toBe('none');
    await still.ctx.close();
  });

  it('atlas dashboard: stage text meets WCAG AA (4.5:1 body, 3:1 for the large figures)', async () => {
    const { ctx, page } = await open(1440, '', { reducedMotion: 'reduce' });
    const results: Array<{ sel: string; ratio: number; min: number }> = await page.evaluate(() => {
      const rgb = (c: string) => c.match(/[\d.]+/g)!.slice(0, 3).map(Number);
      const lum = ([r = 0, g = 0, b = 0]: number[]) => { const f = (x: number) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
      const solidBg = (el: HTMLElement) => { for (let n: HTMLElement | null = el; n; n = n.parentElement) { const c = getComputedStyle(n).backgroundColor; if (/^rgb\(/.test(c)) return c; } return 'rgb(255,255,255)'; };
      const targets: Array<[string, number]> = [['.hero__value', 3], ['.hero__label', 4.5], ['.hero__detail', 4.5], ['.situation__title', 4.5], ['.situation .figure__label', 4.5], ['.situation .figure__detail', 4.5], ['.situation .figure--critical .figure__value', 3], ['.atlas-caption', 4.5], ['.status-list__link', 4.5], ['.flow-figure__subtitle', 4.5], ['.nodes .rack__code', 4.5], ['.nodes .rack__value', 4.5], ['.attention .attention__title', 3], ['.attention .attention__sub', 4.5], ['.attention .kind-row__label', 4.5], ['.attention .kind-row__count', 4.5], ['.attention .kind-row--total .kind-row__label', 4.5], ['.attention .queue-row__what', 4.5], ['.attention .queue-row__damage', 4.5], ['.attention .queue-row__action', 4.5], ['.attention .attention__how > summary', 4.5], ['.movement .activity__carrier', 4.5], ['.movement .activity__date', 4.5]];
      return targets.map(([sel, min]) => {
        const el = document.querySelector(sel) as HTMLElement;
        const a = lum(rgb(getComputedStyle(el).color)), b = lum(rgb(solidBg(el)));
        return { sel, ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05), min };
      });
    });
    for (const r of results) expect(r.ratio, r.sel).toBeGreaterThanOrEqual(r.min);
    await ctx.close();
  });

  // "Top alerts" (docs/DASHBOARD-ALERTS.md; it replaced the 20/37/10 figures, whose contrast targets moved above; renamed
  // from "Do these first" in §9): every row is one link of at most two lines at 1440, Tab reaches the rows in order, and a
  // phone never scrolls sideways.
  it('atlas dashboard: "Top alerts" rows are links of at most two lines at 1440, in tab order, and fit a phone', async () => {
    for (const w of [1440, 390]) {
      const { ctx, page } = await open(w, '', { reducedMotion: 'reduce' });
      const m = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('.attention .queue-row')] as HTMLElement[];
        return {
          hrefs: rows.map((r) => r.getAttribute('href')),
          lines: rows.map((r) => {
            const t = r.querySelector('.queue-row__text') as HTMLElement;
            return Math.round(t.getBoundingClientRect().height / parseFloat(getComputedStyle(t).lineHeight));
          }),
          sideways: document.documentElement.scrollWidth - window.innerWidth
        };
      });
      expect(m.hrefs).toHaveLength(5);
      expect(m.sideways, `${w}`).toBeLessThanOrEqual(0);
      if (w === 1440) {
        for (const l of m.lines) expect(l).toBeLessThanOrEqual(2);
        // the total row of the kinds list replaced "View all alerts" as the last stop before the rows
        await page.locator('.attention .kind-row--total').focus();
        const reached: Array<string | null> = [];
        for (let i = 0; i < m.hrefs.length; i += 1) {
          await page.keyboard.press('Tab');
          reached.push(await page.evaluate(() => document.activeElement?.getAttribute('href') ?? null));
        }
        expect(reached).toEqual(m.hrefs);
      }
      await ctx.close();
    }
  });

  // Top alerts on paper (docs/DASHBOARD-ALERTS.md §9): Tab through every link in the block (the kind rows, the "All
  // alerts" total row, the five rows, "How these are counted") and each focus ring stands 3:1 off the paper (WCAG
  // 1.4.11); the text on a hovered row (its 7% tint included) and the open explanation meet AA (4.5:1).
  it('atlas dashboard: Top alerts on paper keeps focus rings at 3:1 and its text at AA, hovered and open', async () => {
    const { ctx, page } = await open(1440, '', { reducedMotion: 'reduce' });
    // ratio of an element's colour (or outline colour) against what is behind it, alpha layers composited
    const contrast = (target: 'active' | string, prop: 'color' | 'outlineColor') =>
      page.evaluate(([t, p]: [string, 'color' | 'outlineColor']) => {
        const parse = (s: string): number[] => {
          const srgb = s.match(/color\(srgb ([^)]+)\)/);
          if (srgb) { const v = (srgb[1] as string).split(/[\s/]+/).filter(Boolean).map(Number); return [v[0]! * 255, v[1]! * 255, v[2]! * 255, v[3] ?? 1]; }
          const v = (s.match(/[\d.]+/g) ?? []).map(Number);
          return [v[0] ?? 0, v[1] ?? 0, v[2] ?? 0, v[3] ?? 1];
        };
        const over = (fg: number[], bg: number[]) => [0, 1, 2].map((i) => fg[i]! * fg[3]! + bg[i]! * (1 - fg[3]!)).concat(1);
        const behind = (el: Element | null) => {
          const layers: number[][] = [];
          for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c[3]! > 0) { layers.push(c); if (c[3]! >= 1) break; } }
          return layers.reduceRight((bg, l) => over(l, bg), [255, 255, 255, 1]);
        };
        const lum = (c: number[]) => { const f = (x: number) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]!) + 0.7152 * f(c[1]!) + 0.0722 * f(c[2]!); };
        const els = t === 'active' ? [document.activeElement as HTMLElement] : ([...document.querySelectorAll(t)] as HTMLElement[]);
        return els.map((el) => {
          // a ring is drawn outside the element, over its parent; text sits on the element's own background
          const bg = behind(p === 'outlineColor' ? el.parentElement : el);
          const fg = over(parse(getComputedStyle(el)[p]), bg);
          const a = lum(fg), b = lum(bg);
          return { what: `${el.className} ${(el.textContent ?? '').trim().slice(0, 30)}`, inBlock: Boolean(el.closest('.attention')), ring: getComputedStyle(el).outlineStyle, ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) };
        });
      }, [target, prop] as [string, 'color' | 'outlineColor']);

    const stops = await page.locator('.attention a[href], .attention summary').count();
    const kinds = await page.locator('.attention .kind-list a').count();
    expect(kinds).toBeGreaterThan(0);
    expect(stops).toBe(kinds + 1 + 5 + 1); // the kind rows, the total row, five rows, the explanation
    await page.locator('.status-list__link').last().focus();
    for (let i = 0; i < stops; i += 1) {
      await page.keyboard.press('Tab');
      const [r] = await contrast('active', 'outlineColor');
      expect(r!.inBlock, r!.what).toBe(true);
      expect(r!.ring, r!.what).toBe('solid');
      expect(r!.ratio, r!.what).toBeGreaterThanOrEqual(3);
    }

    await page.locator('.attention .queue-row').first().hover();
    for (const r of await contrast('.attention .queue-row:hover .queue-row__text *, .attention .queue-row:hover .queue-row__text', 'color')) expect(r.ratio, r.what).toBeGreaterThanOrEqual(4.5);
    await page.locator('.attention .kind-row').first().hover();
    for (const r of await contrast('.attention .kind-row:hover > span', 'color')) expect(r.ratio, r.what).toBeGreaterThanOrEqual(4.5);
    await page.mouse.move(0, 0);

    await page.locator('.attention__how > summary').click();
    const explained = await contrast('.attention__how > summary, .attention__how > p', 'color');
    expect(explained).toHaveLength(2);
    for (const r of explained) expect(r.ratio, r.what).toBeGreaterThanOrEqual(4.5);
    await ctx.close();
  });

  // The "Alerts needing attention" tile and the "Need attention" total row both open the Alerts page with exactly the
  // number they show (kind=any: no info alerts), clicked in a real browser (docs/DASHBOARD-ALERTS.md §10).
  it('atlas dashboard: the attention tile and the Need attention row open exactly their count of alerts', async () => {
    const { ctx, page } = await open(1440, '', { reducedMotion: 'reduce' });
    for (const link of ['.signals a.figure[href^="#/alerts"]', '.attention .kind-row--total']) {
      await page.goto(`${base}/#/`);
      await page.waitForSelector(link);
      const shown = (await page.locator(link).locator('.figure__value, .kind-row__count').first().innerText()).trim();
      await page.locator(link).click();
      await page.waitForSelector('.table-summary');
      expect(page.url(), link).toContain('#/alerts?kind=any');
      expect((await page.locator('.table-summary').innerText()).replace(/\s+/g, ' '), link).toContain(`${shown} alerts`);
      expect(await page.locator('.alerts-ledger tbody tr.alert-row--info').count(), link).toBe(0);
    }
    await ctx.close();
  });

  // The Top alerts head (docs/DASHBOARD-ALERTS.md §10): the title a step above the other section titles (600, one line
  // on a phone); the kinds as one column of whole-row links, 40px tall (44px on a phone), within 22rem (the whole column on a
  // phone), the counts in one right-aligned tabular column; the total row's rule never level with a rule of the five rows
  // beside it.
  it('atlas dashboard: Top alerts kinds are one column of tall rows, counts aligned, title a step up', async () => {
    // 1100 and 1280 too: with a four-column head, "Incomplete or wrong records" wrapped below 1440 (the demo video caught it)
    for (const w of [1440, 1280, 1100, 390]) {
      const { ctx, page } = await open(w, '', { reducedMotion: 'reduce' });
      const m = await page.evaluate(() => {
        const rect = (e: Element) => e.getBoundingClientRect();
        const title = document.querySelector('.attention .attention__title') as HTMLElement;
        const rows = [...document.querySelectorAll('.attention .kind-row')] as HTMLElement[];
        const total = document.querySelector('.attention .kind-row--total') as HTMLElement;
        return {
          titleSize: parseFloat(getComputedStyle(title).fontSize),
          titleWeight: getComputedStyle(title).fontWeight,
          titleLines: Math.round(rect(title).height / parseFloat(getComputedStyle(title).lineHeight)),
          otherTitle: parseFloat(getComputedStyle(document.querySelector('.flow .scene__title')!).fontSize),
          heights: rows.map((r) => rect(r).height),
          labelLines: rows.map((r) => { const l = r.querySelector('.kind-row__label') as HTMLElement; return Math.round(rect(l).height / parseFloat(getComputedStyle(l).lineHeight)); }),
          xs: rows.map((r) => Math.round(rect(r).left)),
          listWidth: rect(document.querySelector('.attention .attention__kinds')!).width,
          rem: parseFloat(getComputedStyle(document.documentElement).fontSize),
          countRights: rows.map((r) => Math.round(rect(r.querySelector('.kind-row__count')!).right)),
          numeric: getComputedStyle(rows[0]!.querySelector('.kind-row__count')!).fontVariantNumeric,
          totalRule: Math.round(rect(total).top),
          queueRules: [...document.querySelectorAll('.attention .queue-row')].map((r) => Math.round(rect(r).top)),
          sideways: document.documentElement.scrollWidth - window.innerWidth
        };
      });
      expect(m.titleSize, `${w}`).toBeGreaterThan(m.otherTitle);
      expect(m.titleWeight).toBe('600');
      expect(m.titleLines, `${w}: title on one line`).toBe(1);
      expect(m.heights.length).toBeGreaterThan(2);
      for (const h of m.heights) expect(h, `${w}: row height`).toBeGreaterThanOrEqual(w < 768 ? 44 : 40);
      for (const l of m.labelLines) expect(l, `${w}: each kind label on one line`).toBe(1);
      expect(new Set(m.xs).size, `${w}: one column`).toBe(1);
      expect(m.listWidth, `${w}: 21rem, the whole column on a phone`).toBeLessThanOrEqual(w < 768 ? w - 32 : 22 * m.rem);
      expect(new Set(m.countRights).size, `${w}: counts share one right edge`).toBe(1);
      expect(m.numeric).toContain('tabular-nums');
      if (w === 1440) for (const y of m.queueRules) expect(Math.abs(y - m.totalRule), 'total rule level with a queue rule').toBeGreaterThan(8);
      expect(m.sideways, `${w}`).toBeLessThanOrEqual(0);
      await ctx.close();
    }
  });

  // The design rules the V2 specification measures (section i): one grid, five identical racks, six type sizes, no uppercase.
  it('atlas dashboard: one grid, five identical racks, six type sizes, no uppercase, no overflow', async () => {
    for (const w of [1440, 1024, 768, 390]) {
      const { ctx, page } = await open(w, '', { reducedMotion: 'reduce' });
      const m = await page.evaluate(() => {
        const box = (el: Element) => { const b = el.getBoundingClientRect(); return { x: b.left, y: b.top + scrollY, w: b.width, h: b.height }; };
        const q = (s: string) => [...document.querySelectorAll(s)];
        const visibleText = q('.atlas-page *').filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? '').trim()) && e.getBoundingClientRect().width > 0 && !e.closest('.visually-hidden') && e.tagName !== 'title' && !e.closest('.select-field'));
        const hero = document.querySelector('.hero__value') as HTMLElement;
        // The h1 is shown at every width (the top bar no longer repeats the title). h1Hidden stays as a
        // guard: a clipped 1x1 h1 fails below and never joins the shared left edge.
        const h1 = document.querySelector('h1')!;
        const h1Hidden = h1.getBoundingClientRect().width <= 1 && getComputedStyle(h1).position === 'absolute';
        return {
          h1Hidden,
          left: [...(h1Hidden ? [] : [box(h1).x]), box(hero).x, ...q('.atlas-page h2').map((e) => box(e).x), box(q('.rack__frame')[0]!).x, box(document.querySelector('.activity')!).x].map((x) => Math.round(x)),
          frames: q('.rack__frame').map(box),
          codeY: q('.rack__code').map((e) => Math.round(box(e).y)),
          pctY: q('.rack__pct').map((e) => Math.round(box(e).y)),
          valueY: q('.rack__value').map((e) => Math.round(box(e).y)),
          // Phones turn the bays horizontal (atlas.css "the same bays turned horizontal"), so there the fill is a width.
          fills: q('.rack__fill').map((e) => (innerWidth < 768 ? box(e).w / e.parentElement!.clientWidth : box(e).h / e.parentElement!.clientHeight)),
          pctFits: q('.rack__pct').every((e) => e.scrollWidth <= e.clientWidth),
          heroFits: hero.scrollWidth <= hero.clientWidth,
          sizes: [...new Set(visibleText.map((e) => getComputedStyle(e).fontSize))],
          weights: [...new Set(visibleText.map((e) => getComputedStyle(e).fontWeight))],
          upper: q('.atlas-page *').filter((e) => getComputedStyle(e).textTransform === 'uppercase').length,
          overflow: document.documentElement.scrollWidth - window.innerWidth,
          sceneBg: q('.scene').map((e) => getComputedStyle(e).backgroundColor)
        };
      });
      expect(m.h1Hidden, `${w}: h1 shown at every width`).toBe(false);
      expect(new Set(m.left).size, `${w}: left edges ${m.left}`).toBe(1);
      expect(m.frames).toHaveLength(5);
      if (w >= 768) {
        expect(new Set(m.frames.map((f: any) => Math.round(f.y))).size, `${w}: rack tops`).toBe(1);
        expect(new Set(m.frames.map((f: any) => Math.round(f.h))).size, `${w}: rack heights`).toBe(1);
        expect(Math.max(...m.frames.map((f: any) => f.w)) - Math.min(...m.frames.map((f: any) => f.w)), `${w}: rack widths`).toBeLessThan(1);
        for (const ys of [m.codeY, m.pctY, m.valueY]) expect(new Set(ys).size).toBe(1);
      }
      expect(m.fills.map((f: number) => Math.round(f * 1000) / 10)).toEqual([76.9, 63.5, 56.5, 85.1, 92.4]);
      expect(m.pctFits && m.heroFits, `${w}: hero and percents fit`).toBe(true);
      expect(m.sizes.length, `${w}: sizes ${m.sizes}`).toBeLessThanOrEqual(6);
      expect(m.weights.length, `${w}: weights ${m.weights}`).toBeLessThanOrEqual(3);
      expect(m.upper).toBe(0);
      expect(m.overflow).toBeLessThanOrEqual(0);
      // Scene order: Situation (dark), Top alerts (paper), Flow (paper), Nodes (dark), Movement (paper). Top alerts was a
      // second dark scene until it moved to paper (docs/DASHBOARD-ALERTS.md §9), so the dark/paper pairs changed.
      expect(m.sceneBg.length).toBe(5);
      expect(m.sceneBg[0]).toBe(m.sceneBg[3]);
      expect(m.sceneBg[1]).toBe(m.sceneBg[2]);
      expect(m.sceneBg[2]).toBe(m.sceneBg[4]);
      expect(m.sceneBg[0]).not.toBe(m.sceneBg[1]);
      await ctx.close();
    }
  }, 60_000);

  // The page h1 is the title role: 24px, weight 600. From 1100px its line box is the page band h1's 30px (one baseline
  // for every page's h1); the gap under it gives the 6px back, so the first-screen budget, the map and the four figures do
  // not move. Below 1100px it sits on a 32px line.
  it('atlas dashboard: the h1 is 24px / 600 at every width, on a 30px line from 1100px and a 32px line below', async () => {
    for (const w of [1440, 1100, 1099, 1024, 768, 390]) {
      const { ctx, page } = await open(w, '', { reducedMotion: 'reduce' });
      const h = await page.evaluate(() => {
        const s = getComputedStyle(document.querySelector('h1')!);
        return { size: s.fontSize, weight: s.fontWeight, line: s.lineHeight };
      });
      await ctx.close();
      expect(h.size, `${w}: size`).toBe('24px');
      expect(h.weight, `${w}: weight`).toBe('600');
      expect(h.line, `${w}: line height`).toBe(w >= 1100 ? '30px' : '32px');
    }
  }, 60_000);

  it('inventory, shipments, alerts, analytics and import keep their values', async () => {
    const checks: Array<[string, string[]]> = [
      ['inventory', ['360 items · $32.6M', 'ELC-0015', '$1,403,217', '$617.07', 'Showing 1–25 of 360']],
      ['shipments', ['480 shipments', 'SHP-100200', '$545.08', 'Page 1 of 20']],
      ['alerts', ['Showing 1–25 of 67', 'Out of stock: APP-0005']],
      ['analytics', ['11.17×', 'DIO 32.7 days · 356 of 360 items have usage data', 'avg $1,285 per shipment', '3.1 days', '85.6%', '76.9%', '63.5%', '56.5%', '85.1%', '92.4%']],
      // G1: Data Import opens on the waiting state (the "Current data sources" figures were removed, G0 §4; the top bar
      // names each source, checked below)
      ['import', ['Drop your file', 'CSV, TSV, TXT or GZ file. Up to 2 MB.', 'No file? Try one.']]
    ];
    // DESIGN.md "Money": summaries compact, table amounts to the dollar, unit prices and shipment costs to the cent. The
    // old strings must be gone too: "$1,403,217" is the start of "$1,403,217.18".
    const gone: Record<string, string[]> = { inventory: ['$32,643,371.48', '$1,403,217.18'], analytics: ['avg $1,285.04 per shipment'] };
    for (const [hash, vals] of checks) {
      const { ctx, page } = await open(1440, hash);
      const t = await text(page);
      for (const v of vals) expect(t, `${hash}: ${v}`).toContain(v);
      for (const v of gone[hash] ?? []) expect(t, `${hash}: no ${v}`).not.toContain(v);
      // Both sources are the generated sample, so one chip, and its note names the seed.
      if (hash === 'import') {
        expect(await page.locator('.topbar__chip').allTextContents()).toEqual(['Sample data']);
        expect(await page.locator('.topbar__note').textContent()).toContain('seed 42');
      }
      await ctx.close();
    }
    const { ctx, page } = await open(1440, 'alerts');
    const t = await text(page);
    // Stage figures read value first, then label.
    expect(t).toMatch(/20\s*Critical/);
    expect(t).toMatch(/37\s*Warning/);
    expect(t).toMatch(/10\s*Info/);
    await ctx.close();
  });

  // While both sources are the generated sample, the top bar has one chip, "Sample
  // data", a button that opens a native popover. Enter opens the note, Esc closes it and focus stays on the chip. The note
  // hangs under the chip (where the browser anchors it: right edges level, a phone too), inside the screen, at AA, without
  // the date. One row at every width: the phone top bar was 118.4-119px, then 86px with the chip on a row of its own, now 56px.
  it('top bar: one "Sample data" chip opens its note from the keyboard, under the chip, inside the screen, at AA', async () => {
    for (const w of [390, 1440]) {
      const { ctx, page } = await open(w, 'import', { reducedMotion: 'reduce' });
      expect(await page.locator('.topbar__chip').allTextContents(), `${w}: chips`).toEqual(['Sample data']);
      const height: number = await page.evaluate(() => (document.querySelector('.topbar') as HTMLElement).getBoundingClientRect().height);
      expect(height, `${w}: top bar height`).toBeLessThanOrEqual(56);
      await page.locator('.topbar__chip').focus();
      await page.keyboard.press('Enter');
      const m = await page.evaluate(() => {
        const rgb = (c: string) => c.match(/[\d.]+/g)!.slice(0, 3).map(Number);
        const lum = ([r = 0, g = 0, b = 0]: number[]) => { const f = (x: number) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
        const solidBg = (el: Element) => { for (let n: Element | null = el; n; n = n.parentElement) { const c = getComputedStyle(n).backgroundColor; if (/^rgb\(/.test(c)) return c; } return 'rgb(255,255,255)'; };
        const ratio = (el: Element) => { const a = lum(rgb(getComputedStyle(el).color)), b = lum(rgb(solidBg(el))); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };
        const chip = document.querySelector('.topbar__chip') as HTMLElement;
        const note = document.querySelector('.topbar__note') as HTMLElement;
        const c = chip.getBoundingClientRect();
        const n = note.getBoundingClientRect();
        return {
          open: note.matches(':popover-open'),
          anchored: CSS.supports('position-area: bottom'),
          chipLeft: c.left, chipRight: c.right, chipBottom: c.bottom,
          noteLeft: n.left, noteRight: n.right, noteTop: n.top,
          width: innerWidth,
          sideways: document.documentElement.scrollWidth - innerWidth,
          text: note.textContent ?? '',
          chipRatio: ratio(chip),
          noteRatio: ratio(note)
        };
      });
      expect(m.open, `${w}: Enter opens the note`).toBe(true);
      expect(m.noteLeft, `${w}: note left edge`).toBeGreaterThanOrEqual(0);
      expect(m.noteRight, `${w}: note right edge`).toBeLessThanOrEqual(m.width);
      expect(m.noteTop, `${w}: note under the chip`).toBeGreaterThanOrEqual(m.chipBottom);
      if (m.anchored) {
        const gap = m.noteRight - m.chipRight;
        expect(Math.abs(gap), `${w}: note edge level with the chip's`).toBeLessThanOrEqual(1);
      }
      expect(m.sideways, `${w}: no sideways scroll`).toBeLessThanOrEqual(0);
      expect(m.text).toBe('Generated sample, seed 42. Rebuilt every day until someone imports a file.');
      expect(m.chipRatio, `${w}: chip text`).toBeGreaterThanOrEqual(4.5);
      expect(m.noteRatio, `${w}: note text`).toBeGreaterThanOrEqual(4.5);
      await page.keyboard.press('Escape');
      const after = await page.evaluate(() => [document.querySelector('.topbar__note')!.matches(':popover-open'), document.activeElement?.classList.contains('topbar__chip') ?? false]);
      expect(after, `${w}: Esc closes the note, focus stays on the chip`).toEqual([false, true]);
      await ctx.close();
    }
  }, 60_000);

  // A mouse over the chip opens the note too. It stays open while the mouse is on the chip or on the
  // note (the note hangs against the chip), a click on the chip after the hover does not close it, and the mouse leaving
  // both closes it. Only a mouse: a tap opens the note through its click, and the touch pointer leaving does not close it.
  it('top bar: a mouse over the "Sample data" chip opens its note, which stays while the mouse is on it and closes when the mouse leaves', async () => {
    const { ctx, page } = await open(1440, 'import', { reducedMotion: 'reduce' });
    const isOpen = () => page.evaluate(() => document.querySelector('.topbar__note')!.matches(':popover-open'));
    expect(await isOpen(), 'closed at first').toBe(false);
    await page.hover('.topbar__chip');
    expect(await isOpen(), 'the mouse on the chip opens the note').toBe(true);
    await page.hover('.topbar__note');
    expect(await isOpen(), 'the mouse moving onto the note keeps it open').toBe(true);
    await page.hover('.topbar__chip');
    await page.click('.topbar__chip');
    expect(await isOpen(), 'a click on the chip after the hover does not close it').toBe(true);
    await page.hover('h1');
    expect(await isOpen(), 'the mouse leaving both closes it').toBe(false);
    await ctx.close();
  }, 60_000);

  // Where the browser cannot hang the note under the chip (no position-area), it opens centred on the screen, out of reach of
  // the pointer: a hover that opened it would close it again before the mouse got there (WCAG 1.4.13). So the hover does
  // nothing there; a click opens the note, and the mouse leaving does not close it. The page is told, from its first
  // script, that position-area is unsupported (only its JavaScript asks; the stylesheet's @supports is the browser's own).
  it('top bar: where the note cannot be anchored, a hover opens nothing, a click opens it, and the mouse leaving leaves it open', async () => {
    const { ctx, page } = await open(1440, 'import', { reducedMotion: 'reduce' });
    await ctx.addInitScript(() => {
      const css = CSS as unknown as { supports: (...args: string[]) => boolean };
      const supports = css.supports.bind(CSS);
      css.supports = (...args: string[]) => (/position-area/.test(args.join(' ')) ? false : supports(...args));
    });
    await page.reload();
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => CSS.supports('position-area: bottom')), 'the page reports no anchoring').toBe(false);
    const isOpen = () => page.evaluate(() => document.querySelector('.topbar__note')!.matches(':popover-open'));
    await page.hover('.topbar__chip');
    await page.waitForTimeout(200);
    expect(await isOpen(), 'a hover on the chip opens nothing').toBe(false);
    await page.click('.topbar__chip');
    expect(await isOpen(), 'a click on the chip opens the note').toBe(true);
    await page.hover('h1');
    await page.waitForTimeout(200);
    expect(await isOpen(), 'the mouse leaving does not close a note a click opened').toBe(true);
    await ctx.close();
  }, 60_000);

  it('top bar: a tap on the "Sample data" chip opens its note through its click alone: the hover code leaves a touch pointer alone', async () => {
    const { ctx, page } = await open(390, 'import', { hasTouch: true, reducedMotion: 'reduce' });
    // The click alone opens the note, so the end state cannot tell a touch that was ignored from one that closed the note and
    // had it reopened by the click; count the hidePopover calls the page makes (the browser's own Esc and outside-click closing
    // do not go through it).
    await page.evaluate(() => {
      const w = window as unknown as { __hides: number };
      w.__hides = 0;
      const hide = HTMLElement.prototype.hidePopover;
      HTMLElement.prototype.hidePopover = function (this: HTMLElement) { w.__hides += 1; return hide.call(this); };
    });
    await page.tap('.topbar__chip');
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => document.querySelector('.topbar__note')!.matches(':popover-open')), 'the tap opens the note and it stays').toBe(true);
    expect(await page.evaluate(() => (window as unknown as { __hides: number }).__hides), 'the touch pointer leaving hides nothing').toBe(0);
    await ctx.close();
  }, 60_000);

  it('URL-synced filters keep working with the new controls', async () => {
    const { ctx, page } = await open(1440, 'inventory');
    await page.getByLabel('Stock status', { exact: true }).selectOption('low_or_out');
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => location.hash)).toBe('#/inventory?stock=low_or_out');
    expect(await text(page)).toContain('20 items · $449.6K');
    await page.goto(`${base}/#/shipments?flag=delayed`);
    await page.reload();
    await page.waitForTimeout(400);
    expect(await text(page)).toContain('73 shipments');
    await ctx.close();
  });

  // A short line beside each number that differs on purpose from another place; no number changes.
  // Seed 42: 8 delivered shipments cannot be rated (433 delivered, 425 rated); 57 of the 67 alerts need attention; the kinds
  // count only those; Overdue is past ETA and not delivered; 25 of the 32 lanes are on the map. On the Dashboard the note sits
  // beside the rate's label: a longer detail line widened or deepened the figure onto the map's marks at 1280px.
  it('explanation lines: beside their numbers on seed 42, at AA, the Dashboard figure unchanged', async () => {
    const read = (page: any, sels: string[]) =>
      page.evaluate((s: string[]) => {
        const rgb = (c: string) => c.match(/[\d.]+/g)!.slice(0, 3).map(Number);
        const lum = ([r = 0, g = 0, b = 0]: number[]) => { const f = (x: number) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
        const solidBg = (el: Element) => { for (let n: Element | null = el; n; n = n.parentElement) { const c = getComputedStyle(n).backgroundColor; if (/^rgb\(/.test(c)) return c; } return 'rgb(255,255,255)'; };
        return s.map((sel) => {
          const el = document.querySelector(sel) as HTMLElement | null;
          if (el === null) return { sel, text: null, ratio: 0, display: '', height: 0 };
          const a = lum(rgb(getComputedStyle(el).color)), b = lum(rgb(solidBg(el)));
          return { sel, text: (el.textContent ?? '').replace(/\s+/g, ' ').trim(), ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05), display: getComputedStyle(el).display, height: el.getBoundingClientRect().height };
        });
      }, sels);

    let { ctx, page } = await open(1440, '', { reducedMotion: 'reduce' });
    const [note, label, detail, info, overdue] = await read(page, ['.hero__note', '.hero__label', '.hero__detail', '.attention__note', '.kind-row__note']);
    expect(note!.text).toContain('8 not measurable');
    expect(note!.display, '1440: note beside the label').toBe('inline');
    expect(label!.height, '1440: the label stays one 24px line').toBeLessThanOrEqual(24.5);
    expect(detail!.text).toBe('364 of 425 delivered on time · below the 90% target');
    expect(info!.text).toBe('Info alerts are not counted.');
    expect(overdue!.text).toBe('past ETA, not delivered');
    const described = await page.evaluate(() => {
      const a = document.querySelector('.attention .kind-row[aria-describedby]') as HTMLElement;
      return [a.getAttribute('aria-label'), document.getElementById(a.getAttribute('aria-describedby')!)?.textContent];
    });
    expect(described).toEqual(['Overdue, 12, view in Alerts', 'past ETA, not delivered']);
    for (const r of [note, info, overdue]) expect(r!.ratio, r!.sel).toBeGreaterThanOrEqual(4.5);
    await ctx.close();

    ({ ctx, page } = await open(1024, '', { reducedMotion: 'reduce' }));
    const [note1024, sep1024] = await read(page, ['.hero__note', '.hero__sep']);
    expect(note1024!.display, '1024: the note takes its own line').toBe('block');
    expect(sep1024!.display, '1024: without the dot').toBe('none');
    await ctx.close();

    ({ ctx, page } = await open(1440, 'alerts'));
    const [alerts] = await read(page, ['.table-summary']);
    expect(alerts!.text).toBe('67 alerts · 57 need attention · 10 info');
    await ctx.close();

    ({ ctx, page } = await open(1440, 'analytics'));
    expect((await page.locator('.stage-figure', { hasText: 'On-time rate' }).locator('.stage-figure__detail').textContent())?.trim()).toBe(
      '364 of 425 delivered on time · 8 not measurable · below the 90% target'
    );
    await ctx.close();

    ({ ctx, page } = await open(1440, 'routes'));
    const [routes] = await read(page, ['.routes__summary']);
    expect(routes!.text).toBe('32 lanes · the map shows the top 25 of 30 · 2 are unmapped');
    await ctx.close();
  }, 60_000);

  it('route colour class matches the delayed rate (<10% neutral, 10-19% warning, >=20% critical) on list and map', async () => {
    const { ctx, page } = await open(1440, 'routes');
    const rows: Array<{ t: string; cls: string }> = await page.locator('.route-map__list-button').evaluateAll((a: Element[]) => a.map((x) => ({ t: (x as HTMLElement).innerText.replace(/\s+/g, ' '), cls: x.className })));
    expect(rows.length).toBe(25);
    const counts: Record<string, number> = { neutral: 0, warning: 0, critical: 0 };
    for (const r of rows) {
      const pct = Number(/(\d+)% delayed/.exec(r.t)![1]);
      const tone = pct >= 20 ? 'critical' : pct >= 10 ? 'warning' : 'neutral';
      // a rounded pct of 10 could come from 9.5-9.99; none exist in the sample, so this is exact here
      expect(r.cls, r.t).toContain(`route-map__list-button--${tone}`);
      counts[tone] = (counts[tone] ?? 0) + 1;
    }
    const strokes: string[] = await page.locator('.route-map__path').evaluateAll((a: Element[]) => a.map((x) => getComputedStyle(x).stroke));
    const distinct = new Map<string, number>();
    strokes.forEach((s) => distinct.set(s, (distinct.get(s) ?? 0) + 1));
    expect([...distinct.values()].sort()).toEqual([counts.neutral, counts.warning, counts.critical].sort());
    await ctx.close();
  });

  it('route selection by click and keyboard: one halo, two endpoints, others dimmed, detail shown', async () => {
    const { ctx, page } = await open(1440, 'routes');
    const btn = (i: number) => page.locator('.route-map__list-button').nth(i);
    await btn(1).click();
    expect(await page.locator('.route-map__halo').count()).toBe(1);
    expect(await page.locator('.is-endpoint').count()).toBe(2);
    expect(await page.locator('.route-map__path').count()).toBe(25);
    expect(await btn(1).getAttribute('aria-pressed')).toBe('true');
    await btn(3).focus();
    await page.keyboard.press('Enter');
    expect(await btn(3).getAttribute('aria-pressed')).toBe('true');
    expect(await btn(1).getAttribute('aria-pressed')).toBe('false');
    expect(await page.locator('.route-map__halo').count()).toBe(1);
    await ctx.close();
  });

  it('every nav link works and focus lands on the h1 after a route change', async () => {
    const { ctx, page } = await open(1440, '');
    const n = await page.locator('#sidebar .sidebar__nav a').count();
    expect(n).toBe(7);
    for (const i of [1, 2, 3, 4, 5, 6]) {
      await page.locator('#sidebar .sidebar__nav a').nth(i).click();
      await page.waitForTimeout(200);
      expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('H1');
    }
    await ctx.close();
  });

  // Pagination: a nav named Pagination whose Previous and Next are 36px, level with the 36px page-size select (same bottom
  // edge while they share a row), and which holds no link: the main navigation keeps its 7 page links (its foot adds LinkedIn and GitHub).
  it('pagination: a named nav with 36px Previous and Next level with the page-size select, and no link of its own', async () => {
    for (const [w, hash] of [[1440, 'inventory'], [1440, 'shipments'], [1440, 'alerts'], [390, 'inventory']] as const) {
      const { ctx, page } = await open(w, hash, { reducedMotion: 'reduce' });
      const m = await page.evaluate(() => {
        const navs = [...document.querySelectorAll('nav[aria-label="Pagination"]')];
        const nav = navs[0];
        const box = (el: Element | null | undefined) => { const b = el!.getBoundingClientRect(); return { height: b.height, bottom: b.bottom }; };
        return {
          navs: navs.length,
          buttons: nav ? [...nav.querySelectorAll('button')].map(box) : [],
          select: nav ? box(nav.querySelector('select')) : null,
          links: nav ? nav.querySelectorAll('a').length : -1,
          allNavLinks: document.querySelectorAll('nav a:not(.sidebar__credit-link)').length
        };
      });
      await ctx.close();
      const where = `${w} #/${hash}`;
      expect(m.navs, where).toBe(1);
      expect(m.buttons, where).toHaveLength(2);
      for (const b of m.buttons) expect(b.height, `${where}: button height`).toBeCloseTo(36, 0);
      expect(m.select!.height, `${where}: select height`).toBeCloseTo(36, 0);
      if (w >= 1100) for (const b of m.buttons) expect(Math.abs(b.bottom - m.select!.bottom), `${where}: bottom edges`).toBeLessThanOrEqual(1);
      expect(m.links, where).toBe(0);
      if (w >= 1100) expect(m.allNavLinks, where).toBe(7);
    }
  }, 60_000);

  it('no page-level horizontal overflow at 1440/1024/768/390, no console errors, no external requests', async () => {
    for (const w of [1440, 1024, 768, 390]) {
      for (const hash of ['', 'inventory', 'shipments', 'routes', 'analytics', 'alerts', 'import']) {
        const { ctx, page, errors } = await open(w, hash);
        const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(over, `${w} #/${hash}`).toBeLessThanOrEqual(0);
        expect(errors, `${w} #/${hash}`).toEqual([]);
        await ctx.close();
      }
    }
    expect(external).toEqual([]);
  }, 120_000);

  it('fonts load from self-hosted /assets/*.woff2', async () => {
    const { ctx, page } = await open(1440, '');
    const fams: string[] = await page.evaluate(async () => { await document.fonts.ready; return [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family); });
    expect(fams.some((f) => /Inter/.test(f))).toBe(true);
    expect(fams.some((f) => /Archivo/.test(f))).toBe(true);
    await ctx.close();
  });

  it('prefers-reduced-motion removes animations and long transitions', async () => {
    const { ctx, page } = await open(1440, '', { reducedMotion: 'reduce' });
    const r = await page.evaluate(() => {
      let anim = 0, maxT = 0;
      document.querySelectorAll('*').forEach((e) => {
        const cs = getComputedStyle(e);
        if (cs.animationName !== 'none' && parseFloat(cs.animationDuration) > 0.001) anim++;
        maxT = Math.max(maxT, ...cs.transitionDuration.split(',').map(parseFloat));
      });
      return { anim, maxT };
    });
    expect(r.anim).toBe(0);
    expect(r.maxT).toBeLessThan(0.01);
    await ctx.close();
  });

  // Only Data Import still has a display headline.
  // No page keeps a display headline any more, so the stage contrast check covers the figure-stage instead: small text
  // (group labels, details) at WCAG AA 4.5:1, the large figures (including red and amber ones) at 3:1.
  it('figure-stage text meets WCAG AA contrast on the stage (labels and details 4.5:1, figures 3:1)', async () => {
    for (const hash of ['shipments', 'inventory', 'routes', 'alerts', 'analytics', 'import']) {
      const { ctx, page } = await open(1440, hash, { reducedMotion: 'reduce' });
      const worst = await page.evaluate(() => {
        const rgb = (c: string) => c.match(/[\d.]+/g)!.slice(0, 3).map(Number);
        const lum = ([r = 0, g = 0, b = 0]: number[]) => { const f = (x: number) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
        const ratio = (el: Element) => {
          let bg = 'rgb(255,255,255)';
          for (let n: Element | null = el; n; n = n.parentElement) { const c = getComputedStyle(n).backgroundColor; if (!/rgba\(.*, 0\)$/.test(c) && c !== 'transparent') { bg = c; break; } }
          const a = lum(rgb(getComputedStyle(el).color)), b = lum(rgb(bg));
          return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        };
        const min = (sel: string) => Math.min(...[...document.querySelectorAll(sel)].map(ratio));
        return { small: min('.figure-stage__label, .stage-figure__detail, .stage-figure__label'), large: min('.stage-figure__value') };
      });
      await ctx.close();
      expect(worst.small, `${hash}: labels and details`).toBeGreaterThanOrEqual(4.5);
      expect(worst.large, `${hash}: figures`).toBeGreaterThanOrEqual(3);
    }
  });

  // Figure: a figure link is read value, label, detail. The hover arrow is decoration with empty
  // alternative text, so it is not part of the name. Read from Chrome's own accessibility tree, not from the DOM text.
  it('figure links are named value, label, detail in Chrome, without the hover arrow', async () => {
    const { ctx, page } = await open(1440, 'shipments', { reducedMotion: 'reduce' });
    const cdp = await ctx.newCDPSession(page);
    const { nodes } = await cdp.send('Accessibility.getFullAXTree');
    await ctx.close();
    const names: string[] = nodes
      .filter((n: any) => n.role?.value === 'link')
      .map((n: any) => String(n.name?.value ?? '').replace(/\s+/g, ' ').trim())
      .filter((name: string) => /^\d/.test(name));
    expect(names).toHaveLength(8); // four statuses, four flags
    for (const name of names) expect(name).not.toContain('→');
    expect(names).toContainEqual(expect.stringMatching(/^\d+ ?Delayed ?\d+ overdue · \d+ delivered late$/));
  });

  // The first-screen viewports: desktop sizes and real laptop viewports (browser chrome and taskbar already removed).
  const FIRST_SCREENS: Array<[number, number]> = [
    [1100, 800], [1200, 800], [1280, 800], [1366, 768], [1440, 900], [1920, 1080],
    [1366, 650], [1280, 690], [1440, 790], [1920, 950]
  ];

  // V2 wave 2: the lane map is the stage. From 1280px on screens taller than 760px the on-time figure sits inside the
  // full-width map (lower left, open sea); on shorter screens it stands beside the map; below 1280px it sits above it.
  // Wherever it is, it touches no warehouse code, node, city, transit dot or lane.
  it('atlas dashboard: the on-time figure sits inside, beside or above the map by screen size, clear of every mark', async () => {
    // 1200 and 1279 sit between breakpoints: checked too, at 900px tall as before, plus every first-screen viewport.
    const sizes: Array<[number, number]> = [[1100, 900], [1200, 900], [1279, 900], [1280, 900], [1440, 900], [1920, 900], [390, 844], ...FIRST_SCREENS];
    for (const [w, h] of sizes) {
      const { ctx, page } = await open(w, '', { reducedMotion: 'reduce', viewport: { width: w, height: h } });
      const m = await page.evaluate(() => {
        const r = (e: Element) => { const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; };
        const hero = r(document.querySelector('.hero')!);
        const map = r(document.querySelector('.situation__map')!);
        const grid = r(document.querySelector('.situation__grid')!);
        const hit = (a: ReturnType<typeof r>, b: ReturnType<typeof r>) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
        const marks = [...document.querySelectorAll('.atlas__label, .atlas__warehouse-node, .atlas__city, .atlas__dot-core')].filter((e) => hit(hero, r(e))).length;
        let lanePoints = 0;
        for (const p of document.querySelectorAll<SVGPathElement>('.atlas__lane')) {
          const len = p.getTotalLength();
          const ctm = p.getScreenCTM()!;
          for (let i = 0; i <= 60; i++) {
            const q = p.getPointAtLength((len * i) / 60).matrixTransform(ctm);
            if (q.x > hero.l && q.x < hero.r && q.y > hero.t && q.y < hero.b) lanePoints++;
          }
        }
        return {
          inside: hero.t >= map.t && hero.b <= map.b + 1 && hero.l >= map.l - 1,
          above: hero.b <= map.t + 1,
          beside: hero.r <= map.l + 1 && hero.t >= map.t - 1 && hero.b <= map.b + 1,
          fullWidth: Math.abs(map.l - grid.l) < 1 && Math.abs(map.r - grid.r) < 1,
          marks,
          lanePoints
        };
      });
      await ctx.close();
      const at = `${w}x${h}`;
      if (w >= 1280 && h > 760) {
        expect(m.inside, `${at}: figure inside the map`).toBe(true);
        expect(m.fullWidth, `${at}: map spans the grid`).toBe(true);
      } else if (w >= 1280) {
        expect(m.beside, `${at}: figure beside the map`).toBe(true);
      } else {
        expect(m.above, `${at}: figure above the map`).toBe(true);
      }
      expect(m.marks, `${at}: marks under the figure`).toBe(0);
      expect(m.lanePoints, `${at}: lane points under the figure`).toBe(0);
    }
  });

  // The four figures (value and label) are on the first screen at every desktop and laptop viewport; the detail line
  // under each may be cut.
  it('atlas dashboard: the four figures, value and label, fit on the first screen at desktop and laptop viewports', async () => {
    for (const [w, h] of FIRST_SCREENS) {
      const { ctx, page } = await open(w, '', { reducedMotion: 'reduce', viewport: { width: w, height: h } });
      const m = await page.evaluate(() => {
        const figs = [...document.querySelectorAll('.signals > .figure')];
        const bottom = (sel: string) => Math.max(...figs.map((f) => f.querySelector(sel)!.getBoundingClientRect().bottom));
        return { count: figs.length, scrollY: window.scrollY, value: bottom('.figure__value'), label: bottom('.figure__label') };
      });
      await ctx.close();
      expect(m.count, `${w}x${h}: four figures`).toBe(4);
      expect(m.scrollY, `${w}x${h}: not scrolled`).toBe(0);
      expect(m.value, `${w}x${h}: values on the first screen`).toBeLessThanOrEqual(h);
      expect(m.label, `${w}x${h}: labels on the first screen`).toBeLessThanOrEqual(h);
    }
  });

  // Shipments ledger: at phone width each shipment is a stacked record, yet the accessibility tree still sees a table
  // (explicit roles), nothing scrolls sideways and the status and cost of a record are on screen.
  it('shipments at 390px: stacked records keep table roles, no sideways scroll, status and cost on screen', async () => {
    const { ctx, page } = await open(390, 'shipments', { reducedMotion: 'reduce' });
    const table = page.getByRole('table', { name: 'Shipments' });
    expect(await table.getByRole('columnheader').count()).toBe(9);
    expect(await table.getByRole('row').count()).toBe(26); // header row + 25 records
    expect(await table.getByRole('cell').count()).toBe(25 * 9);
    expect(await table.getByRole('row').nth(1).getByRole('cell').count()).toBe(9);
    const m = await page.evaluate(() => {
      const row = document.querySelector('.shipments-ledger tbody tr')!;
      const box = (sel: string) => row.querySelector(sel)!.getBoundingClientRect();
      return {
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        display: getComputedStyle(row).display,
        status: box('.data-table__col--status').right,
        cost: box('.data-table__col--cost').right,
        etaLabel: getComputedStyle(row.querySelector('.data-table__col--eta .data-table__phone-label')!).display
      };
    });
    await ctx.close();
    expect(m.overflow).toBeLessThanOrEqual(0);
    expect(m.display).toBe('grid');
    expect(m.status).toBeLessThanOrEqual(390);
    expect(m.cost).toBeLessThanOrEqual(390);
    expect(m.etaLabel).not.toBe('none');
  });

  // No sideways scroll at any width: stacked records below 1280px; from 1280px to 1439px the carrier sits under the
  // route and cells are tighter. Checked on the flagged view (the widest flag badges).
  it('shipments: the ledger never scrolls sideways, from phone to desktop', async () => {
    for (const w of [390, 768, 1024, 1100, 1180, 1280, 1366, 1440]) {
      const { ctx, page } = await open(w, 'shipments?flag=any_issue', { reducedMotion: 'reduce' });
      const m = await page.evaluate(() => {
        const s = document.querySelector('.table-scroll')!;
        return { extra: s.scrollWidth - s.clientWidth, page: document.documentElement.scrollWidth - window.innerWidth };
      });
      expect(await page.getByRole('table', { name: 'Shipments' }).getByRole('columnheader').count(), `${w}: nine column headers`).toBe(9);
      await ctx.close();
      expect(m.extra, `${w}: table overflow`).toBeLessThanOrEqual(1);
      expect(m.page, `${w}: page overflow`).toBeLessThanOrEqual(0);
    }
  });

  it('shipments at 1440px: the table is a plain table, phone labels hidden, and both figure rows are on the first screen', async () => {
    const { ctx, page } = await open(1440, 'shipments', { reducedMotion: 'reduce' });
    const m = await page.evaluate(() => ({
      rowDisplay: getComputedStyle(document.querySelector('.shipments-ledger tbody tr')!).display,
      label: getComputedStyle(document.querySelector('.data-table__phone-label')!).display,
      attentionBottom: document.querySelector('#shipments-attention')!.closest('section')!.getBoundingClientRect().bottom
    }));
    await ctx.close();
    expect(m.rowDisplay).toBe('table-row');
    expect(m.label).toBe('none');
    expect(m.attentionBottom).toBeLessThanOrEqual(900);
  });

  // Inventory ledger: same pattern. At 390px each item is a stacked record that keeps its table roles.
  it('inventory at 390px: stacked records keep table roles, no sideways scroll, stock and value on screen', async () => {
    const { ctx, page } = await open(390, 'inventory', { reducedMotion: 'reduce' });
    const table = page.getByRole('table', { name: 'Inventory' });
    expect(await table.getByRole('columnheader').count()).toBe(11);
    expect(await table.getByRole('row').count()).toBe(26); // header row + 25 records
    expect(await table.getByRole('row').nth(1).getByRole('cell').count()).toBe(11);
    const m = await page.evaluate(() => {
      const row = document.querySelector('.inventory-ledger tbody tr')!;
      const box = (sel: string) => row.querySelector(sel)!.getBoundingClientRect();
      return {
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        display: getComputedStyle(row).display,
        stock: box('.data-table__col--stock').right,
        value: box('.data-table__col--value').right,
        valueLabel: getComputedStyle(row.querySelector('.data-table__col--value .data-table__phone-label')!).display
      };
    });
    await ctx.close();
    expect(m.overflow).toBeLessThanOrEqual(0);
    expect(m.display).toBe('grid');
    expect(m.stock).toBeLessThanOrEqual(390);
    expect(m.value).toBeLessThanOrEqual(390);
    expect(m.valueLabel).not.toBe('none');
  });

  // Stacked below 1280px (with 14px table text, merged, it still scrolled up to ~1250px); from 1280px the category sits under the product (unmerged it needs ~1150px).
  it('inventory: the ledger never scrolls sideways, from phone to wide desktop', async () => {
    for (const w of [390, 768, 1024, 1100, 1180, 1199, 1200, 1280, 1366, 1440, 1600]) {
      const { ctx, page } = await open(w, 'inventory?stock=low_or_out', { reducedMotion: 'reduce' });
      const m = await page.evaluate(() => {
        const s = document.querySelector('.table-scroll')!;
        return { extra: s.scrollWidth - s.clientWidth, page: document.documentElement.scrollWidth - window.innerWidth };
      });
      expect(await page.getByRole('table', { name: 'Inventory' }).getByRole('columnheader').count(), `${w}: eleven column headers`).toBe(11);
      await ctx.close();
      expect(m.extra, `${w}: table overflow`).toBeLessThanOrEqual(1);
      expect(m.page, `${w}: page overflow`).toBeLessThanOrEqual(0);
    }
  });

  // DESIGN.md §12: a number column is right-aligned with tabular figures, its header level with the numbers. A cell's box
  // has the column's edges whatever its alignment, so the text edges are read with a Range. Stacked records keep their
  // numbers at the left, under their labels (below 1100px every stacking table; 1100-1279px Shipments and Inventory).
  it('number columns: right-aligned, tabular and level with their header at 1440; stacked records keep them at the left', async () => {
    // [page, number columns, a column whose values have several widths on the first page]
    const wide: Array<[string, string[], string]> = [
      ['inventory', ['quantity', 'reorderPoint', 'unitCost', 'value', 'daysOfSupply'], 'value'],
      ['shipments', ['cost'], 'cost']
    ];
    for (const [hash, keys, varied] of wide) {
      const { ctx, page } = await open(1440, hash, { reducedMotion: 'reduce' });
      const cols = await page.evaluate((keys: string[]) => {
        const edges = (el: Element) => {
          const r = document.createRange();
          r.selectNodeContents(el);
          const b = r.getBoundingClientRect();
          return [Math.round(b.left), Math.round(b.right)] as const;
        };
        return keys.map((k) => {
          const cells = [...document.querySelectorAll(`tbody td.data-table__col--${k}`)];
          return {
            k,
            rows: cells.length,
            lefts: new Set(cells.map((c) => edges(c)[0])).size,
            rights: [...new Set(cells.map((c) => edges(c)[1]))],
            head: edges(document.querySelector(`thead th.data-table__col--${k}`)!)[1],
            align: getComputedStyle(cells[0]!).textAlign,
            numeric: getComputedStyle(cells[0]!).fontVariantNumeric
          };
        });
      }, keys);
      await ctx.close();
      for (const c of cols) {
        expect(c.rows, `${hash} ${c.k}: rows`).toBe(25);
        expect(c.align, `${hash} ${c.k}`).toBe('right');
        expect(c.numeric, `${hash} ${c.k}`).toContain('tabular-nums');
        expect(c.rights, `${hash} ${c.k}: one right edge`).toHaveLength(1);
        expect(Math.abs(c.head - c.rights[0]!), `${hash} ${c.k}: header level with the numbers`).toBeLessThanOrEqual(1);
        if (c.k === varied) expect(c.lefts, `${hash} ${c.k}: values of several widths`).toBeGreaterThan(1);
      }
    }
    const stacked: Array<[number, string, string[]]> = [
      [390, 'inventory', ['quantity', 'value']],
      [1024, 'shipments', ['cost']],
      [1024, 'routes', ['count', 'avgCost']],
      [1200, 'inventory', ['quantity', 'value']],
      [1200, 'shipments', ['cost']]
    ];
    for (const [w, hash, keys] of stacked) {
      const { ctx, page } = await open(w, hash, { reducedMotion: 'reduce' });
      const aligns = await page.evaluate(
        (keys: string[]) => keys.map((k) => getComputedStyle(document.querySelector(`tbody td.data-table__col--${k}`)!).textAlign),
        keys
      );
      await ctx.close();
      expect(aligns, `${w} ${hash}: stacked numbers at the left`).toEqual(keys.map(() => 'left'));
    }
  }, 60_000);

  // DESIGN.md §9: running text keeps proportional figures. With tabular-nums on the body, Inter drew a hyphen
  // as wide as a digit (0.65em instead of 0.46em: "ELC - 0015", "On - time"). Number cells, figures and counters
  // keep tabular figures. A floor table's scroll covers are the paper, so a table that fits shows no pale band.
  it('running text has proportional figures and narrow hyphens; numbers stay tabular; no pale band at a table edge', async () => {
    const probe = async (hash: string, hyphenIn: string, tabular: string[]) => {
      const { ctx, page } = await open(1440, hash, { reducedMotion: 'reduce' });
      const m = await page.evaluate(([hyphenIn, tabular]: [string, string[]]) => {
        // The width of the first "-" inside an element, in em of its own font size.
        const hyphenEm = (el: Element | null): number | null => {
          if (el === null) return null;
          const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
          for (let n = walk.nextNode(); n !== null; n = walk.nextNode()) {
            const i = (n.textContent ?? '').indexOf('-');
            if (i < 0) continue;
            const r = document.createRange();
            r.setStart(n, i);
            r.setEnd(n, i + 1);
            return r.getBoundingClientRect().width / parseFloat(getComputedStyle(n.parentElement!).fontSize);
          }
          return null;
        };
        const scroll = document.querySelector('.page-floor .table-scroll');
        return {
          body: getComputedStyle(document.body).fontVariantNumeric,
          hyphen: hyphenEm(document.querySelector(hyphenIn)),
          tabular: tabular.map((s) => getComputedStyle(document.querySelector(s)!).fontVariantNumeric),
          cover: scroll === null ? null : (/rgba?\([^)]*\)/.exec(getComputedStyle(scroll).backgroundImage)?.[0] ?? ''),
          paper: getComputedStyle(document.body).backgroundColor
        };
      }, [hyphenIn, tabular] as [string, string[]]);
      await ctx.close();
      return m;
    };
    const pages = {
      inventory: await probe('inventory', 'tbody td.data-table__col--sku', ['tbody td.data-table__col--value', '.pagination__page']),
      analytics: await probe('analytics', '.figure-stage__figures .stage-figure__label', ['.risk-summary__value', '.meter-list__value', '.stage-figure__value']),
      dashboard: await probe('', 'tbody .activity__id', ['tbody .activity__cost', '.kind-row__count'])
    };
    for (const [name, m] of Object.entries(pages)) {
      expect(m.body, `${name}: body figures`).toBe('normal');
      expect(m.hyphen, `${name}: a hyphen was found`).not.toBeNull();
      expect(m.hyphen!, `${name}: hyphen width (em)`).toBeLessThan(0.55);
      for (const v of m.tabular) expect(v, name).toContain('tabular-nums');
    }
    expect(pages.inventory.cover, 'the scroll cover is the paper').toBe(pages.inventory.paper);
  }, 60_000);

  it('inventory: each attention figure links to a filter showing exactly that many items', async () => {
    const { ctx, page } = await open(1440, 'inventory', { reducedMotion: 'reduce' });
    const figures = await page.locator('#inventory-attention + ul a').evaluateAll((as: Element[]) =>
      as.map((a) => [Number(a.querySelector('.stage-figure__value')!.textContent!.replace(/,/g, '')), a.getAttribute('href')!] as const)
    );
    expect(figures).toHaveLength(4);
    for (const [count, href] of figures) {
      await page.goto(`${base}/${href}`);
      await page.waitForSelector('.table-summary');
      expect(await page.locator('.table-summary').textContent(), href).toMatch(new RegExp(`^${count} items? ·`));
    }
    await ctx.close();
  });

  // Routes: each lane figure links to a filter listing exactly that many lanes (map list plus unmapped table).
  it('routes: each lane figure links to a filter showing exactly that many lanes', async () => {
    const { ctx, page } = await open(1440, 'routes', { reducedMotion: 'reduce' });
    const figures = await page.locator('.figure-stage a').evaluateAll((as: Element[]) =>
      as.map((a) => [Number(a.querySelector('.stage-figure__value')!.textContent!.replace(/,/g, '')), a.getAttribute('href')!] as const)
    );
    expect(figures).toHaveLength(4);
    for (const [count, href] of figures) {
      await page.goto(`${base}/${href}`);
      await page.waitForSelector('.routes__summary');
      if (href.includes('lane=')) {
        const rows = (await page.locator('.route-map__list-button').count()) + (await page.locator('.routes-ledger tbody tr').count());
        expect(rows, href).toBe(count);
      }
      expect(await page.locator('.routes__summary').textContent(), href).toMatch(new RegExp(`^${count} lanes?`));
    }
    await ctx.close();
  });

  it('routes at 390px: map, lane list and unmapped table never scroll sideways; unmapped routes stack', async () => {
    const { ctx, page } = await open(390, 'routes', { reducedMotion: 'reduce' });
    const m = await page.evaluate(() => ({
      page: document.documentElement.scrollWidth - window.innerWidth,
      sideways: [...document.querySelectorAll('.route-map, .route-map *, .table-scroll, .control-rail')]
        .filter((e) => e.scrollWidth > e.clientWidth + 1)
        .map((e) => String((e as HTMLElement).className)),
      svgRight: document.querySelector('.route-map__svg')!.getBoundingClientRect().right,
      row: getComputedStyle(document.querySelector('.routes-ledger tbody tr')!).display
    }));
    expect(await page.getByRole('table', { name: 'Unmapped routes' }).getByRole('columnheader').count()).toBe(3);
    await ctx.close();
    expect(m.page).toBeLessThanOrEqual(0);
    expect(m.sideways).toEqual([]);
    expect(m.svgRight).toBeLessThanOrEqual(390);
    expect(m.row).toBe('grid');
  });

  // Phones: no scroll box nested in the page; the first ten lanes, then "Show all lanes"; warehouse labels only.
  it('routes at 390px: the lane list flows with the page (ten, then Show all lanes) and the map hides city labels', async () => {
    const { ctx, page } = await open(390, 'routes', { reducedMotion: 'reduce' });
    const read = () =>
      page.evaluate(() => {
        const list = document.querySelector('.route-map__list')!;
        const shown = (sel: string) => [...document.querySelectorAll(sel)].filter((e) => getComputedStyle(e).display !== 'none').length;
        return {
          overflowY: getComputedStyle(list).overflowY,
          maxHeight: getComputedStyle(list).maxHeight,
          nested: list.scrollHeight - list.clientHeight,
          lanes: shown('.route-map__list li'),
          cityLabels: shown('.route-map__marker--city .route-map__marker-label'),
          cityDots: shown('.route-map__marker--city .route-map__marker-shape'),
          warehouseLabels: shown('.route-map__marker--warehouse .route-map__marker-label')
        };
      });
    const before = await read();
    expect(before.overflowY).toBe('visible');
    expect(before.maxHeight).toBe('none');
    expect(before.nested).toBeLessThanOrEqual(1);
    expect(before.lanes).toBe(10);
    expect(before.cityLabels).toBe(0);
    expect(before.cityDots).toBeGreaterThan(0);
    expect(before.warehouseLabels).toBe(5);
    await page.getByRole('button', { name: 'Show all 25 lanes in the list' }).click();
    expect((await read()).lanes).toBe(25);
    await ctx.close();
  });

  it('routes at 1440px: a 10-20% lane is drawn in the same --warning amber as the stage figures', async () => {
    const { ctx, page } = await open(1440, 'routes', { reducedMotion: 'reduce' });
    const m = await page.evaluate(() => {
      const figure = getComputedStyle(document.querySelector('.stage-figure--warning .stage-figure__value')!).color;
      const lane = document.querySelector('.route-map__list-button--warning')!;
      const strokes = [...document.querySelectorAll('.route-map__path')].map((p) => getComputedStyle(p).stroke);
      return { figure, listTone: getComputedStyle(lane).boxShadow, strokes };
    });
    await ctx.close();
    expect(m.strokes).toContain(m.figure);
    expect(m.listTone).toContain(m.figure);
  });

  // The map has no red of its own: it reads the stage's --critical (#f2645a), not the old map red (#ef5b4e, rgb 239, 91, 78).
  it('routes at 1440px: a 20% or later lane, its list bar and its key line are drawn in the stage red', async () => {
    const { ctx, page } = await open(1440, 'routes', { reducedMotion: 'reduce' });
    const m = await page.evaluate(() => {
      const map = document.querySelector('.route-map')!;
      const stage = map.closest('.surface-stage');
      const critical = (el: Element | null) => (el ? getComputedStyle(el).getPropertyValue('--critical').trim() : null);
      const strokes = [...document.querySelectorAll('.route-map__path')].map((p) => getComputedStyle(p).stroke);
      return {
        inStage: stage !== null,
        mapRed: critical(map),
        stageRed: critical(stage),
        strokes,
        listTone: getComputedStyle(document.querySelector('.route-map__list-button--critical')!).boxShadow,
        key: getComputedStyle(document.querySelector('.route-map__key-line--critical')!).backgroundImage
      };
    });
    await ctx.close();
    const red = 'rgb(242, 100, 90)';
    expect(m.inStage).toBe(true);
    expect(m.stageRed).toBe('#f2645a');
    expect(m.mapRed, 'the map inherits the stage red').toBe(m.stageRed);
    expect(m.strokes).toContain(red);
    expect(m.strokes).not.toContain('rgb(239, 91, 78)');
    expect(m.listTone).toContain(red);
    expect(m.key).toContain(red);
  });

  // Alerts: each severity and type figure links to a filter showing exactly that many alerts.
  it('alerts: each figure links to a filter showing exactly that many alerts', async () => {
    const { ctx, page } = await open(1440, 'alerts', { reducedMotion: 'reduce' });
    const figures = await page.locator('.figure-stage a').evaluateAll((as: Element[]) =>
      as.map((a) => [Number(a.querySelector('.stage-figure__value')!.textContent!.replace(/,/g, '')), a.getAttribute('href')!] as const)
    );
    expect(figures).toHaveLength(8); // three severities, five types
    for (const [count, href] of figures) {
      await page.goto(`${base}/${href}`);
      await page.waitForSelector('.table-summary');
      // A view holding both kinds of row adds " · N need attention · M info" after the count (the count
      // itself is still the figure's number, as Inventory's "N items ·" above).
      expect(await page.locator('.table-summary').textContent(), href).toMatch(new RegExp(`^${count} alerts?( · |$)`));
    }
    await ctx.close();
  });

  it('alerts at 390px: stacked records keep table roles; severity, type, title, message and entity on screen', async () => {
    const { ctx, page } = await open(390, 'alerts', { reducedMotion: 'reduce' });
    const table = page.getByRole('table', { name: 'Alerts' });
    expect(await table.getByRole('columnheader').count()).toBe(5);
    expect(await table.getByRole('row').nth(1).getByRole('cell').count()).toBe(5);
    const m = await page.evaluate(() => {
      const row = document.querySelector('.alerts-ledger tbody tr')!;
      const right = (sel: string) => row.querySelector(sel)!.getBoundingClientRect().right;
      return {
        page: document.documentElement.scrollWidth - window.innerWidth,
        display: getComputedStyle(row).display,
        rights: ['severity', 'type', 'title', 'message', 'entity'].map((k) => right(`.data-table__col--${k}`)),
        rule: getComputedStyle(row).boxShadow
      };
    });
    await ctx.close();
    expect(m.page).toBeLessThanOrEqual(0);
    expect(m.display).toBe('grid');
    for (const r of m.rights) expect(r).toBeLessThanOrEqual(390);
    expect(m.rule).toContain('inset');
  });

  // Stacked below 1280px (the five-column table still scrolled sideways up to ~1230px); a plain table from 1280px.
  it('alerts: the ledger never scrolls sideways, from phone to desktop', async () => {
    for (const w of [390, 768, 1024, 1100, 1180, 1279, 1280, 1366, 1440]) {
      const { ctx, page } = await open(w, 'alerts', { reducedMotion: 'reduce' });
      const m = await page.evaluate(() => {
        const s = document.querySelector('.table-scroll')!;
        return {
          extra: s.scrollWidth - s.clientWidth,
          page: document.documentElement.scrollWidth - window.innerWidth,
          row: getComputedStyle(document.querySelector('.alerts-ledger tbody tr')!).display
        };
      });
      await ctx.close();
      expect(m.extra, `${w}: table overflow`).toBeLessThanOrEqual(1);
      expect(m.page, `${w}: page overflow`).toBeLessThanOrEqual(0);
      expect(m.row, `${w}: row display`).toBe(w < 1280 ? 'grid' : 'table-row');
    }
  });

  // IDs never break at their hyphen: every ID on the ledgers sits on a single line box.
  it('ids (SHP-, SKU, WH-) never break across lines on the Alerts, Shipments and Inventory ledgers', async () => {
    for (const w of [390, 1100, 1440]) {
      for (const hash of ['alerts', 'shipments', 'inventory']) {
        const { ctx, page } = await open(w, hash, { reducedMotion: 'reduce' });
        const broken = await page.evaluate(() =>
          [...document.querySelectorAll('.id-code, .code-tag')].filter((e) => e.getClientRects().length > 1).map((e) => e.textContent)
        );
        expect(await page.locator('.id-code').count(), `${w} #/${hash}: ids found`).toBeGreaterThan(0);
        await ctx.close();
        expect(broken, `${w} #/${hash}`).toEqual([]);
      }
    }
  });

  // Analytics: no sideways scroll from phone to desktop; green only where it means delivered (the status bar reads the shared
  // status tones), ink data, red delays.
  it('analytics: nothing scrolls sideways at 390/768/1440 and charts use the system tones', async () => {
    for (const w of [390, 768, 1440]) {
      const { ctx, page } = await open(w, 'analytics', { reducedMotion: 'reduce' });
      const m = await page.evaluate(() => {
        const floor = [...document.querySelectorAll('.page *')];
        const colors = floor.filter((e) => !e.closest('.share-bar')).map((e) => `${getComputedStyle(e).fill} ${getComputedStyle(e).backgroundColor}`).join(' ');
        return {
          page: document.documentElement.scrollWidth - window.innerWidth,
          sideways: floor
            .filter((e) => e.scrollWidth > e.clientWidth + 1 && !['visible', 'hidden', 'clip'].includes(getComputedStyle(e).overflowX))
            .map((e) => String((e as HTMLElement).className)),
          green: colors.includes('rgb(27, 110, 68)'),
          delivered: [...document.querySelectorAll('.share-bar__item')].filter((li) => li.querySelector('.share-bar__label')?.textContent === 'Delivered').map((li) => getComputedStyle(li.querySelector('.share-bar__swatch')!).backgroundColor),
          barRight: document.querySelector('.share-bar__track')!.getBoundingClientRect().right
        };
      });
      await ctx.close();
      expect(m.page, `${w}`).toBeLessThanOrEqual(0);
      expect(m.sideways, `${w}`).toEqual([]);
      expect(m.green, `${w}: no green outside the status bar`).toBe(false);
      expect(m.delivered, `${w}: Delivered is --good`).toEqual(['rgb(27, 110, 68)']);
      expect(m.barRight, `${w}`).toBeLessThanOrEqual(w);
    }
  });

  it('data import: nothing scrolls sideways from phone to desktop; the import cards sit open on the paper', async () => {
    for (const w of [390, 768, 1100, 1440]) {
      const { ctx, page } = await open(w, 'import', { reducedMotion: 'reduce' });
      const m = await page.evaluate(() => ({
        page: document.documentElement.scrollWidth - window.innerWidth,
        sideways: [...document.querySelectorAll('.page *')]
          .filter((e) => e.scrollWidth > e.clientWidth + 1 && !['visible', 'hidden', 'clip'].includes(getComputedStyle(e).overflowX))
          .map((e) => String((e as HTMLElement).className)),
        cards: [...document.querySelectorAll('.import-floor > .card, .import-floor > .import-grid > .card')].map((c) => getComputedStyle(c).backgroundColor)
      }));
      await ctx.close();
      expect(m.page, `${w}`).toBeLessThanOrEqual(0);
      expect(m.sideways, `${w}`).toEqual([]);
      for (const bg of m.cards) expect(bg, `${w}`).toBe('rgba(0, 0, 0, 0)');
    }
  });

  // G1 fix: the stage of Data Import holds only its title, so it is a slim band (it was 112px tall and empty at 1440).
  it('data import: the dark stage is a slim band holding only the title, from phone to desktop', async () => {
    for (const w of [390, 768, 1100, 1440]) {
      const { ctx, page } = await open(w, 'import', { reducedMotion: 'reduce' });
      const stage = await page.evaluate(() => {
        const s = document.querySelector('.page-stage') as HTMLElement;
        return { height: s.getBoundingClientRect().height, text: s.innerText.trim() };
      });
      await ctx.close();
      expect(stage.text, `${w}`).toBe('Data Import');
      expect(stage.height, `${w}`).toBeLessThanOrEqual(64);
    }
  });

  // DESIGN.md "The page band": the dark band is at most 256px tall from 768px and at most 360px below; the
  // slim band (Data Import, Page not found) at most 64px. Pages that still hold figures, a map or controls in the band are
  // brought to the rule in Phase 2, so their cases are `it.fails`: each turns red the day its page complies, and then moves
  // to `it`. Measured when the rule came in (1440 / 1024 / 768 / 390): Inventory 358 / 358 / 377 / 419, Shipments 377 / 394 / 394 /
  // 516, Routes 1148 / 1215 / 1215 / 1804, Analytics 359 / 376 / 376 / 452, Alerts 360 / 438 / 457 / 576; both slim bands 63.
  const BAND_WIDTHS = [1440, 1024, 768, 390];
  const BAND_PAGES: Array<{ name: string; hash: string; slim: boolean; phase2: boolean }> = [
    { name: 'Data Import', hash: 'import', slim: true, phase2: false },
    { name: 'Page not found', hash: 'nope', slim: true, phase2: false },
    { name: 'Inventory', hash: 'inventory', slim: false, phase2: true },
    { name: 'Shipments', hash: 'shipments', slim: false, phase2: true },
    { name: 'Routes', hash: 'routes', slim: false, phase2: true },
    { name: 'Analytics', hash: 'analytics', slim: false, phase2: true },
    { name: 'Alerts', hash: 'alerts', slim: false, phase2: true }
  ];
  for (const { name, hash, slim, phase2 } of BAND_PAGES) {
    const title = `page band: ${name} is at most ${slim ? '64px tall' : '256px tall from 768px and 360px below'}${phase2 ? ' (Phase 2)' : ''}`;
    const check = async () => {
      for (const w of BAND_WIDTHS) {
        const { ctx, page } = await open(w, hash, { reducedMotion: 'reduce' });
        const height: number = await page.evaluate(() => (document.querySelector('.page-stage') as HTMLElement).getBoundingClientRect().height);
        await ctx.close();
        expect(height, `${name} at ${w}`).toBeLessThanOrEqual(slim ? 64 : w >= 768 ? 256 : 360);
      }
    };
    if (phase2) it.fails(title, check, 60_000);
    else it(title, check, 60_000);
  }

  // V16-BUG-1 (pre-existing since V1.5), fixed in V1.6 fix round 1 (S-1).
  it('V16-BUG-1: with the mobile drawer closed, keyboard Tab must not land on off-screen sidebar links', async () => {
    const { ctx, page } = await open(390, '');
    const xs: number[] = [];
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('Tab');
      xs.push(await page.evaluate(() => Math.round(document.activeElement!.getBoundingClientRect().x)));
    }
    await ctx.close();
    expect(xs.every((x) => x >= 0), `focused x positions: ${xs.join(',')}`).toBe(true);
  });
});
