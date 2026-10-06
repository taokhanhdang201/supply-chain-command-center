// Criterion 15: status and warehouse value maps, and the shipment location summary.

import { describe, expect, it } from 'vitest';
import {
  AMBIGUOUS_STATUS_WORDS,
  classifyStatus,
  classifyWarehouse,
  distinctValues,
  mapStatusValues,
  mapWarehouseValues,
  summarizeLocations,
  valueKey
} from '../../../src/shared/ingest/mapping/valueMaps';
import { SHIPMENT_STATUSES } from '../../../src/shared/types';
import { STATUS_WORDS } from '../../fixtures/ingest/gen';

describe('status value map (7.5)', () => {
  it('the four canonical statuses map to themselves in any case/space/hyphen variant', () => {
    for (const s of SHIPMENT_STATUSES) {
      for (const v of [s, s.toUpperCase(), s.replace('_', ' '), s.replace('_', '-'), ` ${s} `, s.replace(/^./, (c) => c.toUpperCase())]) {
        expect(classifyStatus(v), v).toMatchObject({ target: s, canonical: true, ambiguous: false });
      }
    }
  });

  it('proposes the documented words of every language', () => {
    const expected: Array<[string, string]> = [
      ['In Transit', 'in_transit'], ['shipped', 'in_transit'], ['Dispatched', 'in_transit'], ['en route', 'in_transit'], ['on the way', 'in_transit'], ['out for delivery', 'in_transit'], ['departed', 'in_transit'],
      ['En tránsito', 'in_transit'], ['Unterwegs', 'in_transit'], ['Đang vận chuyển', 'in_transit'], ['En transit', 'in_transit'], ['en cours', 'in_transit'],
      ['Delivered', 'delivered'], ['completed', 'delivered'], ['Received', 'delivered'], ['POD', 'delivered'], ['Entregado', 'delivered'], ['Geliefert', 'delivered'], ['Đã giao', 'delivered'], ['Livré', 'delivered'],
      ['Pending', 'pending'], ['Booked', 'pending'], ['created', 'pending'], ['open', 'pending'], ['planned', 'pending'], ['Scheduled', 'pending'], ['awaiting pickup', 'pending'], ['processing', 'pending'], ['new', 'pending'],
      ['Pendiente', 'pending'], ['Offen', 'pending'], ['Chờ xử lý', 'pending'], ['En attente', 'pending'],
      ['Cancelled', 'cancelled'], ['Canceled', 'cancelled'], ['void', 'cancelled'], ['Cancelado', 'cancelled'], ['Storniert', 'cancelled'], ['Đã hủy', 'cancelled'], ['Annulé', 'cancelled']
    ];
    for (const [word, status] of expected) expect(classifyStatus(word).target, word).toBe(status);
  });

  it('the language word lists used by the corpora all map', () => {
    for (const [lang, words] of Object.entries(STATUS_WORDS)) {
      if (lang === 'canonical') continue;
      words.forEach((w, i) => expect(classifyStatus(w).target, `${lang}: ${w}`).toBe(['delivered', 'in_transit', 'pending', 'cancelled'][i]));
    }
  });

  it('the ambiguity list and unknown words are never proposed: the user must choose', () => {
    expect(AMBIGUOUS_STATUS_WORDS).toEqual(['arrived', 'picked up', 'loaded', 'on hold', 'exception', 'delayed', 'returned', 'partially delivered', 'closed', 'rejected']);
    for (const w of [...AMBIGUOUS_STATUS_WORDS, 'Arrived', 'ON HOLD', 'unknown stuff', 'xyz']) {
      const c = classifyStatus(w);
      expect(c.target, w).toBeNull();
      const e = mapStatusValues([[w, 3]])[0]!;
      expect(e).toMatchObject({ state: 'choose', target: null, count: 3 });
      expect(e.evidence.length).toBeGreaterThan(10);
    }
    expect(classifyStatus('arrived').ambiguous).toBe(true);
    expect(classifyStatus('xyz')).toMatchObject({ ambiguous: false, statusLike: false });
  });

  it('works on distinct values with counts in first-occurrence order (never per row)', () => {
    const d = distinctValues(['Delivered', 'Booked', 'Delivered', '', '  ', 'Delayed', 'Delivered']);
    expect(d).toEqual([['Delivered', 3], ['Booked', 1], ['Delayed', 1]]);
    expect(mapStatusValues(d).map((e) => [e.source, e.target, e.state, e.count])).toEqual([
      ['Delivered', 'delivered', 'mapped', 3],
      ['Booked', 'pending', 'mapped', 1],
      ['Delayed', null, 'choose', 1]
    ]);
  });
});

describe('warehouse value map (7.6)', () => {
  it('resolves only by exact known code or exact known name, insensitive to case, diacritics, spacing and separators', () => {
    const ok: Array<[string, string]> = [
      ['WH-DFW', 'WH-DFW'], ['wh-dfw', 'WH-DFW'], ['WH_DFW', 'WH-DFW'], ['wh dfw', 'WH-DFW'], ['DFW', 'WH-DFW'], ['dfw', 'WH-DFW'],
      ['Dallas-Fort Worth DC', 'WH-DFW'], ['dallas fort worth dc', 'WH-DFW'], ['  Atlanta   DC ', 'WH-ATL'], ['Chicago DC', 'WH-ORD'], ['Los Angeles DC', 'WH-LAX'], ['Newark DC', 'WH-EWR'], ['EWR', 'WH-EWR']
    ];
    for (const [v, code] of ok) expect(classifyWarehouse(v).code, v).toBe(code);
  });

  it('anything else needs an explicit choice and the message names the known warehouses', () => {
    for (const v of ['Plant 1000', '1000', 'Memphis DC', 'Dallas', 'WH-XYZ', 'DFW2', 'Atlanta Distribution']) {
      expect(classifyWarehouse(v).code, v).toBeNull();
      const e = mapWarehouseValues([[v, 2]])[0]!;
      expect(e).toMatchObject({ state: 'choose', target: null });
      expect(e.evidence).toContain('WH-ATL, WH-DFW, WH-EWR, WH-LAX, WH-ORD');
    }
    const m = mapWarehouseValues(distinctValues(['DFW', 'Memphis DC', 'DFW', 'Atlanta DC']));
    expect(m.map((e) => [e.source, e.target, e.state, e.count])).toEqual([['DFW', 'WH-DFW', 'mapped', 2], ['Memphis DC', null, 'choose', 1], ['Atlanta DC', 'WH-ATL', 'mapped', 1]]);
  });

  it('valueKey folds case, diacritics, separators and punctuation', () => {
    expect(valueKey(' Dallas–Fort  Worth.DC ')).toBe(valueKey('dallas fort worth dc'));
    expect(valueKey('ENTREPÔT')).toBe('entrepot');
  });
});

describe('shipment locations stay free text (7.6)', () => {
  it('counts recognized versus unmapped rows, hides nothing, and lists exact short forms as visible rewrites', () => {
    const values = ['WH-DFW', 'Houston, TX', 'houston, tx', 'DFW', 'Gary, IN', 'Gary, IN', 'Plant 7', ''];
    const s = summarizeLocations(values);
    expect(s).toMatchObject({ totalRows: 7, recognizedRows: 4, unmappedRows: 3 });
    expect(s.unmapped).toEqual([{ value: 'Gary, IN', count: 2 }, { value: 'Plant 7', count: 1 }]);
    expect(s.rewrites).toEqual([{ from: 'DFW', to: 'WH-DFW', count: 1 }]);
  });
  it('an empty list is an empty summary', () => {
    expect(summarizeLocations([])).toEqual({ totalRows: 0, recognizedRows: 0, unmappedRows: 0, unmapped: [], rewrites: [] });
  });
});
