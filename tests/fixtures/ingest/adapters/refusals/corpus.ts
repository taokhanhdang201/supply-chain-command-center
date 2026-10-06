// Conformance corpora of the refusal adapters: one valid sample per recognized family (it must be recognized and
// refused with a registry-generated message) plus hostile variants. All data is invented.

import type { AdapterCorpus, CorpusEntry } from '../../../../ingest-kit/corpus';
import { concat, prng, randomBytes, utf16le, utf8 } from '../../../../ingest-kit/corpus';

const rand = prng(21);
const zeros = (n: number): Uint8Array => new Uint8Array(n);
const ascii = (s: string): Uint8Array => utf8(s);

function pe(): Uint8Array {
  const out = new Uint8Array(0x100);
  out[0] = 0x4d;
  out[1] = 0x5a;
  out[0x3c] = 0x80;
  out.set([0x50, 0x45, 0, 0], 0x80);
  return out;
}

function utf32le(text: string): Uint8Array {
  const out = new Uint8Array(4 + text.length * 4);
  out.set([0xff, 0xfe, 0, 0], 0);
  for (let i = 0; i < text.length; i++) out[4 + i * 4] = text.charCodeAt(i);
  return out;
}

const csv = 'sku,product_name,category\nELC-9001,Wireless Scanner,Electronics\nELC-9002,Label Printer,Electronics\n';

function entry(name: string, bytes: Uint8Array): CorpusEntry {
  return { name, bytes };
}

const SAMPLES: Record<string, { valid: CorpusEntry[]; hostile?: CorpusEntry[] }> = {
  'refuse-image': {
    valid: [
      entry('png', concat(Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), randomBytes(rand, 64))),
      entry('jpeg', concat(Uint8Array.of(0xff, 0xd8, 0xff, 0xe0), randomBytes(rand, 64))),
      entry('gif', concat(ascii('GIF89a'), randomBytes(rand, 32))),
      entry('webp', concat(ascii('RIFF'), Uint8Array.of(1, 2, 3, 4), ascii('WEBPVP8 '), randomBytes(rand, 32))),
      entry('tiff', concat(Uint8Array.of(0x49, 0x49, 0x2a, 0x00), randomBytes(rand, 32)))
    ],
    hostile: [entry('png signature only', Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))]
  },
  'refuse-sqlite': { valid: [entry('sqlite', concat(ascii('SQLite format 3\u0000'), zeros(100)))] },
  'refuse-parquet': { valid: [entry('parquet', concat(ascii('PAR1'), randomBytes(rand, 64), ascii('PAR1')))] },
  'refuse-executable': {
    valid: [entry('windows pe', pe()), entry('elf', concat(Uint8Array.of(0x7f, 0x45, 0x4c, 0x46), zeros(60)))],
    hostile: [entry('MZ without PE header', concat(ascii('MZ'), zeros(100))), entry('MZ csv-like text', ascii('MZ-100,Widget\nMZ-101,Gadget\n'))]
  },
  'refuse-zip': {
    valid: [entry('zip local header', concat(Uint8Array.of(0x50, 0x4b, 0x03, 0x04), zeros(60))), entry('empty zip', Uint8Array.of(0x50, 0x4b, 0x05, 0x06, ...zeros(18)))],
    hostile: [entry('zip signature only', Uint8Array.of(0x50, 0x4b, 0x03, 0x04)), entry('zip followed by a pdf header', concat(Uint8Array.of(0x50, 0x4b, 0x03, 0x04), zeros(100), ascii('%PDF-1.4\n')))]
  },
  'refuse-cfb': { valid: [entry('compound file', concat(Uint8Array.of(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1), zeros(120)))] },
  'refuse-pdf': {
    valid: [entry('pdf', ascii('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n')), entry('pdf after leading bytes', ascii('\n\n  %PDF-1.4\n1 0 obj\n'))],
    hostile: [entry('pdf header only', ascii('%PDF-'))]
  },
  'refuse-rtf': { valid: [entry('rtf', ascii('{\\rtf1\\ansi\\deff0 {\\fonttbl {\\f0 Arial;}} Hello}'))] },
  'refuse-archive': {
    valid: [
      entry('7z', concat(Uint8Array.of(0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c), zeros(40))),
      entry('rar', concat(ascii('Rar!'), Uint8Array.of(0x1a, 0x07, 0x00), zeros(40))),
      entry('bzip2', concat(ascii('BZh9'), randomBytes(rand, 40))),
      entry('xz', concat(Uint8Array.of(0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00), zeros(40)))
    ],
    hostile: [entry('BZh csv-like text', ascii('BZhx,b\n1,2\n'))]
  },
  'refuse-utf32': { valid: [entry('utf-32le bom', utf32le(csv))] },
  'refuse-utf16-no-bom': { valid: [entry('utf-16le no bom', utf16le(csv, false))], hostile: [entry('utf-16le no bom, odd length', concat(utf16le(csv, false), Uint8Array.of(0x41)))] },
  'refuse-binary': {
    valid: [entry('zero bytes', zeros(100)), entry('undefined windows-1252 bytes', concat(ascii('a,b\n1,'), Uint8Array.of(0x81, 0x8d, 0x8f, 0x90, 0x9d), ascii('\n')))],
    hostile: [entry('random bytes', randomBytes(rand, 400))]
  },
  'refuse-json': {
    valid: [entry('json array', ascii('[{"id":1,"name":"a"},{"id":2,"name":"b"}]')), entry('json object', ascii('{"shipments":[{"id":"SHP-1"}]}')), entry('json with bom', concat(Uint8Array.of(0xef, 0xbb, 0xbf), ascii('[{"a":1}]')))],
    hostile: [entry('bracketed csv header', ascii('[sku],[qty]\nA-1,2\n'))]
  },
  'refuse-html': {
    valid: [entry('html doctype', ascii('<!DOCTYPE html><html><body><table><tr><td>1</td></tr></table></body></html>')), entry('bare table', ascii('<table><tr><td>1</td></tr></table>'))]
  },
  'refuse-xml': {
    valid: [entry('xml declaration', ascii('<?xml version="1.0"?><root><item id="1"/></root>')), entry('xml root only', ascii('<Consignments><Consignment id="1"/></Consignments>'))],
    hostile: [entry('xml with DOCTYPE entity', ascii('<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaa">]><x>&a;&a;</x>'))]
  }
};

export const corpora: AdapterCorpus[] = Object.entries(SAMPLES).map(([adapterId, s]) => ({ adapterId, valid: s.valid, hostile: s.hostile ?? [] }));
