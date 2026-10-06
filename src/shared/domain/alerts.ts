// Alert generation (plan §4.8). Builds the full, sorted alert list from enriched inventory, shipments and
// warehouse utilization.

import type { Alert, DayString, InventoryItem, Location, Severity, Shipment, WarehouseUtilization } from '../types';
import { COST_CRITICAL_MULTIPLIER, DELAY_CRITICAL_DAYS, RECENT_LATE_WINDOW_DAYS } from '../constants';
import { addDays } from '../dates';
import { formatCents, formatDay, statusLabel } from '../format';

const SEVERITY_ORDER: readonly Severity[] = ['critical', 'warning', 'info'];
const TYPE_ORDER = ['low_stock', 'shipment_delayed', 'cost_anomaly', 'missing_info', 'invalid_data'] as const;

function warehouseName(code: string, locations: readonly Location[]): string {
  return locations.find((l) => l.code === code)?.name ?? code;
}

/** Builds every alert row for the current dataset (plan §4.8), sorted by severity, then type, then entity id. */
export function buildAlerts(
  inventory: readonly InventoryItem[],
  shipments: readonly Shipment[],
  utilization: readonly WarehouseUtilization[],
  today: DayString,
  locations: readonly Location[]
): Alert[] {
  const alerts: Alert[] = [];
  const recentLateCutoff = addDays(today, -RECENT_LATE_WINDOW_DAYS);

  for (const item of inventory) {
    const wName = warehouseName(item.warehouse, locations);
    if (item.stockStatus === 'out_of_stock') {
      alerts.push({
        id: `low_stock:inventory:${item.id}`,
        type: 'low_stock',
        severity: 'critical',
        title: `Out of stock: ${item.sku}`,
        message: `${item.productName} at ${wName} has 0 units (reorder point ${item.reorderPoint}).`,
        entity: { kind: 'inventory', id: item.id, label: `${item.sku} @ ${item.warehouse}` }
      });
    } else if (item.stockStatus === 'low_stock') {
      alerts.push({
        id: `low_stock:inventory:${item.id}`,
        type: 'low_stock',
        severity: 'warning',
        title: `Low stock: ${item.sku}`,
        message: `${item.productName} at ${wName} has ${item.quantity} units, at or below the reorder point of ${item.reorderPoint}.`,
        entity: { kind: 'inventory', id: item.id, label: `${item.sku} @ ${item.warehouse}` }
      });
    }

    if (item.avgDailyUsage === null) {
      alerts.push({
        id: `missing_info:inventory:${item.id}:usage`,
        type: 'missing_info',
        severity: 'info',
        title: `Missing usage data: ${item.sku}`,
        message: `${item.productName} at ${wName} has no average daily usage; stockout risk and turnover exclude it.`,
        entity: { kind: 'inventory', id: item.id, label: `${item.sku} @ ${item.warehouse}` }
      });
    }
  }

  for (const s of shipments) {
    if (s.deliveryState === 'overdue' && s.daysLate !== null) {
      alerts.push({
        id: `shipment_delayed:shipment:${s.shipmentId}`,
        type: 'shipment_delayed',
        severity: s.daysLate >= DELAY_CRITICAL_DAYS ? 'critical' : 'warning',
        title: `Shipment overdue: ${s.shipmentId}`,
        message: `${s.routeLabel} via ${s.carrier} was due ${formatDay(s.estimatedDelivery)} and is ${s.daysLate} day(s) late.`,
        entity: { kind: 'shipment', id: s.shipmentId, label: s.shipmentId }
      });
    } else if (s.deliveryState === 'late' && s.daysLate !== null && s.actualDelivery !== null && s.actualDelivery >= recentLateCutoff) {
      alerts.push({
        id: `shipment_delayed:shipment:${s.shipmentId}`,
        type: 'shipment_delayed',
        severity: 'info',
        title: `Delivered late: ${s.shipmentId}`,
        message: `${s.routeLabel} via ${s.carrier} arrived ${s.daysLate} day(s) after the estimated ${formatDay(s.estimatedDelivery)}.`,
        entity: { kind: 'shipment', id: s.shipmentId, label: s.shipmentId }
      });
    }

    if (s.cost.isAnomaly && s.cost.baselineCents !== null && s.cost.baselineCents > 0) {
      const ratio = s.shippingCostCents / s.cost.baselineCents;
      alerts.push({
        id: `cost_anomaly:shipment:${s.shipmentId}`,
        type: 'cost_anomaly',
        severity: s.shippingCostCents >= COST_CRITICAL_MULTIPLIER * s.cost.baselineCents ? 'critical' : 'warning',
        title: `Unusual shipping cost: ${s.shipmentId}`,
        message: `${formatCents(s.shippingCostCents)} is ${ratio.toFixed(1)}× the typical ${formatCents(s.cost.baselineCents)} for ${
          s.cost.method === 'route_carrier'
            ? 'this route with this carrier'
            : s.cost.method === 'route'
              ? 'this route'
              : 'a shipment of this distance'
        }.`,
        entity: { kind: 'shipment', id: s.shipmentId, label: s.shipmentId }
      });
    }

    if (s.missingDates.includes('estimated_delivery')) {
      alerts.push({
        id: `missing_info:shipment:${s.shipmentId}:eta`,
        type: 'missing_info',
        severity: 'warning',
        title: `Missing estimated delivery: ${s.shipmentId}`,
        message: `${s.routeLabel} (${statusLabel(s.status).toLowerCase()}) has no estimated delivery date, so delays cannot be detected.`,
        entity: { kind: 'shipment', id: s.shipmentId, label: s.shipmentId }
      });
    }
    if (s.missingDates.includes('actual_delivery')) {
      alerts.push({
        id: `missing_info:shipment:${s.shipmentId}:actual`,
        type: 'missing_info',
        severity: 'warning',
        title: `Missing delivery date: ${s.shipmentId}`,
        message: `${s.routeLabel} is marked delivered but has no actual delivery date.`,
        entity: { kind: 'shipment', id: s.shipmentId, label: s.shipmentId }
      });
    }

    for (const issue of s.issues) {
      alerts.push({
        id: `invalid_data:shipment:${s.shipmentId}:${issue.code}`,
        type: 'invalid_data',
        severity: 'warning',
        title: `Data issue: ${s.shipmentId}`,
        message: issue.message,
        entity: { kind: 'shipment', id: s.shipmentId, label: s.shipmentId }
      });
    }
  }

  for (const w of utilization) {
    if (w.utilization !== null && w.utilization > 1) {
      alerts.push({
        id: `invalid_data:warehouse:${w.code}`,
        type: 'invalid_data',
        severity: 'warning',
        title: `Over capacity: ${w.name}`,
        message: `${w.units} units stored vs capacity ${w.capacityUnits} (${(w.utilization * 100).toFixed(1)}%).`,
        entity: { kind: 'warehouse', id: w.code, label: w.name }
      });
    }
  }

  return alerts.sort((a, b) => {
    const severityDiff = SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity);
    if (severityDiff !== 0) return severityDiff;
    const typeDiff = TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type);
    if (typeDiff !== 0) return typeDiff;
    return a.entity.id.localeCompare(b.entity.id, 'en', { numeric: true, sensitivity: 'base' });
  });
}
