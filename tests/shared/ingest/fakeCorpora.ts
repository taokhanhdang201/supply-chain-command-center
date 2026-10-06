// Corpora for the test-only fake adapters (shared by the conformance run and the fake-adapter tests).

import type { AdapterCorpus } from '../../ingest-kit/corpus';
import { utf8 } from '../../ingest-kit/corpus';
import { encodeImagesOnly, encodeMulti, encodePositioned, encodeRecords, encodeToy, MTC_MAGIC, PTX_MAGIC, REC_MAGIC, TOY_MAGIC } from '../../ingest-kit/fakeAdapters';

export const multiBytes = encodeMulti([
  {
    name: 'Loads',
    rows: [
      [{ v: 'Consignment Reference', t: 'text' }, { v: 'Dispatched On', t: 'text' }, { v: 'Freight', t: 'text' }],
      [{ v: 'SHP-1001', t: 'text' }, { v: '2026-03-02', t: 'date' }, { v: '812.4', t: 'number' }],
      [{ v: 'SHP-1002', t: 'text' }, { v: '2026-03-03', t: 'date' }, { v: '640', t: 'number' }]
    ],
    merged: [[1, 0]]
  },
  { name: 'Notes', hidden: true, rows: [[{ v: 'internal', t: 'text' }]] }
]);

export const recordBytes = encodeRecords('shipments', [
  { shipment: { id: 'SHP-1', route: { from: { city: 'Dallas' }, to: { city: 'Houston' } } }, status: 'delivered', events: [{ code: 'A' }, { code: 'B' }] },
  { shipment: { id: 'SHP-2', route: { from: { city: 'Atlanta' }, to: { city: 'Miami' } } }, status: 'pending', events: [] }
]);

export const positionedBytes = encodePositioned([
  [
    { text: 'Consignment', x: 10, y: 10, w: 60, h: 8 },
    { text: 'Freight', x: 120, y: 10, w: 40, h: 8 },
    { text: 'SHP-1', x: 10, y: 24, w: 30, h: 8 },
    { text: '812.40', x: 120, y: 24, w: 40, h: 8 }
  ]
]);

export const imagesOnlyBytes = encodeImagesOnly(2);

export const toyBytes = encodeToy([
  [['sku', 'ABC-100'], ['warehouse', 'WH-DFW'], ['quantity', '5']],
  [['sku', 'ABC-101'], ['warehouse', 'WH-ATL'], ['quantity', '7']]
]);

export const fakeCorpora: AdapterCorpus[] = [
  { adapterId: 'toy-kv', valid: [{ name: 'toy', bytes: toyBytes }], hostile: [{ name: 'header only', bytes: utf8(TOY_MAGIC) }, { name: 'random text', bytes: utf8('nothing') }] },
  { adapterId: 'fake-multi', valid: [{ name: 'multi', bytes: multiBytes }], hostile: [{ name: 'bad json', bytes: utf8(MTC_MAGIC + '{') }, { name: 'wrong shape', bytes: utf8(MTC_MAGIC + '{"sheets":5}') }] },
  { adapterId: 'fake-records', valid: [{ name: 'records', bytes: recordBytes }], hostile: [{ name: 'bad json', bytes: utf8(REC_MAGIC + '[') }] },
  {
    adapterId: 'fake-positioned',
    valid: [{ name: 'runs', bytes: positionedBytes }, { name: 'images only', bytes: imagesOnlyBytes }],
    hostile: [{ name: 'bad json', bytes: utf8(PTX_MAGIC + 'x') }]
  }
];
