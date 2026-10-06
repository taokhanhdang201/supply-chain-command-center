// Single text source for the Analytics page's "How these are calculated" section (plan §4.7). Every metric row
// mirrors the formula implemented in `domain/metrics.ts`, `domain/shipments.ts` and `domain/costAnomaly.ts`.

export interface MetricDefinition {
  id: string;
  name: string;
  formula: string;
  notes: string;
}

export const METRIC_DEFINITIONS: ReadonlyArray<MetricDefinition> = [
  {
    id: 'total_inventory_value',
    name: 'Total inventory value',
    formula: 'Σ quantity × unit cost',
    notes: 'Sum across all inventory records.'
  },
  {
    id: 'total_shipments',
    name: 'Total shipments',
    formula: 'count of all shipment records',
    notes: 'Subtitle breaks out active (pending + in transit) and cancelled counts.'
  },
  {
    id: 'on_time_rate',
    name: 'On-time delivery rate',
    formula: 'onTime / (onTime + late)',
    notes: 'Only delivered shipments with a known on_time/late state; null when the denominator is 0.'
  },
  {
    id: 'delayed_shipments',
    name: 'Delayed shipments',
    formula: 'late + overdue',
    notes: 'Overdue means an open shipment past its estimated delivery date, compared against today.'
  },
  {
    id: 'low_stock_items',
    name: 'Low-stock items',
    formula: 'count(stockStatus ∈ {low_stock, out_of_stock})',
    notes: 'Counted per SKU@warehouse record.'
  },
  {
    id: 'total_shipping_cost',
    name: 'Total shipping cost',
    formula: 'Σ shippingCost where status ≠ cancelled',
    notes: 'Cancelled shipments are excluded from every cost total.'
  },
  {
    id: 'average_shipping_cost',
    name: 'Average shipping cost',
    formula: 'total shipping cost / count(status ≠ cancelled)',
    notes: 'Rounded to the nearest cent; null when there are 0 non-cancelled shipments.'
  },
  {
    id: 'average_delivery_time',
    name: 'Average delivery time',
    formula: 'mean(actual − shipDate) in days',
    notes: 'Averaged over shipments with a non-null transit time; null when there are none.'
  },
  {
    id: 'inventory_turnover',
    name: 'Inventory turnover (annualized, estimated)',
    formula: 'Σ(avgDailyUsage × 365 × unitCost) / Σ(inventory value)',
    notes:
      'Honest assumptions: COGS is estimated from recorded usage at current unit cost, and the current snapshot ' +
      'value is used as a proxy for average inventory since no history is stored. Only items with usage data ' +
      'count toward the numerator, but the denominator is the *whole* inventory\'s value — so when usage-data ' +
      'coverage is below 100%, this number reads lower than a "usage-covered items only" turnover would. The ' +
      'coverage shows how many items that is out of the total, so the caveat is never hidden.'
  },
  {
    id: 'days_inventory_outstanding',
    name: 'Days inventory outstanding',
    formula: '365 / turnover',
    notes: 'Null when turnover is null or 0.'
  },
  {
    id: 'warehouse_utilization',
    name: 'Warehouse utilization',
    formula: 'Σ quantity in warehouse / warehouse capacity',
    notes: 'Capacity comes from the reference location list; utilization may exceed 100%.'
  },
  {
    id: 'stockout_risk',
    name: 'Stockout risk',
    formula: 'high / medium / low / unknown, from days of supply vs. lead time',
    notes:
      'Evaluated in this order: quantity = 0 is always high (regardless of usage); unknown usage is unknown; ' +
      'usage = 0 while in stock is low; otherwise, days of supply (quantity / avgDailyUsage) below lead time is ' +
      'high, within a 7-day safety buffer of lead time is medium, else low. Counts per risk class across all ' +
      'inventory records.'
  },
  {
    id: 'cost_anomaly_score',
    name: 'Cost anomaly score',
    formula:
      'flagged when modified z-score (median, MAD) > 3.5 AND cost ≥ 1.5 × peer median (route+carrier, route, or per-mile peers)',
    notes:
      'Upper-tail only: only abnormally expensive shipments are flagged. Both conditions must hold: a high ' +
      'z-score alone is not enough, because a very tight peer group makes even a few percent of excess look ' +
      'statistically extreme, so a shipment must also cost at least 1.5× its peer baseline. Peer group is ' +
      'route+carrier when that has enough shipments (different carriers can legitimately charge quite ' +
      'different rates on the same route, so mixing them can flag a shipment for nothing more than using a ' +
      'pricier carrier); falls back to route alone, then to a per-mile peer group, when each is too small in ' +
      'turn; and to a mean-absolute-deviation score when MAD is 0.'
  },
  {
    id: 'delay_detection',
    name: 'Delay detection',
    formula: "late: delivered after ETA. overdue: still open and past ETA vs. today.",
    notes: 'Comparisons are at whole-day granularity; delivered exactly on the ETA day counts as on time.'
  },
  {
    id: 'time_series_scope',
    name: 'Time-series charts & recent activity',
    formula: 'shipDate (or actualDelivery for delivered) ≤ today',
    notes:
      'Future-dated shipments (e.g. scheduled pending shipments) never appear in "Shipping cost over time" or ' +
      '"Recent shipment activity" — both only ever show activity that has actually happened as of today. The ' +
      'current month is never a full month of data, so it is labeled "(MTD)" ("Sep*" on a chart axis, with a note under the chart).'
  }
];
