// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RoutesPage } from '../../../src/client/pages/RoutesPage';
import { renderWithData } from '../../helpers/renderWithData';
import { makeShipmentRecord, makeSnapshot, TODAY } from '../../helpers/fixtures';
import type { ShipmentRecord } from '../../../src/shared/types';

beforeEach(() => {
  window.location.hash = '';
});

const many = (n: number, base: Partial<ShipmentRecord>, late = 0, costs: number[] = []) =>
  Array.from({ length: n }, (_, i) =>
    makeShipmentRecord({
      ...base,
      actualDelivery: i < late ? '2026-06-09' : '2026-06-05', // ETA 2026-06-05: the first `late` arrive late
      shippingCostCents: costs[i] ?? 80000 + 500 * (i % 5)
    })
  );

// Four lanes: Atlanta → Miami 25% late (critical), Dallas → Phoenix 10% late (watch), Dallas → Houston on time with
// one shipment at five times its peers (unusual cost), Newark → Boston on time.
function lanes() {
  return makeSnapshot(
    [],
    [
      ...many(4, { origin: 'WH-ATL', destination: 'MIA' }, 1),
      ...many(10, { origin: 'WH-DFW', destination: 'PHX' }, 1),
      ...many(10, { origin: 'WH-DFW', destination: 'HOU' }, 0, [80000, 80500, 81000, 79500, 79000, 80200, 80800, 79800, 80300, 400000]),
      ...many(3, { origin: 'WH-EWR', destination: 'BOS' })
    ],
    { today: TODAY }
  );
}

const listed = () => document.querySelectorAll('.route-map__list-button').length;

describe('RoutesPage: lane figures and URL filters', () => {
  // Unusual cost is decided by the shared cost model (route peers, else cost per mile), so the expected lanes are read
  // from the snapshot rather than guessed; the costly Dallas → Houston shipment is always among them.
  const costLanes = () => new Set(lanes().shipments.filter((s) => s.cost.isAnomaly).map((s) => s.routeKey));

  it('keeps the fixture honest: the costly Dallas → Houston shipment is flagged', () => {
    expect([...costLanes()]).toContain('WH-DFW>HOU');
  });

  it('shows Total lanes and one figure per lane filter, each linking to it, with no combined total', async () => {
    await renderWithData(<RoutesPage />, { snapshot: lanes() });
    expect(within(screen.getByRole('region', { name: 'The network' })).getByRole('link')).toHaveTextContent('4 Total lanes');
    const group = screen.getByRole('region', { name: 'Needs attention' });
    expect(within(group).getAllByRole('link').map((a) => [a.textContent?.replace(/\s+/g, ' ').trim(), a.getAttribute('href')])).toEqual([
      ['1 Delayed ≥20%', '#/routes?lane=critical'],
      ['1 Delayed 10–20%', '#/routes?lane=watch'],
      [`${costLanes().size} Unusual cost`, '#/routes?lane=cost']
    ]);
    expect(within(group).queryByText(/total/i)).toBeNull();
  });

  it('colours Delayed ≥20% red and the other two amber', async () => {
    await renderWithData(<RoutesPage />, { snapshot: lanes() });
    expect(screen.getByRole('link', { name: /^1 Delayed ≥20%/ })).toHaveClass('stage-figure--critical');
    expect(screen.getByRole('link', { name: /^1 Delayed 10–20%/ })).toHaveClass('stage-figure--warning');
    expect(screen.getByRole('link', { name: /Unusual cost/ })).toHaveClass('stage-figure--warning');
  });

  it('without parameters behaves as before: every filter All, top 25, every lane listed', async () => {
    await renderWithData(<RoutesPage />, { snapshot: lanes() });
    for (const name of ['Carrier', 'Status', 'Range', 'Lane']) expect(screen.getByRole('combobox', { name })).toHaveValue('all');
    expect(screen.getByRole('combobox', { name: 'Show top' })).toHaveValue('25');
    expect(listed()).toBe(4);
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();
  });

  it.each([
    ['critical', /Miami/, 1],
    ['watch', /Phoenix/, 1],
    ['cost', /Houston/, costLanes().size]
  ])('a lane=%s link shows exactly the lanes its figure counts, every match shown', async (lane, name, count) => {
    window.location.hash = `#/routes?lane=${lane}`;
    await renderWithData(<RoutesPage />, { snapshot: lanes() });
    expect(screen.getByRole('combobox', { name: 'Show top' })).toHaveValue('all');
    expect(screen.getByText(count === 1 ? '1 lane' : `${count} lanes`)).toBeInTheDocument();
    expect(listed()).toBe(count);
    expect(screen.getByRole('button', { name })).toBeInTheDocument();
  });

  it('writes a changed filter to the hash, and shows Clear filters while one is active', async () => {
    const user = userEvent.setup();
    await renderWithData(<RoutesPage />, { snapshot: lanes() });
    await user.selectOptions(screen.getByRole('combobox', { name: 'Lane' }), 'critical');
    expect(window.location.hash).toBe('#/routes?lane=critical');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'open');
    expect(window.location.hash).toBe('#/routes?status=open&lane=critical');
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument();
  });

  it('ignores unknown parameter values', async () => {
    window.location.hash = '#/routes?lane=bogus&top=7&carrier=Nobody';
    await renderWithData(<RoutesPage />, { snapshot: lanes() });
    expect(screen.getByRole('combobox', { name: 'Lane' })).toHaveValue('all');
    expect(screen.getByRole('combobox', { name: 'Show top' })).toHaveValue('25');
    expect(screen.getByRole('combobox', { name: 'Carrier' })).toHaveValue('all');
  });

  it('drops the editorial slogan: the stage carries figures, and the h1 stays the page title', async () => {
    await renderWithData(<RoutesPage />, { snapshot: lanes() });
    expect(screen.getByRole('heading', { level: 1, name: 'Routes' })).toBeInTheDocument();
    expect(document.querySelector('.page-stage__display')).toBeNull();
  });

  // On paper a section's title is a SectionHeader (h2 24/500 over the ink rule), Unmapped routes included; the band is the
  // compact band of the other pages, so the h1 sits where theirs does.
  it('titles the Unmapped routes ledger with a section header, on the compact band', async () => {
    const snapshot = makeSnapshot([], [makeShipmentRecord({ origin: 'WH-DFW', destination: 'HOU' }), makeShipmentRecord({ origin: 'WH-DFW', destination: 'Plant 7' })], { today: TODAY });
    await renderWithData(<RoutesPage />, { snapshot });
    const h2 = screen.getByRole('heading', { level: 2, name: 'Unmapped routes' });
    expect(h2).toHaveClass('section-label');
    expect(h2.parentElement).toHaveClass('section-bar');
    expect(screen.getByRole('region', { name: 'Unmapped routes' })).toContainElement(screen.getByRole('table', { name: 'Unmapped routes' }));
    expect(document.querySelector('.page-stage')).toHaveClass('page-stage--compact');
  });
});
