// @vitest-environment jsdom
// V2 Dashboard: the parts of the design that the specification fixes and that jsdom can see: what was removed, the reading
// (= keyboard) order, the hero gauge, the severity text that replaces the badges, the ledger's table semantics under its
// CSS-grid layout, and the motion switches (reduced motion arms nothing; otherwise only the drawn chapters are armed).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { DashboardPage, ON_TIME_FLOOR, ON_TIME_TARGET } from '../../../src/client/pages/DashboardPage';
import { renderWithData } from '../../helpers/renderWithData';
import { makeInventoryRecord, makeShipmentRecord, makeSnapshot, TODAY } from '../../helpers/fixtures';
import { buildQueue, kindCounts } from '../../../src/client/lib/attention';

beforeEach(() => {
  window.location.hash = '';
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function scenario() {
  return makeSnapshot(
    [makeInventoryRecord({ warehouse: 'WH-DFW', quantity: 0 }), makeInventoryRecord({ warehouse: 'WH-ATL', quantity: 400 })],
    [
      makeShipmentRecord({ shipmentId: 'SHP-000001' }),
      makeShipmentRecord({ shipmentId: 'SHP-000002' }),
      makeShipmentRecord({ shipmentId: 'SHP-000003' }),
      makeShipmentRecord({ shipmentId: 'SHP-000004', actualDelivery: '2026-06-08' }), // delivered late
      makeShipmentRecord({ shipmentId: 'SHP-000005', status: 'in_transit', shipDate: '2026-06-05', estimatedDelivery: '2026-06-10', actualDelivery: null }), // overdue
      makeShipmentRecord({ shipmentId: 'SHP-000006', status: 'pending', shipDate: '2026-06-20', estimatedDelivery: '2026-06-25', actualDelivery: null }),
      makeShipmentRecord({ shipmentId: 'SHP-000007', status: 'cancelled', actualDelivery: null })
    ],
    { today: TODAY }
  );
}

/** `n` delivered on time and `late` delivered late. */
function withRate(n: number, late: number) {
  const shipments = [
    ...Array.from({ length: n }, () => makeShipmentRecord()),
    ...Array.from({ length: late }, () => makeShipmentRecord({ actualDelivery: '2026-06-08' }))
  ];
  return makeSnapshot([], shipments, { today: TODAY });
}

describe('Dashboard V2: the hero and its gauge', () => {
  it('draws a 2px gauge at the on-time rate, hidden from assistive tech; the value and label carry the meaning', async () => {
    await renderWithData(<DashboardPage />, { snapshot: scenario() });
    const gauge = document.querySelector('.hero__gauge') as HTMLElement;
    expect(gauge).toHaveAttribute('aria-hidden', 'true');
    expect(gauge.textContent).toBe('');
    expect(gauge.style.getPropertyValue('--rate')).toBe('75.00%');
    // The value itself is plain ink: the tone lives only on the gauge's remainder.
    expect(screen.getByText('75.0%').className).toBe('hero__value');
    expect(screen.getByText('On-time delivery rate')).toHaveClass('hero__label');
    // 75% is below the floor (critical): the colour is decoration, so being under target is also said in words.
    expect(screen.getByText('3 of 4 delivered on time · below the 90% target')).toHaveClass('hero__detail');
  });

  it.each([
    [10, 0, 'good'],
    [8, 1, 'warning'],
    [3, 1, 'critical']
  ])('%i on time and %i late colours the remainder with the existing tone (%s)', async (onTime, late, tone) => {
    await renderWithData(<DashboardPage />, { snapshot: withRate(onTime, late) });
    expect(document.querySelector('.hero__gauge')).toHaveClass(`hero__gauge--${tone}`);
  });

  it.each([
    [10, 0, 'good', '10 of 10 delivered on time'],
    [9, 1, 'good', '9 of 10 delivered on time'], // exactly at the target is not below it
    [8, 1, 'warning', '8 of 9 delivered on time · below the 90% target'],
    [3, 1, 'critical', '3 of 4 delivered on time · below the 90% target']
  ])('%i on time and %i late (%s) says "%s"', async (onTime, late, _tone, text) => {
    await renderWithData(<DashboardPage />, { snapshot: withRate(onTime, late) });
    expect(document.querySelector('.hero__detail')?.textContent).toBe(text);
  });

  it('takes the target in that sentence from the same constant as the tone', () => {
    expect(ON_TIME_TARGET).toBe(0.9);
    expect(ON_TIME_FLOOR).toBeLessThan(ON_TIME_TARGET);
  });

  it('has no gauge when there is nothing to rate, and the value stays a dash', async () => {
    await renderWithData(<DashboardPage />, { snapshot: makeSnapshot([], [], { today: TODAY }) });
    expect(document.querySelector('.hero__gauge')).toBeNull();
    expect(document.querySelector('.hero__value')).toHaveTextContent('—');
  });
});

describe('Dashboard V2: what the redesign removed stays removed', () => {
  it('has no callout, key, manifest, eyebrow, badge, graticule, city label or per-warehouse name/units text', async () => {
    await renderWithData(<DashboardPage />, { snapshot: scenario() });
    expect(document.querySelector('.situation__callout, .atlas-key, .manifest, .eyebrow, .atlas__graticule, .badge, .alert-line__badge, .callout')).toBeNull();
    expect(screen.queryByText('Most delayed lane')).toBeNull();
    expect(screen.queryByText(/Rack width follows capacity/)).toBeNull();
    // Racks show code, percent and value only: no name and no "units of capacity" line.
    expect(screen.queryByText('Dallas-Fort Worth DC', { selector: '.rack *' })).toBeNull();
    expect(document.querySelector('.rack')?.textContent).toMatch(/^WH-DFW.*\$/);
    // The atlas labels warehouses only: at most the five codes, never a city.
    const labels = [...document.querySelectorAll('.atlas__label')].map((n) => n.textContent);
    expect(labels.length).toBeLessThanOrEqual(5);
    for (const l of labels) expect(l).toMatch(/^WH-/);
  });

  it('keeps exactly four h2 chapter titles, in reading order', async () => {
    await renderWithData(<DashboardPage />, { snapshot: scenario() });
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'Top alerts', // "Do these first" for one release, renamed back when the block moved to paper (docs/DASHBOARD-ALERTS.md §9)
      'Delivery reliability and cost',
      'Warehouses and inventory',
      'Recent shipment activity'
    ]);
  });
});

describe('Dashboard V2: keyboard order equals reading order', () => {
  // "Top alerts" adds the kinds links before the alerts link and the queue rows after it, in reading order (title
  // column, then the rows); the rest of the order is unchanged.
  it('tabs through the network, the four figures then the status counts, the kinds, the alerts link, the rows, the flow and the racks', async () => {
    const snapshot = scenario();
    await renderWithData(<DashboardPage />, { snapshot });
    const order = [...document.querySelectorAll('a[href], button, select')].map((el) => el.getAttribute('href') ?? el.tagName.toLowerCase());
    const kinds = kindCounts(snapshot.alerts).map((k) => k.href);
    const rows = buildQueue(snapshot).map((r) => r.href);
    expect(kinds.length).toBeGreaterThan(0);
    expect(rows.length).toBeGreaterThan(0);
    expect(order).toEqual([
      '#/inventory?warehouse=WH-DFW',
      '#/inventory?warehouse=WH-ATL',
      '#/inventory?warehouse=WH-ORD',
      '#/inventory?warehouse=WH-LAX',
      '#/inventory?warehouse=WH-EWR',
      '#/routes',
      '#/shipments',
      '#/shipments?flag=delayed',
      '#/alerts',
      '#/inventory?stock=low_or_out',
      '#/shipments?status=pending',
      '#/shipments?status=in_transit',
      '#/shipments?status=delivered',
      '#/shipments?status=cancelled',
      ...kinds,
      '#/alerts?kind=any', // the "Need attention" total opens only the alerts that need attention (it was '#/alerts')
      ...rows,
      'select',
      'button',
      'button',
      '#/inventory',
      '#/inventory?warehouse=WH-DFW',
      '#/inventory?warehouse=WH-ATL',
      '#/inventory?warehouse=WH-ORD',
      '#/inventory?warehouse=WH-LAX',
      '#/inventory?warehouse=WH-EWR'
    ]);
  });

  it('draws the status counts after the fourth figure, as a list named by its visible label', async () => {
    await renderWithData(<DashboardPage />, { snapshot: scenario() });
    const label = screen.getByText('Shipments by status');
    expect(label).toBeVisible();
    expect(label).toHaveClass('status-label');
    const list = screen.getByRole('list', { name: 'Shipments by status' });
    expect(list).toHaveAttribute('aria-labelledby', label.id);
    expect(within(list).getAllByRole('link')).toHaveLength(4);
    // DOM order: the four figure links, then the label, then the list (so keyboard order = the order it is drawn in).
    const figures = [...document.querySelectorAll('.signals > a.figure')];
    expect(figures).toHaveLength(4);
    const follows = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(figures[3] as Element, label)).toBe(true);
    expect(follows(label, list)).toBe(true);
    expect(within(list).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual([
      '#/shipments?status=pending',
      '#/shipments?status=in_transit',
      '#/shipments?status=delivered',
      '#/shipments?status=cancelled'
    ]);
  });

  it('draws the five racks in snapshot order, one link each', async () => {
    const snapshot = scenario();
    await renderWithData(<DashboardPage />, { snapshot });
    expect([...document.querySelectorAll('.rack__code')].map((n) => n.textContent)).toEqual(snapshot.metrics.warehouseUtilization.map((w) => w.code));
  });
});

describe('Dashboard V2: alerts and the ledger keep their meaning without colour or layout', () => {
  // "Top alerts": each row is now one link (it used to be a plain list item that could not be clicked); the glyph and
  // the hidden severity word stay, and the dots between the parts read as commas to a screen reader.
  it('gives every queue row one link, a glyph plus visually hidden severity text (no badge), and read-aloud separators', async () => {
    await renderWithData(<DashboardPage />, { snapshot: scenario() });
    const rows = [...document.querySelectorAll('.queue > li')] as HTMLElement[];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const links = row.querySelectorAll('a[href]');
      expect(links).toHaveLength(1);
      expect(links[0]).toHaveClass('queue-row');
      expect(row.querySelectorAll('.alert-glyph[aria-hidden="true"]')).toHaveLength(1);
      expect(row.querySelector('.visually-hidden')?.textContent).toMatch(/^(Critical|Warning): $/);
      for (const dot of row.querySelectorAll('.queue-row__sep')) expect(dot).toHaveAttribute('aria-hidden', 'true');
      expect(row.querySelector('.queue-row__action')?.textContent).toMatch(/^(Move|Reorder|Check|Ask)/);
    }
    expect(screen.getByText('How these are counted').closest('details')).not.toHaveAttribute('open');
  });

  it('exposes the ledger as a table with six column headers and six cells per row, and a marker plus the status word', async () => {
    await renderWithData(<DashboardPage />, { snapshot: scenario() });
    const table = screen.getByRole('table', { name: 'Recent shipment activity' });
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['ID', 'Route', 'Carrier', 'Status', 'Activity date', 'Cost']);
    const bodyRows = within(table)
      .getAllByRole('row')
      .filter((r) => within(r).queryAllByRole('columnheader').length === 0);
    expect(bodyRows.length).toBeGreaterThan(0);
    for (const row of bodyRows) {
      expect(within(row).getAllByRole('cell')).toHaveLength(6);
      const status = row.querySelector('.activity__status') as HTMLElement;
      expect(status.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
      expect(status.textContent).toMatch(/^(Pending|In transit|Delivered|Cancelled)$/);
    }
  });
});

describe('Dashboard V2: motion', () => {
  const stubMotion = (reduce: boolean) => {
    vi.stubGlobal('matchMedia', () => ({ matches: reduce, addEventListener: () => undefined, removeEventListener: () => undefined }));
    vi.stubGlobal('IntersectionObserver', class { observe = vi.fn(); disconnect = vi.fn(); });
  };

  it('under reduced motion nothing is armed, animated or travelling', async () => {
    stubMotion(true);
    await renderWithData(<DashboardPage />, { snapshot: scenario() });
    expect(document.querySelector('.atlas--animate')).toBeNull();
    expect(document.querySelector('animateMotion')).toBeNull();
    expect(document.querySelector('[data-reveal]')).toBeNull();
  });

  it('with motion allowed the atlas animates and only the four drawn chapters wait for their reveal', async () => {
    stubMotion(false);
    await renderWithData(<DashboardPage />, { snapshot: scenario() });
    expect(document.querySelector('.atlas--animate')).not.toBeNull();
    expect(document.querySelectorAll('animateMotion').length).toBeGreaterThan(0);
    expect(document.querySelectorAll('section[data-reveal="armed"]')).toHaveLength(4);
    expect(screen.getByRole('region', { name: 'Network situation' })).not.toHaveAttribute('data-reveal');
  });
});
