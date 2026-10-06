import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { importShipmentsCsv } from '../../../src/shared/csv/importShipments';

const HEADER = 'shipment_id,origin,destination,carrier,status,ship_date,estimated_delivery,actual_delivery,shipping_cost';

function row(overrides: Partial<Record<string, string>> = {}): string {
  const defaults: Record<string, string> = {
    shipment_id: 'SHP-900001',
    origin: 'WH-DFW',
    destination: 'HOU',
    carrier: 'Northstar Freight',
    status: 'delivered',
    ship_date: '2026-03-02',
    estimated_delivery: '2026-03-05',
    actual_delivery: '2026-03-04',
    shipping_cost: '812.40'
  };
  const merged = { ...defaults, ...overrides };
  return [
    'shipment_id',
    'origin',
    'destination',
    'carrier',
    'status',
    'ship_date',
    'estimated_delivery',
    'actual_delivery',
    'shipping_cost'
  ]
    .map((k) => merged[k])
    .join(',');
}

describe('importShipmentsCsv', () => {
  it('imports the shipped template with zero errors', () => {
    const text = readFileSync(resolve(process.cwd(), 'public/templates/shipments-template.csv'), 'utf-8');
    const result = importShipmentsCsv(text);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rows).toHaveLength(2);
  });

  it('rejects a duplicate shipment_id (case-insensitive)', () => {
    const text = `${HEADER}\n${row()}\n${row({ shipment_id: 'shp-900001' })}\n`;
    const result = importShipmentsCsv(text);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const dup = result.errors.find((e) => e.code === 'DUPLICATE_ID');
      expect(dup?.message).toContain('first seen on line 2');
    }
  });

  it('rejects an invalid date format', () => {
    const result = importShipmentsCsv(`${HEADER}\n${row({ ship_date: '03/15/2026' })}\n`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('INVALID_DATE');
  });

  it('rejects an impossible calendar date', () => {
    const result = importShipmentsCsv(`${HEADER}\n${row({ ship_date: '2026-02-30' })}\n`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('INVALID_DATE');
  });

  it('rejects a year outside the supported range', () => {
    const result = importShipmentsCsv(`${HEADER}\n${row({ ship_date: '1999-12-31' })}\n`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('OUT_OF_RANGE');
  });

  it('treats blank optional dates as null', () => {
    const result = importShipmentsCsv(`${HEADER}\n${row({ estimated_delivery: '', actual_delivery: '' })}\n`);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rows[0]?.estimatedDelivery).toBeNull();
      expect(result.rows[0]?.actualDelivery).toBeNull();
    }
  });

  it('requires ship_date', () => {
    const result = importShipmentsCsv(`${HEADER}\n${row({ ship_date: '' })}\n`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('REQUIRED');
  });

  it('rejects an invalid status', () => {
    const result = importShipmentsCsv(`${HEADER}\n${row({ status: 'shipped' })}\n`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('INVALID_STATUS');
  });

  it('accepts status variants', () => {
    const result = importShipmentsCsv(`${HEADER}\n${row({ status: 'In Transit', actual_delivery: '' })}\n`);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rows[0]?.status).toBe('in_transit');
  });

  it('rejects a negative shipping cost', () => {
    const result = importShipmentsCsv(`${HEADER}\n${row({ shipping_cost: '-1' })}\n`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('NEGATIVE');
  });

  it('reports MALFORMED_CSV with a line for malformed quotes', () => {
    const result = importShipmentsCsv(`${HEADER}\n"unterminated,x\n`);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe('MALFORMED_CSV');
      expect(result.errors[0]?.message).toContain('line 2');
    }
  });

  it('accepts a logically inconsistent row (actual before ship) without rejecting the import', () => {
    const result = importShipmentsCsv(`${HEADER}\n${row({ ship_date: '2026-03-10', actual_delivery: '2026-03-01' })}\n`);
    expect(result.ok).toBe(true);
  });

  it('collapses inner whitespace in origin/destination', () => {
    const result = importShipmentsCsv(`${HEADER}\n${row({ destination: '"Seattle,  WA"' })}\n`);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rows[0]?.destination).toBe('Seattle, WA');
  });
});
