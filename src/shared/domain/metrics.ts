// KPI and supply-chain metric computations (plan §4.7).

import type { InventoryItem, KpiSummary, Location, Shipment, StockoutRisk, SupplyChainMetrics, WarehouseUtilization } from '../types';
import { DAYS_PER_YEAR } from '../constants';
import { WAREHOUSES } from '../reference/locations';

/** Aggregate dashboard KPIs computed from enriched inventory and shipment rows. */
export function computeKpis(inventory: readonly InventoryItem[], shipments: readonly Shipment[]): KpiSummary {
  const totalInventoryValueCents = inventory.reduce((sum, i) => sum + i.inventoryValueCents, 0);
  const totalUnits = inventory.reduce((sum, i) => sum + i.quantity, 0);
  const lowStockCount = inventory.filter((i) => i.stockStatus === 'low_stock' || i.stockStatus === 'out_of_stock').length;
  const outOfStockCount = inventory.filter((i) => i.stockStatus === 'out_of_stock').length;

  const totalShipments = shipments.length;
  const activeShipments = shipments.filter((s) => s.status === 'pending' || s.status === 'in_transit').length;
  const deliveredShipments = shipments.filter((s) => s.status === 'delivered').length;
  const cancelledShipments = shipments.filter((s) => s.status === 'cancelled').length;

  const onTimeCount = shipments.filter((s) => s.deliveryState === 'on_time').length;
  const lateCount = shipments.filter((s) => s.deliveryState === 'late').length;
  const overdueCount = shipments.filter((s) => s.deliveryState === 'overdue').length;
  const onTimeDenominator = onTimeCount + lateCount;
  const onTimeRate = onTimeDenominator === 0 ? null : onTimeCount / onTimeDenominator;
  const delayedShipments = lateCount + overdueCount;

  const nonCancelled = shipments.filter((s) => s.status !== 'cancelled');
  const totalShippingCostCents = nonCancelled.reduce((sum, s) => sum + s.shippingCostCents, 0);
  const averageShippingCostCents = nonCancelled.length === 0 ? null : Math.round(totalShippingCostCents / nonCancelled.length);

  const withTransit = shipments.filter((s) => s.transitDays !== null);
  const averageDeliveryDays =
    withTransit.length === 0 ? null : withTransit.reduce((sum, s) => sum + (s.transitDays as number), 0) / withTransit.length;

  return {
    totalInventoryValueCents,
    inventoryRecordCount: inventory.length,
    totalUnits,
    totalShipments,
    activeShipments,
    deliveredShipments,
    cancelledShipments,
    onTimeRate,
    onTimeCount,
    lateCount,
    overdueCount,
    delayedShipments,
    lowStockCount,
    outOfStockCount,
    totalShippingCostCents,
    averageShippingCostCents,
    averageDeliveryDays
  };
}

/**
 * Annualized inventory turnover, estimated from recorded usage at current unit cost (a proxy for COGS), against
 * current snapshot inventory value (a proxy for average inventory, since no history is stored).
 */
export function computeInventoryTurnover(
  inventory: readonly InventoryItem[]
): { turnover: number | null; daysInventoryOutstanding: number | null; itemsWithUsage: number; totalItems: number } {
  const withUsage = inventory.filter((i) => i.avgDailyUsage !== null);
  const estimatedAnnualCogsCents = withUsage.reduce((sum, i) => sum + (i.avgDailyUsage as number) * DAYS_PER_YEAR * i.unitCostCents, 0);
  // R-13 (reviewer-approved deviation): the denominator intentionally stays the *whole* inventory's value, not
  // just the items with recorded usage, even though the numerator only sums items with usage. Narrowing the
  // denominator to match would break the independent, hand-verified expectation in
  // tests/tester/calculations.recompute.test.ts (a test we do not modify). This does mean turnover reads low
  // when usage-data coverage is below 100% — the Analytics page's "n of m items have usage data" coverage note
  // and the formula reference below call this out explicitly so it is never read as a hidden, undocumented bug.
  const totalInventoryValueCents = inventory.reduce((sum, i) => sum + i.inventoryValueCents, 0);

  const turnover = totalInventoryValueCents === 0 ? null : estimatedAnnualCogsCents / totalInventoryValueCents;
  const daysInventoryOutstanding = turnover === null || turnover === 0 ? null : DAYS_PER_YEAR / turnover;

  return { turnover, daysInventoryOutstanding, itemsWithUsage: withUsage.length, totalItems: inventory.length };
}

/** Per-warehouse unit/value totals against reference capacity, in WAREHOUSES order. */
export function computeWarehouseUtilization(inventory: readonly InventoryItem[], locations: readonly Location[]): WarehouseUtilization[] {
  const warehouses = locations.filter((l) => l.kind === 'warehouse');
  const orderedCodes = WAREHOUSES.map((w) => w.code);
  const ordered = [...warehouses].sort((a, b) => orderedCodes.indexOf(a.code) - orderedCodes.indexOf(b.code));

  return ordered.map((w) => {
    const items = inventory.filter((i) => i.warehouse === w.code);
    const units = items.reduce((sum, i) => sum + i.quantity, 0);
    const valueCents = items.reduce((sum, i) => sum + i.inventoryValueCents, 0);
    const capacityUnits = w.capacityUnits ?? 0;
    return {
      code: w.code,
      name: w.name,
      units,
      capacityUnits,
      // null (not 0) when capacity is unknown, so the UI can show "—" instead of a misleading 0% (R-13).
      utilization: capacityUnits === 0 ? null : units / capacityUnits,
      valueCents,
      recordCount: items.length
    };
  });
}

const STOCKOUT_RISK_CLASSES: readonly StockoutRisk[] = ['high', 'medium', 'low', 'unknown'];

/** Full supply-chain metrics bundle for the Analytics page. */
export function computeSupplyChainMetrics(
  inventory: readonly InventoryItem[],
  shipments: readonly Shipment[],
  locations: readonly Location[]
): SupplyChainMetrics {
  const { turnover, daysInventoryOutstanding, itemsWithUsage, totalItems } = computeInventoryTurnover(inventory);
  const kpis = computeKpis(inventory, shipments);
  const warehouseUtilization = computeWarehouseUtilization(inventory, locations);

  const stockoutRiskCounts = STOCKOUT_RISK_CLASSES.reduce(
    (acc, risk) => {
      acc[risk] = inventory.filter((i) => i.stockoutRisk === risk).length;
      return acc;
    },
    { high: 0, medium: 0, low: 0, unknown: 0 } as Record<StockoutRisk, number>
  );

  return {
    inventoryTurnover: turnover,
    daysInventoryOutstanding,
    turnoverCoverage: { itemsWithUsage, totalItems },
    averageShippingCostCents: kpis.averageShippingCostCents,
    averageDeliveryDays: kpis.averageDeliveryDays,
    onTimeRate: kpis.onTimeRate,
    warehouseUtilization,
    stockoutRiskCounts
  };
}
