// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouteMap } from '../../../src/client/components/routes/RouteMap';
import type { RouteSummary } from '../../../src/shared/domain/analytics';
import { LOCATIONS } from '../../../src/shared/reference/locations';

function makeRoute(overrides: Partial<RouteSummary> = {}): RouteSummary {
  return {
    routeKey: 'WH-DFW>HOU',
    label: 'Dallas-Fort Worth DC → Houston, TX',
    originCode: 'WH-DFW',
    destinationCode: 'HOU',
    originName: 'Dallas-Fort Worth DC',
    destinationName: 'Houston, TX',
    count: 10,
    totalCostCents: 100000,
    avgCostCents: 10000,
    delayedCount: 1,
    delayedShare: 0.1,
    carriers: [{ carrier: 'Northstar Freight', count: 10 }],
    mapped: true,
    ...overrides
  };
}

describe('RouteMap', () => {
  it('draws one path per mapped, non-same-origin route and lists it in the accessible route list', () => {
    const routes = [makeRoute()];
    render(<RouteMap routes={routes} locations={LOCATIONS} selectedKey={null} onSelect={vi.fn()} />);

    const svg = screen.getByRole('img');
    expect(svg.querySelectorAll('path.route-map__path')).toHaveLength(1);
    expect(screen.getByText('Schematic route map')).toBeInTheDocument();
    expect(screen.getByText(/Schematic map of 1 route,/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Dallas-Fort Worth DC → Houston, TX/ })).toBeInTheDocument();
  });

  it('does not draw or list an unmapped route', () => {
    const routes = [makeRoute({ routeKey: 'X>Y', label: 'Somewhere → Nowhere', originCode: null, destinationCode: null, mapped: false })];
    render(<RouteMap routes={routes} locations={LOCATIONS} selectedKey={null} onSelect={vi.fn()} />);
    expect(screen.getByRole('img').querySelectorAll('path.route-map__path')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /Somewhere/ })).not.toBeInTheDocument();
  });

  it('does not draw a same-origin-destination route', () => {
    const routes = [makeRoute({ routeKey: 'WH-DFW>WH-DFW', originCode: 'WH-DFW', destinationCode: 'WH-DFW', mapped: true })];
    render(<RouteMap routes={routes} locations={LOCATIONS} selectedKey={null} onSelect={vi.fn()} />);
    expect(screen.getByRole('img').querySelectorAll('path.route-map__path')).toHaveLength(0);
  });

  it('marks the selected route button as pressed and calls onSelect when clicked', async () => {
    const onSelect = vi.fn();
    const routes = [makeRoute({ routeKey: 'A' }), makeRoute({ routeKey: 'B', label: 'Atlanta DC → Miami, FL', originCode: 'WH-ATL', destinationCode: 'MIA' })];
    const user = userEvent.setup();
    render(<RouteMap routes={routes} locations={LOCATIONS} selectedKey="A" onSelect={onSelect} />);

    const buttons = screen.getAllByRole('button');
    expect(buttons[0]).toHaveAttribute('aria-pressed', 'true');
    expect(buttons[1]).toHaveAttribute('aria-pressed', 'false');

    await user.click(buttons[1] as HTMLElement);
    expect(onSelect).toHaveBeenCalledWith('B');
  });

  it('renders warehouse markers as squares and city markers as circles, each with a title', () => {
    const routes = [makeRoute()];
    const { container } = render(<RouteMap routes={routes} locations={LOCATIONS} selectedKey={null} onSelect={vi.fn()} />);
    expect(container.querySelectorAll('rect.route-map__marker-shape').length).toBe(LOCATIONS.filter((l) => l.kind === 'warehouse').length);
    expect(container.querySelectorAll('circle.route-map__marker-shape').length).toBe(LOCATIONS.filter((l) => l.kind === 'city').length);
    expect(screen.getByText('Dallas-Fort Worth DC', { selector: 'title' })).toBeInTheDocument();
  });

  it('shows the legend explaining color and width', () => {
    render(<RouteMap routes={[]} locations={LOCATIONS} selectedKey={null} onSelect={vi.fn()} />);
    expect(screen.getByText(/Schematic projection; not to scale\./)).toBeInTheDocument();
  });

  it('draws lanes in the stage tones: gray, solid --warning amber from 10%, dashed red from 20%, no hard-coded amber', () => {
    const routes = [
      makeRoute({ routeKey: 'A', delayedShare: 0.05 }),
      makeRoute({ routeKey: 'B', label: 'Atlanta DC → Miami, FL', originCode: 'WH-ATL', destinationCode: 'MIA', delayedShare: 0.15 }),
      makeRoute({ routeKey: 'C', label: 'Newark DC → Boston, MA', originCode: 'WH-EWR', destinationCode: 'BOS', delayedShare: 0.25 })
    ];
    const { container } = render(<RouteMap routes={routes} locations={LOCATIONS} selectedKey={null} onSelect={vi.fn()} />);
    const paths = [...container.querySelectorAll('path.route-map__path')];
    expect(paths.map((p) => p.getAttribute('stroke'))).toEqual(['var(--route)', 'var(--warning)', 'var(--critical)']);
    expect(paths.map((p) => p.getAttribute('stroke-dasharray') !== null)).toEqual([false, false, true]);
    expect(container.innerHTML.toLowerCase()).not.toContain('#e89a2c');
  });

  it('marks lanes past the first ten for phones and offers Show all lanes, which reveals them', async () => {
    const routes = Array.from({ length: 12 }, (_, i) => makeRoute({ routeKey: `R${i}`, label: `Route ${i}` }));
    const user = userEvent.setup();
    const { container } = render(<RouteMap routes={routes} locations={LOCATIONS} selectedKey={null} onSelect={vi.fn()} />);
    expect(container.querySelectorAll('.route-map__list-item--extra')).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Show all 12 lanes in the list' }));
    expect(container.querySelectorAll('.route-map__list-item--extra')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /^Show all/ })).toBeNull();
  });

  it('offers no Show all lanes button for ten lanes or fewer', () => {
    render(<RouteMap routes={[makeRoute()]} locations={LOCATIONS} selectedKey={null} onSelect={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /^Show all/ })).toBeNull();
  });

  it('handles zero routes without dividing by zero', () => {
    render(<RouteMap routes={[]} locations={LOCATIONS} selectedKey={null} onSelect={vi.fn()} />);
    expect(screen.getByText(/Schematic map of 0 routes,/)).toBeInTheDocument();
  });
});
