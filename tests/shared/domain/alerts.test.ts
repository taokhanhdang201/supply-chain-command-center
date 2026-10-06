import { describe, it, expect } from 'vitest';
import { buildAlerts } from '../../../src/shared/domain/alerts';
import { enrichInventory } from '../../../src/shared/domain/inventory';
import { enrichShipments } from '../../../src/shared/domain/shipments';
import { computeWarehouseUtilization } from '../../../src/shared/domain/metrics';
import { LOCATIONS } from '../../../src/shared/reference/locations';
import { makeInventoryRecord, makeShipmentRecord, TODAY } from '../../helpers/fixtures';

function alertsFor(inventoryRecords: ReturnType<typeof makeInventoryRecord>[], shipmentRecords: ReturnType<typeof makeShipmentRecord>[]) {
  const inventory = enrichInventory(inventoryRecords);
  const shipments = enrichShipments(shipmentRecords, TODAY, LOCATIONS);
  const utilization = computeWarehouseUtilization(inventory, LOCATIONS);
  return buildAlerts(inventory, shipments, utilization, TODAY, LOCATIONS);
}

describe('buildAlerts', () => {
  it('emits a critical low_stock alert for out-of-stock', () => {
    const alerts = alertsFor([makeInventoryRecord({ sku: 'A', quantity: 0, reorderPoint: 10 })], []);
    const alert = alerts.find((a) => a.type === 'low_stock');
    expect(alert?.severity).toBe('critical');
    expect(alert?.title).toBe('Out of stock: A');
  });

  it('emits a warning low_stock alert for low stock', () => {
    const alerts = alertsFor([makeInventoryRecord({ sku: 'A', quantity: 5, reorderPoint: 10 })], []);
    const alert = alerts.find((a) => a.type === 'low_stock');
    expect(alert?.severity).toBe('warning');
    expect(alert?.title).toBe('Low stock: A');
  });

  it('emits an info missing_info alert when usage is null', () => {
    const alerts = alertsFor([makeInventoryRecord({ avgDailyUsage: null })], []);
    const alert = alerts.find((a) => a.type === 'missing_info' && a.entity.kind === 'inventory');
    expect(alert?.severity).toBe('info');
  });

  it('shipment_delayed overdue is critical at 7+ days late, warning at 6', () => {
    const critical = alertsFor([], [makeShipmentRecord({ status: 'in_transit', estimatedDelivery: '2026-06-08', actualDelivery: null })]); // 7 days late
    const warning = alertsFor([], [makeShipmentRecord({ status: 'in_transit', estimatedDelivery: '2026-06-09', actualDelivery: null })]); // 6 days late
    expect(critical.find((a) => a.type === 'shipment_delayed')?.severity).toBe('critical');
    expect(warning.find((a) => a.type === 'shipment_delayed')?.severity).toBe('warning');
  });

  it('emits an info alert for a recently late delivery (within 14 days)', () => {
    const alerts = alertsFor(
      [],
      [makeShipmentRecord({ status: 'delivered', estimatedDelivery: '2026-06-05', actualDelivery: '2026-06-06' })]
    );
    const alert = alerts.find((a) => a.type === 'shipment_delayed');
    expect(alert?.severity).toBe('info');
    expect(alert?.title).toContain('Delivered late');
  });

  it('does not emit a late-delivery alert outside the recent window (15+ days ago)', () => {
    const alerts = alertsFor(
      [],
      [makeShipmentRecord({ status: 'delivered', shipDate: '2026-05-01', estimatedDelivery: '2026-05-25', actualDelivery: '2026-05-26' })]
    );
    expect(alerts.find((a) => a.type === 'shipment_delayed')).toBeUndefined();
  });

  it('emits a critical cost_anomaly alert when cost >= 3x baseline', () => {
    const base = Array.from({ length: 7 }, (_, i) =>
      makeShipmentRecord({ shipmentId: `SHP-${100000 + i}`, shippingCostCents: 10000 })
    );
    const outlier = makeShipmentRecord({ shipmentId: 'SHP-999999', shippingCostCents: 50000 });
    const alerts = alertsFor([], [...base, outlier]);
    const alert = alerts.find((a) => a.type === 'cost_anomaly');
    expect(alert?.severity).toBe('critical');
  });

  it('emits a missing_info alert for a missing ETA', () => {
    const alerts = alertsFor([], [makeShipmentRecord({ status: 'in_transit', estimatedDelivery: null, actualDelivery: null })]);
    expect(alerts.find((a) => a.title.includes('Missing estimated delivery'))?.severity).toBe('warning');
  });

  it('emits a missing_info alert for a missing actual delivery date', () => {
    const alerts = alertsFor([], [makeShipmentRecord({ status: 'delivered', actualDelivery: null })]);
    expect(alerts.find((a) => a.title.includes('Missing delivery date'))?.severity).toBe('warning');
  });

  it('emits an invalid_data alert for each DataIssue', () => {
    const alerts = alertsFor([], [makeShipmentRecord({ origin: 'HOU', destination: 'HOU' })]);
    expect(alerts.some((a) => a.type === 'invalid_data' && a.message.includes('Origin and destination'))).toBe(true);
  });

  it('emits an invalid_data alert when warehouse utilization exceeds 100%', () => {
    const capacityLocations = LOCATIONS.map((l) => (l.code === 'WH-DFW' ? { ...l, capacityUnits: 10 } : l));
    const inventory = enrichInventory([makeInventoryRecord({ warehouse: 'WH-DFW', quantity: 20 })]);
    const utilization = computeWarehouseUtilization(inventory, capacityLocations);
    const alerts = buildAlerts(inventory, [], utilization, TODAY, capacityLocations);
    expect(alerts.some((a) => a.title.startsWith('Over capacity'))).toBe(true);
  });

  it('produces unique ids', () => {
    const alerts = alertsFor(
      [makeInventoryRecord({ quantity: 0 })],
      [makeShipmentRecord({ status: 'in_transit', estimatedDelivery: '2026-06-01', actualDelivery: null })]
    );
    const ids = alerts.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('sorts by severity then type then entity id', () => {
    const alerts = alertsFor(
      [makeInventoryRecord({ sku: 'Z', quantity: 5, reorderPoint: 10 }), makeInventoryRecord({ sku: 'A', quantity: 0, reorderPoint: 10 })],
      []
    );
    expect(alerts[0]?.severity).toBe('critical');
    expect(alerts[alerts.length - 1]?.severity !== 'critical' || alerts.length === 1).toBe(true);
  });

  it('produces no alerts for clean data', () => {
    const alerts = alertsFor([makeInventoryRecord({ quantity: 100, reorderPoint: 10, avgDailyUsage: 5 })], [makeShipmentRecord()]);
    expect(alerts).toEqual([]);
  });
});
