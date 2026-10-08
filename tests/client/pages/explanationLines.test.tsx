// @vitest-environment jsdom
// Phase 1 spec §8 (owner: "5 cặp số lệch: thêm một dòng giải thích ngắn cạnh số, không đổi số"): a number that differs on
// purpose from another place says why, beside it, counted from the server's own flags; no number changes. Seed 42 at
// 2026-10-07 gives the pairs .bangiao/phase0/tong-hop.md lists; small fixtures give the edges: nothing to explain shows nothing.
import { beforeEach, describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { AlertsPage } from '../../../src/client/pages/AlertsPage';
import { AnalyticsPage } from '../../../src/client/pages/AnalyticsPage';
import { DashboardPage } from '../../../src/client/pages/DashboardPage';
import { RoutesPage } from '../../../src/client/pages/RoutesPage';
import { notMeasurableNote } from '../../../src/client/lib/targets';
import { createSampleDataset } from '../../../src/shared/sample/generateSampleData';
import { buildSnapshot } from '../../../src/shared/domain/snapshot';
import { renderWithData } from '../../helpers/renderWithData';
import { makeInventoryRecord, makeShipmentRecord, makeSnapshot, TODAY } from '../../helpers/fixtures';

const seed42 = buildSnapshot(createSampleDataset(42, '2026-10-07', '2026-10-07T00:00:00.000Z'), '2026-10-07', {
  generatedAt: '2026-10-07T00:00:00.000Z',
  limits: { maxUploadBytes: 2_097_152, maxRows: 20_000 }
});

const text = (selector: string) => document.querySelector(selector)?.textContent ?? null;
const onTimeDetail = () =>
  within(screen.getByRole('region', { name: /^Range:/ })).getByText('On-time rate').closest('li')?.querySelector('.stage-figure__detail')?.textContent;

beforeEach(() => {
  window.location.hash = '';
});

describe('1. "8 not measurable": one helper for the Dashboard hero and the Analytics range', () => {
  it('counts the delivered shipments the server could not rate, nothing else, and nothing when every one was rated', () => {
    const snap = makeSnapshot(
      [],
      [
        makeShipmentRecord(), // on time
        makeShipmentRecord({ actualDelivery: '2026-06-08' }), // late
        makeShipmentRecord({ actualDelivery: null }), // delivered without a delivery date
        makeShipmentRecord({ shipDate: '2026-06-03', actualDelivery: '2026-06-02' }), // delivered before it shipped
        makeShipmentRecord({ status: 'in_transit', estimatedDelivery: null, actualDelivery: null }), // unknown, not delivered
        makeShipmentRecord({ status: 'cancelled', actualDelivery: null })
      ],
      { today: TODAY }
    );
    expect(snap.shipments.filter((s) => s.deliveryState === 'unknown')).toHaveLength(3);
    // the note is exactly the gap between delivered and the rate's denominator
    expect(snap.kpis.deliveredShipments - snap.kpis.onTimeCount - snap.kpis.lateCount).toBe(2);
    expect(notMeasurableNote(snap.shipments)).toBe('2 not measurable');
    expect(notMeasurableNote(snap.shipments.slice(0, 2))).toBeNull();
    expect(notMeasurableNote([])).toBeNull();
  });

  it('seed 42: 433 delivered, 425 rated, so 8 not measurable', () => {
    const { kpis } = seed42;
    expect([kpis.onTimeCount, kpis.onTimeCount + kpis.lateCount, kpis.deliveredShipments]).toEqual([364, 425, 433]);
    expect(notMeasurableNote(seed42.shipments)).toBe('8 not measurable');
  });

  it('Dashboard: beside the rate label; the label words and the detail line are unchanged', async () => {
    await renderWithData(<DashboardPage />, { snapshot: seed42 });
    const label = document.querySelector('.hero__label') as HTMLElement;
    expect(screen.getByText('On-time delivery rate')).toBe(label);
    expect(label.querySelector('.hero__note')?.textContent).toBe(', · 8 not measurable');
    expect(label.querySelector('.hero__sep')).toHaveAttribute('aria-hidden', 'true');
    expect(text('.hero__detail')).toBe('364 of 425 delivered on time · below the 90% target');
  });

  it('Analytics: in the on-time figure, before the target', async () => {
    await renderWithData(<AnalyticsPage />, { snapshot: seed42 });
    expect(onTimeDetail()).toBe('364 of 425 delivered on time · 8 not measurable · below the 90% target');
  });

  it('shows nothing on either page when every delivered shipment was rated', async () => {
    const shipments = [
      ...Array.from({ length: 9 }, () => makeShipmentRecord()),
      makeShipmentRecord({ actualDelivery: '2026-06-08' })
    ];
    const snapshot = makeSnapshot([], shipments, { today: TODAY });
    const dashboard = await renderWithData(<DashboardPage />, { snapshot });
    expect(document.querySelector('.hero__note')).toBeNull();
    expect(text('.hero__label')).toBe('On-time delivery rate');
    dashboard.unmount();
    await renderWithData(<AnalyticsPage />, { snapshot });
    expect(onTimeDetail()).toBe('9 of 10 delivered on time');
  });
});

describe('2. Alerts: the rows in view, split into need attention and info', () => {
  it.each([
    ['#/alerts', '67 alerts · 57 need attention · 10 info'],
    ['#/alerts?type=shipment_delayed', '18 alerts · 12 need attention · 6 info'],
    ['#/alerts?type=missing_info', '13 alerts · 9 need attention · 4 info'],
    ['#/alerts?severity=info', '10 alerts'], // one kind of row in view: nothing to split
    ['#/alerts?kind=any', '57 alerts'],
    ['#/alerts?severity=critical', '20 alerts']
  ])('seed 42 at %s reads "%s"', async (hash, line) => {
    window.location.hash = hash;
    await renderWithData(<AlertsPage />, { snapshot: seed42 });
    expect(text('.table-summary')).toBe(line);
  });

  it('agrees in number: one needs attention', async () => {
    const snapshot = makeSnapshot([makeInventoryRecord({ quantity: 0 }), makeInventoryRecord({ avgDailyUsage: null })], [], { today: TODAY });
    expect(snapshot.alerts.map((a) => a.severity).sort()).toEqual(['critical', 'info']);
    await renderWithData(<AlertsPage />, { snapshot });
    expect(text('.table-summary')).toBe('2 alerts · 1 needs attention · 1 info');
  });
});

describe('3 and 4. Dashboard Top alerts: info alerts left out, Overdue said plainly', () => {
  it('seed 42: one muted line under the total, and "past ETA, not delivered" beside Overdue as its description', async () => {
    await renderWithData(<DashboardPage />, { snapshot: seed42 });
    const note = document.querySelector('.attention__kinds .attention__note') as HTMLElement;
    expect(note.textContent).toBe('Info alerts are not counted.');
    const total = document.querySelector('.kind-row--total') as HTMLElement;
    expect(total.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(total.querySelector('.kind-row__count')?.textContent).toBe('57');

    const rows = [...document.querySelectorAll('.kind-list .kind-row')] as HTMLElement[];
    const overdue = rows.find((r) => r.querySelector('.kind-row__label')?.textContent === 'Overdue') as HTMLElement;
    expect(overdue.getAttribute('aria-label')).toBe('Overdue, 12, view in Alerts');
    expect(overdue.querySelector('.kind-row__note')?.textContent).toBe('past ETA, not delivered');
    expect(overdue.querySelector('.kind-row__sep')).toHaveAttribute('aria-hidden', 'true');
    expect(document.getElementById(overdue.getAttribute('aria-describedby') ?? '')?.textContent).toBe('past ETA, not delivered');
    for (const r of rows.filter((x) => x !== overdue)) {
      expect(r.querySelector('.kind-row__note')).toBeNull();
      expect(r).not.toHaveAttribute('aria-describedby');
    }
  });

  it('says nothing about info alerts when there are none', async () => {
    const snapshot = makeSnapshot([makeInventoryRecord({ quantity: 0 })], [makeShipmentRecord()], { today: TODAY });
    expect(snapshot.alerts.filter((a) => a.severity === 'info')).toHaveLength(0);
    await renderWithData(<DashboardPage />, { snapshot });
    expect(document.querySelector('.attention__note')).toBeNull();
  });
});

describe('5. Routes: the lanes on the map and the lanes that are not', () => {
  it('seed 42: 25 of the 32 lanes on the map, the button names them', async () => {
    await renderWithData(<RoutesPage />, { snapshot: seed42 });
    expect(text('.routes__summary')).toBe('32 lanes · the map shows the top 25 · 7 lanes are not on the map');
    expect(screen.getByRole('button', { name: 'Show all 25 lanes in the list' })).toBeInTheDocument();
  });

  it('seed 42 with every lane shown: only the 2 without coordinates are off the map', async () => {
    window.location.hash = '#/routes?top=all';
    await renderWithData(<RoutesPage />, { snapshot: seed42 });
    expect(text('.routes__summary')).toBe('32 lanes · 2 lanes are not on the map');
    expect(screen.getByRole('button', { name: 'Show all 30 lanes in the list' })).toBeInTheDocument();
  });

  it('one lane off the map reads "1 lane is"; none off the map adds nothing', async () => {
    const lane = (destination: string) => makeShipmentRecord({ origin: 'WH-DFW', destination });
    const mapped = [lane('HOU'), lane('PHX'), makeShipmentRecord({ origin: 'WH-ATL', destination: 'MIA' })];
    const one = await renderWithData(<RoutesPage />, { snapshot: makeSnapshot([], [...mapped, lane('Plant 7')], { today: TODAY }) });
    expect(text('.routes__summary')).toBe('4 lanes · 1 lane is not on the map');
    one.unmount();
    await renderWithData(<RoutesPage />, { snapshot: makeSnapshot([], mapped, { today: TODAY }) });
    expect(text('.routes__summary')).toBe('3 lanes');
    expect(screen.queryByRole('button', { name: /^Show all/ })).toBeNull();
  });
});

describe('Edges: nothing to explain shows nothing; what there is reads right', () => {
  it('a count of a thousand or more reads with its comma, on the Dashboard label', async () => {
    const shipments = Array.from({ length: 1234 }, () => makeShipmentRecord({ actualDelivery: null }));
    const snapshot = makeSnapshot([], shipments, { today: TODAY });
    expect(notMeasurableNote(snapshot.shipments)).toBe('1,234 not measurable');
    await renderWithData(<DashboardPage />, { snapshot });
    expect(text('.hero__note')).toBe(', · 1,234 not measurable');
  });

  it('when no delivered shipment could be rated, the rate is "—" and the label still says how many were left out', async () => {
    const snapshot = makeSnapshot([], [makeShipmentRecord({ actualDelivery: null }), makeShipmentRecord({ actualDelivery: null })], { today: TODAY });
    await renderWithData(<DashboardPage />, { snapshot });
    expect(text('.hero__value')).toBe('—');
    expect(text('.hero__label')).toBe('On-time delivery rate, · 2 not measurable');
    expect(text('.hero__detail')).toBe('0 of 0 delivered on time');
  });

  it('Analytics counts again for the range in view (seed 42, 30 days: one not measurable)', async () => {
    window.location.hash = '#/analytics?range=30d';
    await renderWithData(<AnalyticsPage />, { snapshot: seed42 });
    expect(onTimeDetail()).toMatch(/ · 1 not measurable( · |$)/);
    expect(onTimeDetail()).not.toContain('8 not measurable');
  });

  it('Alerts: a view with no rows has no split, only its empty state', async () => {
    window.location.hash = '#/alerts?q=zzzz-no-such-alert';
    await renderWithData(<AlertsPage />, { snapshot: seed42 });
    expect(document.querySelector('.table-summary')).toBeNull();
    expect(screen.queryByText(/need attention · /)).toBeNull();
  });

  it('Alerts: a view of only rows that need attention has no split', async () => {
    window.location.hash = '#/alerts?severity=warning';
    await renderWithData(<AlertsPage />, { snapshot: seed42 });
    expect(text('.table-summary')).toMatch(/^\d+ alerts?$/);
  });

  it('Dashboard: with no overdue shipment no kind row carries a note and none describes another', async () => {
    const snapshot = makeSnapshot([makeInventoryRecord({ quantity: 0 })], [makeShipmentRecord()], { today: TODAY });
    await renderWithData(<DashboardPage />, { snapshot });
    expect(document.querySelectorAll('.kind-list .kind-row').length).toBeGreaterThan(0);
    expect(document.querySelector('.kind-row__note')).toBeNull();
    expect(document.querySelector('.kind-list [aria-describedby]')).toBeNull();
  });
});
