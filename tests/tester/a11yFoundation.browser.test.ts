// The foundation's accessibility in a real browser, where jsdom cannot tell.
// A focused control is never left under the sticky top bar (WCAG 2.4.11); the open drawer keeps Tab inside it (2.4.3);
// the sort buttons of a hidden header row leave the Tab order (2.4.7); field borders and a danger button on the band meet
// their contrast (1.4.11, 1.4.3); an unavailable button keeps the focus (2.4.3); the skip link's ring shows on the dark
// frame; link buttons, the Dashboard's links and its "How these are counted" answer a 24px target (2.5.8).
// With the default font at 200% (text zoom, not page zoom), every line height grows with its text (1.4.4).
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

describe('accessibility of the foundation (real Chromium)', () => {
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
    await ctx.addInitScript(installContrast);
    const page = await ctx.newPage();
    await page.goto(`${base}/#/${hash}`);
    await page.waitForSelector('main h1');
    return { ctx, page };
  };

  // WCAG 2.4.11: the top bar is sticky (56px, one row at every width). The field is
  // put 16px above the bar's bottom edge (under the bar, inside the viewport) and reached with Shift+Tab from the control
  // after it. Without html scroll-padding-top Chromium leaves a control that is inside the viewport where it is.
  it('Shift+Tab to a field under the sticky top bar scrolls it clear of the bar (1440 Shipments, 390 Inventory)', async () => {
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

  // WCAG 1.4.11: on the paper a field's white fill is 1.12:1 against the floor, so its border is its edge; on the band the
  // border is drawn over the field's dark fill. WCAG 1.4.3: no danger button sits on the band today; one placed there reads in
  // the dark ink, as the primary button does.
  it('field borders stand 3:1 on the paper and on the band; a danger button on the band reads 4.5:1', async () => {
    const edges = (page: any, sel: string) =>
      page.evaluate((s: string) => {
        const c = (window as any).__contrast;
        const el = document.querySelector(s) as HTMLElement;
        const fill = c.behind(el);
        const border = c.over(c.parse(getComputedStyle(el).borderTopColor), fill);
        return { fill: c.ratio(border, fill), around: c.ratio(border, c.behind(el.parentElement)) };
      }, sel);
    let { ctx, page } = await open(1440, 'shipments');
    for (const sel of ['.filter-bar .search-input__field', '.filter-bar .select-field__control']) {
      const r = await edges(page, sel);
      expect(r.fill, `${sel}: against its fill`).toBeGreaterThanOrEqual(3);
      expect(r.around, `${sel}: against the paper`).toBeGreaterThanOrEqual(3);
    }
    await ctx.close();
    ({ ctx, page } = await open(1440, 'analytics'));
    const range = await edges(page, '.page-stage .select-field__control');
    expect(range.fill, 'Range: against its fill').toBeGreaterThanOrEqual(3);
    expect(range.around, 'Range: against the band').toBeGreaterThanOrEqual(3);
    const danger: number = await page.evaluate(() => {
      const c = (window as any).__contrast;
      const b = document.createElement('button');
      b.className = 'button button--danger';
      b.textContent = 'Discard';
      (document.querySelector('.page-stage') as HTMLElement).appendChild(b);
      return c.ratio(c.parse(getComputedStyle(b).color), c.behind(b));
    });
    expect(danger, 'danger text on the band').toBeGreaterThanOrEqual(4.5);
    await ctx.close();
  }, 60_000);

  // WCAG 2.4.3 / 2.4.11: below 1024px the drawer covers the top bar (its menu button too) and dims the page. While it is
  // open, Tab stays in it; Escape and the backdrop close it and give the focus to the menu button; a window that widens to
  // 1024px closes it (the sidebar is fixed there), so the shell is not left inert.
  it('drawer below 1024px: Tab stays in it; Escape and the backdrop close it to the menu button; a wider window closes it', async () => {
    const { ctx, page } = await open(390, '');
    const menu = page.locator('button[aria-controls="sidebar"]');
    const where = () =>
      page.evaluate(() => {
        const a = document.activeElement;
        return { sidebar: !!a?.closest('#sidebar'), shell: !!a?.closest('.app-shell__content'), skip: !!a?.classList.contains('skip-link'), body: a === document.body, href: a?.getAttribute('href') ?? null };
      });
    await menu.click();
    await page.waitForSelector('#sidebar.is-open');
    expect((await where()).sidebar, 'opening focuses the first link').toBe(true);
    expect(await page.evaluate(() => [document.querySelector('.app-shell__content')!.hasAttribute('inert'), document.querySelector('.skip-link')!.hasAttribute('inert')])).toEqual([true, true]);
    const links = new Set<string>();
    for (let i = 0; i < 18; i += 1) {
      await page.keyboard.press('Tab');
      const w = await where();
      expect(w.shell || w.skip, `Tab ${i + 1} left the drawer`).toBe(false);
      expect(w.sidebar || w.body, `Tab ${i + 1}`).toBe(true);
      if (w.href !== null) links.add(w.href);
    }
    expect(links.size, 'Tab reached every link of the drawer (7 pages, LinkedIn and GitHub)').toBe(9);
    for (let i = 0; i < 9; i += 1) {
      await page.keyboard.press('Shift+Tab');
      const w = await where();
      expect(w.shell || w.skip, `Shift+Tab ${i + 1} left the drawer`).toBe(false);
    }
    const closed = () =>
      page.evaluate(() => ({
        open: document.querySelector('#sidebar')!.classList.contains('is-open'),
        inert: document.querySelector('.app-shell__content')!.hasAttribute('inert'),
        menu: document.activeElement?.getAttribute('aria-controls') === 'sidebar'
      }));
    await page.keyboard.press('Escape');
    expect(await closed(), 'Escape').toEqual({ open: false, inert: false, menu: true });
    await menu.click();
    await page.waitForSelector('#sidebar.is-open');
    await page.mouse.click(370, 600); // the backdrop, right of the 288px drawer
    expect(await closed(), 'the backdrop').toEqual({ open: false, inert: false, menu: true });
    await page.setViewportSize({ width: 800, height: 900 });
    await menu.click();
    await page.waitForSelector('#sidebar.is-open');
    await page.setViewportSize({ width: 1100, height: 900 });
    await page.waitForFunction(() => !document.querySelector('.app-shell__content')!.hasAttribute('inert'), undefined, { timeout: 5000 });
    expect(await page.evaluate(() => document.querySelector('#sidebar')!.classList.contains('is-open')), 'the drawer state is closed').toBe(false);
    await ctx.close();
  }, 60_000);

  // WCAG 2.4.3: a button that turns unavailable while it has the focus keeps it (the disabled attribute dropped it to <body>,
  // so the next Tab started over from the skip link).
  it('an unavailable button keeps the focus: Next on the last page of Alerts, Refresh while it refreshes', async () => {
    const { ctx, page } = await open(1440, 'alerts');
    await page.getByRole('navigation', { name: 'Pagination' }).getByRole('button', { name: 'Next' }).focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter'); // 67 alerts, 25 a page: page 3 of 3
    const last = await page.evaluate(() => {
      const a = document.activeElement as HTMLElement;
      return { name: a.textContent?.trim(), unavailable: a.getAttribute('aria-disabled'), shown: document.querySelector('.pagination__summary')?.textContent };
    });
    expect(last).toEqual({ name: 'Next', unavailable: 'true', shown: 'Showing 51–67 of 67' });
    // Review S1: opacity fades the whole button, its outline too (2.03:1 on the paper at 0.45). The ring of the focused,
    // unavailable Next must keep 3:1 once the opacity is counted: its colour mixed with what lies behind it, by the opacity.
    const ring = await page.evaluate(() => {
      const c = (window as any).__contrast;
      const a = document.activeElement as HTMLElement;
      const s = getComputedStyle(a);
      let opacity = 1;
      for (let e: HTMLElement | null = a; e; e = e.parentElement) opacity *= Number(getComputedStyle(e).opacity);
      const colour = c.parse(s.outlineColor);
      const behind = c.behind(a.parentElement);
      const drawn = c.over([colour[0], colour[1], colour[2], colour[3] * opacity], behind);
      return { visible: a.matches(':focus-visible'), style: s.outlineStyle, opacity, ratio: c.ratio(drawn, behind) };
    });
    expect(ring.visible, 'Next shows its focus ring').toBe(true);
    expect(ring.style, 'the ring is drawn').toBe('solid');
    expect(ring.ratio, `Next's ring at opacity ${ring.opacity} against the paper`).toBeGreaterThanOrEqual(3);
    await page.keyboard.press('Enter'); // ignored
    expect(await page.locator('.pagination__summary').textContent()).toBe('Showing 51–67 of 67');
    // The local reload takes a few milliseconds, too short to catch: the snapshot is held back, so Refresh stays busy for 600ms.
    await page.route('**/api/snapshot', async (route: any) => {
      await new Promise((r) => setTimeout(r, 600));
      await route.continue();
    });
    await page.getByRole('button', { name: 'Refresh' }).focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    const busy = await page.evaluate(() => {
      const a = document.activeElement as HTMLElement;
      return { name: a.textContent?.trim(), busy: a.getAttribute('aria-busy'), unavailable: a.getAttribute('aria-disabled') };
    });
    expect(busy, 'Refresh while it refreshes still has the focus').toEqual({ name: 'Refresh', busy: 'true', unavailable: 'true' });
    await page.waitForFunction(() => document.querySelector('.topbar .button')?.getAttribute('aria-busy') !== 'true', undefined, { timeout: 5000 });
    expect(await page.evaluate(() => (document.activeElement as HTMLElement).textContent?.trim())).toBe('Refresh');
    await ctx.close();
  });

  // The skip link appears over the dark sidebar (from 1024px) or the dark top bar: its ring is the light stage ink. The ring
  // is drawn 2-4px outside the link; what lies under it there is read with elementFromPoint. After the load nothing has the
  // focus (the route's h1 focus runs while the data is loading), so the first Tab lands on the skip link (V16-BUG-1).
  it("the skip link's focus ring stands 3:1 on the dark frame it appears over (1440, 390)", async () => {
    for (const w of [1440, 390]) {
      const { ctx, page } = await open(w, '');
      await page.keyboard.press('Tab');
      const m = await page.evaluate(() => {
        const c = (window as any).__contrast;
        const link = document.querySelector('.skip-link') as HTMLElement;
        const r = link.getBoundingClientRect();
        const under = document.elementFromPoint(r.left - 3, r.top + r.height / 2) as Element;
        const s = getComputedStyle(link);
        return { focused: document.activeElement === link, visible: link.matches(':focus-visible'), style: s.outlineStyle, ratio: c.ratio(c.parse(s.outlineColor), c.behind(under)) };
      });
      await ctx.close();
      expect(m.focused, `${w}: Tab lands on the skip link first`).toBe(true);
      expect(m.visible, `${w}: the ring applies`).toBe(true);
      expect(m.style, `${w}`).toBe('solid');
      expect(m.ratio, `${w}: ring against the frame`).toBeGreaterThanOrEqual(3);
    }
  });

  // WCAG 2.4.7 / 2.4.3: below 1100px every stacking table hides its header row, and the three ledgers stack to 1279px. A sort
  // button there took the focus where nobody could see it (Alerts 4, Inventory 11, Shipments 8 stops). It leaves the Tab order;
  // the header keeps its name, and the page's Sort by sorts the records. The plain table at 1440 keeps its sort buttons.
  it('a stacked table: no sort button takes Tab, every header keeps its name, and Sort by is on the page', async () => {
    const tabStops = async (page: any): Promise<string[]> => {
      const stops: string[] = [];
      for (let i = 0; i < 90; i += 1) {
        await page.keyboard.press('Tab');
        const s: string = await page.evaluate(() => {
          const a = document.activeElement;
          return !a || a === document.body ? 'body' : a.closest('thead') ? 'thead' : a.tagName;
        });
        if (s === 'body' && stops.length > 0) break;
        stops.push(s);
      }
      return stops;
    };
    const cases = [
      [390, 'alerts', 'Alerts', 'Severity'],
      [1200, 'alerts', 'Alerts', 'Type'],
      [1024, 'shipments', 'Shipments', 'Ship date'],
      [1200, 'inventory', 'Inventory', 'Qty']
    ] as const;
    for (const [w, hash, table, header] of cases) {
      const { ctx, page } = await open(w, hash);
      const stops = await tabStops(page);
      expect(stops.length, `${w} #/${hash}: Tab went through the page`).toBeGreaterThan(10);
      expect(stops, `${w} #/${hash}`).not.toContain('thead');
      expect(await page.getByRole('table', { name: table }).getByRole('columnheader', { name: header, exact: true }).count(), `${w} #/${hash}: ${header}`).toBe(1);
      expect(await page.getByLabel('Sort by', { exact: true }).count(), `${w} #/${hash}: Sort by`).toBe(1);
      await ctx.close();
    }
    const { ctx, page } = await open(1440, 'alerts');
    expect(await tabStops(page), '1440: the plain table keeps its sort buttons').toContain('thead');
    await ctx.close();
  }, 120_000);

  // WCAG 2.5.8: a target is at least 24px tall, or spaced. The link buttons (Button variant link), the Dashboard's links and
  // its "How these are counted" have a 17-21px line; a tap 11.5px above or below the centre must still land on them.
  it('link buttons, the Dashboard links and "How these are counted" answer a tap 11.5px above and below their centre', async () => {
    const pages = [
      ['', ['.dash-link', '.attention__how > summary', '.button--link'], 4],
      ['import', ['.button--link'], 1]
    ] as const;
    for (const [hash, sels, least] of pages) {
      const { ctx, page } = await open(1440, hash);
      const m = await page.evaluate((selectors: readonly string[]) => {
        const out = { checked: 0, misses: [] as string[] };
        for (const el of selectors.flatMap((s) => [...document.querySelectorAll<HTMLElement>(s)])) {
          if (!el.checkVisibility()) continue;
          el.scrollIntoView({ block: 'center' });
          const r = el.getBoundingClientRect();
          out.checked += 1;
          for (const dy of [-11.5, 11.5]) {
            const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2 + dy);
            if (hit?.closest('a, button, summary') !== el) out.misses.push(`${el.className || el.tagName} "${(el.textContent ?? '').trim().slice(0, 24)}" at ${dy}`);
          }
        }
        return out;
      }, sels);
      await ctx.close();
      expect(m.checked, `#/${hash}: targets checked`).toBeGreaterThanOrEqual(least);
      expect(m.misses, `#/${hash}`).toEqual([]);
    }
  });

  // WCAG 1.4.4 with a larger default font (text zoom, not page zoom): every line height grows with its text, so a wrapped
  // line never runs into the next. A px line height stays put while the rem text doubles (the Dashboard drew its 72px
  // figures on 44px lines; the sidebar badge kept a 16px line). Each text element's line height over its font size is read
  // at the default size and with the root font at 200%; the two must match ("normal" grows by itself and is skipped).
  it('with the default font at 200% every line height grows with its text, on all eight pages (1280)', async () => {
    const off: string[] = [];
    for (const hash of ['', 'inventory', 'shipments', 'routes', 'analytics', 'alerts', 'import', 'nope']) {
      const { ctx, page } = await open(1280, hash);
      off.push(
        ...(await page.evaluate((h: string) => {
          const texts = [...document.querySelectorAll('.app-shell *')].filter(
            (e) => !e.closest('svg') && [...e.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? '').trim() !== '') && e.checkVisibility()
          );
          const ratio = (e: Element): number | null => {
            const s = getComputedStyle(e);
            return s.lineHeight === 'normal' ? null : parseFloat(s.lineHeight) / parseFloat(s.fontSize);
          };
          const before = texts.map(ratio);
          document.documentElement.style.fontSize = '200%';
          const after = texts.map(ratio);
          return texts.flatMap((e, i) => {
            const a = before[i];
            const b = after[i];
            return a === null || a === undefined || b === null || b === undefined || Math.abs(a - b) <= 0.01
              ? []
              : [`#/${h} ${e.tagName.toLowerCase()}.${String(e.className).split(' ')[0]} ${a.toFixed(2)} -> ${b.toFixed(2)}`];
          });
        }, hash))
      );
      await ctx.close();
    }
    expect(off).toEqual([]);
  }, 120_000);
});
