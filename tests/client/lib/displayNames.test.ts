// One name for each thing on screen: a warehouse reads its short code ("DFW", never "WH-DFW"), a route reads "ATL → BOS" with its
// full label kept for the tooltip, and the KPIs keep one name on every page.
import { describe, expect, it } from 'vitest';
import { KPI_LABELS, routeDisplay, warehouseShortName } from '../../../src/client/lib/displayNames';

describe('warehouseShortName', () => {
  it.each<[string, string]>([
    ['WH-DFW', 'DFW'],
    ['WH-EWR', 'EWR'],
    ['WH-ATL', 'ATL']
  ])('drops the WH- prefix of %s', (code, short) => {
    expect(warehouseShortName(code)).toBe(short);
  });

  it('keeps a code that has no WH- prefix as it is', () => {
    expect(warehouseShortName('DFW')).toBe('DFW');
    expect(warehouseShortName('BNA')).toBe('BNA');
  });

  it('returns an unknown code unchanged and does not strip a WH- that is not at the start', () => {
    expect(warehouseShortName('ZZZ-9')).toBe('ZZZ-9');
    expect(warehouseShortName('XWH-DFW')).toBe('XWH-DFW');
    expect(warehouseShortName('')).toBe('');
  });
});

describe('routeDisplay', () => {
  const mapped = {
    label: 'Atlanta DC → Boston Hub',
    originCode: 'WH-ATL',
    destinationCode: 'BOS',
    originName: 'Atlanta DC',
    destinationName: 'Boston Hub'
  };

  it('reads "ATL → BOS" short and keeps the full label for the tooltip and the accessible name', () => {
    expect(routeDisplay(mapped)).toEqual({ short: 'ATL → BOS', full: 'Atlanta DC → Boston Hub' });
  });

  it('uses the place name for an unmapped end of a route', () => {
    const half = { ...mapped, destinationCode: null, destinationName: 'Harbor Point' };
    expect(routeDisplay(half).short).toBe('ATL → Harbor Point');
    const none = { ...mapped, originCode: null, destinationCode: null, originName: 'Dock 9', destinationName: 'Harbor Point' };
    expect(routeDisplay(none).short).toBe('Dock 9 → Harbor Point');
    expect(routeDisplay(none).full).toBe('Atlanta DC → Boston Hub');
  });
});

describe('KPI_LABELS', () => {
  it('names the six KPIs in the words the pages use', () => {
    expect(KPI_LABELS).toEqual({
      onTimeRate: 'On-time rate',
      shippingCost: 'Shipping cost',
      avgDeliveryTime: 'Avg delivery time',
      shipments: 'Shipments',
      inventoryTurnover: 'Inventory turnover',
      daysInventoryOutstanding: 'Days inventory outstanding (DIO)'
    });
  });
});
