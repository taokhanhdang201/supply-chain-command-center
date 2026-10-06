// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AtlasCaption, AtlasScene } from '../../../src/client/components/atlas/AtlasScene';
import { buildTransitDots } from '../../../src/client/components/atlas/atlasGeometry';
import { WarehouseRacks } from '../../../src/client/components/atlas/WarehouseRacks';
import { CostChart, FlowFigure, ReliabilityChart } from '../../../src/client/components/atlas/FlowCharts';
import { niceMax } from '../../../src/client/components/atlas/flowScale';
import { summarizeRoutes } from '../../../src/shared/domain/analytics';
import type { WarehouseUtilization } from '../../../src/shared/types';
import { makeInventoryRecord, makeShipmentRecord, makeSnapshot, TODAY } from '../../helpers/fixtures';

afterEach(() => {
  vi.unstubAllGlobals();
});

function sceneProps(animate: boolean) {
  const snapshot = makeSnapshot(
    [makeInventoryRecord({ warehouse: 'WH-DFW', quantity: 100, unitCostCents: 1000 })],
    [
      makeShipmentRecord({ status: 'in_transit', shipDate: '2026-06-10', estimatedDelivery: '2026-06-20', actualDelivery: null }),
      makeShipmentRecord({ status: 'delivered' }),
      makeShipmentRecord({ origin: 'WH-LAX', destination: 'Anchorage, AK', status: 'delivered' })
    ]
  );
  return {
    routes: summarizeRoutes(snapshot.shipments, snapshot.locations),
    locations: snapshot.locations,
    warehouseValueCents: new Map(snapshot.metrics.warehouseUtilization.map((w) => [w.code, w.valueCents])),
    dots: buildTransitDots(snapshot.shipments, snapshot.locations, TODAY),
    focusRouteKey: null,
    animate,
    snapshot
  };
}

describe('AtlasScene', () => {
  it('draws only mapped lanes, and every warehouse is a link to its filtered Inventory', () => {
    const { snapshot, ...props } = sceneProps(true);
    const { container } = render(<AtlasScene {...props} />);
    expect(container.querySelectorAll('.atlas__lane')).toHaveLength(1); // the Anchorage route is unmapped and not drawn
    for (const w of snapshot.locations.filter((l) => l.kind === 'warehouse')) {
      const link = screen.getByRole('link', { name: new RegExp(`^${w.name}, .* in inventory`) });
      expect(link).toHaveAttribute('href', `#/inventory?warehouse=${w.code}`);
    }
  });

  it('animates dots along their lane only when motion is allowed', () => {
    const animated = render(<AtlasScene {...sceneProps(true)} />);
    expect(animated.container.querySelectorAll('animateMotion')).toHaveLength(1);
    expect(animated.container.querySelector('.atlas--animate')).not.toBeNull();
    animated.unmount();

    const still = render(<AtlasScene {...sceneProps(false)} />);
    expect(still.container.querySelectorAll('animateMotion')).toHaveLength(0);
    expect(still.container.querySelector('.atlas--animate')).toBeNull();
    // Reduced motion: the dot is drawn in its final place, not left at the origin of the svg.
    expect(still.container.querySelector('.atlas__dot')?.getAttribute('transform')).toMatch(/^translate\(/);
  });

  it('describes the drawing in words, including how many shipments are placed', () => {
    const { snapshot: _snapshot, ...props } = sceneProps(false);
    render(<AtlasScene {...props} />);
    expect(
      screen.getByRole('group', {
        name: /5 warehouses, 16 cities, 1 lanes with shipments\. 1 shipments in transit are placed along their lanes; \d+ are past their estimated delivery\. \d+ lanes are 20% or more delayed\./
      })
    ).toBeInTheDocument();
  });
});

const rack = (over: Partial<WarehouseUtilization>): WarehouseUtilization => ({
  code: 'WH-DFW',
  name: 'Dallas-Fort Worth DC',
  units: 500,
  capacityUnits: 1000,
  utilization: 0.5,
  valueCents: 250_000_000,
  recordCount: 3,
  ...over
});

describe('WarehouseRacks', () => {
  it('shows the existing utilization and value, and links to that warehouse', () => {
    render(<WarehouseRacks warehouses={[rack({})]} />);
    const link = screen.getByRole('link', { name: 'Dallas-Fort Worth DC: 50.0% of capacity used, $2.50M inventory value. View its inventory' });
    expect(link).toHaveAttribute('href', '#/inventory?warehouse=WH-DFW');
    expect(link.querySelector('.rack__fill')).toHaveStyle({ '--fill': '50%' });
  });

  it('caps the drawn fill at the rack but keeps the true figure, and flags over capacity', () => {
    const { container } = render(<WarehouseRacks warehouses={[rack({ units: 1200, utilization: 1.2 })]} />);
    expect(container.querySelector('.rack')).toHaveClass('rack--over');
    expect(container.querySelector('.rack__fill')).toHaveStyle({ '--fill': '100%' });
    expect(container.querySelector('.rack__pct')).toHaveTextContent('120.0%');
  });

  it('is empty, not broken, when capacity is unknown', () => {
    const { container } = render(<WarehouseRacks warehouses={[rack({ capacityUnits: 0, utilization: null })]} />);
    expect(container.querySelector('.rack__fill')).toHaveStyle({ '--fill': '0%' });
    expect(container.querySelector('.rack__pct')).toHaveTextContent('—');
  });
});

describe('niceMax', () => {
  it('rounds up to 1, 2 or 5 times a power of ten', () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(0.7)).toBe(1);
    expect(niceMax(3)).toBe(5);
    expect(niceMax(80)).toBe(100);
    expect(niceMax(100)).toBe(100);
    expect(niceMax(101)).toBe(200);
    expect(niceMax(4_800)).toBe(5_000);
  });
});

describe('FlowFigure and charts', () => {
  const table = { columns: ['Month', 'On time'], rows: [['Jun 2026', 3]] };

  it('shows the shared empty message when there is no data, with no toggle', () => {
    render(
      <FlowFigure title="Empty" isEmpty table={table}>
        <div>chart</div>
      </FlowFigure>
    );
    expect(screen.getByText('No data for the selected range')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show data table' })).toBeNull();
  });

  it('swaps the chart for its data table and back', async () => {
    const user = userEvent.setup();
    render(
      <FlowFigure title="Reliability" isEmpty={false} table={table}>
        <div>chart</div>
      </FlowFigure>
    );
    expect(screen.getByText('chart')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show data table' }));
    expect(screen.getByRole('table', { name: 'Reliability data' })).toBeInTheDocument();
    expect(screen.queryByText('chart')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Hide data table' }));
    expect(screen.getByText('chart')).toBeInTheDocument();
  });

  it('ReliabilityChart writes the delayed count above a bar only when there are delayed shipments', () => {
    const { container } = render(
      <ReliabilityChart
        data={[
          { label: 'May 2026', axisLabel: 'May', onTime: 10, delayed: 4 },
          { label: 'Jun 2026', axisLabel: 'Jun', onTime: 8, delayed: 0 }
        ]}
        ariaLabel="On-time vs delayed"
        valueFormat={String}
      />
    );
    expect(screen.getByRole('img', { name: 'On-time vs delayed' })).toBeInTheDocument();
    const delayedLabels = [...container.querySelectorAll('.flow-chart__delayed')].map((n) => n.textContent);
    expect(delayedLabels).toEqual(['4']);
    expect(container.querySelector('title')?.textContent).toBe('May 2026: 10 on time, 4 delayed');
  });

  it('CostChart labels the first, last, highest and lowest months and names every point in its tooltip', () => {
    const data = [100, 300, 200, 250, 150].map((c, i) => ({ label: `M${i}`, axisLabel: `M${i}`, cents: c * 100 }));
    const { container } = render(<CostChart data={data} ariaLabel="Cost" valueFormat={(c) => `$${c / 100}`} />);
    const labelled = [...container.querySelectorAll('.flow-chart__value')].map((n) => n.textContent);
    // First ($100, also the lowest), highest ($300) and last ($150); the middle months carry a dot and a tooltip only.
    expect(labelled).toEqual(['$100', '$300', '$150']);
    // Dots only where a value is written (first, highest, last); every month keeps its tooltip via the transparent hit target.
    expect(container.querySelectorAll('.flow-cost__dot')).toHaveLength(3);
    expect(container.querySelectorAll('.flow-cost__hit')).toHaveLength(5);
    expect([...container.querySelectorAll('title')].map((n) => n.textContent)).toEqual(['M0: $100', 'M1: $300', 'M2: $200', 'M3: $250', 'M4: $150']);
  });
});
