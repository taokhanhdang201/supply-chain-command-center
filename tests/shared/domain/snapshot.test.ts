import { describe, it, expect } from 'vitest';
import { buildSnapshot } from '../../../src/shared/domain/snapshot';
import { makeInventoryRecord, makeShipmentRecord, TODAY } from '../../helpers/fixtures';
import type { Dataset } from '../../../src/shared/types';

function dataset(inventory: ReturnType<typeof makeInventoryRecord>[], shipments: ReturnType<typeof makeShipmentRecord>[]): Dataset {
  return {
    inventory,
    shipments,
    sources: {
      inventory: { kind: 'sample', label: 'Sample data (seed 42)', loadedAt: '2026-01-01T00:00:00.000Z', rowCount: inventory.length },
      shipments: { kind: 'sample', label: 'Sample data (seed 42)', loadedAt: '2026-01-01T00:00:00.000Z', rowCount: shipments.length }
    }
  };
}

const OPTS = { generatedAt: '2026-06-15T12:00:00.000Z', limits: { maxUploadBytes: 2_097_152, maxRows: 20000 } };

describe('buildSnapshot', () => {
  it('produces kpis consistent with the rows', () => {
    const snapshot = buildSnapshot(dataset([makeInventoryRecord({ quantity: 10, unitCostCents: 100 })], []), TODAY, OPTS);
    expect(snapshot.kpis.totalInventoryValueCents).toBe(1000);
    expect(snapshot.inventory).toHaveLength(1);
  });

  it('every alert references an existing entity', () => {
    const snapshot = buildSnapshot(
      dataset(
        [makeInventoryRecord({ quantity: 0 })],
        [makeShipmentRecord({ status: 'in_transit', estimatedDelivery: '2026-06-01', actualDelivery: null })]
      ),
      TODAY,
      OPTS
    );
    for (const alert of snapshot.alerts) {
      if (alert.entity.kind === 'inventory') {
        expect(snapshot.inventory.some((i) => i.id === alert.entity.id)).toBe(true);
      } else if (alert.entity.kind === 'shipment') {
        expect(snapshot.shipments.some((s) => s.shipmentId === alert.entity.id)).toBe(true);
      } else {
        expect(snapshot.locations.some((l) => l.code === alert.entity.id)).toBe(true);
      }
    }
  });

  it('gives a valid snapshot for an empty dataset with no NaN or Infinity anywhere', () => {
    const snapshot = buildSnapshot(dataset([], []), TODAY, OPTS);
    expect(snapshot.inventory).toEqual([]);
    expect(snapshot.shipments).toEqual([]);
    expect(snapshot.kpis.onTimeRate).toBeNull();
    const json = JSON.stringify(snapshot);
    expect(json).not.toContain('NaN');
    expect(json).not.toContain('Infinity');
  });
});
