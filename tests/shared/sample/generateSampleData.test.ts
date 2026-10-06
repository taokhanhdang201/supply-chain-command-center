import { describe, it, expect } from 'vitest';
import { generateSampleData, createSampleDataset } from '../../../src/shared/sample/generateSampleData';
import { importInventoryCsv } from '../../../src/shared/csv/importInventory';
import { importShipmentsCsv } from '../../../src/shared/csv/importShipments';
import { buildSnapshot } from '../../../src/shared/domain/snapshot';
import { WAREHOUSES } from '../../../src/shared/reference/locations';
import { toCsv } from '../../helpers/toCsv';

const TODAY = '2026-06-15';

describe('generateSampleData', () => {
  it('generates 360 inventory records and 480 shipment records', () => {
    const { inventory, shipments } = generateSampleData({ seed: 42, today: TODAY });
    expect(inventory).toHaveLength(360);
    expect(shipments).toHaveLength(480);
  });

  it('is deterministic for the same seed and today', () => {
    const a = generateSampleData({ seed: 42, today: TODAY });
    const b = generateSampleData({ seed: 42, today: TODAY });
    expect(a).toEqual(b);
  });

  it('differs for a different seed', () => {
    const a = generateSampleData({ seed: 42, today: TODAY });
    const b = generateSampleData({ seed: 7, today: TODAY });
    expect(a.inventory).not.toEqual(b.inventory);
  });

  it('produces identical quantities, costs and carriers for a different today', () => {
    const a = generateSampleData({ seed: 42, today: TODAY });
    const b = generateSampleData({ seed: 42, today: '2027-01-01' });
    expect(a.inventory).toEqual(b.inventory);
    const stripDates = (s: (typeof a.shipments)[number]) => ({ carrier: s.carrier, shippingCostCents: s.shippingCostCents, shipmentId: s.shipmentId });
    expect(a.shipments.map(stripDates)).toEqual(b.shipments.map(stripDates));
  });

  it('includes every shipment status', () => {
    const { shipments } = generateSampleData({ seed: 42, today: TODAY });
    const statuses = new Set(shipments.map((s) => s.status));
    expect(statuses).toEqual(new Set(['pending', 'in_transit', 'delivered', 'cancelled']));
  });

  it('re-imports cleanly through the CSV importers (both kinds)', () => {
    const { inventory, shipments } = generateSampleData({ seed: 42, today: TODAY });
    const inventoryCsv = toCsv(
      ['sku', 'product_name', 'category', 'warehouse', 'quantity', 'reorder_point', 'unit_cost', 'avg_daily_usage', 'lead_time_days'],
      inventory.map((r) => ({
        sku: r.sku,
        product_name: r.productName,
        category: r.category,
        warehouse: r.warehouse,
        quantity: r.quantity,
        reorder_point: r.reorderPoint,
        unit_cost: (r.unitCostCents / 100).toFixed(2),
        avg_daily_usage: r.avgDailyUsage === null ? '' : r.avgDailyUsage,
        lead_time_days: r.leadTimeDays
      }))
    );
    const inventoryResult = importInventoryCsv(inventoryCsv);
    expect(inventoryResult.ok).toBe(true);

    const shipmentsCsv = toCsv(
      ['shipment_id', 'origin', 'destination', 'carrier', 'status', 'ship_date', 'estimated_delivery', 'actual_delivery', 'shipping_cost'],
      shipments.map((r) => ({
        shipment_id: r.shipmentId,
        origin: r.origin,
        destination: r.destination,
        carrier: r.carrier,
        status: r.status,
        ship_date: r.shipDate,
        estimated_delivery: r.estimatedDelivery ?? '',
        actual_delivery: r.actualDelivery ?? '',
        shipping_cost: (r.shippingCostCents / 100).toFixed(2)
      }))
    );
    const shipmentsResult = importShipmentsCsv(shipmentsCsv);
    expect(shipmentsResult.ok).toBe(true);
  });

  it('has unique inventory ids and unique shipment ids', () => {
    const { inventory, shipments } = generateSampleData({ seed: 42, today: TODAY });
    const invIds = inventory.map((r) => `${r.sku}@${r.warehouse}`);
    const shipIds = shipments.map((r) => r.shipmentId);
    expect(new Set(invIds).size).toBe(invIds.length);
    expect(new Set(shipIds).size).toBe(shipIds.length);
  });

  it('reports the expected manifest sizes', () => {
    const { anomalies } = generateSampleData({ seed: 42, today: TODAY });
    expect(anomalies.outOfStock).toHaveLength(6);
    expect(anomalies.lowStock).toHaveLength(14);
    expect(anomalies.missingUsage).toHaveLength(4);
    expect(anomalies.misconfiguredReorder).toHaveLength(5);
    expect(anomalies.overdue).toHaveLength(12);
    expect(anomalies.costAnomaly).toHaveLength(8);
    expect(anomalies.missingActual).toHaveLength(5);
    expect(anomalies.missingEta).toHaveLength(4);
    expect(anomalies.actualBeforeShip).toHaveLength(3);
    expect(anomalies.openWithActual).toHaveLength(2);
    expect(anomalies.zeroCost).toHaveLength(2);
    expect(anomalies.sameOriginDestination).toHaveLength(1);
    expect(anomalies.unmapped).toHaveLength(2);
  });

  it('produces exactly 6 critical + 14 warning low_stock alerts, and matching manifest-driven alert counts', () => {
    const dataset = createSampleDataset(42, TODAY, '2026-06-15T00:00:00.000Z');
    const { anomalies } = generateSampleData({ seed: 42, today: TODAY });
    const snapshot = buildSnapshot(dataset, TODAY, { generatedAt: '2026-06-15T00:00:00.000Z', limits: { maxUploadBytes: 2_097_152, maxRows: 20000 } });

    const lowStockAlerts = snapshot.alerts.filter((a) => a.type === 'low_stock');
    expect(lowStockAlerts.filter((a) => a.severity === 'critical')).toHaveLength(6);
    expect(lowStockAlerts.filter((a) => a.severity === 'warning')).toHaveLength(14);

    const delayedAlerts = snapshot.alerts.filter((a) => a.type === 'shipment_delayed' && a.title.startsWith('Shipment overdue'));
    expect(delayedAlerts).toHaveLength(12);
    expect(delayedAlerts.filter((a) => a.severity === 'critical')).toHaveLength(6);

    // Exactly the 8 manifest-injected cost anomalies must be flagged, and no others (plan §14). Carrier is now
    // assigned per lane rather than per shipment (R-6/R-12), so a route's peer group no longer mixes carriers
    // with different per-mile rates, and no natural false positives should occur.
    const costAnomalyAlerts = snapshot.alerts.filter((a) => a.type === 'cost_anomaly');
    const flaggedIds = new Set(costAnomalyAlerts.map((a) => a.entity.id));
    expect(flaggedIds).toEqual(new Set(anomalies.costAnomaly));
    expect(costAnomalyAlerts).toHaveLength(anomalies.costAnomaly.length);

    const missingInfoShipmentAlerts = snapshot.alerts.filter((a) => a.type === 'missing_info' && a.entity.kind === 'shipment');
    expect(missingInfoShipmentAlerts).toHaveLength(9); // 5 missingActual + 4 missingEta

    const missingInfoInventoryAlerts = snapshot.alerts.filter((a) => a.type === 'missing_info' && a.entity.kind === 'inventory');
    expect(missingInfoInventoryAlerts).toHaveLength(4);

    const invalidDataShipmentAlerts = snapshot.alerts.filter((a) => a.type === 'invalid_data' && a.entity.kind === 'shipment');
    expect(invalidDataShipmentAlerts).toHaveLength(8); // 3 actualBeforeShip + 2 openWithActual + 2 zeroCost + 1 sameOriginDestination
  });

  it('gives misconfiguredReorder items a high stockout risk while in_stock', () => {
    const dataset = createSampleDataset(42, TODAY, '2026-06-15T00:00:00.000Z');
    const { anomalies } = generateSampleData({ seed: 42, today: TODAY });
    const snapshot = buildSnapshot(dataset, TODAY, { generatedAt: '2026-06-15T00:00:00.000Z', limits: { maxUploadBytes: 2_097_152, maxRows: 20000 } });
    for (const id of anomalies.misconfiguredReorder) {
      const item = snapshot.inventory.find((i) => i.id === id);
      expect(item?.stockoutRisk).toBe('high');
      expect(item?.stockStatus).toBe('in_stock');
    }
  });

  it('gives an on-time rate between 0.8 and 0.95', () => {
    const dataset = createSampleDataset(42, TODAY, '2026-06-15T00:00:00.000Z');
    const snapshot = buildSnapshot(dataset, TODAY, { generatedAt: '2026-06-15T00:00:00.000Z', limits: { maxUploadBytes: 2_097_152, maxRows: 20000 } });
    expect(snapshot.kpis.onTimeRate).toBeGreaterThan(0.8);
    expect(snapshot.kpis.onTimeRate).toBeLessThan(0.95);
  });

  it('tunes seed-42 warehouse utilization within ±0.02 of the targets and all under 1', () => {
    const dataset = createSampleDataset(42, TODAY, '2026-06-15T00:00:00.000Z');
    const snapshot = buildSnapshot(dataset, TODAY, { generatedAt: '2026-06-15T00:00:00.000Z', limits: { maxUploadBytes: 2_097_152, maxRows: 20000 } });
    const targets: Record<string, number> = { 'WH-DFW': 0.78, 'WH-ATL': 0.64, 'WH-ORD': 0.57, 'WH-LAX': 0.86, 'WH-EWR': 0.93 };
    for (const w of snapshot.metrics.warehouseUtilization) {
      expect(w.utilization).not.toBeNull();
      const utilization = w.utilization as number;
      expect(utilization).toBeLessThan(1);
      expect(Math.abs(utilization - (targets[w.code] as number))).toBeLessThanOrEqual(0.02);
    }
    expect(snapshot.metrics.warehouseUtilization).toHaveLength(WAREHOUSES.length);
  });
});
