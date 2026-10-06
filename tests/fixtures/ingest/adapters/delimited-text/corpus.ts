// Conformance corpus of the delimited-text adapter. All data is invented.

import type { AdapterCorpus } from '../../../../ingest-kit/corpus';
import { concat, cp1252, prng, randomBytes, utf16be, utf16le, utf8, utf8Bom } from '../../../../ingest-kit/corpus';

const HEADER = 'sku,product_name,category,warehouse,quantity,reorder_point,unit_cost';
const ROWS = ['ELC-9001,Wireless Scanner,Electronics,WH-DFW,120,40,89.50', 'ELC-9002,Label Printer,Electronics,WH-ATL,60,20,210.00', 'PKG-1001,Pallet Wrap,Packaging,WH-ORD,900,300,24.99'];
const comma = [HEADER, ...ROWS].join('\n') + '\n';
const withSep = (d: string): string => comma.split(',').join(d);

const manyRows = (n: number): string => [HEADER, ...Array.from({ length: n }, (_, i) => `SKU-${String(i).padStart(6, '0')},Item ${i},Cat,WH-DFW,${i},5,1.25`)].join('\n') + '\n';

const rand = prng(99);

export const corpora: AdapterCorpus[] = [
  {
    adapterId: 'delimited-text',
    valid: [
      { name: 'comma utf-8', bytes: utf8(comma), hints: { extension: '.csv' } },
      { name: 'comma crlf', bytes: utf8(comma.replace(/\n/g, '\r\n')), hints: { extension: '.csv' } },
      { name: 'semicolon', bytes: utf8(withSep(';')), hints: { extension: '.csv' } },
      { name: 'tab', bytes: utf8(withSep('\t')), hints: { extension: '.tsv' } },
      { name: 'pipe', bytes: utf8(withSep('|')), hints: { extension: '.txt' } },
      { name: 'utf-8 bom', bytes: utf8Bom(comma), hints: { extension: '.csv' } },
      { name: 'utf-16le bom tsv', bytes: utf16le(withSep('\t')), hints: { extension: '.csv' } },
      { name: 'utf-16be bom', bytes: utf16be(withSep(';')) },
      { name: 'windows-1252 confirmed', bytes: cp1252('sku;producto;almacén\nA-100;Camión ligero;Bogotá\nA-101;Café molido;Medellín\n'), options: { encoding: 'windows-1252' } },
      { name: 'sep directive', bytes: utf8('sep=;\n' + withSep(';')) },
      { name: 'quoted fields with embedded newline and quote', bytes: utf8('id,note\n1,"line one\nline two"\n2,"say ""hi"""\n'), options: { delimiter: 'comma' } },
      { name: 'banner and blank lines', bytes: utf8('Stock report\n\n' + comma + '\n\n') },
      { name: 'forced separator', bytes: utf8('a\nb\nc\n'), options: { delimiter: 'comma' } }
    ],
    hostile: [
      { name: 'empty', bytes: new Uint8Array(0) },
      { name: 'whitespace only', bytes: utf8('  \n\n  \n') },
      { name: 'NUL bytes', bytes: new Uint8Array(100) },
      { name: 'utf-16 odd byte length', bytes: concat(utf16le(comma), Uint8Array.of(0x41)) },
      { name: 'utf-16 lone high surrogate', bytes: concat(Uint8Array.of(0xff, 0xfe), Uint8Array.of(0x41, 0x00, 0x00, 0xd8, 0x42, 0x00)) },
      { name: 'utf-16 lone low surrogate', bytes: concat(Uint8Array.of(0xff, 0xfe), Uint8Array.of(0x00, 0xdc, 0x41, 0x00)) },
      { name: 'utf-32 bom', bytes: Uint8Array.of(0xff, 0xfe, 0, 0, 0x41, 0, 0, 0) },
      { name: 'windows-1252 undefined bytes', bytes: concat(utf8('a,b\n1,'), Uint8Array.of(0x81, 0x8d, 0x8f, 0x90, 0x9d), utf8('\n')) },
      { name: 'windows-1252 without confirmation', bytes: cp1252('sku;producto\nA-100;Camión\n') },
      { name: 'overlong utf-8', bytes: concat(utf8('a,b\n1,'), Uint8Array.of(0xc0, 0xaf), utf8('\n')) },
      { name: 'unterminated quote', bytes: utf8('a,b\n1,"never closed\n2,3\n') },
      { name: '51 columns', bytes: utf8(Array.from({ length: 51 }, (_, i) => `c${i}`).join(',') + '\n' + Array.from({ length: 51 }, (_, i) => `${i}`).join(',') + '\n') },
      { name: 'prototype-like headers and values', bytes: utf8('__proto__,constructor,toString\n__proto__,constructor,toString\n') },
      { name: 'formula-injection cells', bytes: utf8("a,b,c\n=cmd|'/C calc'!A0,+1,-1\n@SUM(1),=1+1,x\n") },
      { name: 'html in text', bytes: utf8('a,b\n<script>alert(1)</script>,<img src=x onerror=alert(1)>\n') },
      { name: 'control characters', bytes: utf8('a,b\n1,\u0001\u0002\u0003\n') },
      { name: '20,001 rows', bytes: utf8(manyRows(20_001)) },
      { name: 'single 1.5 MB token', bytes: utf8('a,b\n' + 'x'.repeat(1_500_000) + ',1\n') },
      { name: 'one long line without separators', bytes: utf8('z'.repeat(200_000)) },
      { name: 'random bytes', bytes: randomBytes(rand, 500) },
      { name: 'only separators', bytes: utf8(',,,,\n,,,,\n') }
    ]
  }
];
