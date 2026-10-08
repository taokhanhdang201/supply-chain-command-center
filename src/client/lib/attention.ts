// "Top alerts" on the Dashboard (docs/DASHBOARD-ALERTS.md). The alerts that need attention (critical and warning, the
// same count as the KPI tile and the sidebar badge) sorted into kinds, and a queue of at most five rows ranked by the money
// SCC can compute: stock short before restock, valued at unit cost, and what each carrier billed above typical. The carrier
// with the most shipments 7+ days late takes the last row. Pure functions of the snapshot: the shared alert, inventory and
// shipment logic is read, never changed.

import type { Alert, InventoryItem, Location, Shipment, Snapshot } from '../../shared/types';
import { COST_CRITICAL_MULTIPLIER, DELAY_CRITICAL_DAYS } from '../../shared/constants';
import { displayMoneySummary } from './displayMoney';
import { buildHash } from '../router';

// ---- kinds ------------------------------------------------------------------------------------------------------

export type AttentionKind = 'out_of_stock' | 'low_stock' | 'overdue' | 'unusual_cost' | 'over_capacity' | 'records';

/** The kinds in the order the Dashboard lists them. */
export const ATTENTION_KINDS: readonly AttentionKind[] = ['out_of_stock', 'low_stock', 'overdue', 'unusual_cost', 'over_capacity', 'records'];

/** [one, many]: "unusual cost" for 1, "unusual costs" for 8. */
const KIND_NOUNS: Record<AttentionKind, readonly [string, string]> = {
  out_of_stock: ['out of stock', 'out of stock'],
  low_stock: ['low stock', 'low stock'],
  overdue: ['overdue', 'overdue'],
  unusual_cost: ['unusual cost', 'unusual costs'],
  over_capacity: ['warehouse over capacity', 'warehouses over capacity'],
  records: ['incomplete or wrong record', 'incomplete or wrong records']
};

/** Short names for the Alerts page's filter. */
export const ATTENTION_KIND_LABELS: Record<AttentionKind, string> = {
  out_of_stock: 'Out of stock',
  low_stock: 'Low stock',
  overdue: 'Overdue',
  unusual_cost: 'Unusual cost',
  over_capacity: 'Over capacity',
  records: 'Incomplete or wrong record'
};

/** A few words beside a kind whose name alone reads two ways (Phase 1 spec §8). "Overdue" sits under the Dashboard's
 *  "Delayed shipments" figure, which also counts deliveries that arrived late; this kind is only the shipments past their
 *  ETA and not delivered (pending or in transit: deliveryState "overdue"). Delivered-late alerts are info and have no kind. */
export const KIND_NOTES: Readonly<Partial<Record<AttentionKind, string>>> = { overdue: 'past ETA, not delivered' };

/** The kind of an alert that needs attention; null for info alerts, which ask for no action. */
export function kindOf(alert: Alert): AttentionKind | null {
  if (alert.severity === 'info') return null;
  switch (alert.type) {
    case 'low_stock':
      return alert.severity === 'critical' ? 'out_of_stock' : 'low_stock';
    case 'shipment_delayed':
      return 'overdue';
    case 'cost_anomaly':
      return 'unusual_cost';
    case 'invalid_data':
      return alert.entity.kind === 'warehouse' ? 'over_capacity' : 'records';
    case 'missing_info':
      return 'records';
  }
}

export interface KindCount {
  kind: AttentionKind;
  count: number;
  /** Sentence case, agreeing with the count: "Out of stock", "Unusual costs" ("Unusual cost" for one). */
  label: string;
  href: string;
}

/** The kinds that have alerts needing attention, in order; their counts add up to the "need attention" total. */
export function kindCounts(alerts: readonly Alert[]): KindCount[] {
  return ATTENTION_KINDS.map((kind) => {
    const n = alerts.filter((a) => kindOf(a) === kind).length;
    const noun = KIND_NOUNS[kind][n === 1 ? 0 : 1];
    return { kind, count: n, label: noun.charAt(0).toUpperCase() + noun.slice(1), href: buildHash('alerts', { kind }) };
  }).filter((k) => k.count > 0);
}

// ---- the queue --------------------------------------------------------------------------------------------------

export const MAX_ROWS = 5;
/** Stock rows give way to other rows above this number (they fill free rows only when nothing else is left). */
export const MAX_STOCK_ROWS = 3;

export interface QueueRow {
  key: string;
  tone: 'critical' | 'warning';
  /** What and where, as the start of the sentence. */
  what: string;
  /** "$165.2K short before restock"; null when the row has no money figure of its own. */
  damage: string | null;
  action: string;
  href: string;
}

interface Candidate {
  row: QueueRow;
  cents: number;
  /** Stock only; rows without one sort after rows with one. */
  daysOfSupply: number | null;
  shipments: number;
  sortKey: string;
}

const compareKeys = (a: string, b: string): number => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' });
const count = (n: number): string => n.toLocaleString('en-US');
const plural = (n: number, one: string, many: string): string => `${count(n)} ${n === 1 ? one : many}`;

/** "Chicago DC" reads "Chicago". */
export function placeName(code: string, locations: readonly Location[]): string {
  return (locations.find((l) => l.code === code)?.name ?? code).replace(/ DC$/, '');
}

/**
 * Whole units short before a reorder placed today can arrive: daily usage × lead time − on hand, rounded up, never below
 * zero. Null without usage data. Computed in hundredths of a unit (usage has at most two decimals), so no floating-point
 * residue can round a whole number up (26.9 × 10 is 269, not 270).
 */
export function shortUnitsBeforeRestock(item: InventoryItem): number | null {
  if (item.avgDailyUsage === null) return null;
  const demandHundredths = Math.round(item.avgDailyUsage * 100) * item.leadTimeDays;
  return Math.ceil(Math.max(0, demandHundredths - item.quantity * 100) / 100);
}

/** The money on the row: the units short before restock × unit cost, in cents. Null without usage data. */
export function shortBeforeRestockCents(item: InventoryItem): number | null {
  const units = shortUnitsBeforeRestock(item);
  return units === null ? null : units * item.unitCostCents;
}

/** The most another warehouse can send and still stay above its own reorder point (so the move creates no alert). */
const canGive = (item: InventoryItem): number => Math.max(0, item.quantity - item.reorderPoint - 1);

/**
 * The action for a short item. N = the units short before restock (for an item without usage data: its reorder point −
 * on hand), so doing it ends the shortage the row prices. The source is the other warehouse holding the SKU that can give
 * the most (then the warehouse code A→Z); a source keeps more than its own reorder point after the move.
 * - it can give all of N: "Move N from X";
 * - it can give some (A < N): "Move A from X, reorder B" with A + B = N, never a "Move" that looks complete;
 * - none can give any: "Reorder N".
 * "Reorder now" when N is 0.
 */
export function stockAction(item: InventoryItem, inventory: readonly InventoryItem[], locations: readonly Location[]): string {
  const need = shortUnitsBeforeRestock(item) ?? item.reorderPoint - item.quantity;
  if (need <= 0) return 'Reorder now';
  const from = inventory
    .filter((o) => o.sku === item.sku && o.warehouse !== item.warehouse && canGive(o) > 0)
    .sort((a, b) => canGive(b) - canGive(a) || compareKeys(a.warehouse, b.warehouse))[0];
  if (from === undefined) return `Reorder ${count(need)}`;
  const place = placeName(from.warehouse, locations);
  const moved = Math.min(need, canGive(from));
  return moved === need ? `Move ${count(need)} from ${place}` : `Move ${count(moved)} from ${place}, reorder ${count(need - moved)}`;
}

function stockWhat(item: InventoryItem, place: string): string {
  if (item.stockStatus === 'out_of_stock') return `${item.productName} is out of stock in ${place}`;
  const days = Math.floor(item.daysOfSupply ?? 0);
  return `${item.productName} runs out in ${place} ${days === 0 ? 'today' : `in ${plural(days, 'day', 'days')}`}`;
}

function stockCandidates(snapshot: Snapshot): Candidate[] {
  const out: Candidate[] = [];
  for (const item of snapshot.inventory) {
    if (item.stockStatus === 'in_stock') continue;
    const cents = shortBeforeRestockCents(item);
    if (cents === null || cents <= 0) continue;
    out.push({
      cents,
      daysOfSupply: item.daysOfSupply ?? 0,
      shipments: 1,
      sortKey: item.id,
      row: {
        key: `stock:${item.id}`,
        tone: item.stockStatus === 'out_of_stock' ? 'critical' : 'warning',
        what: stockWhat(item, placeName(item.warehouse, snapshot.locations)),
        damage: `${displayMoneySummary(cents)} short before restock`,
        action: stockAction(item, snapshot.inventory, snapshot.locations),
        href: buildHash('inventory', { q: item.sku, warehouse: item.warehouse })
      }
    });
  }
  return out;
}

/** Out-of-stock items without usage data: no money figure, so they only fill free rows. Ordered by id. */
function noUsageRows(snapshot: Snapshot): QueueRow[] {
  return snapshot.inventory
    .filter((i) => i.stockStatus === 'out_of_stock' && i.avgDailyUsage === null)
    .sort((a, b) => compareKeys(a.id, b.id))
    .map((item) => ({
      key: `stock:${item.id}`,
      tone: 'critical' as const,
      what: `${item.productName} is out of stock in ${placeName(item.warehouse, snapshot.locations)}`,
      damage: 'usage unknown',
      action: stockAction(item, snapshot.inventory, snapshot.locations),
      href: buildHash('inventory', { q: item.sku, warehouse: item.warehouse })
    }));
}

function groupByCarrier(shipments: readonly Shipment[]): Map<string, Shipment[]> {
  const groups = new Map<string, Shipment[]>();
  for (const s of shipments) groups.set(s.carrier, [...(groups.get(s.carrier) ?? []), s]);
  return groups;
}

/** One row per carrier: what its unusual-cost shipments cost above typical, summed (the same shipments the alerts flag). */
function billingCandidates(snapshot: Snapshot): Candidate[] {
  const flagged = snapshot.shipments.filter((s) => s.cost.isAnomaly && s.cost.baselineCents !== null && s.cost.baselineCents > 0);
  return [...groupByCarrier(flagged)].map(([carrier, group]) => {
    const cents = group.reduce((sum, s) => sum + s.shippingCostCents - (s.cost.baselineCents as number), 0);
    const critical = group.some((s) => s.shippingCostCents >= COST_CRITICAL_MULTIPLIER * (s.cost.baselineCents as number));
    const only = group.length === 1 ? (group[0] as Shipment) : null;
    return {
      cents,
      daysOfSupply: null,
      shipments: group.length,
      sortKey: carrier,
      row: {
        key: `billing:${carrier}`,
        tone: critical ? 'critical' : 'warning',
        what: `${carrier} billed ${displayMoneySummary(cents)} above typical on ${only ? only.shipmentId : `${count(group.length)} shipments`}`,
        damage: null,
        action: only ? 'Check the invoice' : 'Check the invoices',
        href: buildHash('shipments', { carrier, flag: 'cost_anomaly' })
      }
    };
  });
}

/** The carrier with the most shipments overdue 7+ days (then the oldest, then the name A→Z), as one row. */
function lateRow(snapshot: Snapshot): QueueRow | null {
  const late = snapshot.shipments.filter((s) => s.deliveryState === 'overdue' && s.daysLate !== null && s.daysLate >= DELAY_CRITICAL_DAYS);
  const groups = [...groupByCarrier(late)].map(([carrier, group]) => {
    const days = group.map((s) => s.daysLate as number).sort((a, b) => a - b);
    return { carrier, group, min: days[0] as number, max: days[days.length - 1] as number };
  });
  const worst = groups.sort((a, b) => b.group.length - a.group.length || b.max - a.max || compareKeys(a.carrier, b.carrier))[0];
  if (worst === undefined) return null;
  const { carrier, group, min, max } = worst;
  const only = group.length === 1 ? (group[0] as Shipment) : null;
  return {
    key: `late:${carrier}`,
    tone: 'critical',
    what: only
      ? `${carrier}: ${only.shipmentId} is ${plural(max, 'day', 'days')} late`
      : `${carrier} has ${count(group.length)} shipments ${min === max ? count(max) : `${count(min)} to ${count(max)}`} days late`,
    damage: null,
    action: only ? 'Ask for a new date' : 'Ask for new dates',
    href: buildHash('shipments', { carrier, flag: 'delayed' })
  };
}

const TONE_RANK = { critical: 0, warning: 1 } as const;

/** Larger damage → critical before warning → fewer days of supply → more shipments → key A→Z (numeric-aware). */
function compareCandidates(a: Candidate, b: Candidate): number {
  if (a.cents !== b.cents) return b.cents - a.cents;
  if (a.row.tone !== b.row.tone) return TONE_RANK[a.row.tone] - TONE_RANK[b.row.tone];
  if (a.daysOfSupply !== b.daysOfSupply) {
    if (a.daysOfSupply === null) return 1;
    if (b.daysOfSupply === null) return -1;
    return a.daysOfSupply - b.daysOfSupply;
  }
  if (a.shipments !== b.shipments) return b.shipments - a.shipments;
  return compareKeys(a.sortKey, b.sortKey);
}

/**
 * The queue: money rows in money order (at most 3 stock rows while anything else is left), then out-of-stock items
 * without usage data, then the late carrier in the last row. At most five rows; empty when nothing needs action.
 */
export function buildQueue(snapshot: Snapshot): QueueRow[] {
  const stock = stockCandidates(snapshot).sort(compareCandidates);
  const late = lateRow(snapshot);
  const room = MAX_ROWS - (late === null ? 0 : 1);
  const money = [...stock.slice(0, MAX_STOCK_ROWS), ...billingCandidates(snapshot)].sort(compareCandidates).slice(0, room);
  const noUsage = noUsageRows(snapshot).slice(0, room - money.length);
  // the stock cap gives way only when nothing else is left to show
  const extra = stock.slice(MAX_STOCK_ROWS, MAX_STOCK_ROWS + room - money.length - noUsage.length);
  const moneyRows = [...money, ...extra].sort(compareCandidates).map((c) => c.row);
  return [...moneyRows, ...noUsage, ...(late === null ? [] : [late])];
}
