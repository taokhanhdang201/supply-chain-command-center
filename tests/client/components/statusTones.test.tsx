// @vitest-environment jsdom
// One table gives each shipment status its tone (DESIGN.md "Shipment status"): the badge on Shipments, the mark in the
// Dashboard's recent activity and the status bar on Analytics all read it, so a status reads one colour on every page.
import { beforeEach, describe, expect, it } from 'vitest';
import { STATUS_TONE } from '../../../src/client/components/charts/statusTones';
import { AnalyticsPage } from '../../../src/client/pages/AnalyticsPage';
import { DashboardPage } from '../../../src/client/pages/DashboardPage';
import { ShipmentsPage } from '../../../src/client/pages/ShipmentsPage';
import { statusLabel } from '../../../src/shared/format';
import { buildSnapshot } from '../../../src/shared/domain/snapshot';
import { createSampleDataset } from '../../../src/shared/sample/generateSampleData';
import type { ShipmentStatus } from '../../../src/shared/types';
import { renderWithData } from '../../helpers/renderWithData';

const seed42 = buildSnapshot(createSampleDataset(42, '2026-10-07', '2026-10-07T00:00:00.000Z'), '2026-10-07', {
  generatedAt: '2026-10-07T00:00:00.000Z',
  limits: { maxUploadBytes: 2_097_152, maxRows: 20_000 }
});
const STATUSES: readonly ShipmentStatus[] = ['pending', 'in_transit', 'delivered', 'cancelled'];
const byLabel = new Map(STATUSES.map((s) => [statusLabel(s), s]));

beforeEach(() => {
  window.location.hash = '';
});

describe('the shipment status tones', () => {
  it('pending, in transit and cancelled are neutral; delivered is good', () => {
    expect(STATUS_TONE).toEqual({ pending: 'neutral', in_transit: 'neutral', delivered: 'good', cancelled: 'neutral' });
  });

  // Renders the Shipments page once per status, one after another: slow while the full suite keeps the CPU busy (about 0.2 s alone).
  it('Shipments: each status badge takes the tone of its status', async () => {
    for (const status of STATUSES) {
      window.location.hash = `#/shipments?status=${status}`;
      const view = await renderWithData(<ShipmentsPage />, { snapshot: seed42 });
      const badges = [...document.querySelectorAll('td.data-table__col--status .badge')];
      expect(badges.length, status).toBeGreaterThan(0);
      for (const b of badges) expect(b.className, `${status}: ${b.textContent}`).toBe(`badge badge--${STATUS_TONE[status]}`);
      view.unmount();
    }
  }, 20_000);

  it("Dashboard: each mark in the recent activity is drawn in its status's tone", async () => {
    await renderWithData(<DashboardPage />, { snapshot: seed42 });
    const marks = [...document.querySelectorAll('.activity svg.status-mark')] as SVGElement[];
    const seen = new Set<string>();
    for (const m of marks) {
      const status = /status-mark--(\w+)/.exec(m.getAttribute('class') ?? '')?.[1] as ShipmentStatus;
      seen.add(status);
      expect(m.style.color, status).toBe(`var(--${STATUS_TONE[status]})`);
    }
    expect(seen.size, 'more than one status in the activity').toBeGreaterThan(1);
  });

  it("Analytics: each part of the status bar and its swatch is drawn in its status's tone", async () => {
    await renderWithData(<AnalyticsPage />, { snapshot: seed42 });
    const items = [...document.querySelectorAll('.share-bar__item')];
    expect(items.map((i) => i.querySelector('.share-bar__label')?.textContent)).toEqual(['Pending', 'In transit', 'Delivered', 'Cancelled']);
    for (const item of items) {
      const status = byLabel.get(item.querySelector('.share-bar__label')?.textContent ?? '') as ShipmentStatus;
      expect((item.querySelector('.share-bar__swatch') as HTMLElement).style.background, status).toBe(`var(--${STATUS_TONE[status]})`);
    }
    const segments = [...document.querySelectorAll('.share-bar__track .share-bar__segment')] as HTMLElement[];
    expect(segments.map((s) => s.style.background)).toEqual(['var(--neutral)', 'var(--neutral)', 'var(--good)', 'var(--neutral)']);
  });
});
