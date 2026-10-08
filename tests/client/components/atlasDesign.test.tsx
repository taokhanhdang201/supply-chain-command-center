// @vitest-environment jsdom
// V2 Dashboard components: the design rules that live in the markup (a quiet atlas, five identical racks, charts with one
// baseline and direct labels) rather than in the data. Data behaviour is covered in atlasComponents.test.tsx.
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AtlasCaption, AtlasScene, laneWidthPx } from '../../../src/client/components/atlas/AtlasScene';
import { buildTransitDots } from '../../../src/client/components/atlas/atlasGeometry';
import { WarehouseRacks } from '../../../src/client/components/atlas/WarehouseRacks';
import { CostChart, ReliabilityChart } from '../../../src/client/components/atlas/FlowCharts';
import { MAX_BAR, costHeight, reliabilityHeight } from '../../../src/client/components/atlas/flowScale';
import { summarizeRoutes } from '../../../src/shared/domain/analytics';
import type { WarehouseUtilization } from '../../../src/shared/types';
import { makeShipmentRecord, makeSnapshot, TODAY } from '../../helpers/fixtures';

function scene(shipments = [makeShipmentRecord()], focus: 'first' | null = null) {
  const snapshot = makeSnapshot([], shipments, { today: TODAY });
  const routes = summarizeRoutes(snapshot.shipments, snapshot.locations);
  return (
    <AtlasScene
      routes={routes}
      locations={snapshot.locations}
      warehouseValueCents={new Map(snapshot.metrics.warehouseUtilization.map((w) => [w.code, w.valueCents]))}
      dots={buildTransitDots(snapshot.shipments, snapshot.locations, TODAY)}
      focusRouteKey={focus === 'first' ? (routes[0]?.routeKey ?? null) : null}
      animate={false}
    />
  );
}

describe('AtlasScene is a quiet drawing', () => {
  it('has no graticule, gradient, ring or city label; only the warehouse codes are written', () => {
    const { container } = render(scene([makeShipmentRecord({ status: 'in_transit', shipDate: '2026-06-01', estimatedDelivery: '2026-06-05', actualDelivery: null })]));
    expect(container.querySelector('.atlas__graticule, defs, linearGradient, radialGradient, .atlas__ring, .atlas__casing')).toBeNull();
    const codes = [...container.querySelectorAll('svg text')].map((n) => n.textContent);
    expect(codes.length).toBeLessThanOrEqual(5);
    for (const c of codes) expect(c).toMatch(/^WH-[A-Z]{3}$/);
    // Cities are dots with a tooltip, not labels.
    expect(container.querySelectorAll('.atlas__city')).toHaveLength(16);
    expect(container.querySelector('.atlas__city title')?.textContent).toMatch(/^[A-Z]{3} · /);
  });

  it('gives a lane a neutral, warning or critical class from its delayed share, and a dot one 3px circle', () => {
    // Two shipments on one lane, both late: 100% delayed, so critical. A third lane with none late stays neutral.
    const late = { actualDelivery: '2026-06-09' };
    const { container } = render(
      scene([
        makeShipmentRecord({ ...late }),
        makeShipmentRecord({ ...late }),
        makeShipmentRecord({ origin: 'WH-ATL', destination: 'MIA' }),
        makeShipmentRecord({ status: 'in_transit', shipDate: '2026-06-01', estimatedDelivery: '2026-06-05', actualDelivery: null })
      ])
    );
    expect(container.querySelector('.atlas__lane--critical')).not.toBeNull();
    expect(container.querySelector('.atlas__lane--neutral')).not.toBeNull();
    const dot = container.querySelector('.atlas__dot') as SVGGElement;
    expect(dot.querySelectorAll('circle')).toHaveLength(1);
    expect(dot.querySelector('circle')).toHaveAttribute('r', '3');
    expect(dot).toHaveClass('atlas__dot--overdue');
  });

  it('carries the most delayed lane sentence in its description (and its lane tooltip) instead of a callout', () => {
    const late = { actualDelivery: '2026-06-09' };
    const { container } = render(scene([makeShipmentRecord({ ...late }), makeShipmentRecord()], 'first'));
    const label = container.querySelector('svg')?.getAttribute('aria-label') ?? '';
    expect(label).toMatch(/Most delayed lane, Dallas-Fort Worth DC → Houston, TX: 1 of 2 shipments delayed \(50%\)\./);
    expect(container.querySelector('.atlas__lane title')?.textContent).toBe('Dallas-Fort Worth DC → Houston, TX: 1 of 2 shipments delayed (50%)');
  });
});

describe('AtlasScene lane width and dashes (V2 wave 2)', () => {
  // jsdom has no layout, so the box keeps its 1000 x 600 default: scale 1, one viewBox unit per screen px.
  const late = { actualDelivery: '2026-06-09' };
  const lanes = () =>
    render(
      scene([
        makeShipmentRecord({ ...late }),
        makeShipmentRecord({ ...late }),
        makeShipmentRecord({ origin: 'WH-ATL', destination: 'MIA' })
      ])
    ).container;

  it('draws width from 1px to 5px by shipment count, the busiest lane at 5px', () => {
    expect(laneWidthPx(0, 10)).toBe(1);
    expect(laneWidthPx(10, 10)).toBe(5);
    expect(laneWidthPx(1, 4)).toBe(3); // square root: a quarter of the traffic is half the extra width
    expect(laneWidthPx(2, 10)).toBeGreaterThan(laneWidthPx(1, 10));
    const c = lanes();
    const width = (sel: string) => Number(c.querySelector(sel)?.getAttribute('stroke-width'));
    expect(width('.atlas__lane--critical')).toBeCloseTo(5); // two shipments: the busiest lane
    expect(width('.atlas__lane--neutral')).toBeCloseTo(laneWidthPx(1, 2)); // one of two
  });

  it('dashes late lanes (not colour alone) with a dash 3x and a gap 2x their own width; other lanes stay solid', () => {
    const c = lanes();
    const critical = c.querySelector('.atlas__lane--critical') as SVGPathElement;
    const w = Number(critical.getAttribute('stroke-width'));
    const [dash, gap] = critical.style.strokeDasharray.split(/[\s,]+/).map((v) => parseFloat(v));
    expect(dash).toBeCloseTo(3 * w);
    expect(gap).toBeCloseTo(2 * w);
    expect(critical.hasAttribute('pathLength')).toBe(false); // the pattern is in real length units
    const neutral = c.querySelector('.atlas__lane--neutral') as SVGPathElement;
    expect(neutral.style.strokeDasharray).toBe('');
    expect(neutral.getAttribute('pathLength')).toBe('1');
  });
});

describe('AtlasCaption', () => {
  it('is the one line that replaces the key: width is traffic, dashed red is late', () => {
    render(<AtlasCaption />);
    expect(screen.getByText('Thicker lanes carry more shipments. Dashed red lanes are 20%+ delayed. Dots are shipments in transit, red when overdue.')).toHaveClass('atlas-caption');
  });
});

const wh = (code: string, over: Partial<WarehouseUtilization>): WarehouseUtilization => ({
  code,
  name: `Warehouse ${code}`,
  units: 500,
  capacityUnits: 1000,
  utilization: 0.5,
  valueCents: 250_000_000,
  recordCount: 3,
  ...over
});

describe('WarehouseRacks are five copies of one bay', () => {
  const five = [
    wh('WH-DFW', { units: 55_383, capacityUnits: 72_000, utilization: 0.769 }),
    wh('WH-ATL', { units: 47_625, capacityUnits: 75_000, utilization: 0.635 }),
    wh('WH-ORD', { units: 51_415, capacityUnits: 91_000, utilization: 0.565 }),
    wh('WH-LAX', { units: 46_805, capacityUnits: 55_000, utilization: 0.851 }),
    wh('WH-EWR', { units: 57_288, capacityUnits: 62_000, utilization: 0.924 })
  ];

  it('gives every bay identical markup and class, whatever its capacity: no per-bay width, height or flex style', () => {
    const { container } = render(<WarehouseRacks warehouses={five} />);
    const items = [...container.querySelectorAll('.racks__item')];
    expect(items).toHaveLength(5);
    for (const item of items) {
      expect(item.hasAttribute('style')).toBe(false);
      const rack = item.querySelector('.rack') as HTMLElement;
      expect(rack.className).toBe('rack');
      expect(rack.hasAttribute('style')).toBe(false);
      expect(rack.querySelector('.rack__frame')?.hasAttribute('style')).toBe(false);
      // The single thing that differs between bays is the fill level custom property.
      expect((rack.querySelector('.rack__fill') as HTMLElement).getAttribute('style')).toMatch(/^--fill: [\d.]+%;?$/);
    }
    const shape = (el: Element): string => [...el.querySelectorAll('*')].map((n) => n.tagName + '.' + n.className).join('|');
    expect(new Set(items.map(shape)).size).toBe(1);
  });

  it('writes code, percent and value under the bay in that order and nothing else', () => {
    const { container } = render(<WarehouseRacks warehouses={five.slice(0, 1)} />);
    const rack = container.querySelector('.rack') as HTMLElement;
    const parts = [...rack.children].map((n) => n.className);
    expect(parts).toEqual(['rack__frame', 'rack__code', 'rack__pct', 'rack__value']);
    expect([...rack.querySelectorAll('.rack__code, .rack__pct, .rack__value')].map((n) => n.textContent)).toEqual(['WH-DFW', '76.9%', '$2.5M']);
    // Name and units live in the accessible name and the tooltip, not in the drawing.
    expect(rack).toHaveAttribute('title', 'Warehouse WH-DFW: 55,383 of 72,000 units');
    expect(rack.textContent).not.toMatch(/Warehouse|units/);
  });

  it('sets the fill level to the utilization of each bay', () => {
    const { container } = render(<WarehouseRacks warehouses={five} />);
    const fills = [...container.querySelectorAll('.rack__fill')].map((n) => (n as HTMLElement).style.getPropertyValue('--fill'));
    expect(fills).toEqual(['76.9%', '63.5%', '56.5%', '85.1%', '92.4%']);
  });
});

describe('Flow charts are drawn with one baseline and direct labels', () => {
  const data = [
    { label: 'May 2026', axisLabel: 'May', onTime: 10, delayed: 4 },
    { label: 'Jun 2026', axisLabel: 'Jun', onTime: 8, delayed: 2 }
  ];

  it('draws no axis ticks, gridlines or legend swatches, and names the series at the last bar', () => {
    const { container } = render(<ReliabilityChart data={data} ariaLabel="Reliability" valueFormat={String} />);
    expect(container.querySelectorAll('line')).toHaveLength(1);
    expect(container.querySelector('.flow-chart__key')).toBeNull();
    expect([...container.querySelectorAll('.flow-chart__series-label')].map((n) => n.textContent)).toEqual(['On time', 'Delayed']);
    // The on-time count is printed inside its bar, the delayed count above the bar.
    expect([...container.querySelectorAll('.flow-chart__inside')].map((n) => n.textContent)).toEqual(['10', '8']);
    expect([...container.querySelectorAll('.flow-chart__delayed')].map((n) => n.textContent)).toEqual(['4', '2']);
  });

  it('draws each bar as one stack (ink + red) that reveals as a unit, with bars no wider than 48px', () => {
    const { container } = render(<ReliabilityChart data={data} ariaLabel="Reliability" valueFormat={String} />);
    const stacks = [...container.querySelectorAll('.flow-stack')];
    expect(stacks).toHaveLength(2);
    for (const stack of stacks) {
      expect(stack.querySelectorAll('.flow-bar--ontime')).toHaveLength(1);
      expect(stack.querySelectorAll('.flow-bar--delayed')).toHaveLength(1);
    }
    expect(MAX_BAR).toBe(48);
    for (const rect of container.querySelectorAll('.flow-bar')) expect(Number(rect.getAttribute('width'))).toBeLessThanOrEqual(MAX_BAR);
    // Text is never inside the animated stack.
    expect(container.querySelector('.flow-stack text')).toBeNull();
  });

  it('gives way to one inline label row on a narrow drawing (no room for direct labels)', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 350, height: 220, top: 0, left: 0, right: 350, bottom: 220, x: 0, y: 0, toJSON: () => ({}) });
    const { container } = render(<ReliabilityChart data={data} ariaLabel="Reliability" valueFormat={String} />);
    expect(container.querySelector('.flow-chart__series-label')).toBeNull();
    expect(container.querySelector('.flow-chart__key')?.textContent).toBe('On timeDelayed');
    expect(container.querySelector('svg')).toHaveAttribute('height', '220');
  });

  it('hangs the lowest month value below its dot so it cannot touch a neighbouring higher one', () => {
    const cents = [400, 350, 480, 450].map((d, i) => ({ label: `M${i}`, axisLabel: `M${i}`, cents: d * 100 }));
    const { container } = render(<CostChart data={cents} ariaLabel="Cost" valueFormat={(c) => `$${c / 100}`} />);
    const dots = [...container.querySelectorAll('.flow-cost__dot')].map((n) => Number(n.getAttribute('cy')));
    const labels = [...container.querySelectorAll('.flow-chart__value')].map((n) => Number(n.getAttribute('y')));
    expect(dots).toHaveLength(4);
    expect(labels.map((y, i) => y > (dots[i] as number))).toEqual([false, true, false, false]);
  });

  it('draws the cost as one ink line with no area', () => {
    const { container } = render(<CostChart data={[100, 200].map((d, i) => ({ label: `M${i}`, axisLabel: `M${i}`, cents: d * 100 }))} ariaLabel="Cost" valueFormat={String} />);
    expect(container.querySelectorAll('path')).toHaveLength(1);
    expect(container.querySelector('path')).toHaveClass('flow-cost__line');
  });

  it('sizes the charts to the measured width: 320/280/260/220 and 200/180/160', () => {
    expect([1088, 704, 688, 350].map(reliabilityHeight)).toEqual([320, 280, 260, 220]);
    expect([1088, 704, 350].map(costHeight)).toEqual([200, 180, 160]);
  });
});
