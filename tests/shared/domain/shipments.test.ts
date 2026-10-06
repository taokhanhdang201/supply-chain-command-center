import { describe, it, expect } from 'vitest';
import {
  normalizeLocationText,
  resolveLocation,
  findShipmentIssues,
  getDeliveryState,
  enrichShipments
} from '../../../src/shared/domain/shipments';
import { LOCATIONS } from '../../../src/shared/reference/locations';
import { makeShipmentRecord, TODAY } from '../../helpers/fixtures';

describe('normalizeLocationText', () => {
  it('trims, collapses whitespace and uppercases', () => {
    expect(normalizeLocationText('  houston,   tx  ')).toBe('HOUSTON, TX');
  });
});

describe('resolveLocation', () => {
  it('resolves by code', () => {
    expect(resolveLocation('wh-dfw', LOCATIONS)?.code).toBe('WH-DFW');
  });

  it('resolves by name, case-insensitively', () => {
    expect(resolveLocation('houston, tx', LOCATIONS)?.code).toBe('HOU');
  });

  it('resolves with extra whitespace', () => {
    expect(resolveLocation('  HOU  ', LOCATIONS)?.code).toBe('HOU');
  });

  it('returns null for an unmapped location', () => {
    expect(resolveLocation('Anchorage, AK', LOCATIONS)).toBeNull();
  });
});

describe('findShipmentIssues', () => {
  it('detects ACTUAL_BEFORE_SHIP', () => {
    const r = makeShipmentRecord({ shipDate: '2026-03-10', actualDelivery: '2026-03-05' });
    const issues = findShipmentIssues(r, TODAY, 'WH-DFW', 'HOU');
    expect(issues.map((i) => i.code)).toContain('ACTUAL_BEFORE_SHIP');
  });

  it('detects ETA_BEFORE_SHIP', () => {
    const r = makeShipmentRecord({ shipDate: '2026-03-10', estimatedDelivery: '2026-03-05', actualDelivery: null });
    const issues = findShipmentIssues(r, TODAY, 'WH-DFW', 'HOU');
    expect(issues.map((i) => i.code)).toContain('ETA_BEFORE_SHIP');
  });

  it('detects OPEN_WITH_ACTUAL', () => {
    const r = makeShipmentRecord({ status: 'in_transit', actualDelivery: '2026-06-01' });
    const issues = findShipmentIssues(r, TODAY, 'WH-DFW', 'HOU');
    expect(issues.map((i) => i.code)).toContain('OPEN_WITH_ACTUAL');
  });

  it('detects SAME_ORIGIN_DESTINATION', () => {
    const r = makeShipmentRecord();
    const issues = findShipmentIssues(r, TODAY, 'WH-DFW', 'WH-DFW');
    expect(issues.map((i) => i.code)).toContain('SAME_ORIGIN_DESTINATION');
  });

  it('detects ZERO_COST for a non-cancelled shipment', () => {
    const r = makeShipmentRecord({ shippingCostCents: 0 });
    const issues = findShipmentIssues(r, TODAY, 'WH-DFW', 'HOU');
    expect(issues.map((i) => i.code)).toContain('ZERO_COST');
  });

  it('does not flag ZERO_COST for a cancelled shipment', () => {
    const r = makeShipmentRecord({ status: 'cancelled', shippingCostCents: 0, actualDelivery: null });
    const issues = findShipmentIssues(r, TODAY, 'WH-DFW', 'HOU');
    expect(issues.map((i) => i.code)).not.toContain('ZERO_COST');
  });

  it('detects SHIP_DATE_IN_FUTURE for an in-transit shipment', () => {
    const r = makeShipmentRecord({ status: 'in_transit', shipDate: '2026-06-20', actualDelivery: null, estimatedDelivery: '2026-06-25' });
    const issues = findShipmentIssues(r, TODAY, 'WH-DFW', 'HOU');
    expect(issues.map((i) => i.code)).toContain('SHIP_DATE_IN_FUTURE');
  });

  it('detects ACTUAL_IN_FUTURE', () => {
    const r = makeShipmentRecord({ actualDelivery: '2026-06-20' });
    const issues = findShipmentIssues(r, TODAY, 'WH-DFW', 'HOU');
    expect(issues.map((i) => i.code)).toContain('ACTUAL_IN_FUTURE');
  });

  it('finds no issues for a clean record', () => {
    const r = makeShipmentRecord();
    expect(findShipmentIssues(r, TODAY, 'WH-DFW', 'HOU')).toEqual([]);
  });
});

describe('getDeliveryState', () => {
  it('is cancelled for a cancelled shipment', () => {
    const r = makeShipmentRecord({ status: 'cancelled', actualDelivery: null });
    expect(getDeliveryState(r, TODAY, []).state).toBe('cancelled');
  });

  it('is on_time when delivered the same day as ETA', () => {
    const r = makeShipmentRecord({ status: 'delivered', estimatedDelivery: '2026-06-05', actualDelivery: '2026-06-05' });
    expect(getDeliveryState(r, TODAY, []).state).toBe('on_time');
  });

  it('is late when delivered after ETA, with correct daysLate', () => {
    const r = makeShipmentRecord({ status: 'delivered', estimatedDelivery: '2026-06-05', actualDelivery: '2026-06-08' });
    expect(getDeliveryState(r, TODAY, [])).toEqual({ state: 'late', daysLate: 3 });
  });

  it('is unknown when delivered but missing actual or ETA', () => {
    const r = makeShipmentRecord({ status: 'delivered', actualDelivery: null });
    expect(getDeliveryState(r, TODAY, []).state).toBe('unknown');
  });

  it('is in_progress when ETA is today for an open shipment', () => {
    const r = makeShipmentRecord({ status: 'in_transit', estimatedDelivery: TODAY, actualDelivery: null });
    expect(getDeliveryState(r, TODAY, []).state).toBe('in_progress');
  });

  it('is overdue by 1 day when ETA was yesterday', () => {
    const r = makeShipmentRecord({ status: 'in_transit', estimatedDelivery: '2026-06-14', actualDelivery: null });
    expect(getDeliveryState(r, TODAY, [])).toEqual({ state: 'overdue', daysLate: 1 });
  });

  it('is unknown for an open shipment missing ETA', () => {
    const r = makeShipmentRecord({ status: 'in_transit', estimatedDelivery: null, actualDelivery: null });
    expect(getDeliveryState(r, TODAY, []).state).toBe('unknown');
  });

  it('is unknown when ACTUAL_BEFORE_SHIP issue is present, regardless of status', () => {
    const r = makeShipmentRecord({ status: 'delivered', estimatedDelivery: '2026-06-05', actualDelivery: '2026-06-01', shipDate: '2026-06-02' });
    const state = getDeliveryState(r, TODAY, [{ code: 'ACTUAL_BEFORE_SHIP', message: 'x' }]);
    expect(state.state).toBe('unknown');
  });
});

describe('enrichShipments', () => {
  it('resolves route keys and null distance for unmapped endpoints', () => {
    const r = makeShipmentRecord({ origin: 'WH-DFW', destination: 'Anchorage, AK' });
    const [s] = enrichShipments([r], TODAY, LOCATIONS);
    expect(s?.originCode).toBe('WH-DFW');
    expect(s?.destinationCode).toBeNull();
    expect(s?.distanceMiles).toBeNull();
    expect(s?.routeKey).toBe('WH-DFW>ANCHORAGE, AK');
  });

  it('sets transitDays for a delivered shipment', () => {
    const r = makeShipmentRecord({ status: 'delivered', shipDate: '2026-06-01', actualDelivery: '2026-06-04' });
    const [s] = enrichShipments([r], TODAY, LOCATIONS);
    expect(s?.transitDays).toBe(3);
  });

  it('sets missingDates for an open shipment with no ETA', () => {
    const r = makeShipmentRecord({ status: 'in_transit', estimatedDelivery: null, actualDelivery: null });
    const [s] = enrichShipments([r], TODAY, LOCATIONS);
    expect(s?.missingDates).toEqual(['estimated_delivery']);
  });

  it('sets missingDates for a delivered shipment with no actual', () => {
    const r = makeShipmentRecord({ status: 'delivered', actualDelivery: null });
    const [s] = enrichShipments([r], TODAY, LOCATIONS);
    expect(s?.missingDates).toEqual(['actual_delivery']);
  });
});
