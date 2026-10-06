import { describe, it, expect } from 'vitest';
import {
  computeInventoryValueCents,
  getStockStatus,
  computeDaysOfSupply,
  getStockoutRisk,
  enrichInventory
} from '../../../src/shared/domain/inventory';
import { makeInventoryRecord } from '../../helpers/fixtures';

describe('computeInventoryValueCents', () => {
  it('multiplies quantity by unit cost', () => {
    expect(computeInventoryValueCents(10, 500)).toBe(5000);
  });

  it('stays within Number.MAX_SAFE_INTEGER for very large values', () => {
    const value = computeInventoryValueCents(10_000_000, 100_000_000);
    expect(value).toBe(1e15);
    expect(Number.isSafeInteger(value)).toBe(true);
  });
});

describe('getStockStatus', () => {
  it('is out_of_stock when quantity is 0, even with reorderPoint 0', () => {
    expect(getStockStatus(0, 0)).toBe('out_of_stock');
  });

  it('is in_stock when quantity is 1 and reorderPoint is 0', () => {
    expect(getStockStatus(1, 0)).toBe('in_stock');
  });

  it('is low_stock when quantity equals reorderPoint', () => {
    expect(getStockStatus(40, 40)).toBe('low_stock');
  });

  it('is in_stock when quantity is one above reorderPoint', () => {
    expect(getStockStatus(41, 40)).toBe('in_stock');
  });
});

describe('computeDaysOfSupply', () => {
  it('is null when usage is unknown', () => {
    expect(computeDaysOfSupply(100, null)).toBeNull();
  });

  it('is null when usage is zero', () => {
    expect(computeDaysOfSupply(100, 0)).toBeNull();
  });

  it('divides quantity by usage', () => {
    expect(computeDaysOfSupply(100, 10)).toBe(10);
  });
});

describe('getStockoutRisk', () => {
  it('is high when quantity is 0', () => {
    expect(getStockoutRisk({ quantity: 0, avgDailyUsage: 10, leadTimeDays: 14 })).toBe('high');
  });

  it('is unknown when usage is null', () => {
    expect(getStockoutRisk({ quantity: 100, avgDailyUsage: null, leadTimeDays: 14 })).toBe('unknown');
  });

  it('is low when usage is zero but quantity > 0', () => {
    expect(getStockoutRisk({ quantity: 100, avgDailyUsage: 0, leadTimeDays: 14 })).toBe('low');
  });

  it('is high when days of supply is below lead time', () => {
    expect(getStockoutRisk({ quantity: 100, avgDailyUsage: 10, leadTimeDays: 14 })).toBe('high'); // dos=10 < 14
  });

  it('is medium exactly at the lead-time boundary (dos == leadTime)', () => {
    expect(getStockoutRisk({ quantity: 140, avgDailyUsage: 10, leadTimeDays: 14 })).toBe('medium'); // dos=14
  });

  it('is low exactly at the safety-buffer boundary (dos == leadTime + buffer)', () => {
    expect(getStockoutRisk({ quantity: 210, avgDailyUsage: 10, leadTimeDays: 14 })).toBe('low'); // dos=21 == 14+7
  });

  it('is medium just below the safety-buffer boundary', () => {
    expect(getStockoutRisk({ quantity: 209, avgDailyUsage: 10, leadTimeDays: 14 })).toBe('medium'); // dos=20.9
  });
});

describe('enrichInventory', () => {
  it('sets a deterministic id and derived fields', () => {
    const record = makeInventoryRecord({ sku: 'ELC-1000', warehouse: 'WH-DFW', quantity: 50, unitCostCents: 200, reorderPoint: 10 });
    const [item] = enrichInventory([record]);
    expect(item?.id).toBe('ELC-1000@WH-DFW');
    expect(item?.inventoryValueCents).toBe(10_000);
    expect(item?.stockStatus).toBe('in_stock');
  });
});
