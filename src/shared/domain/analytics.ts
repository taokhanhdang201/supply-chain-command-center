// Client-side analytics series derived from enriched shipments/inventory (plan §4.9). Pure, deterministic,
// framework-free so the same code drives both server-computed defaults and any client-side re-aggregation.

import type { Location, Shipment, InventoryItem } from '../types';
import { addDays, monthKey, monthRange } from '../dates';

export type DateRange = 'all' | '30d' | '90d' | '180d' | '365d';

const RANGE_DAYS: Record<Exclude<DateRange, 'all'>, number> = { '30d': 30, '90d': 90, '180d': 180, '365d': 365 };

/** Keeps shipments with shipDate within the last N days of `today` (future-dated pending shipments are kept). */
export function filterShipmentsByRange(shipments: readonly Shipment[], range: DateRange, today: string): Shipment[] {
  if (range === 'all') return [...shipments];
  const cutoff = addDays(today, -RANGE_DAYS[range]);
  return shipments.filter((s) => s.shipDate >= cutoff);
}

export interface InventoryValueGroup {
  key: string;
  label: string;
  valueCents: number;
  units: number;
  recordCount: number;
}

/** Groups inventory value by warehouse or category, sorted by value desc then key asc. */
export function groupInventoryValue(
  items: readonly InventoryItem[],
  by: 'warehouse' | 'category',
  locations: readonly Location[]
): InventoryValueGroup[] {
  const groups = new Map<string, InventoryValueGroup>();
  for (const item of items) {
    const key = by === 'warehouse' ? item.warehouse : item.category;
    const label = by === 'warehouse' ? locations.find((l) => l.code === key)?.name ?? key : key;
    const existing = groups.get(key);
    if (existing) {
      existing.valueCents += item.inventoryValueCents;
      existing.units += item.quantity;
      existing.recordCount += 1;
    } else {
      groups.set(key, { key, label, valueCents: item.inventoryValueCents, units: item.quantity, recordCount: 1 });
    }
  }
  return [...groups.values()].sort((a, b) => b.valueCents - a.valueCents || a.key.localeCompare(b.key));
}

const STATUS_ORDER = ['pending', 'in_transit', 'delivered', 'cancelled'] as const;

/** Shipment counts by status, in a fixed order, zero counts included. */
export function countShipmentsByStatus(shipments: readonly Shipment[]): Array<{ status: string; count: number }> {
  return STATUS_ORDER.map((status) => ({ status, count: shipments.filter((s) => s.status === status).length }));
}

export interface MonthlyCost {
  month: string;
  totalCents: number;
  count: number;
}

/** Total non-cancelled shipping cost by month of ship date, for months up to and including `today`'s month.
 * Contiguous from min to max month (gaps filled with 0). Future-dated (e.g. scheduled pending) shipments are
 * excluded so the series never shows a partial/misleading trailing month of only-scheduled cost. */
export function shippingCostByMonth(shipments: readonly Shipment[], today: string): MonthlyCost[] {
  const eligible = shipments.filter((s) => s.status !== 'cancelled' && s.shipDate <= today);
  if (eligible.length === 0) return [];
  const byMonth = new Map<string, MonthlyCost>();
  for (const s of eligible) {
    const key = monthKey(s.shipDate);
    const existing = byMonth.get(key);
    if (existing) {
      existing.totalCents += s.shippingCostCents;
      existing.count += 1;
    } else {
      byMonth.set(key, { month: key, totalCents: s.shippingCostCents, count: 1 });
    }
  }
  const months = eligible.map((s) => monthKey(s.shipDate)).sort();
  const range = monthRange(months[0] as string, months[months.length - 1] as string);
  return range.map((month) => byMonth.get(month) ?? { month, totalCents: 0, count: 0 });
}

export interface MonthlyOnTime {
  month: string;
  onTime: number;
  delayed: number;
}

/** On-time vs delayed counts by month of estimated delivery, contiguous (delayed = late + overdue). */
export function onTimeVsDelayedByMonth(shipments: readonly Shipment[]): MonthlyOnTime[] {
  const eligible = shipments.filter(
    (s) => (s.deliveryState === 'on_time' || s.deliveryState === 'late' || s.deliveryState === 'overdue') && s.estimatedDelivery !== null
  );
  if (eligible.length === 0) return [];
  const byMonth = new Map<string, MonthlyOnTime>();
  for (const s of eligible) {
    const key = monthKey(s.estimatedDelivery as string);
    const existing = byMonth.get(key) ?? { month: key, onTime: 0, delayed: 0 };
    if (s.deliveryState === 'on_time') existing.onTime += 1;
    else existing.delayed += 1;
    byMonth.set(key, existing);
  }
  const months = eligible.map((s) => monthKey(s.estimatedDelivery as string)).sort();
  const range = monthRange(months[0] as string, months[months.length - 1] as string);
  return range.map((month) => byMonth.get(month) ?? { month, onTime: 0, delayed: 0 });
}

export interface RouteSummary {
  routeKey: string;
  label: string;
  originCode: string | null;
  destinationCode: string | null;
  originName: string;
  destinationName: string;
  count: number;
  totalCostCents: number;
  avgCostCents: number;
  delayedCount: number;
  delayedShare: number;
  carriers: Array<{ carrier: string; count: number }>;
  mapped: boolean;
}

/** Compact route text for chart axes, e.g. "DFW → BNA": location codes (warehouse "WH-" prefix dropped), falling back
 * to the full name for an unmapped end. The full `label` stays the source for tooltips, aria and tables. */
export function routeShortLabel(r: Pick<RouteSummary, 'originCode' | 'destinationCode' | 'originName' | 'destinationName'>): string {
  const short = (code: string | null, name: string) => (code === null ? name : code.replace(/^WH-/, ''));
  return `${short(r.originCode, r.originName)} → ${short(r.destinationCode, r.destinationName)}`;
}

/** Per-route summary (non-cancelled shipments only), sorted by count desc then routeKey asc. */
export function summarizeRoutes(shipments: readonly Shipment[], locations: readonly Location[]): RouteSummary[] {
  const eligible = shipments.filter((s) => s.status !== 'cancelled');
  const groups = new Map<string, Shipment[]>();
  for (const s of eligible) {
    const arr = groups.get(s.routeKey) ?? [];
    arr.push(s);
    groups.set(s.routeKey, arr);
  }

  const summaries: RouteSummary[] = [];
  for (const [routeKey, group] of groups) {
    const first = group[0] as Shipment;
    const totalCostCents = group.reduce((sum, s) => sum + s.shippingCostCents, 0);
    const delayedCount = group.filter((s) => s.isDelayed).length;
    const carrierCounts = new Map<string, number>();
    for (const s of group) {
      carrierCounts.set(s.carrier, (carrierCounts.get(s.carrier) ?? 0) + 1);
    }
    const carriers = [...carrierCounts.entries()]
      .map(([carrier, count]) => ({ carrier, count }))
      .sort((a, b) => b.count - a.count || a.carrier.localeCompare(b.carrier));

    const originLoc = first.originCode ? locations.find((l) => l.code === first.originCode) : undefined;
    const destinationLoc = first.destinationCode ? locations.find((l) => l.code === first.destinationCode) : undefined;

    summaries.push({
      routeKey,
      label: first.routeLabel,
      originCode: first.originCode,
      destinationCode: first.destinationCode,
      originName: originLoc?.name ?? first.origin,
      destinationName: destinationLoc?.name ?? first.destination,
      count: group.length,
      totalCostCents,
      avgCostCents: Math.round(totalCostCents / group.length),
      delayedCount,
      delayedShare: delayedCount / group.length,
      carriers,
      mapped: first.originCode !== null && first.destinationCode !== null
    });
  }

  return summaries.sort((a, b) => b.count - a.count || a.routeKey.localeCompare(b.routeKey));
}

/** `summarizeRoutes` re-sorted by count or total cost desc (tie-break routeKey asc), limited to `limit` entries. */
export function topRoutes(
  shipments: readonly Shipment[],
  locations: readonly Location[],
  limit: number,
  sortBy: 'count' | 'cost'
): RouteSummary[] {
  const summaries = summarizeRoutes(shipments, locations);
  const sorted = [...summaries].sort((a, b) => {
    const diff = sortBy === 'count' ? b.count - a.count : b.totalCostCents - a.totalCostCents;
    if (diff !== 0) return diff;
    return a.routeKey.localeCompare(b.routeKey);
  });
  return sorted.slice(0, limit);
}

/** The most recent shipment activity that has actually happened as of `today` (desc by activity date, ties by
 * shipmentId asc). Delivered shipments use `actualDelivery`; in-transit and cancelled shipments use `shipDate`;
 * pending shipments only count once their (possibly future-scheduled) `shipDate` has arrived. Any event whose
 * date is still in the future relative to `today` is excluded, so scheduled-but-not-yet-shipped pending
 * shipments never appear here. */
export function recentActivity(shipments: readonly Shipment[], today: string, limit = 10): Shipment[] {
  function activityDate(s: Shipment): string | null {
    if (s.status === 'delivered') return s.actualDelivery;
    if (s.status === 'pending') return s.shipDate;
    return s.shipDate;
  }
  const withDate: Array<{ shipment: Shipment; date: string }> = [];
  for (const s of shipments) {
    const date = activityDate(s);
    if (date !== null && date <= today) withDate.push({ shipment: s, date });
  }
  return withDate
    .sort((a, b) => {
      const dateDiff = b.date.localeCompare(a.date);
      if (dateDiff !== 0) return dateDiff;
      return a.shipment.shipmentId.localeCompare(b.shipment.shipmentId);
    })
    .slice(0, limit)
    .map((x) => x.shipment);
}
