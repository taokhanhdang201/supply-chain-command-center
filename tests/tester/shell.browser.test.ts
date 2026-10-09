// The app shell in a real browser: the sidebar's foot and its Close navigation button, the drawer on a route change (Back)
// and on the link of the open page, one top bar row at 390 and every width, the "Someone imported a file." banner on the seven
// pages and what Restore sample data does (the reset once, the reload, a word for a screen reader, the focus), and the pages in
// the imported state at 390 and 1440 (no sideways scroll, one h1, no console error).
// OPT-IN (`*.browser.test.ts`). Run: npm run build && SCC_PW_DIR=<dir with playwright> npm run test:browser
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
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
const TODAY = '2026-09-28';
const PAGES = ['', 'inventory', 'shipments', 'routes', 'analytics', 'alerts', 'import'] as const;
const LONG_NAME = `${'carrier-export-'.padEnd(56, 'x')}.csv`;
const POLITE = '.topbar__actions [aria-live="polite"]';
const BANNER_TITLE = 'Someone imported a file.';
const BANNER_TEXT = 'These figures come from that file, not the sample. Restoring resets it for everyone.';

/** Installed in every page: the contrast of a colour over what is behind it, alpha layers composited (WCAG luminance). */
function installContrast(): void {
  const parse = (s: string): number[] => {
    const srgb = s.match(/color\(srgb ([^)]+)\)/);
    if (srgb) {
      const v = (srgb[1] as string).split(/[\s/]+/).filter(Boolean).map(Number);
      return [v[0]! * 255, v[1]! * 255, v[2]! * 255, v[3] ?? 1];
    }
    const v = (s.match(/[\d.]+/g) ?? []).map(Number);
    return [v[0] ?? 0, v[1] ?? 0, v[2] ?? 0, v[3] ?? 1];
  };
  const over = (fg: number[], bg: number[]): number[] => [0, 1, 2].map((i) => fg[i]! * fg[3]! + bg[i]! * (1 - fg[3]!)).concat(1);
  const behind = (el: Element | null): number[] => {
    const layers: number[][] = [];
    for (let e = el; e; e = e.parentElement) {
      const c = parse(getComputedStyle(e).backgroundColor);
      if (c[3]! > 0) {
        layers.push(c);
        if (c[3]! >= 1) break;
      }
    }
    return layers.reduceRight((bg, l) => over(l, bg), [255, 255, 255, 1]);
  };
  const lum = (c: number[]): number => {
    const f = (x: number) => (x / 255 <= 0.03928 ? x / 255 / 12.92 : ((x / 255 + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(c[0]!) + 0.7152 * f(c[1]!) + 0.0722 * f(c[2]!);
  };
  const ratio = (a: number[], b: number[]): number => {
    const x = lum(a);
    const y = lum(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
  (window as unknown as { __contrast: unknown }).__contrast = { parse, over, behind, ratio };
}

describe('app shell (real Chromium, real server)', () => {
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

  // ---- the server's data: the seed-42 sample, or a file imported through the API the page itself uses ----
  const post = (p: string, init: { headers?: Record<string, string>; body?: string } = {}) =>
    fetch(`${base}${p}`, { method: 'POST', headers: { 'X-SCC-Request': '1', ...init.headers }, body: init.body });
  const resetData = async () => {
    expect((await post('/api/reset')).status).toBe(200);
  };
  const importFile = async (kind: 'inventory' | 'shipments', name: string) => {
    const csv = await buildSampleFile(kind, TODAY).text(); // seed 7, so every figure differs from seed 42
    const res = await post(`/api/import/${kind}`, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'X-SCC-Filename': encodeURIComponent(name) }, body: csv });
    expect(res.status, `import ${name}`).toBe(200);
  };
  const importBoth = async () => {
    await importFile('inventory', 'sample-inventory-seed-7.csv');
    await importFile('shipments', 'carrier-export.csv');
  };

  const open = async (w: number, hash: string, height = w < 500 ? 844 : 900) => {
    const ctx = await browser.newContext({ viewport: { width: w, height }, reducedMotion: 'reduce' });
    await ctx.addInitScript(installContrast);
    const page = await ctx.newPage();
    const problems: string[] = [];
    page.on('console', (m: any) => {
      if (m.type() === 'error' || m.type() === 'warning') problems.push(`${m.type()}: ${m.text()}`);
    });
    page.on('pageerror', (e: any) => problems.push(`pageerror: ${String(e)}`));
    await page.goto(`${base}/#/${hash}`);
    await page.waitForSelector('main h1');
    return { ctx, page, problems };
  };
  const openDrawer = async (page: any) => {
    await page.click('button[aria-controls="sidebar"]');
    await page.waitForSelector('#sidebar.is-open');
    await page.waitForTimeout(150);
  };
  const state = (page: any) =>
    page.evaluate(() => {
      const active = document.activeElement as HTMLElement | null;
      return {
        open: document.getElementById('sidebar')!.classList.contains('is-open'),
        inert: document.querySelector('.app-shell__content')!.hasAttribute('inert'),
        onMenu: active === document.querySelector('button[aria-controls="sidebar"]'),
        onH1: active === document.querySelector('main h1'),
        active: `${active?.tagName.toLowerCase()} ${(active?.getAttribute('aria-label') ?? active?.textContent ?? '').trim().slice(0, 40)}`
      };
    });

  // ---------------------------------------------------------------- B: the sidebar's foot
  describe('the sidebar foot', () => {
    it('1440: "Built by Đăng Tạo" and two links that open in a new tab, under the last page link, inside the screen, 4.5:1 on the sidebar', async () => {
      const { ctx, page } = await open(1440, '');
      const m = await page.evaluate(() => {
        const c = (window as any).__contrast;
        const footer = document.querySelector('#sidebar .sidebar__footer') as HTMLElement;
        const nav = [...document.querySelectorAll('#sidebar .sidebar__nav a')];
        const credit = footer.querySelector('.sidebar__credit') as HTMLElement;
        const bg = c.behind(footer);
        return {
          credit: credit.textContent,
          footerAnchors: footer.querySelectorAll('a').length,
          links: [...footer.querySelectorAll('a')].map((a) => ({
            text: (a.textContent ?? '').trim(),
            href: a.getAttribute('href'),
            target: a.getAttribute('target'),
            rel: a.getAttribute('rel'),
            label: a.getAttribute('aria-label'),
            height: a.getBoundingClientRect().height,
            iconWidth: (a.querySelector('svg') as SVGElement).getBoundingClientRect().width,
            iconHidden: a.querySelector('svg')!.getAttribute('aria-hidden'),
            rest: getComputedStyle(a).textDecorationLine,
            contrast: c.ratio(c.over(c.parse(getComputedStyle(a).color), bg), bg)
          })),
          creditContrast: c.ratio(c.over(c.parse(getComputedStyle(credit).color), bg), bg),
          footerTop: footer.getBoundingClientRect().top,
          footerBottom: footer.getBoundingClientRect().bottom,
          lastNavBottom: nav[nav.length - 1]!.getBoundingClientRect().bottom,
          font: getComputedStyle(credit).fontFamily
        };
      });
      await ctx.close();
      expect(m.credit).toBe('Built by Đăng Tạo');
      expect(m.footerAnchors).toBe(2);
      expect(m.links.map((l: any) => [l.text, l.href, l.target, l.rel, l.label])).toEqual([
        ['LinkedIn', 'https://www.linkedin.com/in/dangtao-scm', '_blank', 'noopener noreferrer', "LinkedIn: Đăng Tạo's profile (opens in a new tab)"],
        ['GitHub', 'https://github.com/taokhanhdang201/supply-chain-command-center', '_blank', 'noopener noreferrer', 'GitHub: SCC source code (opens in a new tab)']
      ]);
      for (const l of m.links) {
        expect(l.iconWidth, `${l.text}: icon`).toBe(12);
        expect(l.iconHidden, `${l.text}: icon aria-hidden`).toBe('true');
        expect(l.height, `${l.text}: a 24px target (WCAG 2.5.8)`).toBeGreaterThanOrEqual(24);
        expect(l.rest, `${l.text}: underlined only on hover and focus`).toBe('none');
        expect(l.contrast, `${l.text}: contrast on the sidebar`).toBeGreaterThanOrEqual(4.5);
      }
      expect(m.creditContrast, '"Built by": contrast on the sidebar').toBeGreaterThanOrEqual(4.5);
      expect(m.footerTop, 'the foot sits under the last page link').toBeGreaterThanOrEqual(m.lastNavBottom);
      expect(m.footerBottom, 'the foot is inside the 900px screen').toBeLessThanOrEqual(900);
      expect(m.font, '"Đăng Tạo" is drawn in Inter, which carries Vietnamese').toContain('Inter');
    }, 60_000);

    it('1440: Tab goes from the last page link to LinkedIn, then GitHub, which underline on focus and on hover', async () => {
      const { ctx, page } = await open(1440, '');
      await page.focus('#sidebar a[href="#/import"]');
      const seen: Array<{ label: string | null; underline: string }> = [];
      for (let i = 0; i < 2; i += 1) {
        await page.keyboard.press('Tab');
        seen.push(await page.evaluate(() => ({ label: document.activeElement!.getAttribute('aria-label'), underline: getComputedStyle(document.activeElement!).textDecorationLine })));
      }
      await page.hover('.sidebar__credit-link');
      const hover = await page.evaluate(() => getComputedStyle(document.querySelector('.sidebar__credit-link')!).textDecorationLine);
      await ctx.close();
      expect(seen.map((s) => s.label)).toEqual(["LinkedIn: Đăng Tạo's profile (opens in a new tab)", 'GitHub: SCC source code (opens in a new tab)']);
      for (const s of seen) expect(s.underline, 'on focus').toBe('underline');
      expect(hover, 'on hover').toBe('underline');
    }, 60_000);

    it('390 drawer: the foot is inside the 844px screen and its links are 24px tall', async () => {
      const { ctx, page } = await open(390, '');
      await openDrawer(page);
      const m = await page.evaluate(() => ({
        bottom: (document.querySelector('#sidebar .sidebar__footer') as HTMLElement).getBoundingClientRect().bottom,
        heights: [...document.querySelectorAll('#sidebar .sidebar__footer a')].map((a) => a.getBoundingClientRect().height)
      }));
      await ctx.close();
      expect(m.bottom).toBeLessThanOrEqual(844);
      expect(m.heights).toHaveLength(2);
      for (const h of m.heights) expect(h).toBeGreaterThanOrEqual(24);
    }, 60_000);

    // A short 1440x600 window: the sidebar scrolls inside itself; the foot stays after the links and can be scrolled into view.
    it('on a 1440x600 screen the foot comes after the page links without overlapping them, and can be scrolled into view', async () => {
      const { ctx, page } = await open(1440, '', 600);
      const before = await page.evaluate(() => {
        const nav = [...document.querySelectorAll('#sidebar .sidebar__nav a')];
        return {
          footerTop: (document.querySelector('#sidebar .sidebar__footer') as HTMLElement).getBoundingClientRect().top,
          lastBottom: nav[nav.length - 1]!.getBoundingClientRect().bottom,
          sideways: document.documentElement.scrollWidth - window.innerWidth
        };
      });
      await page.evaluate(() => (document.querySelector('#sidebar .sidebar__footer') as HTMLElement).scrollIntoView({ block: 'end' }));
      const after = await page.evaluate(() => ({ bottom: (document.querySelector('#sidebar .sidebar__footer') as HTMLElement).getBoundingClientRect().bottom, bar: (document.querySelector('.topbar') as HTMLElement).getBoundingClientRect().bottom }));
      await ctx.close();
      expect(before.footerTop, 'the foot does not cover the last link').toBeGreaterThanOrEqual(before.lastBottom - 0.5);
      expect(before.sideways).toBeLessThanOrEqual(0);
      expect(after.bottom, 'scrolled into view').toBeLessThanOrEqual(600 + 0.5);
    }, 60_000);

    it('the group labels are Operations, Insights and Data, Dashboard is the first link, and opening the drawer focuses it', async () => {
      const { ctx, page } = await open(390, 'alerts');
      const m = await page.evaluate(() => ({
        labels: [...document.querySelectorAll('.sidebar__group-label')].map((n) => n.textContent),
        first: document.querySelector('#sidebar a')!.textContent!.trim()
      }));
      await openDrawer(page);
      const focus = await state(page);
      await ctx.close();
      expect(m.labels).toEqual(['Operations', 'Insights', 'Data']);
      expect(m.first).toBe('Dashboard');
      expect(focus.active).toBe('a Dashboard');
    }, 60_000);
  });

  // ---------------------------------------------------------------- C: the drawer
  describe('the drawer', () => {
    it('390: the Close navigation button is 36x36, on top, named, and no second menu button; it is hidden from 1024px', async () => {
      const { ctx, page } = await open(390, '');
      await openDrawer(page);
      const m = await page.evaluate(() => {
        const b = document.querySelector('#sidebar .sidebar__close') as HTMLElement;
        const r = b.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return {
          name: (b.textContent ?? '').trim(),
          w: r.width,
          h: r.height,
          onTop: b.contains(hit),
          controls: b.hasAttribute('aria-controls'),
          expanded: b.hasAttribute('aria-expanded'),
          menuButtons: document.querySelectorAll('button[aria-controls="sidebar"]').length
        };
      });
      await ctx.close();
      expect(m.name).toBe('Close navigation');
      expect([m.w, m.h]).toEqual([36, 36]);
      expect(m.onTop, 'elementFromPoint at its centre is the button').toBe(true);
      expect(m.controls || m.expanded).toBe(false);
      expect(m.menuButtons).toBe(1);
      for (const w of [1024, 1440]) {
        const wide = await open(w, '');
        const display = await wide.page.evaluate(() => getComputedStyle(document.querySelector('#sidebar .sidebar__close')!).display);
        await wide.ctx.close();
        expect(display, `${w}px`).toBe('none');
      }
    }, 60_000);

    /** The brand row's lines of text, the Close button's box, and whether any brand text sits under that button. */
    const measureBrand = (page: any) =>
      page.evaluate(() => {
        const row = document.querySelector('#sidebar .sidebar__brand') as HTMLElement;
        const closeEl = document.querySelector('#sidebar .sidebar__close') as HTMLElement;
        const close = closeEl.getBoundingClientRect();
        const rects = (el: Element) => {
          const r = document.createRange();
          r.selectNodeContents(el);
          return [...r.getClientRects()].filter((x) => x.width > 0);
        };
        const lines = (el: Element) => new Set(rects(el).map((x) => Math.round(x.top))).size;
        const name = document.querySelector('.sidebar__brand-name') as HTMLElement;
        const sub = document.querySelector('.sidebar__brand-sub') as HTMLElement;
        const textRight = Math.max(...rects(name).map((x) => x.right), ...rects(sub).map((x) => x.right));
        return {
          nameLines: lines(name),
          subLines: lines(sub),
          closeShown: close.width > 0,
          closeSize: [close.width, close.height],
          overlap: close.width > 0 && [...rects(name), ...rects(sub)].some((r) => r.right > close.left + 0.5 && r.left < close.right && r.bottom > close.top && r.top < close.bottom),
          gap: close.width > 0 ? close.left - textRight : null,
          onTop: close.width > 0 && closeEl.contains(document.elementFromPoint(close.left + close.width / 2, close.top + close.height / 2)),
          rowOverflow: row.scrollWidth - row.clientWidth
        };
      });

    // The drawer is as wide as the sidebar's text needs: the logo reads on the same lines as on the fixed sidebar.
    it('390: the brand row keeps "Command Center" on the lines it has at 1440, clear of the Close navigation button', async () => {
      const wide = await open(1440, '');
      const fixedSidebar = await measureBrand(wide.page);
      await wide.ctx.close();
      expect([fixedSidebar.nameLines, fixedSidebar.subLines], '1440: the fixed sidebar').toEqual([1, 1]);
      const { ctx, page } = await open(390, '');
      await openDrawer(page);
      const m = await measureBrand(page);
      await ctx.close();
      expect([m.nameLines, m.subLines], 'the drawer has the lines of the fixed sidebar').toEqual([fixedSidebar.nameLines, fixedSidebar.subLines]);
      expect(m.overlap, 'no brand text under the button').toBe(false);
      expect(m.gap, 'the text ends before the button').toBeGreaterThan(0);
      expect(m.closeSize).toEqual([36, 36]);
      expect(m.onTop, 'the button is the topmost element at its centre').toBe(true);
      expect(m.rowOverflow).toBeLessThanOrEqual(0);
    }, 60_000);

    // The drawer is min(288px, 100vw - 48px) wide below 1024px: a strip of backdrop is always left to tap.
    it('the drawer is 288px wide, or 48px short of a narrower screen, with the foot and the Close button inside', async () => {
      for (const [w, drawerWidth] of [[390, 288], [360, 288], [320, 272]] as const) {
        const { ctx, page } = await open(w, '');
        await openDrawer(page);
        const m = await page.evaluate(() => {
          const s = (document.getElementById('sidebar') as HTMLElement).getBoundingClientRect();
          const close = (document.querySelector('#sidebar .sidebar__close') as HTMLElement).getBoundingClientRect();
          return { width: s.width, right: s.right, closeRight: close.right, closeLeft: close.left, footer: (document.querySelector('#sidebar .sidebar__footer') as HTMLElement).getBoundingClientRect().bottom, sideways: document.documentElement.scrollWidth - window.innerWidth, inner: window.innerWidth };
        });
        const brand = await measureBrand(page);
        await ctx.close();
        expect(m.width, `${w}: drawer width`).toBe(drawerWidth);
        expect(m.inner - m.right, `${w}: a strip of backdrop is left`).toBeGreaterThanOrEqual(48);
        expect(m.closeLeft, `${w}: the Close button is inside the drawer`).toBeGreaterThanOrEqual(0);
        expect(m.closeRight, `${w}: the Close button is inside the drawer`).toBeLessThanOrEqual(m.right);
        expect(m.footer, `${w}: the foot is inside the screen`).toBeLessThanOrEqual(844);
        expect(m.sideways, `${w}: sideways`).toBeLessThanOrEqual(0);
        expect(brand.overlap, `${w}: no brand text under the button`).toBe(false);
      }
    }, 60_000);

    it('390: a click or Enter on Close navigation closes the drawer, ends the inert shell and focuses the menu button', async () => {
      for (const how of ['click', 'Enter'] as const) {
        const { ctx, page } = await open(390, '');
        await openDrawer(page);
        if (how === 'click') await page.click('#sidebar .sidebar__close');
        else {
          await page.focus('#sidebar .sidebar__close');
          await page.keyboard.press('Enter');
        }
        const s = await state(page);
        await ctx.close();
        expect(s, how).toMatchObject({ open: false, inert: false, onMenu: true });
      }
    }, 60_000);

    // Back with the drawer open: the route changes under the open drawer (TalkBack's back gesture).
    it('390: Back with the drawer open closes it, ends the inert shell, focuses the h1 of the page it returns to, and logs nothing', async () => {
      const { ctx, page, problems } = await open(390, '');
      await page.evaluate(() => {
        window.location.hash = '#/inventory';
      });
      await page.waitForFunction(() => document.querySelector('main h1')?.textContent === 'Inventory');
      await openDrawer(page);
      await page.goBack();
      await page.waitForFunction(() => document.querySelector('main h1')?.textContent === 'Dashboard');
      await page.waitForFunction(() => !document.getElementById('sidebar')!.classList.contains('is-open'));
      await page.waitForTimeout(150);
      const s = await state(page);
      await ctx.close();
      expect(s, 'after Back').toMatchObject({ open: false, inert: false, onH1: true });
      expect(problems, 'console errors and warnings').toEqual([]);
    }, 60_000);

    it('390: the link of the page already open closes the drawer and focuses the menu button, not a hidden link or the body', async () => {
      const { ctx, page } = await open(390, 'inventory');
      await openDrawer(page);
      await page.click('#sidebar a[aria-current="page"]');
      await page.waitForTimeout(150);
      const s = await state(page);
      await ctx.close();
      expect(s).toMatchObject({ open: false, inert: false, onMenu: true });
    }, 60_000);

    it('390: a link to another page closes the drawer and focuses that page\'s h1', async () => {
      const { ctx, page } = await open(390, '');
      await openDrawer(page);
      await page.click('#sidebar a[href="#/shipments"]');
      await page.waitForFunction(() => document.querySelector('main h1')?.textContent === 'Shipments');
      await page.waitForTimeout(150);
      const s = await state(page);
      await ctx.close();
      expect(s).toMatchObject({ open: false, inert: false, onH1: true });
    }, 60_000);

    // From 1024px, a click on the open page's link: no drawer, so the focus stays where the click put it.
    it('from 1024px the link of the open page leaves the focus on that link', async () => {
      for (const w of [1024, 1440]) {
        const { ctx, page } = await open(w, 'inventory');
        await page.click('#sidebar a[aria-current="page"]');
        await page.waitForTimeout(150);
        const m = await page.evaluate(() => ({ onLink: document.activeElement === document.querySelector('#sidebar a[aria-current="page"]'), onMenu: document.activeElement === document.querySelector('button[aria-controls="sidebar"]') }));
        await ctx.close();
        expect(m, `${w}px`).toEqual({ onLink: true, onMenu: false });
      }
    }, 60_000);

    it('390 drawer: Tab never leaves the drawer and reaches its 9 links and its Close button', async () => {
      const { ctx, page } = await open(390, '');
      await openDrawer(page);
      const stops = new Set<string>();
      for (let i = 0; i < 14; i += 1) {
        await page.keyboard.press('Tab');
        const w = await page.evaluate(() => {
          const a = document.activeElement as HTMLElement;
          // BODY is the wrap-around: after the last stop Tab leaves the page for the browser, and the next Tab re-enters at the first
          return { inside: document.getElementById('sidebar')!.contains(a) || a === document.body, name: `${a.tagName} ${(a.getAttribute('aria-label') ?? a.textContent ?? '').trim().slice(0, 40)}` };
        });
        expect(w.inside, `Tab ${i + 1}: ${w.name}`).toBe(true);
        stops.add(w.name);
      }
      await ctx.close();
      expect([...stops].filter((s) => s.startsWith('A ')).length, 'the 7 pages and the 2 credit links').toBe(9);
      expect(stops.has('BUTTON Close navigation')).toBe(true);
    }, 60_000);
  });

  // ---------------------------------------------------------------- D: the top bar (the sample)
  describe('the top bar on the sample', () => {
    beforeEach(resetData);

    it('one row of at most 56px at 390 and 1440, the chip level with the date, a 24px chip, no sideways scroll, 64px scroll padding', async () => {
      for (const w of [390, 1440]) {
        const { ctx, page } = await open(w, '');
        const m = await page.evaluate(() => {
          const c = (window as any).__contrast;
          const mid = (el: Element) => {
            const r = el.getBoundingClientRect();
            return r.top + r.height / 2;
          };
          const chip = document.querySelector('.topbar__chip') as HTMLElement;
          const bg = c.behind(chip);
          return {
            bar: (document.querySelector('.topbar') as HTMLElement).getBoundingClientRect().height,
            chipH: chip.getBoundingClientRect().height,
            chips: document.querySelectorAll('.topbar__chip').length,
            offset: Math.abs(mid(chip) - mid(document.querySelector('.topbar__date')!)),
            contrast: c.ratio(c.over(c.parse(getComputedStyle(chip).color), bg), bg),
            sideways: document.documentElement.scrollWidth - window.innerWidth,
            scrollPadding: getComputedStyle(document.documentElement).scrollPaddingTop
          };
        });
        await ctx.close();
        expect(m.bar, `${w}: the top bar`).toBeLessThanOrEqual(56);
        expect(m.chips, `${w}: chips`).toBe(1);
        expect(m.chipH, `${w}: chip height`).toBe(24);
        expect(m.offset, `${w}: chip against the date`).toBeLessThanOrEqual(2);
        expect(m.contrast, `${w}: chip text contrast`).toBeGreaterThanOrEqual(4.5);
        expect(m.sideways, `${w}: sideways scroll`).toBeLessThanOrEqual(0);
        expect(m.scrollPadding, `${w}: scroll-padding-top`).toBe('64px');
      }
    }, 60_000);

    it('Refresh is a 36x36 icon button below 768px, still named "Refresh", and shows its word from 768px', async () => {
      let { ctx, page } = await open(390, '');
      const phone = await page.evaluate(() => {
        const b = [...document.querySelectorAll('.topbar__actions button')].find((x) => x.textContent!.includes('Refresh')) as HTMLElement;
        const r = b.getBoundingClientRect();
        const label = b.querySelector('.topbar__refresh-label') as HTMLElement;
        const lr = label.getBoundingClientRect();
        return { w: r.width, h: r.height, labelBox: lr.width * lr.height, labelClip: getComputedStyle(label).clip + getComputedStyle(label).clipPath };
      });
      expect(await page.getByRole('button', { name: 'Refresh', exact: true }).count()).toBe(1);
      await ctx.close();
      expect([phone.w, phone.h], '390: the button').toEqual([36, 36]);
      expect(phone.labelBox, '390: the word takes no room').toBeLessThanOrEqual(4);
      ({ ctx, page } = await open(1440, ''));
      const wide = await page.evaluate(() => {
        const b = [...document.querySelectorAll('.topbar__actions button')].find((x) => x.textContent!.includes('Refresh')) as HTMLElement;
        const label = b.querySelector('.topbar__refresh-label') as HTMLElement;
        return { h: b.getBoundingClientRect().height, wLabel: label.getBoundingClientRect().width, text: label.textContent };
      });
      await ctx.close();
      expect(wide.text).toBe('Refresh');
      expect(wide.wLabel, '1440: the word is shown').toBeGreaterThan(20);
      expect(wide.h, '1440: the button is a control height (32 or 36)').toBeGreaterThanOrEqual(32);
      expect(wide.h).toBeLessThanOrEqual(36);
    }, 60_000);

    it('Enter on the Sample data chip opens its note inside the screen, under the chip where the browser can place it; Esc closes it and the focus stays', async () => {
      for (const w of [390, 1440]) {
        const { ctx, page } = await open(w, '');
        await page.focus('.topbar__chip--sample');
        await page.keyboard.press('Enter');
        const m = await page.evaluate((width: number) => {
          const note = document.querySelector('.topbar__note') as HTMLElement;
          const chip = document.querySelector('.topbar__chip--sample') as HTMLElement;
          const n = note.getBoundingClientRect();
          return { open: note.matches(':popover-open'), text: note.textContent, left: n.left, right: n.right, rightGap: Math.abs(n.right - chip.getBoundingClientRect().right), anchored: CSS.supports('position-area: bottom'), width };
        }, w);
        await page.keyboard.press('Escape');
        const after = await page.evaluate(() => ({ open: document.querySelector('.topbar__note')!.matches(':popover-open'), onChip: document.activeElement === document.querySelector('.topbar__chip--sample') }));
        await ctx.close();
        expect(m.open, `${w}: open`).toBe(true);
        expect(m.text).toBe('Generated sample, seed 42. Rebuilt every day until someone imports a file.');
        expect(m.left, `${w}: left edge`).toBeGreaterThanOrEqual(16);
        expect(m.right, `${w}: right edge`).toBeLessThanOrEqual(w - 16 + 0.5);
        if (m.anchored) expect(m.rightGap, `${w}: the note's right edge is the chip's`).toBeLessThanOrEqual(1);
        expect(after, `${w}: after Esc`).toEqual({ open: false, onChip: true });
      }
    }, 60_000);

    it('no "Someone imported a file." banner on any of the seven pages while the data is the sample', async () => {
      for (const hash of PAGES) {
        const { ctx, page } = await open(1440, hash);
        const n = await page.getByRole('region', { name: BANNER_TITLE }).count();
        await ctx.close();
        expect(n, `#/${hash}`).toBe(0);
      }
    }, 120_000);
  });

  // ---------------------------------------------------------------- E: after a file is imported
  describe('after someone imports a file', () => {
    beforeEach(resetData);
    afterAll(resetData);

    it('on the seven pages at 1440 and 390 there is one banner region with its second sentence and a Restore button; one h1, no sideways scroll, no console error', async () => {
      await importFile('shipments', 'carrier-export.csv'); // shipments a file, inventory still the sample (a mixed pair)
      for (const w of [1440, 390]) {
        for (const hash of PAGES) {
          const { ctx, page, problems } = await open(w, hash);
          await page.waitForSelector(`[role="region"][aria-labelledby]`);
          const m = await page.evaluate(
            ([title]: string[]) => {
              const regions = [...document.querySelectorAll('[role="region"]')].filter((r) => r.getAttribute('aria-labelledby') && document.getElementById(r.getAttribute('aria-labelledby')!)?.textContent === title);
              const region = regions[0] as HTMLElement | undefined;
              const main = document.querySelector('main') as HTMLElement;
              return {
                count: regions.length,
                text: region?.querySelector('.banner__message')?.textContent ?? null,
                button: region?.querySelector('button')?.textContent ?? null,
                before: region !== undefined && main.contains(region) && ((region.compareDocumentPosition(main.querySelector('h1')!) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0),
                h1: document.querySelectorAll('h1').length,
                sideways: document.documentElement.scrollWidth - window.innerWidth
              };
            },
            [BANNER_TITLE]
          );
          await ctx.close();
          const where = `${w} #/${hash}`;
          expect(m.count, `${where}: banners`).toBe(1);
          expect(m.text, `${where}: second sentence`).toBe(BANNER_TEXT);
          expect(m.button, `${where}: button`).toBe('Restore sample data');
          expect(m.before, `${where}: the banner comes before the page`).toBe(true);
          expect(m.h1, `${where}: h1`).toBe(1);
          expect(m.sideways, `${where}: sideways`).toBeLessThanOrEqual(0);
          expect(problems, `${where}: console`).toEqual([]);
        }
      }
    }, 240_000);

    it('the banner shows when only the inventory is a file, as it does when only the shipments are', async () => {
      await importFile('inventory', 'sample-inventory-seed-7.csv');
      const { ctx, page } = await open(1440, '');
      expect(await page.getByRole('region', { name: BANNER_TITLE }).count(), 'only the inventory is a file').toBe(1);
      expect(await page.locator('.topbar__chip').allTextContents()).toEqual(['Imported data']);
      expect(await page.locator('.topbar__note').textContent()).toMatch(/^Inventory: Sample data \(seed 7\)\. Shipments: Sample data/);
      await ctx.close();
    }, 60_000);

    it('Restore sample data resets the server once, brings the sample back, drops the banner, names one chip, says "Sample data restored." and focuses the h1', async () => {
      await importBoth();
      const { ctx, page, problems } = await open(1440, '');
      let resets = 0;
      page.on('request', (r: any) => {
        if (r.method() === 'POST' && r.url().endsWith('/api/reset')) resets += 1;
      });
      const before = await page.locator('.hero__value').innerText();
      await page.getByRole('region', { name: BANNER_TITLE }).getByRole('button', { name: 'Restore sample data' }).click();
      await page.waitForFunction((sel: string) => document.querySelector(sel)?.textContent === 'Sample data restored.', POLITE);
      await page.waitForFunction(() => document.querySelector('.topbar__chip')?.textContent === 'Sample data');
      await page.waitForTimeout(200);
      const m = await page.evaluate((sel: string) => ({
        banners: document.querySelectorAll('.data-banner').length,
        chips: [...document.querySelectorAll('.topbar__chip')].map((c) => c.textContent),
        polite: document.querySelector(sel)!.textContent,
        onH1: document.activeElement === document.querySelector('main h1')
      }), POLITE);
      const after = await page.locator('.hero__value').innerText();
      await ctx.close();
      expect(resets).toBe(1);
      expect(m).toEqual({ banners: 0, chips: ['Sample data'], polite: 'Sample data restored.', onH1: true });
      expect(after, 'the Dashboard figure is the seed-42 sample again').not.toBe(before);
      expect(problems).toEqual([]);
    }, 60_000);

    it('from the h1, Shift+Tab reaches the Restore button and Enter restores the sample', async () => {
      await importBoth();
      const { ctx, page } = await open(390, '');
      await page.focus('main h1');
      await page.keyboard.press('Shift+Tab');
      const onButton = await page.evaluate(() => (document.activeElement?.textContent ?? '').trim());
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.querySelectorAll('.data-banner').length === 0);
      await page.waitForFunction((sel: string) => document.querySelector(sel)?.textContent === 'Sample data restored.', POLITE);
      const polite = await page.locator(POLITE).textContent();
      await ctx.close();
      expect(onButton).toBe('Restore sample data');
      expect(polite).toBe('Sample data restored.');
    }, 60_000);

    // Two more clicks while it runs
    it('while the reset runs the button says "Restoring…", is busy and unavailable, and two more clicks send no second reset', async () => {
      await importBoth();
      const { ctx, page } = await open(1440, '');
      let resets = 0;
      page.on('request', (r: any) => {
        if (r.method() === 'POST' && r.url().endsWith('/api/reset')) resets += 1;
      });
      await page.route('**/api/reset', async (route: any) => {
        await new Promise((r) => setTimeout(r, 1200));
        await route.continue();
      });
      const button = page.getByRole('region', { name: BANNER_TITLE }).getByRole('button');
      await button.click();
      await page.waitForFunction(() => document.querySelector('.data-banner button')?.textContent === 'Restoring…');
      const busy = await page.evaluate(() => {
        const b = document.querySelector('.data-banner button') as HTMLElement;
        return { busy: b.getAttribute('aria-busy'), disabled: b.getAttribute('aria-disabled'), native: (b as HTMLButtonElement).disabled };
      });
      await page.locator('.data-banner button').click({ force: true });
      await page.locator('.data-banner button').click({ force: true });
      await page.waitForFunction(() => document.querySelectorAll('.data-banner').length === 0);
      await ctx.close();
      expect(busy).toEqual({ busy: 'true', disabled: 'true', native: false });
      expect(resets).toBe(1);
    }, 60_000);

    // The reset fails on the network: the request never reaches the server
    it('when the reset cannot reach the server the banner becomes a warning with the message and Try again, and Try again restores the sample', async () => {
      await importBoth();
      const { ctx, page } = await open(1440, '');
      await page.route('**/api/reset', (route: any) => route.abort());
      await page.getByRole('region', { name: BANNER_TITLE }).getByRole('button', { name: 'Restore sample data' }).click();
      const alert = page.getByRole('alert').filter({ hasText: 'Could not restore sample data' });
      await alert.waitFor();
      const text = await alert.innerText();
      const tone = await alert.evaluate((e: Element) => e.classList.contains('banner--warning'));
      const focusOnRetry = await page.evaluate(() => document.activeElement?.textContent === 'Try again');
      await page.unroute('**/api/reset');
      await alert.getByRole('button', { name: 'Try again' }).click();
      await page.waitForFunction(() => document.querySelectorAll('.data-banner').length === 0);
      const chips = await page.locator('.topbar__chip').allTextContents();
      await ctx.close();
      expect(text).toContain('Could not reach the server. Check that it is running and try again.');
      expect(tone).toBe(true);
      expect(focusOnRetry, 'the button keeps the focus').toBe(true);
      expect(chips).toEqual(['Sample data']);
    }, 60_000);

    // The reset went through but the reload failed: the server is reset, the page could not load it
    it('when the reset works but the reload fails, "Could not refresh data" shows, the banner stays, nothing says "restored" and the focus does not jump to the h1', async () => {
      await importBoth();
      const { ctx, page } = await open(1440, '');
      await page.route('**/api/snapshot', (route: any) => route.abort());
      await page.getByRole('region', { name: BANNER_TITLE }).getByRole('button', { name: 'Restore sample data' }).click();
      await page.getByText('Could not refresh data').waitFor();
      await page.waitForTimeout(200);
      const m = await page.evaluate((sel: string) => ({
        banner: document.querySelectorAll('.data-banner').length,
        polite: document.querySelector(sel)!.textContent,
        onH1: document.activeElement === document.querySelector('main h1')
      }), POLITE);
      await page.unroute('**/api/snapshot');
      await ctx.close();
      expect(m).toEqual({ banner: 1, polite: '', onH1: false });
    }, 60_000);

    it('with both sources imported the top bar is one row of at most 56px at 390, 768, 1024 and 1440, with one "Imported data" chip whose note names both sources', async () => {
      await importBoth();
      for (const w of [390, 768, 1024, 1440]) {
        const { ctx, page } = await open(w, '');
        const m = await page.evaluate(() => {
          const shown = (el: Element | null) => el !== null && el.getBoundingClientRect().width > 0;
          return {
            bar: (document.querySelector('.topbar') as HTMLElement).getBoundingClientRect().height,
            chipsShown: [...document.querySelectorAll('.topbar__chip')].filter(shown).length,
            chipText: [...document.querySelectorAll('.topbar__chip')].map((c) => c.textContent),
            sideways: document.documentElement.scrollWidth - window.innerWidth
          };
        });
        expect(m.bar, `${w}: the top bar`).toBeLessThanOrEqual(56);
        expect(m.sideways, `${w}: sideways`).toBeLessThanOrEqual(0);
        expect(m.chipText, `${w}: the chips' text`).toEqual(['Imported data']);
        expect(m.chipsShown, `${w}: one chip button`).toBe(1);
        await page.focus('.topbar__chip');
        await page.keyboard.press('Enter');
        const note = await page.evaluate(() => {
          const n = document.querySelector('#topbar-imported-note') as HTMLElement;
          const r = n.getBoundingClientRect();
          const chipRight = (document.querySelector('.topbar__chip') as HTMLElement).getBoundingClientRect().right;
          return { open: n.matches(':popover-open'), text: n.textContent, left: r.left, right: r.right, chipRight, anchored: CSS.supports('position-area: bottom') };
        });
        expect(note.open).toBe(true);
        expect(note.text).toBe('Inventory: Sample data (seed 7). Shipments: carrier-export.csv.');
        expect(note.left).toBeGreaterThanOrEqual(0);
        expect(note.right).toBeLessThanOrEqual(w);
        if (note.anchored) expect(Math.abs(note.right - note.chipRight), `${w}: the note's right edge is the chip's`).toBeLessThanOrEqual(1);
        await ctx.close();
      }
    }, 120_000);

    it('a mouse over the "Imported data" chip opens its note and leaving closes it, as it does on the Sample data chip', async () => {
      await importBoth();
      const { ctx, page } = await open(1440, '');
      const anchored: boolean = await page.evaluate(() => CSS.supports('position-area: bottom'));
      if (anchored) {
        const isOpen = () => page.evaluate(() => (document.querySelector('#topbar-imported-note') as HTMLElement).matches(':popover-open'));
        await page.hover('.topbar__chip');
        await page.waitForFunction(() => (document.querySelector('#topbar-imported-note') as HTMLElement).matches(':popover-open'));
        expect(await isOpen(), 'hover opens the note').toBe(true);
        await page.mouse.move(700, 600);
        await page.waitForFunction(() => !(document.querySelector('#topbar-imported-note') as HTMLElement).matches(':popover-open'));
        expect(await isOpen(), 'leaving closes it').toBe(false);
      }
      await ctx.close();
    }, 60_000);

    // The Dashboard's first screen: its four figures end inside the 900px screen with the banner on top, as they do on the sample.
    it('1440x900: the four figures of the Dashboard end inside the screen, on the sample and with the banner above them', async () => {
      const figuresBottom = (page: any) =>
        page.evaluate(() => {
          const figures = [...document.querySelectorAll('.signals > .figure')];
          return { count: figures.length, bottom: Math.max(...figures.map((f) => f.getBoundingClientRect().bottom)), banner: (document.querySelector('.data-banner') as HTMLElement | null)?.getBoundingClientRect().height ?? 0, sideways: document.documentElement.scrollWidth - window.innerWidth };
        });
      let { ctx, page } = await open(1440, '');
      const sample = await figuresBottom(page);
      await ctx.close();
      await importBoth();
      ({ ctx, page } = await open(1440, ''));
      const withBanner = await figuresBottom(page);
      await ctx.close();
      expect(sample.count, 'sample: four figures').toBe(4);
      expect(sample.banner, 'sample: no banner').toBe(0);
      expect(sample.bottom, 'sample: figures end inside 900px').toBeLessThanOrEqual(900);
      expect(withBanner.count, 'imported: four figures').toBe(4);
      expect(withBanner.banner, 'imported: the banner is there').toBeGreaterThan(0);
      expect(withBanner.bottom, 'imported: figures end inside 900px').toBeLessThanOrEqual(900);
      expect(withBanner.sideways).toBeLessThanOrEqual(0);
    }, 60_000);

    // From 768px the banner is one row: the text on the left, the button beside it on the right (below 768px the button has its own row).
    it('from 768px the banner is one row: Restore sample data sits beside its text, level with it', async () => {
      await importBoth();
      for (const w of [768, 1024, 1440]) {
        const { ctx, page } = await open(w, '');
        const m = await page.evaluate(() => {
          const banner = document.querySelector('.data-banner .banner') as HTMLElement;
          const body = (banner.querySelector('.banner__body') as HTMLElement).getBoundingClientRect();
          const button = (banner.querySelector('button') as HTMLElement).getBoundingClientRect();
          return { bodyRight: body.right, bodyTop: body.top, bodyBottom: body.bottom, buttonLeft: button.left, buttonTop: button.top, buttonBottom: button.bottom, buttonRight: button.right, inner: window.innerWidth };
        });
        await ctx.close();
        expect(m.buttonLeft, `${w}: the button is beside the text, not under it`).toBeGreaterThanOrEqual(m.bodyRight - 0.5);
        expect(m.buttonTop < m.bodyBottom && m.buttonBottom > m.bodyTop, `${w}: the button shares the text's rows`).toBe(true);
        expect(m.buttonRight, `${w}: the button is on screen`).toBeLessThanOrEqual(m.inner);
      }
    }, 60_000);

    // A 60-character file name
    it('a 60-character file name keeps the top bar one row of at most 56px, the chip on one line, the whole name in its note, and the note inside the screen', async () => {
      expect(LONG_NAME).toHaveLength(60);
      await importFile('shipments', LONG_NAME);
      for (const w of [390, 768, 1024]) {
        const { ctx, page } = await open(w, '');
        await page.focus('.topbar__chip');
        await page.keyboard.press('Enter');
        const m = await page.evaluate(() => {
          const chip = document.querySelector('.topbar__chip') as HTMLElement;
          const r = document.createRange();
          r.selectNodeContents(chip);
          const note = document.querySelector('#topbar-imported-note') as HTMLElement;
          const n = note.getBoundingClientRect();
          const refresh = [...document.querySelectorAll('.topbar__actions button')].find((b) => (b.textContent ?? '').includes('Refresh')) as HTMLElement;
          return {
            bar: (document.querySelector('.topbar') as HTMLElement).getBoundingClientRect().height,
            lines: new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size,
            chip: chip.textContent,
            note: note.textContent,
            noteLeft: n.left,
            noteRight: n.right,
            refreshRight: refresh.getBoundingClientRect().right,
            sideways: document.documentElement.scrollWidth - window.innerWidth
          };
        });
        await ctx.close();
        expect(m.bar, `${w}: the top bar`).toBeLessThanOrEqual(56);
        expect(m.lines, `${w}: the chip's lines`).toBe(1);
        expect(m.chip, `${w}: the chip`).toBe('Imported data');
        expect(m.note, `${w}: the whole name is in the note`).toContain(LONG_NAME);
        expect(m.noteLeft, `${w}: note left edge`).toBeGreaterThanOrEqual(0);
        expect(m.noteRight, `${w}: note right edge`).toBeLessThanOrEqual(w);
        expect(m.refreshRight, `${w}: Refresh stays on screen`).toBeLessThanOrEqual(w);
        expect(m.sideways, `${w}: sideways`).toBeLessThanOrEqual(0);
      }
    }, 120_000);

    it('with a file imported, Shift+Tab to a field under the sticky top bar scrolls it clear of the bar (390 Inventory, 1440 Shipments)', async () => {
      await importBoth();
      for (const [w, hash] of [[1440, 'shipments'], [390, 'inventory']] as const) {
        const { ctx, page } = await open(w, hash);
        const before: number = await page.evaluate(() => {
          const field = document.querySelector('.filter-bar input') as HTMLElement;
          const bar = (document.querySelector('.topbar') as HTMLElement).getBoundingClientRect().bottom;
          const stops = [...document.querySelectorAll<HTMLElement>('a[href], button, input, select')].filter((e) => e.getBoundingClientRect().width > 0);
          window.scrollTo(0, field.getBoundingClientRect().top + window.scrollY - (bar - 16));
          (stops[stops.indexOf(field) + 1] as HTMLElement).focus({ preventScroll: true });
          return field.getBoundingClientRect().top;
        });
        await page.keyboard.press('Shift+Tab');
        const m = await page.evaluate(() => ({
          focused: document.activeElement === document.querySelector('.filter-bar input'),
          top: (document.querySelector('.filter-bar input') as HTMLElement).getBoundingClientRect().top,
          bar: (document.querySelector('.topbar') as HTMLElement).getBoundingClientRect().bottom
        }));
        await ctx.close();
        expect(before, `${w}: the set-up puts the field under the bar`).toBeLessThan(m.bar);
        expect(m.focused, `${w}`).toBe(true);
        expect(m.top, `${w}: the field's top edge clear of the bar`).toBeGreaterThanOrEqual(m.bar);
      }
    }, 60_000);

    it('the banner reads 4.5:1 on the dark stage, its button border 3:1; at 390 the button is 36px tall on a row of its own', async () => {
      await importBoth();
      for (const w of [1440, 390]) {
        const { ctx, page } = await open(w, '');
        const m = await page.evaluate(() => {
          const c = (window as any).__contrast;
          const banner = document.querySelector('.data-banner .banner') as HTMLElement;
          const text = (sel: string) => {
            const el = banner.querySelector(sel) as HTMLElement;
            const bg = c.behind(el);
            return c.ratio(c.over(c.parse(getComputedStyle(el).color), bg), bg);
          };
          const button = banner.querySelector('button') as HTMLElement;
          const around = c.behind(button.parentElement);
          const bb = button.getBoundingClientRect();
          return {
            title: text('.banner__title'),
            message: text('.banner__message'),
            buttonText: text('button'),
            border: c.ratio(c.over(c.parse(getComputedStyle(button).borderTopColor), c.behind(button)), around),
            buttonH: bb.height,
            buttonTop: bb.top,
            bodyBottom: (banner.querySelector('.banner__body') as HTMLElement).getBoundingClientRect().bottom
          };
        });
        await ctx.close();
        expect(m.title, `${w}: title`).toBeGreaterThanOrEqual(4.5);
        expect(m.message, `${w}: message`).toBeGreaterThanOrEqual(4.5);
        expect(m.buttonText, `${w}: button text`).toBeGreaterThanOrEqual(4.5);
        expect(m.border, `${w}: button border`).toBeGreaterThanOrEqual(3);
        if (w === 390) {
          expect(m.buttonH, '390: button height').toBe(36);
          expect(m.buttonTop, '390: the button is under the text').toBeGreaterThanOrEqual(m.bodyBottom);
        }
      }
    }, 60_000);
  });
});
