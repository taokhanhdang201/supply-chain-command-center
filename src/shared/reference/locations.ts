// Static reference data: warehouses, cities, carriers and lanes used by sample-data generation and by shipment
// location resolution. Warehouse `capacityUnits` is tuned (plan §7.6) so seed-42 sample data lands each warehouse
// near a target utilization: DFW 0.78, ATL 0.64, ORD 0.57, LAX 0.86, EWR 0.93 (all comfortably under 100%).

import type { Location } from '../types';

export const WAREHOUSES: readonly Location[] = [
  { code: 'WH-DFW', name: 'Dallas-Fort Worth DC', kind: 'warehouse', lat: 32.9, lon: -97.04, capacityUnits: 72_000 },
  { code: 'WH-ATL', name: 'Atlanta DC', kind: 'warehouse', lat: 33.64, lon: -84.43, capacityUnits: 75_000 },
  { code: 'WH-ORD', name: 'Chicago DC', kind: 'warehouse', lat: 41.98, lon: -87.9, capacityUnits: 91_000 },
  { code: 'WH-LAX', name: 'Los Angeles DC', kind: 'warehouse', lat: 33.94, lon: -118.41, capacityUnits: 55_000 },
  { code: 'WH-EWR', name: 'Newark DC', kind: 'warehouse', lat: 40.69, lon: -74.17, capacityUnits: 62_000 }
];

const CITIES: readonly Location[] = [
  { code: 'HOU', name: 'Houston, TX', kind: 'city', lat: 29.76, lon: -95.37, capacityUnits: null },
  { code: 'SAT', name: 'San Antonio, TX', kind: 'city', lat: 29.42, lon: -98.49, capacityUnits: null },
  { code: 'PHX', name: 'Phoenix, AZ', kind: 'city', lat: 33.45, lon: -112.07, capacityUnits: null },
  { code: 'DEN', name: 'Denver, CO', kind: 'city', lat: 39.74, lon: -104.99, capacityUnits: null },
  { code: 'MCI', name: 'Kansas City, MO', kind: 'city', lat: 39.1, lon: -94.58, capacityUnits: null },
  { code: 'BNA', name: 'Nashville, TN', kind: 'city', lat: 36.16, lon: -86.78, capacityUnits: null },
  { code: 'MIA', name: 'Miami, FL', kind: 'city', lat: 25.76, lon: -80.19, capacityUnits: null },
  { code: 'CLT', name: 'Charlotte, NC', kind: 'city', lat: 35.23, lon: -80.84, capacityUnits: null },
  { code: 'CMH', name: 'Columbus, OH', kind: 'city', lat: 39.96, lon: -83.0, capacityUnits: null },
  { code: 'BOS', name: 'Boston, MA', kind: 'city', lat: 42.36, lon: -71.06, capacityUnits: null },
  { code: 'MSP', name: 'Minneapolis, MN', kind: 'city', lat: 44.98, lon: -93.27, capacityUnits: null },
  { code: 'DTW', name: 'Detroit, MI', kind: 'city', lat: 42.33, lon: -83.05, capacityUnits: null },
  { code: 'LAS', name: 'Las Vegas, NV', kind: 'city', lat: 36.17, lon: -115.14, capacityUnits: null },
  { code: 'SLC', name: 'Salt Lake City, UT', kind: 'city', lat: 40.76, lon: -111.89, capacityUnits: null },
  { code: 'SEA', name: 'Seattle, WA', kind: 'city', lat: 47.61, lon: -122.33, capacityUnits: null },
  { code: 'PDX', name: 'Portland, OR', kind: 'city', lat: 45.52, lon: -122.68, capacityUnits: null }
];

export const LOCATIONS: readonly Location[] = [...WAREHOUSES, ...CITIES];

export const WAREHOUSE_CODES: readonly string[] = WAREHOUSES.map((w) => w.code).slice().sort();

export interface Carrier {
  name: string;
  ratePerMile: number;
}

export const CARRIERS: readonly Carrier[] = [
  { name: 'Northstar Freight', ratePerMile: 1.85 },
  { name: 'BlueLine Logistics', ratePerMile: 2.1 },
  { name: 'Cascade Carriers', ratePerMile: 1.7 },
  { name: 'Summit Express', ratePerMile: 2.35 },
  { name: 'Redwood Transport', ratePerMile: 1.95 }
];

export interface Lane {
  origin: string;
  destination: string;
}

export const LANES: readonly Lane[] = [
  { origin: 'WH-DFW', destination: 'HOU' },
  { origin: 'WH-DFW', destination: 'SAT' },
  { origin: 'WH-DFW', destination: 'PHX' },
  { origin: 'WH-DFW', destination: 'DEN' },
  { origin: 'WH-DFW', destination: 'MCI' },
  { origin: 'WH-DFW', destination: 'BNA' },
  { origin: 'WH-ATL', destination: 'MIA' },
  { origin: 'WH-ATL', destination: 'CLT' },
  { origin: 'WH-ATL', destination: 'BNA' },
  { origin: 'WH-ATL', destination: 'CMH' },
  { origin: 'WH-ATL', destination: 'HOU' },
  { origin: 'WH-ATL', destination: 'BOS' },
  { origin: 'WH-ORD', destination: 'MSP' },
  { origin: 'WH-ORD', destination: 'DTW' },
  { origin: 'WH-ORD', destination: 'CMH' },
  { origin: 'WH-ORD', destination: 'MCI' },
  { origin: 'WH-ORD', destination: 'DEN' },
  { origin: 'WH-ORD', destination: 'BOS' },
  { origin: 'WH-LAX', destination: 'PHX' },
  { origin: 'WH-LAX', destination: 'LAS' },
  { origin: 'WH-LAX', destination: 'SLC' },
  { origin: 'WH-LAX', destination: 'SEA' },
  { origin: 'WH-LAX', destination: 'PDX' },
  { origin: 'WH-LAX', destination: 'DEN' },
  { origin: 'WH-EWR', destination: 'BOS' },
  { origin: 'WH-EWR', destination: 'CLT' },
  { origin: 'WH-EWR', destination: 'DTW' },
  { origin: 'WH-EWR', destination: 'CMH' },
  { origin: 'WH-EWR', destination: 'MIA' },
  { origin: 'WH-EWR', destination: 'BNA' }
];
