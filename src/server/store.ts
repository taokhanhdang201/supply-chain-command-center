// In-memory dataset store (plan §6.2). Each replace swaps in a brand-new `Dataset` object (atomic) and bumps a
// version counter the API layer uses to decide when a cached snapshot must be recomputed.

import type { Dataset, DataSourceInfo, InventoryRecord, ShipmentRecord } from '../shared/types';

export interface DataStore {
  getDataset(): Dataset;
  getVersion(): number;
  replaceInventory(rows: InventoryRecord[], source: DataSourceInfo): void;
  replaceShipments(rows: ShipmentRecord[], source: DataSourceInfo): void;
  replaceAll(dataset: Dataset): void;
}

/** Creates an in-memory data store seeded with `initial`. */
export function createDataStore(initial: Dataset): DataStore {
  let dataset = initial;
  let version = 0;

  return {
    getDataset(): Dataset {
      return dataset;
    },
    getVersion(): number {
      return version;
    },
    replaceInventory(rows: InventoryRecord[], source: DataSourceInfo): void {
      dataset = {
        inventory: rows,
        shipments: dataset.shipments,
        sources: { inventory: source, shipments: dataset.sources.shipments }
      };
      version += 1;
    },
    replaceShipments(rows: ShipmentRecord[], source: DataSourceInfo): void {
      dataset = {
        inventory: dataset.inventory,
        shipments: rows,
        sources: { inventory: dataset.sources.inventory, shipments: source }
      };
      version += 1;
    },
    replaceAll(next: Dataset): void {
      dataset = next;
      version += 1;
    }
  };
}
