import { describe, it, expect } from 'vitest';
import { LOCATIONS } from '../../../src/shared/reference/locations';
import { projectToMap } from '../../../src/shared/geo';
import { ROUTE_DELAY_CRITICAL_SHARE, ROUTE_DELAY_WARNING_SHARE } from '../../../src/shared/constants';
import {
  buildTransitDots,
  laneControl,
  laneSegmentPath,
  laneTone,
  pointOnLane,
  transitProgress
} from '../../../src/client/components/atlas/atlasGeometry';
import { makeShipmentRecord, makeSnapshot, TODAY } from '../../helpers/fixtures';

const DFW = LOCATIONS.find((l) => l.code === 'WH-DFW')!;
const HOU = LOCATIONS.find((l) => l.code === 'HOU')!;
const P1 = projectToMap(DFW.lat, DFW.lon);
const P2 = projectToMap(HOU.lat, HOU.lon);

describe('laneTone', () => {
  it('uses the same route-delay thresholds as the Routes map', () => {
    expect(laneTone(0)).toBe('neutral');
    expect(laneTone(ROUTE_DELAY_WARNING_SHARE - 0.0001)).toBe('neutral');
    expect(laneTone(ROUTE_DELAY_WARNING_SHARE)).toBe('warning');
    expect(laneTone(ROUTE_DELAY_CRITICAL_SHARE - 0.0001)).toBe('warning');
    expect(laneTone(ROUTE_DELAY_CRITICAL_SHARE)).toBe('critical');
    expect(laneTone(1)).toBe('critical');
  });
});

describe('lane geometry', () => {
  it('starts at the origin and ends at the destination', () => {
    expect(pointOnLane(P1, P2, 0)).toEqual(P1);
    const end = pointOnLane(P1, P2, 1);
    expect(end.x).toBeCloseTo(P2.x, 9);
    expect(end.y).toBeCloseTo(P2.y, 9);
  });

  it('bows away from the straight line by 15% of its length', () => {
    const c = laneControl(P1, P2);
    const mid = { x: (P1.x + P2.x) / 2, y: (P1.y + P2.y) / 2 };
    const length = Math.hypot(P2.x - P1.x, P2.y - P1.y);
    expect(Math.hypot(c.x - mid.x, c.y - mid.y)).toBeCloseTo(0.15 * length, 6);
  });

  it('a sub-curve ends exactly where pointOnLane says the shipment is', () => {
    const t = 0.37;
    const at = pointOnLane(P1, P2, t);
    const path = laneSegmentPath(P1, P2, t);
    const numbers = path.match(/-?\d+(\.\d+)?/g)!.map(Number);
    // M x0,y0 Q cx,cy x1,y1 → the last two numbers are the end point (rounded to 2 decimals).
    expect(numbers[numbers.length - 2]).toBeCloseTo(at.x, 1);
    expect(numbers[numbers.length - 1]).toBeCloseTo(at.y, 1);
  });
});

describe('transitProgress', () => {
  it('is the elapsed share of the ship-to-estimated-delivery window', () => {
    expect(transitProgress({ shipDate: '2026-06-10', estimatedDelivery: '2026-06-20' }, '2026-06-15')).toBe(0.5);
    expect(transitProgress({ shipDate: '2026-06-10', estimatedDelivery: '2026-06-20' }, '2026-06-10')).toBe(0);
  });

  it('clamps: not yet shipped is 0, past the estimate is 1', () => {
    expect(transitProgress({ shipDate: '2026-06-20', estimatedDelivery: '2026-06-30' }, '2026-06-15')).toBe(0);
    expect(transitProgress({ shipDate: '2026-06-01', estimatedDelivery: '2026-06-05' }, '2026-06-15')).toBe(1);
  });

  it('is null when there is nothing honest to place', () => {
    expect(transitProgress({ shipDate: '2026-06-10', estimatedDelivery: null }, '2026-06-15')).toBeNull();
    expect(transitProgress({ shipDate: '2026-06-10', estimatedDelivery: '2026-06-10' }, '2026-06-15')).toBeNull();
    expect(transitProgress({ shipDate: '2026-06-10', estimatedDelivery: '2026-06-08' }, '2026-06-15')).toBeNull();
  });
});

describe('buildTransitDots', () => {
  const snapshot = makeSnapshot(
    [],
    [
      makeShipmentRecord({ shipmentId: 'SHP-000001', status: 'in_transit', shipDate: '2026-06-10', estimatedDelivery: '2026-06-20', actualDelivery: null }),
      makeShipmentRecord({ shipmentId: 'SHP-000002', status: 'in_transit', shipDate: '2026-06-05', estimatedDelivery: '2026-06-10', actualDelivery: null }),
      makeShipmentRecord({ shipmentId: 'SHP-000003', status: 'in_transit', shipDate: '2026-06-10', estimatedDelivery: null, actualDelivery: null }),
      makeShipmentRecord({ shipmentId: 'SHP-000004', status: 'in_transit', destination: 'Anchorage, AK', shipDate: '2026-06-10', estimatedDelivery: '2026-06-20', actualDelivery: null }),
      makeShipmentRecord({ shipmentId: 'SHP-000005', status: 'delivered' }),
      makeShipmentRecord({ shipmentId: 'SHP-000006', status: 'pending', shipDate: '2026-06-20', estimatedDelivery: '2026-06-25', actualDelivery: null })
    ]
  );

  it('places only in-transit shipments with a mapped route and a computable journey', () => {
    const dots = buildTransitDots(snapshot.shipments, snapshot.locations, TODAY);
    expect(dots.map((d) => d.shipmentId)).toEqual(['SHP-000001', 'SHP-000002']);
  });

  it('puts each dot at its scheduled progress and marks the ones past their estimate', () => {
    const [onSchedule, past] = buildTransitDots(snapshot.shipments, snapshot.locations, TODAY);
    const expected = pointOnLane(P1, P2, 0.5);
    expect(onSchedule!.progress).toBe(0.5);
    expect(onSchedule!.x).toBeCloseTo(expected.x, 9);
    expect(onSchedule!.y).toBeCloseTo(expected.y, 9);
    expect(onSchedule!.overdue).toBe(false);
    expect(past!.progress).toBe(1);
    expect(past!.overdue).toBe(true);
  });
});
