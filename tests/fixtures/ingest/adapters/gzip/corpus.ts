// Conformance corpus of the gzip wrapper adapter. All data is invented.

import type { AdapterCorpus } from '../../../../ingest-kit/corpus';
import { concat, gzip, prng, randomBytes, utf16le, utf8 } from '../../../../ingest-kit/corpus';

const csv = 'sku,product_name,category,warehouse,quantity,reorder_point,unit_cost\nELC-9001,Wireless Scanner,Electronics,WH-DFW,120,40,89.50\nELC-9002,Label Printer,Electronics,WH-ATL,60,20,210.00\n';
const good = gzip(utf8(csv));
const rand = prng(5);

function printable(rand: () => number, n: number): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let out = '';
  for (let i = 0; i < n; i++) out += alphabet[Math.floor(rand() * alphabet.length)];
  return out;
}

export const corpora: AdapterCorpus[] = [
  {
    adapterId: 'gzip',
    valid: [
      { name: 'gzip csv', bytes: good, hints: { fileName: 'stock.csv.gz', extension: '.gz' } },
      { name: 'gzip utf-16 tsv', bytes: gzip(utf16le(csv.split(',').join('\t'))), hints: { fileName: 'stock.tsv.gz', extension: '.gz' } }
    ],
    hostile: [
      { name: 'truncated gzip', bytes: good.subarray(0, good.length - 9) },
      { name: 'gzip header only', bytes: good.subarray(0, 10) },
      { name: 'bit-flipped gzip', bytes: Uint8Array.from(good, (b, i) => (i === 14 ? b ^ 0xff : b)) },
      { name: 'trailing garbage after gzip', bytes: concat(good, utf8('garbage')) },
      { name: 'gzip of zeros (bomb, ratio cap)', bytes: gzip(new Uint8Array(3 * 1024 * 1024)) },
      { name: 'gzip of nothing', bytes: gzip(new Uint8Array(0)) },
      { name: 'gzip inside gzip', bytes: gzip(good) },
      { name: 'gzip of an image', bytes: gzip(concat(Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), randomBytes(rand, 200))) },
      { name: 'gzip of binary', bytes: gzip(new Uint8Array(200)) },
      { name: 'gzip output above the inner source limit', bytes: gzip(utf8('a,b\n' + printable(rand, 2_200_000) + ',1\n')) }
    ]
  }
];
