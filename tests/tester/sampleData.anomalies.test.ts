// Tester (adversarial) suite: verify every intentional anomaly in plan §7.6's manifest actually produces its
// expected alert(s) with the expected counts, and independently investigate the batch-1 "cost-anomaly natural
// noise" deviation the coder flagged (§7.6 slice costAnomaly, batch-1 deviation #3).

import { describe, it, expect } from 'vitest';
import { generateSampleData, createSampleDataset } from '../../src/shared/sample/generateSampleData';
import { buildSnapshot } from '../../src/shared/domain/snapshot';
import { enrichShipments } from '../../src/shared/domain/shipments';
import { LOCATIONS } from '../../src/shared/reference/locations';

const TODAY = '2026-09-28';

function sample() {
  return generateSampleData({ seed: 42, today: TODAY });
}

function snapshotFor(today: string) {
  const dataset = createSampleDataset(42, today, `${today}T00:00:00.000Z`);
  return buildSnapshot(dataset, today, {
    generatedAt: `${today}T00:00:00.000Z`,
    limits: { maxUploadBytes: 2_097_152, maxRows: 20000 }
  });
}

describe('tester: sample-data anomaly manifest (plan §7.6)', () => {
  it('manifest slice sizes match the plan exactly', () => {
    const { anomalies } = sample();
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

  it('exactly 6 critical + 14 warning low_stock alerts from the outOfStock/lowStock manifest', () => {
    const snapshot = snapshotFor(TODAY);
    const lowStockAlerts = snapshot.alerts.filter((a) => a.type === 'low_stock');
    const critical = lowStockAlerts.filter((a) => a.severity === 'critical');
    const warning = lowStockAlerts.filter((a) => a.severity === 'warning');
    expect(critical).toHaveLength(6);
    expect(warning).toHaveLength(14);
  });

  it('every outOfStock manifest item has quantity 0 and a critical low_stock alert', () => {
    const { anomalies } = sample();
    const snapshot = snapshotFor(TODAY);
    for (const skuAtWh of anomalies.outOfStock) {
      const item = snapshot.inventory.find((i) => i.id === skuAtWh);
      expect(item, `expected inventory item ${skuAtWh} to exist`).toBeDefined();
      expect(item!.quantity).toBe(0);
      expect(item!.stockStatus).toBe('out_of_stock');
      expect(item!.stockoutRisk).toBe('high');
      const alert = snapshot.alerts.find((a) => a.type === 'low_stock' && a.severity === 'critical' && a.entity.id === skuAtWh);
      expect(alert, `expected a critical low_stock alert for ${skuAtWh}`).toBeDefined();
    }
  });

  it('every missingUsage manifest item has avgDailyUsage null, risk unknown, and an info missing_info alert', () => {
    const { anomalies } = sample();
    const snapshot = snapshotFor(TODAY);
    for (const skuAtWh of anomalies.missingUsage) {
      const item = snapshot.inventory.find((i) => i.id === skuAtWh);
      expect(item!.avgDailyUsage).toBeNull();
      expect(item!.stockoutRisk).toBe('unknown');
      const alert = snapshot.alerts.find((a) => a.type === 'missing_info' && a.id.endsWith(':usage') && a.entity.id === skuAtWh);
      expect(alert).toBeDefined();
      expect(alert!.severity).toBe('info');
    }
  });

  it('every misconfiguredReorder item shows stockoutRisk high while stockStatus is in_stock', () => {
    const { anomalies } = sample();
    const snapshot = snapshotFor(TODAY);
    for (const skuAtWh of anomalies.misconfiguredReorder) {
      const item = snapshot.inventory.find((i) => i.id === skuAtWh);
      expect(item!.stockStatus).toBe('in_stock');
      expect(item!.stockoutRisk).toBe('high');
    }
  });

  it('exactly 12 shipment_delayed alerts from the overdue manifest (6 critical, 6 warning)', () => {
    const { anomalies } = sample();
    const snapshot = snapshotFor(TODAY);
    const overdueAlerts = snapshot.alerts.filter(
      (a) => a.type === 'shipment_delayed' && anomalies.overdue.includes(a.entity.id)
    );
    expect(overdueAlerts).toHaveLength(12);
    expect(overdueAlerts.filter((a) => a.severity === 'critical')).toHaveLength(6);
    expect(overdueAlerts.filter((a) => a.severity === 'warning')).toHaveLength(6);
    for (const s of anomalies.overdue) {
      const shipment = snapshot.shipments.find((x) => x.shipmentId === s);
      expect(shipment!.deliveryState).toBe('overdue');
    }
  });

  it('every missingActual manifest shipment is delivered with actualDelivery null -> missing_info :actual alert', () => {
    const { anomalies } = sample();
    const snapshot = snapshotFor(TODAY);
    for (const id of anomalies.missingActual) {
      const shipment = snapshot.shipments.find((s) => s.shipmentId === id);
      expect(shipment!.status).toBe('delivered');
      expect(shipment!.actualDelivery).toBeNull();
      const alert = snapshot.alerts.find((a) => a.type === 'missing_info' && a.id.endsWith(':actual') && a.entity.id === id);
      expect(alert).toBeDefined();
    }
  });

  it('every missingEta manifest shipment has estimatedDelivery null -> missing_info :eta alert, state unknown', () => {
    const { anomalies } = sample();
    const snapshot = snapshotFor(TODAY);
    for (const id of anomalies.missingEta) {
      const shipment = snapshot.shipments.find((s) => s.shipmentId === id);
      expect(shipment!.estimatedDelivery).toBeNull();
      expect(shipment!.deliveryState).toBe('unknown');
      const alert = snapshot.alerts.find((a) => a.type === 'missing_info' && a.id.endsWith(':eta') && a.entity.id === id);
      expect(alert).toBeDefined();
    }
  });

  it('every actualBeforeShip manifest shipment produces ACTUAL_BEFORE_SHIP invalid_data alert and unknown state', () => {
    const { anomalies } = sample();
    const snapshot = snapshotFor(TODAY);
    for (const id of anomalies.actualBeforeShip) {
      const shipment = snapshot.shipments.find((s) => s.shipmentId === id);
      expect(shipment!.deliveryState).toBe('unknown');
      const alert = snapshot.alerts.find(
        (a) => a.type === 'invalid_data' && a.entity.id === id && a.id.endsWith(':ACTUAL_BEFORE_SHIP')
      );
      expect(alert, `expected ACTUAL_BEFORE_SHIP alert for ${id}`).toBeDefined();
    }
  });

  it('every openWithActual manifest shipment produces OPEN_WITH_ACTUAL invalid_data alert', () => {
    const { anomalies } = sample();
    const snapshot = snapshotFor(TODAY);
    for (const id of anomalies.openWithActual) {
      const alert = snapshot.alerts.find(
        (a) => a.type === 'invalid_data' && a.entity.id === id && a.id.endsWith(':OPEN_WITH_ACTUAL')
      );
      expect(alert, `expected OPEN_WITH_ACTUAL alert for ${id}`).toBeDefined();
    }
  });

  it('every zeroCost manifest shipment produces ZERO_COST invalid_data alert and is excluded from cost totals', () => {
    const { anomalies } = sample();
    const snapshot = snapshotFor(TODAY);
    for (const id of anomalies.zeroCost) {
      const shipment = snapshot.shipments.find((s) => s.shipmentId === id);
      expect(shipment!.shippingCostCents).toBe(0);
      const alert = snapshot.alerts.find(
        (a) => a.type === 'invalid_data' && a.entity.id === id && a.id.endsWith(':ZERO_COST')
      );
      expect(alert, `expected ZERO_COST alert for ${id}`).toBeDefined();
    }
  });

  it('the sameOriginDestination manifest shipment produces SAME_ORIGIN_DESTINATION invalid_data alert', () => {
    const { anomalies } = sample();
    const snapshot = snapshotFor(TODAY);
    expect(anomalies.sameOriginDestination).toHaveLength(1);
    const id = anomalies.sameOriginDestination[0]!;
    const alert = snapshot.alerts.find(
      (a) => a.type === 'invalid_data' && a.entity.id === id && a.id.endsWith(':SAME_ORIGIN_DESTINATION')
    );
    expect(alert).toBeDefined();
  });

  it('unmapped manifest shipments resolve to no origin/destination code and produce no alert of their own', () => {
    const { anomalies } = sample();
    const snapshot = snapshotFor(TODAY);
    for (const id of anomalies.unmapped) {
      const shipment = snapshot.shipments.find((s) => s.shipmentId === id);
      expect(shipment!.destinationCode).toBeNull();
      expect(shipment!.distanceMiles).toBeNull();
    }
  });

  it('R-6 regression: cost-anomaly z-score no longer flags any non-injected shipment on seed 42', () => {
    // History: this test originally *documented* BUG-1 — that natural per-shipment carrier-rate variance (not
    // a formula bug) pushed some non-injected shipments past the z >= 3.5 threshold (4 extra flags on WH-EWR
    // routes, Summit Express 2.35/mi vs Cascade Carriers 1.70/mi). The R-6 fix assigns
    // carrier per lane instead of per shipment in generateSampleData.ts, so every shipment on a route now shares
    // one carrier's rate and that source of false positives is gone. Updated here (as R-6 asked) to assert the
    // fixed behavior instead of the now-resolved bug, since a test
    // that asserts a bug's continued existence necessarily starts failing the moment that bug is fixed.
    const { shipments, anomalies } = sample();
    const enriched = enrichShipments(shipments, TODAY, LOCATIONS);
    const flagged = enriched.filter((s) => s.cost.isAnomaly).map((s) => s.shipmentId);

    // All 8 manifest anomalies must always be flagged.
    for (const id of anomalies.costAnomaly) {
      expect(flagged).toContain(id);
    }

    // ...and, now that carrier is assigned per lane rather than per shipment, nothing else should be.
    const nonManifestFlagged = flagged.filter((id) => !anomalies.costAnomaly.includes(id));
    expect(nonManifestFlagged).toEqual([]);
  });

  it('BUG-1 marker: sample data is not "clean apart from intentional anomalies" for cost_anomaly alerts', () => {
    // The sample data's brief asks for "some intentional anomalies" that let the alert/analytics systems
    // "demonstrate their functionality" - implying anomalies are intentional and countable. On seed 42 this
    // is violated: exactly 8 shipments are *intended* to be cost anomalies (manifest), but the alert list
    // shows 12 cost_anomaly alerts because of natural carrier-rate variance on low-peer-group-variance
        // routes. This test intentionally fails to keep the discrepancy visible until product code addresses it
    // (e.g. by narrowing carrier rate variance per lane, or widening the sample tolerance intentionally).
    const snapshot = snapshotFor(TODAY);
    const costAnomalyAlerts = snapshot.alerts.filter((a) => a.type === 'cost_anomaly');
    // BUG-1: expected exactly 8 (per plan §14's original test intent: "exactly the 8 manifest cost anomalies
    // flagged and no others"); actual is 12 due to natural variance (see previous test for hand-verified ids).
    expect(costAnomalyAlerts).toHaveLength(8);
  });
});
