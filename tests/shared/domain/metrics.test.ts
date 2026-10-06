import { describe, it, expect } from 'vitest';
import { computeKpis, computeInventoryTurnover, computeWarehouseUtilization, computeSupplyChainMetrics } from '../../../src/shared/domain/metrics';
import { enrichInventory } from '../../../src/shared/domain/inventory';
import { enrichShipments } from '../../../src/shared/domain/shipments';
import { LOCATIONS } from '../../../src/shared/reference/locations';
import { makeInventoryRecord, makeShipmentRecord, TODAY } from '../../helpers/fixtures';

describe('computeKpis', () => {
  it('computes exact totals on a hand-computed fixture', () => {
    const inventory = enrichInventory([
      makeInventoryRecord({ sku: 'A', quantity: 10, unitCostCents: 100, reorderPoint: 5 }), // in_stock, value 1000
      makeInventoryRecord({ sku: 'B', quantity: 0, unitCostCents: 200, reorderPoint: 5 }) // out_of_stock, value 0
    ]);
    const shipments = enrichShipments(
      [
        makeShipmentRecord({ status: 'delivered', estimatedDelivery: '2026-06-05', actualDelivery: '2026-06-05', shippingCostCents: 1000 }), // on_time
        makeShipmentRecord({ status: 'delivered', estimatedDelivery: '2026-06-05', actualDelivery: '2026-06-08', shippingCostCents: 2000 }), // late
        makeShipmentRecord({ status: 'cancelled', actualDelivery: null, shippingCostCents: 5000 })
      ],
      TODAY,
      LOCATIONS
    );
    const kpis = computeKpis(inventory, shipments);

    expect(kpis.totalInventoryValueCents).toBe(1000);
    expect(kpis.inventoryRecordCount).toBe(2);
    expect(kpis.totalUnits).toBe(10);
    expect(kpis.lowStockCount).toBe(1);
    expect(kpis.outOfStockCount).toBe(1);
    expect(kpis.totalShipments).toBe(3);
    expect(kpis.cancelledShipments).toBe(1);
    expect(kpis.onTimeCount).toBe(1);
    expect(kpis.lateCount).toBe(1);
    expect(kpis.onTimeRate).toBe(0.5);
    expect(kpis.totalShippingCostCents).toBe(3000); // excludes cancelled
    expect(kpis.averageShippingCostCents).toBe(1500);
  });

  it('is null for on-time rate when there is no delivered shipment', () => {
    const shipments = enrichShipments([makeShipmentRecord({ status: 'in_transit', actualDelivery: null })], TODAY, LOCATIONS);
    expect(computeKpis([], shipments).onTimeRate).toBeNull();
  });

  it('is null for average shipping cost when all shipments are cancelled', () => {
    const shipments = enrichShipments([makeShipmentRecord({ status: 'cancelled', actualDelivery: null })], TODAY, LOCATIONS);
    expect(computeKpis([], shipments).averageShippingCostCents).toBeNull();
  });

  it('computes average delivery days over transit days only', () => {
    const shipments = enrichShipments(
      [
        makeShipmentRecord({ status: 'delivered', shipDate: '2026-06-01', actualDelivery: '2026-06-04' }), // 3 days
        makeShipmentRecord({ status: 'delivered', shipDate: '2026-06-01', actualDelivery: '2026-06-06' }) // 5 days
      ],
      TODAY,
      LOCATIONS
    );
    expect(computeKpis([], shipments).averageDeliveryDays).toBe(4);
  });
});

describe('computeInventoryTurnover', () => {
  it('computes an exact turnover value on a fixture', () => {
    const inventory = enrichInventory([
      makeInventoryRecord({ avgDailyUsage: 10, unitCostCents: 100, quantity: 100 }) // annual COGS = 10*365*100 = 365000; value = 100*100=10000
    ]);
    const result = computeInventoryTurnover(inventory);
    expect(result.turnover).toBe(36.5);
    expect(result.itemsWithUsage).toBe(1);
    expect(result.totalItems).toBe(1);
    expect(result.daysInventoryOutstanding).toBeCloseTo(365 / 36.5);
  });

  it('excludes items with null usage from the numerator but counts them in totalItems', () => {
    const inventory = enrichInventory([
      makeInventoryRecord({ avgDailyUsage: null, unitCostCents: 100, quantity: 100 }),
      makeInventoryRecord({ avgDailyUsage: 10, unitCostCents: 100, quantity: 100 })
    ]);
    const result = computeInventoryTurnover(inventory);
    expect(result.itemsWithUsage).toBe(1);
    expect(result.totalItems).toBe(2);
  });

  it('is 0 (not null) when there is inventory value but no usage data at all', () => {
    const inventory = enrichInventory([makeInventoryRecord({ avgDailyUsage: null })]);
    expect(computeInventoryTurnover(inventory).turnover).toBe(0);
  });

  it('is null when total inventory value is 0', () => {
    expect(computeInventoryTurnover([]).turnover).toBeNull();
  });
});

describe('computeWarehouseUtilization', () => {
  it('includes an empty warehouse with 0 units and 0 utilization', () => {
    const result = computeWarehouseUtilization([], LOCATIONS);
    expect(result.every((w) => w.units === 0)).toBe(true);
  });

  it('can exceed 100%', () => {
    const capacityLocations = LOCATIONS.map((l) => (l.code === 'WH-DFW' ? { ...l, capacityUnits: 10 } : l));
    const inventory = enrichInventory([makeInventoryRecord({ warehouse: 'WH-DFW', quantity: 20 })]);
    const result = computeWarehouseUtilization(inventory, capacityLocations);
    const dfw = result.find((w) => w.code === 'WH-DFW');
    expect(dfw?.utilization).toBe(2);
  });
});

describe('computeSupplyChainMetrics', () => {
  it('counts inventory by stockout risk class', () => {
    const inventory = enrichInventory([
      makeInventoryRecord({ quantity: 0 }), // high
      makeInventoryRecord({ avgDailyUsage: null }) // unknown
    ]);
    const metrics = computeSupplyChainMetrics(inventory, [], LOCATIONS);
    expect(metrics.stockoutRiskCounts.high).toBe(1);
    expect(metrics.stockoutRiskCounts.unknown).toBe(1);
  });
});
