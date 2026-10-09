// One number, one meaning, across the pages, in a real browser at 1440. The attention count the sidebar badge, the
// Dashboard and the Alerts page each draw is the same number; each Dashboard kind row equals the Alerts page its link opens;
// the Alerts total less the ones needing attention is the info count the Dashboard says it leaves out; the Dashboard's on-time
// rate and its "not measurable" count are Analytics' own. No figure is pinned to a constant: the pages are compared with each
// other, and each number must be above zero so a page that drew 0 everywhere would not pass.
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

/** A number as the pages write it ("1,234"). */
const num = (s: string | null | undefined): number => Number((s ?? '').replace(/,/g, ''));

describe('numbers agree across the pages (real Chromium, 1440)', () => {
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

  /** Opens `#/<hash>` in a fresh page (so each read is of the page as loaded), runs `read` there, and closes it. */
  const read = async <T>(hash: string, read: () => T): Promise<T> => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await page.goto(`${base}/${hash.startsWith('#') ? hash : `#/${hash}`}`);
    await page.waitForSelector('main h1');
    await page.waitForTimeout(200);
    const value = await page.evaluate(read);
    await ctx.close();
    return value;
  };

  const summary = (text: string) => {
    const m = /^([\d,]+) alerts?(?: · ([\d,]+) need attention)?(?: · ([\d,]+) info)?$/.exec(text.replace(/\s+/g, ' ').trim());
    return { total: num(m?.[1]), attention: m?.[2] === undefined ? null : num(m[2]), info: m?.[3] === undefined ? null : num(m[3]), raw: text };
  };

  it('the sidebar badge, the Dashboard total, the Alerts "need attention", Critical + Warning and the kind=any list are one number', async () => {
    const dash = await read('', () => ({
      badge: document.querySelector('.sidebar__badge')?.textContent ?? null,
      total: document.querySelector('.kind-row--total .kind-row__count')?.textContent ?? null
    }));
    const alerts = await read('alerts', () => {
      const bySeverity: Record<string, string> = {};
      for (const f of document.querySelectorAll('section[aria-labelledby="alerts-by-severity"] .stage-figure')) {
        bySeverity[f.querySelector('.stage-figure__label')!.textContent!.trim()] = f.querySelector('.stage-figure__value')!.textContent!.trim();
      }
      return { summary: document.querySelector('.table-summary')?.textContent ?? '', bySeverity, badge: document.querySelector('.sidebar__badge')?.textContent ?? null };
    });
    const any = await read('alerts?kind=any', () => ({ summary: document.querySelector('.table-summary')?.textContent ?? '' }));

    const badge = num(dash.badge);
    expect(badge, 'the badge').toBeGreaterThan(0);
    expect(num(dash.total), 'Dashboard "Need attention"').toBe(badge);
    expect(num(alerts.badge), 'the badge on the Alerts page').toBe(badge);
    expect(summary(alerts.summary).attention, `Alerts "need attention" in "${alerts.summary}"`).toBe(badge);
    expect(Object.keys(alerts.bySeverity).sort(), 'the severities').toEqual(['Critical', 'Info', 'Warning']);
    expect(num(alerts.bySeverity.Critical) + num(alerts.bySeverity.Warning), 'Critical + Warning').toBe(badge);
    expect(summary(any.summary).total, `the first number of "${any.summary}"`).toBe(badge);
  }, 60_000);

  it('every Dashboard kind row is the first number of the Alerts list its link opens', async () => {
    const rows = await read('', () =>
      [...document.querySelectorAll('.kind-list .kind-row')].map((a) => ({
        label: a.querySelector('.kind-row__label')!.textContent!.trim(),
        count: a.querySelector('.kind-row__count')!.textContent!.trim(),
        href: a.getAttribute('href')!
      }))
    );
    expect(rows.length, 'kind rows').toBeGreaterThanOrEqual(4);
    for (const row of rows) {
      expect(num(row.count), `${row.label}: the Dashboard count`).toBeGreaterThan(0);
      const list = await read(row.href, () => document.querySelector('.table-summary')?.textContent ?? '');
      expect(summary(list).total, `${row.label}: "${list}" at ${row.href}`).toBe(num(row.count));
    }
  }, 120_000);

  it('Alerts total less "need attention" is its info count, which the Dashboard says it leaves out', async () => {
    const alerts = summary(await read('alerts', () => document.querySelector('.table-summary')?.textContent ?? ''));
    const note = await read('', () => document.querySelector('.attention__note')?.textContent ?? null);
    expect(alerts.attention, alerts.raw).toBeGreaterThan(0);
    expect(alerts.info, alerts.raw).toBeGreaterThan(0);
    expect(alerts.total - (alerts.attention ?? 0), alerts.raw).toBe(alerts.info);
    expect(note).toBe('Info alerts are not counted.');
  }, 60_000);

  it('the Dashboard on-time rate and its "not measurable" count are the Analytics ones', async () => {
    const dash = await read('', () => ({ value: document.querySelector('.hero__value')?.textContent ?? '', note: document.querySelector('.hero__note')?.textContent ?? '' }));
    const analytics = await read('analytics', () => {
      const fig = [...document.querySelectorAll('.stage-figure')].find((f) => f.querySelector('.stage-figure__label')?.textContent?.trim() === 'On-time rate');
      return { value: fig?.querySelector('.stage-figure__value')?.textContent ?? '', detail: fig?.querySelector('.stage-figure__detail')?.textContent ?? '' };
    });
    expect(parseFloat(dash.value), `Dashboard "${dash.value}"`).toBeGreaterThan(0);
    expect(dash.value.trim()).toBe(analytics.value.trim());
    const notMeasurable = (s: string) => /([\d,]+) not measurable/.exec(s)?.[1];
    expect(num(notMeasurable(dash.note)), `Dashboard "${dash.note}"`).toBeGreaterThan(0);
    expect(notMeasurable(dash.note), `Dashboard "${dash.note}" against Analytics "${analytics.detail}"`).toBe(notMeasurable(analytics.detail));
  }, 60_000);
});
