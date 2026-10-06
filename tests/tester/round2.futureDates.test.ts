// Round-2 independent verification of R-4 (shippingCostByMonth must never include a shipment/month beyond
// today) and R-5 (recentActivity must never include an event dated after today), fuzzed across many random
// shipment sets AND many different "today" values -- the coder's own regression test
// (tests/shared/domain/analytics.test.ts) only exercises the fixed TODAY fixture ('2026-06-15'). This file
// varies "today" itself, including month/year boundaries, to make sure the fix isn't accidentally specific to
// one calendar date.

import { describe, it, expect } from 'vitest';
import { shippingCostByMonth, recentActivity } from '../../src/shared/domain/analytics';
import { enrichShipments } from '../../src/shared/domain/shipments';
import { LOCATIONS } from '../../src/shared/reference/locations';
import { makeShipmentRecord } from '../helpers/fixtures';
import { monthKey, addDays } from '../../src/shared/dates';
import type { ShipmentStatus } from '../../src/shared/types';

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TODAYS = [
  '2026-01-01', // start of year
  '2026-01-31', // end of January
  '2026-02-01', // right after a month boundary
  '2026-02-28', // end of Feb (non-leap in this calendar context, but exercised anyway)
  '2026-06-15',
  '2026-09-28', // "today" used elsewhere in this project's sample data
  '2026-12-31', // end of year
  '2027-01-01' // year rollover
];

const STATUSES: ShipmentStatus[] = ['pending', 'in_transit', 'delivered', 'cancelled'];

function randomShipmentSet(rand: () => number, today: string, n: number) {
  const records = [];
  for (let i = 0; i < n; i += 1) {
    const offsetDays = Math.floor(rand() * 240) - 120; // -120..+119 days relative to today
    const shipDate = addDays(today, offsetDays);
    const status = STATUSES[Math.floor(rand() * STATUSES.length)] as ShipmentStatus;
    const deliveryOffset = Math.floor(rand() * 10) + 1;
    const actualDelivery = status === 'delivered' ? addDays(shipDate, deliveryOffset) : null;
    records.push(
      makeShipmentRecord({
        shipmentId: `SHP-${100000 + i}`,
        status,
        shipDate,
        estimatedDelivery: addDays(shipDate, deliveryOffset),
        actualDelivery,
        shippingCostCents: 1000 + Math.floor(rand() * 500000)
      })
    );
  }
  return records;
}

describe('R-4 regression (round 2, independent fuzz across many "today" values): shippingCostByMonth', () => {
  for (const today of TODAYS) {
    it(`never emits a month beyond ${today}'s month, and excludes future-dated shipments' cost, for random data`, () => {
      const rand = mulberry32(Number(today.split('-').join(''))); // deterministic per-today seed
      const records = randomShipmentSet(rand, today, 150);
      const shipments = enrichShipments(records, today, LOCATIONS);
      const series = shippingCostByMonth(shipments, today);

      const todayMonth = monthKey(today);
      for (const point of series) {
        expect(point.month <= todayMonth).toBe(true);
      }

      // Every dollar counted in the series must come from a shipment whose ship date is <= today.
      const futureCostCents = shipments
        .filter((s) => s.status !== 'cancelled' && s.shipDate > today)
        .reduce((sum, s) => sum + s.shippingCostCents, 0);
      const seriesTotalCents = series.reduce((sum, p) => sum + p.totalCents, 0);
      const eligibleTotalCents = shipments
        .filter((s) => s.status !== 'cancelled' && s.shipDate <= today)
        .reduce((sum, s) => sum + s.shippingCostCents, 0);
      expect(seriesTotalCents).toBe(eligibleTotalCents);
      expect(futureCostCents).toBeGreaterThan(0); // sanity: the random fixture really does contain future cost to exclude
    });
  }

  it('an all-future shipment set (every shipDate after today) produces an empty series, not a single bogus future month', () => {
    const today = '2026-09-28';
    const records = [
      makeShipmentRecord({ shipmentId: 'SHP-900001', status: 'pending', shipDate: '2026-10-01', estimatedDelivery: '2026-10-05', actualDelivery: null }),
      makeShipmentRecord({ shipmentId: 'SHP-900002', status: 'pending', shipDate: '2026-11-15', estimatedDelivery: '2026-11-20', actualDelivery: null })
    ];
    const shipments = enrichShipments(records, today, LOCATIONS);
    expect(shippingCostByMonth(shipments, today)).toEqual([]);
  });
});

describe('R-5 regression (round 2, independent fuzz across many "today" values): recentActivity', () => {
  for (const today of TODAYS) {
    it(`never includes an event dated after ${today}, for random data`, () => {
      const rand = mulberry32(Number(today.split('-').join('')) + 1);
      const records = randomShipmentSet(rand, today, 150);
      const shipments = enrichShipments(records, today, LOCATIONS);
      const activity = recentActivity(shipments, today, 50);

      for (const s of activity) {
        const activityDate = s.status === 'delivered' ? s.actualDelivery : s.shipDate;
        expect(activityDate).not.toBeNull();
        expect((activityDate as string) <= today).toBe(true);
      }

      // Sanity: the random fixture really does contain future-dated pending shipments that must have been
      // excluded, so this test isn't vacuously true.
      const futurePending = shipments.some((s) => s.status === 'pending' && s.shipDate > today);
      expect(futurePending).toBe(true);
      const activityIds = new Set(activity.map((s) => s.shipmentId));
      for (const s of shipments) {
        if (s.status === 'pending' && s.shipDate > today) {
          expect(activityIds.has(s.shipmentId)).toBe(false);
        }
      }
    });
  }

  it('a pending shipment scheduled for exactly today is included (boundary, not excluded as "future")', () => {
    const today = '2026-09-28';
    const records = [makeShipmentRecord({ shipmentId: 'SHP-900010', status: 'pending', shipDate: today, estimatedDelivery: '2026-10-02', actualDelivery: null })];
    const shipments = enrichShipments(records, today, LOCATIONS);
    const activity = recentActivity(shipments, today, 10);
    expect(activity.map((s) => s.shipmentId)).toContain('SHP-900010');
  });

  it('a pending shipment scheduled for tomorrow is excluded', () => {
    const today = '2026-09-28';
    const records = [makeShipmentRecord({ shipmentId: 'SHP-900011', status: 'pending', shipDate: '2026-09-29', estimatedDelivery: '2026-10-03', actualDelivery: null })];
    const shipments = enrichShipments(records, today, LOCATIONS);
    const activity = recentActivity(shipments, today, 10);
    expect(activity.map((s) => s.shipmentId)).not.toContain('SHP-900011');
  });
});
