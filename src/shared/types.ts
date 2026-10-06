// Core domain types shared by server and client. All money is integer cents (field suffix `Cents`).
// All calendar dates are `DayString` = 'YYYY-MM-DD'. Ratios are 0..1 numbers. `null` means "not available".

export type DayString = string; // validated 'YYYY-MM-DD'

export type ShipmentStatus = 'pending' | 'in_transit' | 'delivered' | 'cancelled';
export const SHIPMENT_STATUSES: readonly ShipmentStatus[] = ['pending', 'in_transit', 'delivered', 'cancelled'];

export type StockStatus = 'in_stock' | 'low_stock' | 'out_of_stock';
export type StockoutRisk = 'high' | 'medium' | 'low' | 'unknown';
export type DeliveryState = 'on_time' | 'late' | 'overdue' | 'in_progress' | 'cancelled' | 'unknown';
export type Severity = 'critical' | 'warning' | 'info';
export type AlertType = 'low_stock' | 'shipment_delayed' | 'cost_anomaly' | 'invalid_data' | 'missing_info';
export type ImportKind = 'inventory' | 'shipments';

export interface Location {
  code: string; // 'WH-DFW', 'HOU'
  name: string; // 'Dallas-Fort Worth DC', 'Houston, TX'
  kind: 'warehouse' | 'city';
  lat: number;
  lon: number;
  capacityUnits: number | null; // warehouses only; cities null
}

export interface InventoryRecord {
  // exactly what a CSV row becomes
  sku: string; // uppercase, /^[A-Z0-9][A-Z0-9-]{2,31}$/
  productName: string; // 1..120 chars
  category: string; // 1..60 chars
  warehouse: string; // a warehouse Location.code (uppercase)
  quantity: number; // integer 0..10_000_000
  reorderPoint: number; // integer 0..10_000_000
  unitCostCents: number; // integer 0..100_000_000
  avgDailyUsage: number | null; // units/day, 0..1_000_000, ≤2 decimals; null = unknown
  leadTimeDays: number; // integer 1..365, default 14
}

export interface InventoryItem extends InventoryRecord {
  id: string; // `${sku}@${warehouse}`
  inventoryValueCents: number;
  stockStatus: StockStatus;
  daysOfSupply: number | null;
  stockoutRisk: StockoutRisk;
}

export interface ShipmentRecord {
  shipmentId: string; // uppercase, /^[A-Z0-9][A-Z0-9-]{2,31}$/
  origin: string; // 1..64 chars, as given (trimmed, inner whitespace collapsed)
  destination: string; // 1..64 chars
  carrier: string; // 1..60 chars
  status: ShipmentStatus;
  shipDate: DayString;
  estimatedDelivery: DayString | null;
  actualDelivery: DayString | null;
  shippingCostCents: number; // integer 0..100_000_000
}

export type DataIssueCode =
  | 'ACTUAL_BEFORE_SHIP'
  | 'ETA_BEFORE_SHIP'
  | 'OPEN_WITH_ACTUAL'
  | 'SAME_ORIGIN_DESTINATION'
  | 'ZERO_COST'
  | 'SHIP_DATE_IN_FUTURE'
  | 'ACTUAL_IN_FUTURE';

export interface DataIssue {
  code: DataIssueCode;
  message: string;
}

export interface CostAssessment {
  method: 'route_carrier' | 'route' | 'per_mile' | 'none';
  peerCount: number; // size of the peer group used (0 when 'none')
  baselineCents: number | null; // route median, or per-mile median × distance (rounded)
  score: number | null; // robust z-score, null when method 'none'
  isAnomaly: boolean;
}

export interface Shipment extends ShipmentRecord {
  originCode: string | null; // resolved Location.code or null (unmapped)
  destinationCode: string | null;
  routeKey: string; // `${originKey}>${destinationKey}`
  routeLabel: string; // `${originName} → ${destinationName}`
  distanceMiles: number | null; // great-circle, both endpoints mapped, rounded to 1 decimal
  deliveryState: DeliveryState;
  isDelayed: boolean; // deliveryState === 'late' || 'overdue'
  daysLate: number | null;
  transitDays: number | null;
  missingDates: Array<'estimated_delivery' | 'actual_delivery'>;
  cost: CostAssessment;
  issues: DataIssue[];
}

export interface Alert {
  id: string; // deterministic, see plan §4.8
  type: AlertType;
  severity: Severity;
  title: string;
  message: string;
  entity: { kind: 'inventory' | 'shipment' | 'warehouse'; id: string; label: string };
}

export type ImportIssueCode =
  | 'EMPTY_FILE'
  | 'FILE_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'INVALID_ENCODING'
  | 'MALFORMED_CSV'
  | 'MISSING_COLUMNS'
  | 'DUPLICATE_COLUMNS'
  | 'INVALID_MAPPING'
  | 'TOO_MANY_ROWS'
  | 'TOO_MANY_COLUMNS'
  | 'NO_DATA_ROWS'
  | 'FIELD_COUNT'
  | 'REQUIRED'
  | 'INVALID_NUMBER'
  | 'NOT_INTEGER'
  | 'NEGATIVE'
  | 'OUT_OF_RANGE'
  | 'TOO_MANY_DECIMALS'
  | 'INVALID_DATE'
  | 'INVALID_FORMAT'
  | 'UNKNOWN_WAREHOUSE'
  | 'INVALID_STATUS'
  | 'DUPLICATE_ID'
  | 'TOO_LONG'
  | 'CONTROL_CHARS';

export interface ImportIssue {
  line: number | null;
  column: string | null;
  code: ImportIssueCode;
  message: string;
}

export interface KpiSummary {
  totalInventoryValueCents: number;
  inventoryRecordCount: number;
  totalUnits: number;
  totalShipments: number;
  activeShipments: number;
  deliveredShipments: number;
  cancelledShipments: number;
  onTimeRate: number | null;
  onTimeCount: number;
  lateCount: number;
  overdueCount: number;
  delayedShipments: number; // lateCount + overdueCount
  lowStockCount: number; // low_stock + out_of_stock records
  outOfStockCount: number;
  totalShippingCostCents: number; // excludes cancelled
  averageShippingCostCents: number | null;
  averageDeliveryDays: number | null;
}

export interface WarehouseUtilization {
  code: string;
  name: string;
  units: number;
  capacityUnits: number;
  utilization: number | null; // units / capacityUnits (may exceed 1); null when capacityUnits is 0 (unknown)
  valueCents: number;
  recordCount: number;
}

export interface SupplyChainMetrics {
  inventoryTurnover: number | null;
  daysInventoryOutstanding: number | null;
  turnoverCoverage: { itemsWithUsage: number; totalItems: number };
  averageShippingCostCents: number | null;
  averageDeliveryDays: number | null;
  onTimeRate: number | null;
  warehouseUtilization: WarehouseUtilization[];
  stockoutRiskCounts: Record<StockoutRisk, number>;
}

export interface DataSourceInfo {
  kind: 'sample' | 'import';
  label: string;
  loadedAt: string;
  rowCount: number;
}

export interface Snapshot {
  today: DayString;
  generatedAt: string; // ISO timestamp
  inventory: InventoryItem[];
  shipments: Shipment[];
  alerts: Alert[];
  kpis: KpiSummary;
  metrics: SupplyChainMetrics;
  locations: Location[];
  dataSources: { inventory: DataSourceInfo; shipments: DataSourceInfo };
  limits: { maxUploadBytes: number; maxRows: number };
}

export interface Dataset {
  inventory: InventoryRecord[];
  shipments: ShipmentRecord[];
  sources: { inventory: DataSourceInfo; shipments: DataSourceInfo };
}
