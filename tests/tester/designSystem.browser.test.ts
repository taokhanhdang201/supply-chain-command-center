// The shared design-system parts in a real browser on the production build: the average cost per shipment to the cent, the
// target tone (only the number turns amber, the gauge stays neutral and carries a target tick), the month to date on every month
// axis, one square mark, link figures underlined at rest, shares to one decimal, one-line chart card headers, the sidebar's foot
// outside the Main landmark, and the banner's live region. Seed 42, today 2026-10-07.
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
import { buildSampleFile } from '../../src/client/import/sampleFiles';

const PW_DIR = process.env.SCC_PW_DIR ? path.resolve(process.env.SCC_PW_DIR) : process.cwd();
const CHROME = process.env.SCC_CHROME || undefined;
const TODAY = '2026-10-07';
const AMBER = 'rgb(240, 164, 58)';
const BANNER_TITLE = 'Someone imported a file.';

describe('design-system parts on the dashboard and analytics (real Chromium, real server)', () => {
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
    const problems: string[] = [];
    page.on('console', (m: any) => {
      if (m.type() === 'error') problems.push(`error: ${m.text()}`);
    });
    page.on('pageerror', (e: any) => problems.push(`pageerror: ${String(e)}`));
    await page.goto(`${base}/#/${hash}`);
    await page.waitForSelector('main h1');
    await page.waitForTimeout(300);
    return { ctx, page, problems };
  };

  /** The colour a design token resolves to inside a page element, read through a probe so the test names tokens, not rgb. */
  const tokenColor = (page: any, scope: string, token: string): Promise<string> =>
    page.evaluate(
      ([s, t]: [string, string]) => {
        const host = document.querySelector(s) ?? document.body;
        const probe = document.createElement('i');
        probe.style.color = `var(${t})`;
        host.appendChild(probe);
        const c = getComputedStyle(probe).color;
        probe.remove();
        return c;
      },
      [scope, token]
    );

  // ------------------------------------------------------------------------------------------------ average cost to the cent
  it.each([1440, 390])('at %ipx reads the average cost per shipment to the cent on the Dashboard and on Analytics, never rounded to a dollar', async (w) => {
    const dash = await open(w, '');
    const flow = await dash.page.locator('.flow__figures').innerText();
    const dashBody = await dash.page.locator('body').innerText();
    await dash.ctx.close();
    const an = await open(w, 'analytics');
    const band = await an.page.locator('.figure-stage__figures').innerText();
    const anBody = await an.page.locator('body').innerText();
    await an.ctx.close();
    expect(flow).toContain('Avg $1,285.04 per shipment');
    expect(band).toMatch(/avg \$1,285\.04 per shipment/i);
    for (const text of [dashBody, anBody]) expect(text).not.toMatch(/avg \$1,285 per/i);
  }, 60_000);

  // ------------------------------------------------------------------------------------------------ target tone
  it('colours only the on-time number amber while it is below the target, on the Dashboard and on Analytics', async () => {
    const dash = await open(1440, '');
    const hero = await dash.page.evaluate(() => {
      const v = document.querySelector('.hero__value') as HTMLElement;
      const label = document.querySelector('.hero__label') as HTMLElement;
      return { text: v.textContent, color: getComputedStyle(v).color, label: getComputedStyle(label).color };
    });
    await dash.ctx.close();
    const an = await open(1440, 'analytics');
    const stage = await an.page.evaluate(() => {
      const v = document.querySelector('.stage-figure--warning .stage-figure__value') as HTMLElement;
      const label = document.querySelector('.stage-figure--warning .stage-figure__label') as HTMLElement;
      return { text: v.textContent, color: getComputedStyle(v).color, label: getComputedStyle(label).color };
    });
    await an.ctx.close();
    expect(hero.text).toBe('85.6%');
    expect(hero.color).toBe(AMBER);
    expect(hero.label, 'the label stays plain').not.toBe(AMBER);
    expect(stage.text).toBe('85.6%');
    expect(stage.color).toBe(AMBER);
    expect(stage.label, 'the label stays plain').not.toBe(AMBER);
  }, 60_000);

  it('colours the 92.4% warehouse amber in the utilization list and leaves the warehouses below 90% in plain text', async () => {
    const { ctx, page } = await open(1440, 'analytics');
    const m = await page.evaluate(() =>
      [...document.querySelectorAll('.meter-list__value')].map((e) => {
        const bar = e.closest('li')?.querySelector('.meter__bar') as HTMLElement | null;
        return { text: e.textContent, color: getComputedStyle(e).color, bar: bar === null ? null : getComputedStyle(bar).backgroundColor };
      })
    );
    await ctx.close();
    expect(m.map((x) => x.text)).toEqual(['76.9%', '63.5%', '56.5%', '85.1%', '92.4%']);
    const newark = m[4]!;
    expect(newark.color).toBe('rgb(154, 82, 0)');
    const plain = m.slice(0, 4).map((x) => x.color);
    expect(new Set(plain).size, 'the four below 90% share one plain colour').toBe(1);
    expect(plain[0]).not.toBe(newark.color);
    // The bar is a neutral bar for every warehouse, the 92.4% one too.
    expect(new Set(m.map((x) => x.bar)).size).toBe(1);
  }, 60_000);

  it('turns only the 92.4% rack percentage amber on the Dashboard and leaves the other racks in the stage ink', async () => {
    const { ctx, page } = await open(1440, '');
    const racks = await page.evaluate(() => [...document.querySelectorAll('.rack__pct')].map((e) => ({ text: e.textContent, color: getComputedStyle(e).color })));
    const over = await page.locator('.rack--over').count();
    await ctx.close();
    expect(racks.map((r) => r.text)).toEqual(['76.9%', '63.5%', '56.5%', '85.1%', '92.4%']);
    expect(racks[4]!.color).toBe(AMBER);
    expect(new Set(racks.slice(0, 4).map((r) => r.color)).size).toBe(1);
    expect(racks[0]!.color).not.toBe(AMBER);
    expect(over, 'no warehouse is over capacity in the sample').toBe(0);
  }, 60_000);

  it('draws the gauges in neutral ink with a 2px by 8px amber target tick at 90%', async () => {
    const dash = await open(1440, '');
    const hero = await dash.page.evaluate(() => {
      const g = document.querySelector('.hero__gauge') as HTMLElement;
      const after = getComputedStyle(g, '::after');
      return { image: getComputedStyle(g).backgroundImage, width: g.getBoundingClientRect().width, tick: { w: after.width, h: after.height, bg: after.backgroundColor, left: after.left } };
    });
    const heroWarning = await tokenColor(dash.page, '.hero__gauge', '--warning');
    const heroSignal = await tokenColor(dash.page, '.hero__gauge', '--critical');
    await dash.ctx.close();
    const an = await open(1440, 'analytics');
    const stage = await an.page.evaluate(() => {
      const g = document.querySelector('.stage-gauge') as HTMLElement;
      const after = getComputedStyle(g, '::after');
      return { image: getComputedStyle(g).backgroundImage, width: g.getBoundingClientRect().width, tick: { w: after.width, h: after.height, bg: after.backgroundColor, left: after.left } };
    });
    const stageWarning = await tokenColor(an.page, '.stage-gauge', '--warning');
    const stageSignal = await tokenColor(an.page, '.stage-gauge', '--critical');
    await an.ctx.close();
    for (const [name, g, warning, signal] of [['hero', hero, heroWarning, heroSignal], ['stage', stage, stageWarning, stageSignal]] as const) {
      expect(g.image, `${name}: the filled and the remaining part are not amber`).not.toContain(warning);
      expect(g.image, `${name}: nor red`).not.toContain(signal);
      expect(g.tick.w, `${name}: tick width`).toBe('2px');
      expect(g.tick.h, `${name}: tick height`).toBe('8px');
      expect(g.tick.bg, `${name}: tick colour`).toBe(warning);
      expect(Math.abs(parseFloat(g.tick.left) - (g.width * 0.9 - 1)), `${name}: tick sits at 90%`).toBeLessThan(1);
    }
  }, 60_000);

  // ------------------------------------------------------------------------------------------------ chart card header
  it.each([1440, 390])('at %ipx keeps every chart card header level and on one line, with a Table toggle that flips aria-pressed', async (w) => {
    const { ctx, page } = await open(w, 'analytics');
    const m = await page.evaluate(() => {
      const headers = [...document.querySelectorAll('.chart-card .card__header')] as HTMLElement[];
      return headers.map((h) => {
        const t = h.querySelector('h3') as HTMLElement;
        const lh = parseFloat(getComputedStyle(t).lineHeight);
        return { title: t.textContent, top: Math.round(h.getBoundingClientRect().top), height: h.getBoundingClientRect().height, titleHeight: t.getBoundingClientRect().height, lh };
      });
    });
    const toggle = page.locator('.chart-card__toggle').first();
    const before = await toggle.getAttribute('aria-pressed');
    const word = await toggle.innerText();
    await toggle.click();
    const after = await page.locator('.chart-card__toggle').first().getAttribute('aria-pressed');
    const word2 = await page.locator('.chart-card__toggle').first().innerText();
    await ctx.close();
    expect(m).toHaveLength(6);
    for (const row of m) expect(row.titleHeight, `${row.title} on one line`).toBeLessThanOrEqual(row.lh + 1);
    const byRow = new Map<number, number[]>();
    for (const row of m) byRow.set(row.top, [...(byRow.get(row.top) ?? []), row.height]);
    for (const heights of byRow.values()) expect(Math.max(...heights) - Math.min(...heights), 'headers of one row have one height').toBeLessThanOrEqual(1);
    expect(word).toBe('Table');
    expect(word2, 'the word does not change, only the pressed state').toBe('Table');
    expect([before, after]).toEqual(['false', 'true']);
  }, 60_000);

  // ------------------------------------------------------------------------------------------------ status bar
  it('reads the status shares to one decimal, with Pending hatched, In transit solid and Cancelled hollow, and a 2px edge between parts', async () => {
    const { ctx, page } = await open(1440, 'analytics');
    const m = await page.evaluate(() => {
      const segs = [...document.querySelectorAll('.share-bar__track .share-bar__segment')] as HTMLElement[];
      return {
        shares: [...document.querySelectorAll('.share-bar__share')].map((e) => e.textContent),
        segs: segs.map((s) => {
          const a = getComputedStyle(s, '::after');
          return { cls: s.className, content: a.content, image: a.backgroundImage, inset: a.top, left: getComputedStyle(s).borderLeftWidth };
        })
      };
    });
    await ctx.close();
    expect(m.shares).toEqual(['2.9%', '4.2%', '90.2%', '2.7%']);
    expect(m.segs).toHaveLength(4);
    expect(m.segs[0]!.cls).toContain('share-bar__segment--hatched');
    expect(m.segs[0]!.image, 'hatched stripes').toContain('repeating-linear-gradient');
    expect(m.segs[1]!.cls).not.toMatch(/hatched|hollow/);
    expect(m.segs[1]!.content, 'a solid part has nothing laid over it').toMatch(/none|normal/);
    expect(m.segs[3]!.cls).toContain('share-bar__segment--hollow');
    expect(m.segs[3]!.inset, 'the hollow part keeps a 1px edge').toBe('1px');
    expect(m.segs.map((s) => s.left)).toEqual(['0px', '2px', '2px', '2px']);
  }, 60_000);

  // ------------------------------------------------------------------------------------------------ month to date
  it.each([1440, 390])('at %ipx ends every month axis on "Oct*", cut nowhere and run into nothing, with the note and the starred table row', async (w) => {
    const dash = await open(w, '');
    const dashAxes = await dash.page.evaluate(() => {
      const texts = [...document.querySelectorAll('svg text')] as SVGTextElement[];
      return texts.filter((t) => /^(Sep|Oct\*?)$/.test(t.textContent ?? '')).map((t) => ({ text: t.textContent, left: t.getBoundingClientRect().left, right: t.getBoundingClientRect().right, y: Math.round(t.getBoundingClientRect().top) }));
    });
    const dashNotes = await dash.page.locator('.chart-frame__note').allInnerTexts();
    await dash.page.getByRole('button', { name: 'Show data table' }).first().click();
    const dashRows = await dash.page.locator('table tbody tr td:first-child').allInnerTexts();
    await dash.ctx.close();
    const an = await open(w, 'analytics');
    const anAxes = await an.page.evaluate(() => {
      const texts = [...document.querySelectorAll('svg text')] as SVGTextElement[];
      return texts.filter((t) => /^(Sep|Oc.*)$/.test(t.textContent ?? '')).map((t) => ({ text: t.textContent, left: t.getBoundingClientRect().left, right: t.getBoundingClientRect().right, y: Math.round(t.getBoundingClientRect().top) }));
    });
    const anNotes = await an.page.locator('.chart-frame__note').allInnerTexts();
    await an.page.locator('.chart-card', { hasText: 'Shipping cost over time' }).locator('.chart-card__toggle').click();
    const anRows = await an.page.locator('.chart-card', { hasText: 'Shipping cost over time' }).locator('tbody tr td:first-child').allInnerTexts();
    await an.ctx.close();
    for (const [name, axes] of [['dashboard', dashAxes], ['analytics', anAxes]] as const) {
      expect(axes.filter((a) => a.text === 'Oct*'), `${name}: two month axes end on Oct*`).toHaveLength(2);
      expect(axes.some((a) => (a.text ?? '').includes('…') || a.text === 'Oc'), `${name}: no label is cut`).toBe(false);
      for (const a of axes.filter((x) => x.text === 'Oct*')) {
        const sep = axes.find((s) => s.text === 'Sep' && s.y === a.y);
        expect(sep, `${name}: the Sep label of the same axis`).toBeDefined();
        expect(sep!.right, `${name}: Sep and Oct* do not overlap`).toBeLessThan(a.left);
      }
    }
    for (const notes of [dashNotes, anNotes]) expect(notes).toContain('Oct* is month to date (Oct 1–7).');
    expect(dashRows.concat(anRows)).toContain('Oct 2026*');
    expect(anRows.slice(0, -1).every((r) => !r.includes('*')), 'finished months carry no asterisk').toBe(true);
  }, 90_000);

  // ------------------------------------------------------------------------------------------------ marks
  it('draws the alert glyph and every status mark as one 8px square with a 1px radius, in the form of its status', async () => {
    const { ctx, page } = await open(1440, '');
    const m = await page.evaluate(() => {
      const shapes = (sel: string) => [...document.querySelectorAll(sel)].map((e) => ({ cls: e.getAttribute('class'), kids: [...e.children].map((c) => ({ tag: c.tagName.toLowerCase(), w: c.getAttribute('width'), h: c.getAttribute('height'), rx: c.getAttribute('rx') })) }));
      return { glyphs: shapes('.alert-glyph'), marks: shapes('.activity .status-mark, .status-mark') };
    });
    await ctx.close();
    expect(m.glyphs.length).toBeGreaterThan(0);
    expect(m.marks.length).toBeGreaterThan(0);
    for (const s of [...m.glyphs, ...m.marks]) expect(s.kids, s.cls ?? '').toEqual([{ tag: 'rect', w: '8', h: '8', rx: '1' }]);
    for (const s of m.marks) {
      if (/status-mark--(in_transit|delivered)/.test(s.cls ?? '')) expect(s.cls).toContain('status-mark--solid');
      if (/status-mark--pending/.test(s.cls ?? '')) expect(s.cls).toContain('status-mark--hatched');
      if (/status-mark--cancelled/.test(s.cls ?? '')) expect(s.cls).toContain('status-mark--hollow');
    }
  }, 60_000);

  // ------------------------------------------------------------------------------------------------ link figures
  it('underlines the label of a link figure at rest in the stage line colour, darkens it on hover, and leaves a figure without a link plain', async () => {
    const dash = await open(1440, '');
    const dashLine = await tokenColor(dash.page, '.atlas-page', '--stage-line-strong');
    const dashText = await tokenColor(dash.page, '.atlas-page', '--stage-text');
    const read = (page: any, sel: string) =>
      page.evaluate((s: string) => {
        const e = document.querySelector(s) as HTMLElement;
        const c = getComputedStyle(e);
        return { line: c.textDecorationLine, thickness: c.textDecorationThickness, color: c.textDecorationColor, offset: c.textUnderlineOffset, cursor: c.cursor };
      }, sel);
    const dashRest = await read(dash.page, '.atlas-page a.figure .figure__label');
    await dash.page.locator('.atlas-page a.figure').first().hover();
    await dash.page.waitForTimeout(350);
    const dashHover = await read(dash.page, '.atlas-page a.figure .figure__label');
    await dash.ctx.close();

    const sh = await open(1440, 'shipments');
    const anLine = await tokenColor(sh.page, '.figure-stage', '--stage-line-strong');
    const anText = await tokenColor(sh.page, '.figure-stage', '--stage-text');
    const anRest = await read(sh.page, 'a.stage-figure .stage-figure__label');
    await sh.page.locator('a.stage-figure').first().hover();
    await sh.page.waitForTimeout(350);
    const anHover = await read(sh.page, 'a.stage-figure .stage-figure__label');
    await sh.ctx.close();

    const an = await open(1440, 'analytics');
    const plain = await an.page.evaluate(() =>
      [...document.querySelectorAll('.stage-figure')].filter((f) => f.tagName !== 'A').map((f) => getComputedStyle(f.querySelector('.stage-figure__label') as HTMLElement).textDecorationLine)
    );
    await an.ctx.close();

    for (const [name, rest, hover, line, text] of [['dashboard', dashRest, dashHover, dashLine, dashText], ['shipments', anRest, anHover, anLine, anText]] as const) {
      expect(rest.line, `${name}: underlined at rest`).toContain('underline');
      expect(rest.thickness, `${name}: 1px`).toBe('1px');
      expect(rest.offset, `${name}: 3px away`).toBe('3px');
      expect(rest.color, `${name}: stage line colour`).toBe(line);
      expect(rest.cursor, `${name}: pointer`).toBe('pointer');
      expect(hover.color, `${name}: the stage ink on hover`).toBe(text);
    }
    expect(plain.length, 'Analytics has figures without a link').toBeGreaterThan(0);
    for (const p of plain) expect(p, 'a figure without a link is not underlined').toBe('none');
  }, 90_000);

  // ------------------------------------------------------------------------------------------------ atlas sentence
  it('writes the share of the most delayed lane to one decimal and keeps the threshold sentence a whole number', async () => {
    const { ctx, page } = await open(1440, '');
    const label = await page.evaluate(() => [...document.querySelectorAll('[aria-label]')].map((e) => e.getAttribute('aria-label') ?? '').find((x) => x.startsWith('Network atlas')) ?? '');
    await ctx.close();
    expect(label).toMatch(/Most delayed lane, [^:]+: \d+ of \d+ shipments delayed \(\d+\.\d%\)\./);
    expect(label).toContain('20% or more delayed');
    expect(label).not.toMatch(/20\.0%/);
  }, 60_000);

  // ------------------------------------------------------------------------------------------------ sidebar frame
  it.each([1440, 390])('at %ipx keeps the two credit links out of the Main landmark, tabs to them after the last page link, and keeps the menu button pointing at a real element', async (w) => {
    const { ctx, page } = await open(w, '');
    const m = await page.evaluate(() => {
      const nav = document.querySelector('nav[aria-label="Main"]') as HTMLElement;
      const target = document.getElementById(document.querySelector('button[aria-controls]')?.getAttribute('aria-controls') ?? '');
      return { footerInNav: nav.contains(document.querySelector('.sidebar__footer')), navLinks: nav.querySelectorAll('a').length, hasTarget: target !== null, targetHolds: target?.contains(nav) === true && target?.contains(document.querySelector('.sidebar__footer')) === true };
    });
    if (w < 500) {
      await page.click('button[aria-controls="sidebar"]');
      await page.waitForSelector('#sidebar.is-open');
    }
    await page.locator('nav[aria-label="Main"] a').last().focus();
    await page.keyboard.press('Tab');
    const first = await page.evaluate(() => document.activeElement?.textContent ?? '');
    await page.keyboard.press('Tab');
    const second = await page.evaluate(() => document.activeElement?.textContent ?? '');
    await ctx.close();
    expect(m.footerInNav).toBe(false);
    expect(m.navLinks).toBe(7);
    expect(m.hasTarget).toBe(true);
    expect(m.targetHolds).toBe(true);
    expect(first).toMatch(/^LinkedIn/);
    expect(second).toMatch(/^GitHub/);
  }, 60_000);

  // ------------------------------------------------------------------------------------------------ banner live region
  describe('the imported-data banner', () => {
    const post = (p: string, init: { headers?: Record<string, string>; body?: string } = {}) =>
      fetch(`${base}${p}`, { method: 'POST', headers: { 'X-SCC-Request': '1', ...init.headers }, body: init.body });
    const importBoth = async () => {
      for (const [kind, name] of [['inventory', 'sample-inventory-seed-7.csv'], ['shipments', 'carrier-export.csv']] as const) {
        const csv = await buildSampleFile(kind, TODAY).text();
        const res = await post(`/api/import/${kind}`, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'X-SCC-Filename': encodeURIComponent(name) }, body: csv });
        expect(res.status, `import ${name}`).toBe(200);
      }
    };

    it('keeps the banner\'s role when a restore fails and announces the error in a live region that was already there', async () => {
      await importBoth();
      const { ctx, page } = await open(1440, '');
      const banner = page.getByRole('region', { name: BANNER_TITLE });
      await banner.waitFor();
      const before = await page.evaluate(() => {
        const live = document.querySelector('.data-banner [aria-live]') as HTMLElement | null;
        (live as any).__same = true;
        const box = document.querySelector('.data-banner .banner') as HTMLElement;
        return { live: live !== null, liveText: live?.textContent ?? 'x', role: box.getAttribute('role'), tagged: box.tagName };
      });
      await page.route('**/api/reset', (route: any) => route.abort());
      await banner.getByRole('button', { name: 'Restore sample data' }).click();
      await page.waitForFunction(() => /Could not restore sample data/.test(document.querySelector('.data-banner [aria-live]')?.textContent ?? ''));
      const after = await page.evaluate(() => {
        const live = document.querySelector('.data-banner [aria-live]') as any;
        const box = document.querySelector('.data-banner .banner') as HTMLElement;
        return { sameNode: live.__same === true, text: live.textContent, role: box.getAttribute('role'), alerts: document.querySelectorAll('.data-banner [role="alert"]').length, button: document.querySelector('.data-banner button')?.textContent };
      });
      const regionStillOne = await page.getByRole('region', { name: BANNER_TITLE }).count();
      await page.unroute('**/api/reset');
      await page.getByRole('region', { name: BANNER_TITLE }).getByRole('button', { name: 'Try again' }).click();
      await page.waitForFunction(() => document.querySelectorAll('.data-banner').length === 0);
      await ctx.close();
      expect(before.live, 'the live region is mounted from the first render').toBe(true);
      expect(before.liveText, 'and empty until something fails').toBe('');
      expect(after.sameNode, 'the same element carries the error').toBe(true);
      expect(after.text).toContain('Could not restore sample data.');
      expect(after.role, 'the banner keeps its role').toBe(before.role);
      expect(after.alerts, 'no alert is added together with its words').toBe(0);
      expect(after.button).toBe('Try again');
      expect(regionStillOne).toBe(1);
    }, 90_000);

    it('gives the sample back when the dashboard is opened without an imported file: no banner and no live region', async () => {
      expect((await post('/api/reset')).status).toBe(200);
      const { ctx, page } = await open(1440, '');
      const n = await page.locator('.data-banner').count();
      await ctx.close();
      expect(n).toBe(0);
    }, 60_000);
  });

  // ------------------------------------------------------------------------------------------------ no console errors
  it.each(['', 'analytics'])('opens #/%s at 1440 and 390 with no console error and no sideways scroll', async (hash) => {
    for (const w of [1440, 390]) {
      const { ctx, page, problems } = await open(w, hash);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      const h1 = await page.locator('h1').count();
      await ctx.close();
      expect(problems, `#/${hash} at ${w}`).toEqual([]);
      expect(over, `#/${hash} at ${w}`).toBeLessThanOrEqual(0);
      expect(h1).toBe(1);
    }
  }, 60_000);
});
