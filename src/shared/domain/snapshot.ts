// Assembles a full `Snapshot` from a raw `Dataset`: enriches inventory/shipments, then derives metrics and
// alerts from the enriched rows. This is the single place the server (and tests) call to get everything the
// client needs from one dataset + a point in time.

import type { DayString, Snapshot, Dataset, Location } from '../types';
import { LOCATIONS } from '../reference/locations';
import { enrichInventory } from './inventory';
import { enrichShipments } from './shipments';
import { computeKpis, computeSupplyChainMetrics, computeWarehouseUtilization } from './metrics';
import { buildAlerts } from './alerts';

export function buildSnapshot(
  dataset: Dataset,
  today: DayString,
  opts: { generatedAt: string; limits: { maxUploadBytes: number; maxRows: number }; locations?: readonly Location[] }
): Snapshot {
  const locations = opts.locations ?? LOCATIONS;

  const inventory = enrichInventory(dataset.inventory);
  const shipments = enrichShipments(dataset.shipments, today, locations);

  const kpis = computeKpis(inventory, shipments);
  const metrics = computeSupplyChainMetrics(inventory, shipments, locations);
  const utilization = computeWarehouseUtilization(inventory, locations);
  const alerts = buildAlerts(inventory, shipments, utilization, today, locations);

  return {
    today,
    generatedAt: opts.generatedAt,
    inventory,
    shipments,
    alerts,
    kpis,
    metrics,
    locations: [...locations],
    dataSources: dataset.sources,
    limits: opts.limits
  };
}
