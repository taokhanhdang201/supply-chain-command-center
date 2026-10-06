// Shared test data builders. Keeps individual test files focused on the behaviour under test.

import type { Dataset, InventoryRecord, ShipmentRecord, Snapshot } from '../../src/shared/types';
import { buildSnapshot } from '../../src/shared/domain/snapshot';

export const TODAY = '2026-06-15';

let inventorySeq = 0;
let shipmentSeq = 0;

export function makeInventoryRecord(overrides: Partial<InventoryRecord> = {}): InventoryRecord {
  inventorySeq += 1;
  return {
    sku: `SKU-${String(inventorySeq).padStart(4, '0')}`,
    productName: 'Test Widget',
    category: 'Test Category',
    warehouse: 'WH-DFW',
    quantity: 100,
    reorderPoint: 20,
    unitCostCents: 500,
    avgDailyUsage: 5,
    leadTimeDays: 14,
    ...overrides
  };
}

export function makeShipmentRecord(overrides: Partial<ShipmentRecord> = {}): ShipmentRecord {
  shipmentSeq += 1;
  return {
    shipmentId: `SHP-${String(100000 + shipmentSeq)}`,
    origin: 'WH-DFW',
    destination: 'HOU',
    carrier: 'Northstar Freight',
    status: 'delivered',
    shipDate: '2026-06-01',
    estimatedDelivery: '2026-06-05',
    actualDelivery: '2026-06-05',
    shippingCostCents: 80000,
    ...overrides
  };
}

export function makeSnapshot(
  inventory: InventoryRecord[],
  shipments: ShipmentRecord[],
  overrides: { today?: string; generatedAt?: string } = {}
): Snapshot {
  const dataset: Dataset = {
    inventory,
    shipments,
    sources: {
      inventory: { kind: 'sample', label: 'Sample data (seed 42)', loadedAt: '2026-06-01T00:00:00.000Z', rowCount: inventory.length },
      shipments: { kind: 'sample', label: 'Sample data (seed 42)', loadedAt: '2026-06-01T00:00:00.000Z', rowCount: shipments.length }
    }
  };
  return buildSnapshot(dataset, overrides.today ?? TODAY, {
    generatedAt: overrides.generatedAt ?? '2026-06-15T12:00:00.000Z',
    limits: { maxUploadBytes: 2_097_152, maxRows: 20000 }
  });
}
