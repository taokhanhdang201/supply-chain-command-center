// Deterministic sample data generator (plan §7). Produces 360 inventory records and 480 shipment records, plus
// a manifest of intentionally injected anomalies used by tests to assert the sample data exercises every rule.
// Determinism rule: every random draw for a record happens in a fixed order, unconditionally, before branching,
// so the PRNG sequence — and therefore quantities, costs, carriers — never depends on `today`. Only dates shift.

import type { DayString, InventoryRecord, ShipmentRecord, ShipmentStatus, Dataset } from '../types';
import { addDays } from '../dates';
import { haversineMiles } from '../geo';
import { LANES, WAREHOUSES, CARRIERS, LOCATIONS } from '../reference/locations';
import { createPrng, randFloat, randInt, pick, shuffle, type Rng } from './prng';

export interface SampleAnomalyManifest {
  outOfStock: string[];
  lowStock: string[];
  missingUsage: string[];
  misconfiguredReorder: string[]; // inventory ids SKU@WH
  overdue: string[];
  costAnomaly: string[];
  missingActual: string[];
  missingEta: string[];
  actualBeforeShip: string[];
  openWithActual: string[];
  zeroCost: string[];
  sameOriginDestination: string[];
  unmapped: string[]; // shipment ids
}

interface CategorySpec {
  prefix: string;
  name: string;
  minCost: number;
  maxCost: number;
  nouns: readonly string[];
}

const ADJECTIVES: readonly string[] = [
  'Premium',
  'Compact',
  'Heavy-Duty',
  'Industrial',
  'Deluxe',
  'Standard',
  'Advanced',
  'Rugged',
  'Lightweight',
  'Professional',
  'Classic',
  'Enhanced'
];

const CATEGORIES: readonly CategorySpec[] = [
  {
    prefix: 'ELC',
    name: 'Electronics',
    minCost: 25,
    maxCost: 900,
    nouns: [
      'Barcode Scanner',
      'Wireless Router',
      'USB Hub',
      'Bluetooth Speaker',
      'LED Monitor',
      'Power Bank',
      'Tablet Stand',
      'Webcam',
      'Label Printer',
      'Handheld Scanner',
      'Network Switch',
      'Surge Protector',
      'Cable Organizer',
      'Docking Station',
      'Wireless Charger'
    ]
  },
  {
    prefix: 'IND',
    name: 'Industrial Parts',
    minCost: 4,
    maxCost: 250,
    nouns: [
      'Ball Bearing',
      'Steel Bracket',
      'Hydraulic Valve',
      'Conveyor Belt',
      'Gear Assembly',
      'Motor Coupling',
      'Pressure Gauge',
      'Pneumatic Cylinder',
      'Chain Sprocket',
      'Bearing Housing',
      'Drive Shaft',
      'Filter Cartridge',
      'Safety Valve',
      'Hex Bolt Set',
      'Pipe Fitting'
    ]
  },
  {
    prefix: 'PKG',
    name: 'Packaging',
    minCost: 0.5,
    maxCost: 30,
    nouns: [
      'Corrugated Box',
      'Bubble Wrap Roll',
      'Packing Tape',
      'Stretch Film',
      'Foam Insert',
      'Shipping Label',
      'Poly Mailer',
      'Void Fill Pillow',
      'Carton Sealer',
      'Pallet Wrap',
      'Strapping Band',
      'Kraft Paper Roll',
      'Padded Envelope',
      'Crate Liner',
      'Moisture Barrier Bag'
    ]
  },
  {
    prefix: 'APP',
    name: 'Apparel',
    minCost: 8,
    maxCost: 120,
    nouns: [
      'Cotton T-Shirt',
      'Work Gloves',
      'Safety Vest',
      'Fleece Jacket',
      'Denim Jeans',
      'Rain Poncho',
      'Wool Socks',
      'Baseball Cap',
      'Thermal Base Layer',
      'Canvas Apron',
      'Utility Belt',
      'Reflective Vest',
      'Work Boots',
      'Knit Beanie',
      'Polo Shirt'
    ]
  },
  {
    prefix: 'HOM',
    name: 'Home Goods',
    minCost: 10,
    maxCost: 300,
    nouns: [
      'Ceramic Mug',
      'Storage Bin',
      'Throw Blanket',
      'Kitchen Utensil Set',
      'Area Rug',
      'Table Lamp',
      'Wall Clock',
      'Cutting Board',
      'Picture Frame',
      'Laundry Basket',
      'Bath Towel Set',
      'Candle Holder',
      'Curtain Panel',
      'Door Mat',
      'Spice Rack'
    ]
  },
  {
    prefix: 'HLB',
    name: 'Health & Beauty',
    minCost: 3,
    maxCost: 60,
    nouns: [
      'Hand Sanitizer',
      'Face Mask Pack',
      'Moisturizing Lotion',
      'Shampoo Bottle',
      'First Aid Kit',
      'Vitamin Supplement',
      'Sunscreen Tube',
      'Toothbrush Pack',
      'Antiseptic Wipes',
      'Lip Balm',
      'Hair Brush',
      'Nail Care Kit',
      'Body Wash',
      'Deodorant Stick',
      'Cotton Swabs Pack'
    ]
  }
];

const LEAD_TIME_CHOICES = [7, 10, 14, 21] as const;

function generateBaseInventory(rng: Rng): InventoryRecord[] {
  const records: InventoryRecord[] = [];

  for (let categoryIndex = 0; categoryIndex < CATEGORIES.length; categoryIndex += 1) {
    const category = CATEGORIES[categoryIndex] as CategorySpec;
    for (let j = 0; j < 15; j += 1) {
      const p = categoryIndex * 15 + j;
      const sku = `${category.prefix}-${String(j + 1).padStart(4, '0')}`;
      const adjective = pick(rng, ADJECTIVES);
      const productName = `${adjective} ${category.nouns[j]}`;
      const unitCostCents = Math.round(randFloat(rng, category.minCost, category.maxCost) * 100);
      const excludedWarehouse = WAREHOUSES[p % 5]?.code;

      for (const warehouse of WAREHOUSES) {
        if (warehouse.code === excludedWarehouse) continue;
        const avgDailyUsage = Math.round(randFloat(rng, 2, 40) * 10) / 10;
        const leadTimeDays = pick(rng, LEAD_TIME_CHOICES);
        const reorderPoint = Math.ceil(avgDailyUsage * leadTimeDays);
        const quantity = Math.round(reorderPoint * randFloat(rng, 1.3, 4.0));

        records.push({
          sku,
          productName,
          category: category.name,
          warehouse: warehouse.code,
          quantity,
          reorderPoint,
          unitCostCents,
          avgDailyUsage,
          leadTimeDays
        });
      }
    }
  }

  return records;
}

function laneDistance(originCode: string, destinationCode: string): number {
  const origin = LOCATIONS.find((l) => l.code === originCode);
  const destination = LOCATIONS.find((l) => l.code === destinationCode);
  if (!origin || !destination) return 0;
  return haversineMiles(origin, destination);
}

function transitBaseFor(originCode: string, destinationCode: string): number {
  return 1 + Math.ceil(laneDistance(originCode, destinationCode) / 450);
}

function generateBaseShipments(rng: Rng, today: DayString): ShipmentRecord[] {
  const records: ShipmentRecord[] = [];

  for (let i = 0; i < 480; i += 1) {
    const laneIndex = i % 30;
    const lane = LANES[laneIndex] as { origin: string; destination: string };
    const shipmentId = `SHP-${100001 + i}`;
    const distance = laneDistance(lane.origin, lane.destination);
    const transitBase = 1 + Math.ceil(distance / 450);

    // Draw every random value, in this fixed order, unconditionally before branching.
    const rStatus = rng();
    const dayOffset = randInt(rng, 1, 180);
    const rNoise = rng();
    const noiseExtra = randInt(rng, 3, 5);
    // Drawn (and discarded) purely to keep the PRNG sequence identical to before R-6/R-12: the carrier is now
    // assigned deterministically per lane rather than independently per shipment (see below), so that every
    // shipment on a given lane shares one carrier's rate. Real-world lanes are mostly single-carrier; drawing a
    // fresh carrier per shipment let a ~38% rate spread between carriers (Summit Express 2.35/mi vs. Cascade
    // Carriers 1.70/mi) masquerade as cost anomalies within an otherwise-uniform route peer group (R-6/BUG-1).
    randInt(rng, 0, 4);
    const costFactor = randFloat(rng, 0.9, 1.1);
    const pendingOffset = randInt(rng, 0, 5);

    const carrier = CARRIERS[laneIndex % CARRIERS.length] as { name: string; ratePerMile: number };
    const shippingCostCents = Math.round(100 * (95 + distance * carrier.ratePerMile) * costFactor);

    let status: ShipmentStatus;
    let shipDate: DayString;
    let estimatedDelivery: DayString;
    let actualDelivery: DayString | null;

    if (rStatus < 0.04) {
      status = 'pending';
      shipDate = addDays(today, pendingOffset);
      estimatedDelivery = addDays(shipDate, transitBase + 1);
      actualDelivery = null;
    } else if (rStatus < 0.07) {
      status = 'cancelled';
      shipDate = addDays(today, -dayOffset);
      estimatedDelivery = addDays(shipDate, transitBase + 1);
      actualDelivery = null;
    } else {
      shipDate = addDays(today, -dayOffset);
      estimatedDelivery = addDays(shipDate, transitBase + 1);
      let noise: number;
      if (rNoise < 0.1) noise = -1;
      else if (rNoise < 0.78) noise = 0;
      else if (rNoise < 0.88) noise = 1;
      else if (rNoise < 0.94) noise = 2;
      else noise = noiseExtra;
      const actualCandidate = addDays(shipDate, transitBase + noise);

      if (estimatedDelivery < today) {
        status = 'delivered';
        actualDelivery = actualCandidate < today ? actualCandidate : today;
      } else if (actualCandidate < today) {
        status = 'delivered';
        actualDelivery = actualCandidate;
      } else {
        status = 'in_transit';
        actualDelivery = null;
      }
    }

    records.push({
      shipmentId,
      origin: lane.origin,
      destination: lane.destination,
      carrier: carrier.name,
      status,
      shipDate,
      estimatedDelivery,
      actualDelivery,
      shippingCostCents
    });
  }

  return records;
}

function inventoryId(r: InventoryRecord): string {
  return `${r.sku}@${r.warehouse}`;
}

function applyInventoryAnomalies(rng: Rng, records: InventoryRecord[]): Pick<SampleAnomalyManifest, 'outOfStock' | 'lowStock' | 'missingUsage' | 'misconfiguredReorder'> {
  const order = shuffle(rng, Array.from({ length: records.length }, (_, i) => i));

  const outOfStockIdx = order.slice(0, 6);
  const lowStockIdx = order.slice(6, 20);
  const missingUsageIdx = order.slice(20, 24);
  const misconfiguredIdx = order.slice(24, 29);

  const outOfStock: string[] = [];
  for (const idx of outOfStockIdx) {
    const r = records[idx] as InventoryRecord;
    r.quantity = 0;
    outOfStock.push(inventoryId(r));
  }

  const lowStock: string[] = [];
  for (const idx of lowStockIdx) {
    const r = records[idx] as InventoryRecord;
    r.quantity = Math.max(1, Math.floor(r.reorderPoint * randFloat(rng, 0.2, 0.95)));
    lowStock.push(inventoryId(r));
  }

  const missingUsage: string[] = [];
  for (const idx of missingUsageIdx) {
    const r = records[idx] as InventoryRecord;
    r.avgDailyUsage = null;
    missingUsage.push(inventoryId(r));
  }

  const misconfiguredReorder: string[] = [];
  for (const idx of misconfiguredIdx) {
    const r = records[idx] as InventoryRecord;
    const usage = r.avgDailyUsage as number;
    const lead = r.leadTimeDays;
    r.reorderPoint = Math.max(1, Math.floor(usage * lead * 0.1));
    r.quantity = Math.max(r.reorderPoint + 1, Math.floor(usage * lead * 0.6));
    misconfiguredReorder.push(inventoryId(r));
  }

  return { outOfStock, lowStock, missingUsage, misconfiguredReorder };
}

const OVERDUE_DAYS_LATE = [1, 2, 3, 4, 5, 6, 7, 9, 11, 14, 17, 20];
const COST_ANOMALY_MULTIPLIERS = [4, 4.5, 5, 5.5, 6, 4, 5, 6];
const UNMAPPED_DESTINATIONS = ['Anchorage, AK', 'Honolulu, HI'];

function applyShipmentAnomalies(
  rng: Rng,
  records: ShipmentRecord[],
  today: DayString
): Pick<
  SampleAnomalyManifest,
  'overdue' | 'costAnomaly' | 'missingActual' | 'missingEta' | 'actualBeforeShip' | 'openWithActual' | 'zeroCost' | 'sameOriginDestination' | 'unmapped'
> {
  const order = shuffle(rng, Array.from({ length: records.length }, (_, i) => i));

  const overdueIdx = order.slice(0, 12);
  const costAnomalyIdx = order.slice(12, 20);
  const missingActualIdx = order.slice(20, 25);
  const missingEtaIdx = order.slice(25, 29);
  const actualBeforeShipIdx = order.slice(29, 32);
  const openWithActualIdx = order.slice(32, 34);
  const zeroCostIdx = order.slice(34, 36);
  const sameOriginIdx = order.slice(36, 37);
  const unmappedIdx = order.slice(37, 39);

  const overdue: string[] = [];
  overdueIdx.forEach((idx, j) => {
    const r = records[idx] as ShipmentRecord;
    const transitBase = transitBaseFor(r.origin, r.destination);
    const k = OVERDUE_DAYS_LATE[j] as number;
    r.status = 'in_transit';
    const eta = addDays(today, -k);
    r.estimatedDelivery = eta;
    r.shipDate = addDays(eta, -(transitBase + 1));
    r.actualDelivery = null;
    overdue.push(r.shipmentId);
  });

  const costAnomaly: string[] = [];
  costAnomalyIdx.forEach((idx, j) => {
    const r = records[idx] as ShipmentRecord;
    r.shippingCostCents = Math.round(r.shippingCostCents * (COST_ANOMALY_MULTIPLIERS[j] as number));
    if (r.status === 'cancelled') {
      r.status = 'delivered';
      r.actualDelivery = r.estimatedDelivery;
    }
    costAnomaly.push(r.shipmentId);
  });

  const missingActual: string[] = [];
  missingActualIdx.forEach((idx, j) => {
    const r = records[idx] as ShipmentRecord;
    const transitBase = transitBaseFor(r.origin, r.destination);
    r.status = 'delivered';
    r.shipDate = addDays(today, -(30 + 5 * j));
    r.estimatedDelivery = addDays(r.shipDate, transitBase + 1);
    r.actualDelivery = null;
    missingActual.push(r.shipmentId);
  });

  const missingEta: string[] = [];
  for (const idx of missingEtaIdx) {
    const r = records[idx] as ShipmentRecord;
    r.status = 'in_transit';
    r.shipDate = addDays(today, -2);
    r.estimatedDelivery = null;
    r.actualDelivery = null;
    missingEta.push(r.shipmentId);
  }

  const actualBeforeShip: string[] = [];
  actualBeforeShipIdx.forEach((idx, j) => {
    const r = records[idx] as ShipmentRecord;
    const transitBase = transitBaseFor(r.origin, r.destination);
    r.status = 'delivered';
    r.shipDate = addDays(today, -(40 + j));
    r.estimatedDelivery = addDays(r.shipDate, transitBase + 1);
    r.actualDelivery = addDays(r.shipDate, -2);
    actualBeforeShip.push(r.shipmentId);
  });

  const openWithActual: string[] = [];
  for (const idx of openWithActualIdx) {
    const r = records[idx] as ShipmentRecord;
    r.status = 'in_transit';
    r.shipDate = addDays(today, -3);
    r.estimatedDelivery = addDays(today, 3);
    r.actualDelivery = addDays(today, -1);
    openWithActual.push(r.shipmentId);
  }

  const zeroCost: string[] = [];
  for (const idx of zeroCostIdx) {
    const r = records[idx] as ShipmentRecord;
    const transitBase = transitBaseFor(r.origin, r.destination);
    r.status = 'delivered';
    r.shipDate = addDays(today, -25);
    r.estimatedDelivery = addDays(r.shipDate, transitBase + 1);
    r.actualDelivery = r.estimatedDelivery;
    r.shippingCostCents = 0;
    zeroCost.push(r.shipmentId);
  }

  const sameOriginDestination: string[] = [];
  for (const idx of sameOriginIdx) {
    const r = records[idx] as ShipmentRecord;
    r.destination = r.origin;
    sameOriginDestination.push(r.shipmentId);
  }

  const unmapped: string[] = [];
  unmappedIdx.forEach((idx, j) => {
    const r = records[idx] as ShipmentRecord;
    r.destination = UNMAPPED_DESTINATIONS[j] as string;
    unmapped.push(r.shipmentId);
  });

  return { overdue, costAnomaly, missingActual, missingEta, actualBeforeShip, openWithActual, zeroCost, sameOriginDestination, unmapped };
}

/** Generates deterministic sample inventory and shipment data for a given seed and "today", plus an anomaly manifest. */
export function generateSampleData(opts: {
  seed: number;
  today: DayString;
}): { inventory: InventoryRecord[]; shipments: ShipmentRecord[]; anomalies: SampleAnomalyManifest } {
  const rng = createPrng(opts.seed);
  const inventory = generateBaseInventory(rng);
  const shipments = generateBaseShipments(rng, opts.today);
  const inventoryAnomalies = applyInventoryAnomalies(rng, inventory);
  const shipmentAnomalies = applyShipmentAnomalies(rng, shipments, opts.today);

  return {
    inventory,
    shipments,
    anomalies: { ...inventoryAnomalies, ...shipmentAnomalies }
  };
}

/** Builds a full `Dataset` from generated sample data, tagging both parts as sample sources. */
export function createSampleDataset(seed: number, today: DayString, loadedAt: string): Dataset {
  const { inventory, shipments } = generateSampleData({ seed, today });
  const label = `Sample data (seed ${seed})`;
  return {
    inventory,
    shipments,
    sources: {
      inventory: { kind: 'sample', label, loadedAt, rowCount: inventory.length },
      shipments: { kind: 'sample', label, loadedAt, rowCount: shipments.length }
    }
  };
}
