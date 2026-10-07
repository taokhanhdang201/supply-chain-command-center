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

  it('dashboard keeps every V1.5 value verbatim', async () => {
    const { ctx, page, errors } = await open(1440, '');
    const t = (await text(page)).toLowerCase();
    for (const v of ['$32.64m', '258,475 units in 360 records', '480', '34 active · 13 cancelled', '85.6%', '364 of 425 delivered on time', '73', '12 overdue · 61 delivered late', '20', '6 out of stock', '$600.1k', 'avg $1,285.04 per shipment', '3.1 days', '57', '67 total · 10 info', 'pending 14', 'in transit 20', 'delivered 433', 'cancelled 13', 'shp-100065', '$908.19'])
      expect(t, v).toContain(v);
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
      const targets: Array<[string, number]> = [['.hero__value', 3], ['.hero__label', 4.5], ['.hero__detail', 4.5], ['.situation__title', 4.5], ['.situation .figure__label', 4.5], ['.situation .figure__detail', 4.5], ['.situation .figure--critical .figure__value', 3], ['.atlas-caption', 4.5], ['.status-list__link', 4.5], ['.flow-figure__subtitle', 4.5], ['.nodes .rack__code', 4.5], ['.nodes .rack__value', 4.5], ['.attention .attention__kinds a', 4.5], ['.attention .queue-row__what', 4.5], ['.attention .queue-row__damage', 4.5], ['.attention .queue-row__action', 4.5], ['.attention .attention__how > summary', 4.5], ['.movement .activity__carrier', 4.5], ['.movement .activity__date', 4.5]];
      return targets.map(([sel, min]) => {
        const el = document.querySelector(sel) as HTMLElement;
        const a = lum(rgb(getComputedStyle(el).color)), b = lum(rgb(solidBg(el)));
        return { sel, ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05), min };
      });
    });
    for (const r of results) expect(r.ratio, r.sel).toBeGreaterThanOrEqual(r.min);
    await ctx.close();
  });

  // "Do these first" (docs/DASHBOARD-ALERTS.md; it replaced the 20/37/10 figures, whose contrast targets moved above):
  // every row is one link of at most two lines at 1440, Tab reaches the rows in order, and a phone never scrolls sideways.
  it('atlas dashboard: "Do these first" rows are links of at most two lines at 1440, in tab order, and fit a phone', async () => {
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
        await page.locator('.attention .dash-link').focus();
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

  // The design rules the V2 specification measures (section i): one grid, five identical racks, six type sizes, no uppercase.
  it('atlas dashboard: one grid, five identical racks, six type sizes, no uppercase, no overflow', async () => {
    for (const w of [1440, 1024, 768, 390]) {
      const { ctx, page } = await open(w, '', { reducedMotion: 'reduce' });
      const m = await page.evaluate(() => {
        const box = (el: Element) => { const b = el.getBoundingClientRect(); return { x: b.left, y: b.top + scrollY, w: b.width, h: b.height }; };
        const q = (s: string) => [...document.querySelectorAll(s)];
        const visibleText = q('.atlas-page *').filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? '').trim()) && e.getBoundingClientRect().width > 0 && !e.closest('.visually-hidden') && e.tagName !== 'title' && !e.closest('.select-field'));
        const hero = document.querySelector('.hero__value') as HTMLElement;
        // Below 768px the h1 is visually hidden on purpose (atlas.css: 1x1, clipped, margin -1px), so its box is not part of
        // the visible layout and only counts toward the shared left edge when it is actually shown.
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
      expect(m.h1Hidden, `${w}: h1 visually hidden only on phones`).toBe(w < 768);
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
      // Scene order: Situation (dark), Attention (dark), Flow (paper), Nodes (dark), Movement (paper).
      expect(m.sceneBg.length).toBe(5);
      expect(m.sceneBg[0]).toBe(m.sceneBg[1]);
      expect(m.sceneBg[1]).toBe(m.sceneBg[3]);
      expect(m.sceneBg[2]).toBe(m.sceneBg[4]);
      expect(m.sceneBg[0]).not.toBe(m.sceneBg[2]);
      await ctx.close();
    }
  }, 60_000);

  it('inventory, shipments, alerts, analytics and import keep their values', async () => {
    const checks: Array<[string, string[]]> = [
      ['inventory', ['360 items · $32,643,371.48', 'ELC-0015', '$1,403,217.18', 'Showing 1–25 of 360']],
      ['shipments', ['480 shipments', 'SHP-100200', '$545.08', 'Page 1 of 20']],
      ['alerts', ['Showing 1–25 of 67', 'Out of stock: APP-0005']],
      ['analytics', ['11.17×', 'DIO 32.7 days · 356 of 360 items have usage data', '$1,285.04', '3.1 days', '85.6%', '76.9%', '63.5%', '56.5%', '85.1%', '92.4%']],
      // G1: Data Import opens on the waiting state (the "Current data sources" figures were removed, G0 §4; the top bar
      // names each source, checked below)
      ['import', ['Drop your file', 'CSV, TSV, TXT or GZ file. Up to 2 MB.', 'No file? Try one.']]
    ];
    for (const [hash, vals] of checks) {
      const { ctx, page } = await open(1440, hash);
      const t = await text(page);
      for (const v of vals) expect(t, `${hash}: ${v}`).toContain(v);
      if (hash === 'import') expect(await page.locator('.topbar__chip').allTextContents()).toEqual(['Inventory: Sample data (seed 42)', 'Shipments: Sample data (seed 42)']);
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

  it('URL-synced filters keep working with the new controls', async () => {
    const { ctx, page } = await open(1440, 'inventory');
    await page.getByLabel('Stock status', { exact: true }).selectOption('low_or_out');
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => location.hash)).toBe('#/inventory?stock=low_or_out');
    expect(await text(page)).toContain('20 items · $449,642.20');
    await page.goto(`${base}/#/shipments?flag=delayed`);
    await page.reload();
    await page.waitForTimeout(400);
    expect(await text(page)).toContain('73 shipments');
    await ctx.close();
  });

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
    const n = await page.locator('nav a').count();
    expect(n).toBe(7);
    for (const i of [1, 2, 3, 4, 5, 6]) {
      await page.locator('nav a').nth(i).click();
      await page.waitForTimeout(200);
      expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('H1');
    }
    await ctx.close();
  });

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

  // No sideways scroll at any width: stacked records below 1100px; from 1100px to 1439px the carrier sits under the
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

  // Stacked below 1200px (merged, it still scrolled up to ~1170px); 1200-1599px the category sits under the product.
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
    await page.getByRole('button', { name: /^Show all lanes/ }).click();
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
      expect(await page.locator('.table-summary').textContent(), href).toBe(`${count} alert${count === 1 ? '' : 's'}`);
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

  // Analytics: no sideways scroll from phone to desktop, no free green or blue in the charts (ink data, red delays).
  it('analytics: nothing scrolls sideways at 390/768/1440 and charts use the system tones', async () => {
    for (const w of [390, 768, 1440]) {
      const { ctx, page } = await open(w, 'analytics', { reducedMotion: 'reduce' });
      const m = await page.evaluate(() => {
        const floor = [...document.querySelectorAll('.page *')];
        const colors = floor.map((e) => `${getComputedStyle(e).fill} ${getComputedStyle(e).backgroundColor}`).join(' ');
        return {
          page: document.documentElement.scrollWidth - window.innerWidth,
          sideways: floor
            .filter((e) => e.scrollWidth > e.clientWidth + 1 && !['visible', 'hidden', 'clip'].includes(getComputedStyle(e).overflowX))
            .map((e) => String((e as HTMLElement).className)),
          green: colors.includes('rgb(27, 110, 68)'),
          barRight: document.querySelector('.share-bar__track')!.getBoundingClientRect().right
        };
      });
      await ctx.close();
      expect(m.page, `${w}`).toBeLessThanOrEqual(0);
      expect(m.sideways, `${w}`).toEqual([]);
      expect(m.green, `${w}: no green on the page`).toBe(false);
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
