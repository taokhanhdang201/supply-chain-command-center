// Declarative column specs used both to drive CSV import validation and to render the Import page's column
// reference tables.

export interface ColumnSpec {
  name: string;
  requiredColumn: boolean;
  requiredValue: boolean;
  format: string;
  example: string;
}

export const INVENTORY_COLUMNS: readonly ColumnSpec[] = [
  { name: 'sku', requiredColumn: true, requiredValue: true, format: 'letters, digits or hyphens (3-32 chars)', example: 'ELC-9001' },
  { name: 'product_name', requiredColumn: true, requiredValue: true, format: 'text, up to 120 characters', example: 'Wireless Barcode Scanner' },
  { name: 'category', requiredColumn: true, requiredValue: true, format: 'text, up to 60 characters', example: 'Electronics' },
  { name: 'warehouse', requiredColumn: true, requiredValue: true, format: 'a known warehouse code', example: 'WH-DFW' },
  { name: 'quantity', requiredColumn: true, requiredValue: true, format: 'whole number, 0-10,000,000', example: '120' },
  { name: 'reorder_point', requiredColumn: true, requiredValue: true, format: 'whole number, 0-10,000,000', example: '40' },
  { name: 'unit_cost', requiredColumn: true, requiredValue: true, format: 'decimal dollars, 0-1,000,000.00', example: '89.50' },
  { name: 'avg_daily_usage', requiredColumn: false, requiredValue: false, format: 'decimal, 0-1,000,000, up to 2 decimals (optional)', example: '6.5' },
  { name: 'lead_time_days', requiredColumn: false, requiredValue: false, format: 'whole number, 1-365 (optional, default 14)', example: '14' }
];

export const SHIPMENT_COLUMNS: readonly ColumnSpec[] = [
  { name: 'shipment_id', requiredColumn: true, requiredValue: true, format: 'letters, digits or hyphens (3-32 chars)', example: 'SHP-900001' },
  { name: 'origin', requiredColumn: true, requiredValue: true, format: 'text, up to 64 characters', example: 'WH-DFW' },
  { name: 'destination', requiredColumn: true, requiredValue: true, format: 'text, up to 64 characters', example: 'HOU' },
  { name: 'carrier', requiredColumn: true, requiredValue: true, format: 'text, up to 60 characters', example: 'Northstar Freight' },
  { name: 'status', requiredColumn: true, requiredValue: true, format: 'pending, in_transit, delivered or cancelled', example: 'delivered' },
  { name: 'ship_date', requiredColumn: true, requiredValue: true, format: 'date, YYYY-MM-DD', example: '2026-03-02' },
  { name: 'estimated_delivery', requiredColumn: true, requiredValue: false, format: 'date, YYYY-MM-DD (optional)', example: '2026-03-05' },
  { name: 'actual_delivery', requiredColumn: true, requiredValue: false, format: 'date, YYYY-MM-DD (optional)', example: '2026-03-04' },
  { name: 'shipping_cost', requiredColumn: true, requiredValue: true, format: 'decimal dollars, 0-1,000,000.00', example: '812.40' }
];
