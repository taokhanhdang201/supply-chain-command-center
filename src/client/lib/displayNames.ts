// One name for each thing on screen (DESIGN.md "Display names"). A warehouse reads its full name in a list or a table from
// 768px ("Dallas-Fort Worth DC") and its short code on a chart axis and at phone width ("DFW", with the full name as its
// title), never "WH-DFW". A route reads "ATL → BOS" everywhere; its full label stays in the tooltip and the accessible name.
// The KPIs keep one name on every page. Only the words change: the snapshot's codes and labels stay as they are.

import { routeShortLabel, type RouteSummary } from '../../shared/domain/analytics';

/** "WH-DFW" → "DFW". A code without the "WH-" prefix, or one SCC does not know, is returned as it is. */
export function warehouseShortName(code: string): string {
  return code.replace(/^WH-/, '');
}

/** A route's short form for axes and lists ("ATL → BOS"; an unmapped end keeps its place name) and its full label. */
export function routeDisplay(r: Pick<RouteSummary, 'label' | 'originCode' | 'destinationCode' | 'originName' | 'destinationName'>): { short: string; full: string } {
  return { short: routeShortLabel(r), full: r.label };
}

/** The names of the KPIs, the same on the band, in the charts and in "How these are calculated". */
export const KPI_LABELS = {
  onTimeRate: 'On-time rate',
  shippingCost: 'Shipping cost',
  avgDeliveryTime: 'Avg delivery time',
  shipments: 'Shipments',
  inventoryTurnover: 'Inventory turnover',
  daysInventoryOutstanding: 'Days inventory outstanding (DIO)'
} as const;
