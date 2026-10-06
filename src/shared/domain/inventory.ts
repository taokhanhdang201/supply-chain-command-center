// Pure inventory domain logic (plan §4.2). Reference module: named exports only, pure functions, explicit return
// types, readonly array params, no classes, no mutation of inputs.

import type { InventoryItem, InventoryRecord, StockStatus, StockoutRisk } from '../types';
import { STOCKOUT_SAFETY_BUFFER_DAYS } from '../constants';

/** Inventory value in cents: quantity × unit cost, computed as an exact integer. */
export function computeInventoryValueCents(quantity: number, unitCostCents: number): number {
  return quantity * unitCostCents;
}

/** Stock status: 0 units is always out_of_stock; at or below the reorder point is low_stock; else in_stock. */
export function getStockStatus(quantity: number, reorderPoint: number): StockStatus {
  if (quantity === 0) return 'out_of_stock';
  if (quantity <= reorderPoint) return 'low_stock';
  return 'in_stock';
}

/** Days of on-hand supply at current usage; null when usage is unknown or zero (no meaningful rate). */
export function computeDaysOfSupply(quantity: number, avgDailyUsage: number | null): number | null {
  if (avgDailyUsage === null || avgDailyUsage === 0) return null;
  return quantity / avgDailyUsage;
}

/**
 * Stockout risk, evaluated in order: no stock is always high risk; unknown usage means unknown risk; zero usage
 * (but in stock) means low risk; otherwise risk depends on days of supply vs. lead time (+ a safety buffer).
 */
export function getStockoutRisk(r: Pick<InventoryRecord, 'quantity' | 'avgDailyUsage' | 'leadTimeDays'>): StockoutRisk {
  if (r.quantity === 0) return 'high';
  if (r.avgDailyUsage === null) return 'unknown';
  if (r.avgDailyUsage === 0) return 'low';
  const dos = computeDaysOfSupply(r.quantity, r.avgDailyUsage) as number;
  if (dos < r.leadTimeDays) return 'high';
  if (dos < r.leadTimeDays + STOCKOUT_SAFETY_BUFFER_DAYS) return 'medium';
  return 'low';
}

/** Enriches raw inventory records with derived value, stock status, days of supply, stockout risk and an id. */
export function enrichInventory(records: readonly InventoryRecord[]): InventoryItem[] {
  return records.map((r) => ({
    ...r,
    id: `${r.sku}@${r.warehouse}`,
    inventoryValueCents: computeInventoryValueCents(r.quantity, r.unitCostCents),
    stockStatus: getStockStatus(r.quantity, r.reorderPoint),
    daysOfSupply: computeDaysOfSupply(r.quantity, r.avgDailyUsage),
    stockoutRisk: getStockoutRisk(r)
  }));
}
