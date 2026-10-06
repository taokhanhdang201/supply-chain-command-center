import { describe, expect, it } from 'vitest';
import { createDefaultRegistry } from '../../../src/shared/ingest/adapters';
import { detectFormat, makeHints } from '../../../src/shared/ingest/detect/arbiter';
import { createRegistry } from '../../../src/shared/ingest/registry';
import type { FormatAdapter } from '../../../src/shared/ingest/types';
import { NO_VOTE } from '../../../src/shared/ingest/types';
import { concat, cp1252, gzip, utf16le, utf8, utf8Bom, SAMPLE_COMMA_CSV } from '../../ingest-kit/corpus';
import { toyAdapter, encodeToy } from '../../ingest-kit/fakeAdapters';

const reg = createDefaultRegistry();
const detect = (bytes: Uint8Array, name: string | null = null, mime: string | null = null) => detectFormat(bytes, makeHints(name, mime), reg);

describe('detection arbiter: text dialects and encodings (criteria 5-8)', () => {
  it('identifies delimited text in every encoding with evidence lines', () => {
    const cases: Array<[string, Uint8Array]> = [
      ['comma utf-8', utf8(SAMPLE_COMMA_CSV)],
      ['semicolon', utf8(SAMPLE_COMMA_CSV.split(',').join(';'))],
      ['tab', utf8(SAMPLE_COMMA_CSV.split(',').join('\t'))],
      ['pipe', utf8(SAMPLE_COMMA_CSV.split(',').join('|'))],
      ['utf-8 bom', utf8Bom(SAMPLE_COMMA_CSV)],
      ['utf-16le bom', utf16le(SAMPLE_COMMA_CSV)],
      ['windows-1252', cp1252('sku;almacén\nA-1;Bogotá\n')]
    ];
    for (const [name, bytes] of cases) {
      const r = detect(bytes);
      expect(r.outcome, name).toBe('chosen');
      expect(r.chosen?.adapterId, name).toBe('delimited-text');
      expect(r.chosen?.evidence.length, name).toBeGreaterThan(0);
    }
  });

  it('identifies a gzip file by its signature', () => {
    const r = detect(gzip(utf8(SAMPLE_COMMA_CSV)));
    expect(r.chosen?.adapterId).toBe('gzip');
    expect(r.chosen?.evidenceClass).toBe('magic');
  });

  it('refuses UTF-32, UTF-16 without BOM, binary, images, ZIP, CFB and PDF with the registry text', () => {
    const samples: Array<[string, Uint8Array, string]> = [
      ['utf-32', Uint8Array.of(0xff, 0xfe, 0, 0, 0x41, 0, 0, 0), 'refuse-utf32'],
      ['utf-16 no bom', utf16le(SAMPLE_COMMA_CSV, false), 'refuse-utf16-no-bom'],
      ['binary', new Uint8Array(100), 'refuse-binary'],
      ['png', Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3), 'refuse-image'],
      ['zip', Uint8Array.of(0x50, 0x4b, 0x03, 0x04, 0, 0), 'refuse-zip'],
      ['cfb', Uint8Array.of(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0), 'refuse-cfb'],
      ['pdf', utf8('%PDF-1.7\n'), 'refuse-pdf']
    ];
    for (const [name, bytes, id] of samples) {
      const r = detect(bytes);
      expect(r.outcome, name).toBe('refused');
      expect(r.chosen?.adapterId, name).toBe(id);
      expect(r.error?.message, name).toContain('SCC cannot import that type');
      expect(r.error?.message, name).toContain('You can import: Delimited text (.csv, .tsv, .txt), Gzip-compressed file (.gz)');
    }
  });

  it('treats extension and MIME as hints only: a .csv with UTF-16 text and a .txt with CSV are read by content', () => {
    const utf16 = detect(utf16le(SAMPLE_COMMA_CSV.split(',').join('\t')), 'data.csv', 'text/csv');
    expect(utf16.chosen?.adapterId).toBe('delimited-text');
    const txt = detect(utf8(SAMPLE_COMMA_CSV), 'data.txt');
    expect(txt.chosen?.adapterId).toBe('delimited-text');
  });

  it('a .xlsx made of zero bytes is refused without any adapter being trusted by its name', () => {
    const r = detect(new Uint8Array(100), 'data.xlsx', 'application/vnd.ms-excel');
    expect(r.outcome).toBe('refused');
    expect(r.error?.message).toContain('SCC cannot import that type');
  });

  it('an empty file is "The file is empty."', () => {
    const r = detect(new Uint8Array(0), 'x.csv');
    expect(r.outcome).toBe('empty');
    expect(r.error?.message).toBe('The file is empty.');
  });

  it('notices a mismatch between the extension and the bytes', () => {
    expect(detect(utf8('{"a":1}'), 'data.csv').outcome).toBe('refused'); // JSON is recognized by content and refused
    const r2 = detect(utf8(SAMPLE_COMMA_CSV), 'data.xlsx');
    expect(r2.chosen?.adapterId).toBe('delimited-text');
    expect(r2.notices.join(' ')).toContain('named .xlsx');
  });

  it('refuses a polyglot (two magic signatures) as ambiguous', () => {
    const r = detect(concat(Uint8Array.of(0x50, 0x4b, 0x03, 0x04), new Uint8Array(40), utf8('%PDF-1.4\n')));
    expect(r.outcome).toBe('ambiguous');
    expect(r.error?.message).toContain('could not be identified safely');
  });

  it('is deterministic and never throws for arbitrary bytes', () => {
    for (let i = 0; i < 50; i++) {
      const bytes = Uint8Array.from({ length: i * 7 }, (_, k) => (k * 31 + i * 17) & 0xff);
      expect(detect(bytes)).toEqual(detect(bytes));
    }
  });
});

describe('detection arbiter: generic rules with fake adapters', () => {
  const vote = (id: string, cls: 'magic' | 'sniff' | 'hint', confidence: number, ext: string[] = []): FormatAdapter => ({
    ...toyAdapter,
    descriptor: { ...toyAdapter.descriptor, id, family: `Family ${id}`, hints: { extensions: ext, mimeTypes: [] }, signatures: [], contentSniff: true },
    detect: () => ({ confidence, evidenceClass: cls, evidence: [`${id} evidence`] })
  });

  it('ranks by evidence class before confidence', () => {
    const r = createRegistry();
    r.register(vote('aaa', 'sniff', 0.99));
    r.register(vote('bbb', 'hint', 1));
    expect(detectFormat(utf8('x'), makeHints(null), r).chosen?.adapterId).toBe('aaa');
  });

  it('an exact tie is broken only by the extension hint, else refused as ambiguous', () => {
    const r = createRegistry();
    r.register(vote('aaa', 'sniff', 0.8, ['.aaa']));
    r.register(vote('bbb', 'sniff', 0.8, ['.bbb']));
    expect(detectFormat(utf8('x'), makeHints('f.bbb'), r).chosen?.adapterId).toBe('bbb');
    const none = detectFormat(utf8('x'), makeHints('f.zzz'), r);
    expect(none.outcome).toBe('ambiguous');
    expect(none.chosen).toBeNull();
  });

  it('an adapter that throws in detect simply abstains', () => {
    const r = createRegistry();
    r.register({ ...vote('boom', 'sniff', 1), detect: () => { throw new Error('bug'); } });
    r.register(vote('ok', 'sniff', 0.5));
    expect(detectFormat(utf8('x'), makeHints(null), r).chosen?.adapterId).toBe('ok');
  });

  it('votes of zero confidence are ignored and an unknown file is refused with the registry text', () => {
    const r = createRegistry();
    r.register({ ...vote('none', 'sniff', 0), detect: () => NO_VOTE });
    const res = detectFormat(utf8('x'), makeHints(null), r);
    expect(res.outcome).toBe('unknown');
    expect(res.error?.message).toContain('a file of an unknown type');
  });

  it('a disabled adapter is recognized and refused with "not enabled"', () => {
    const r = createRegistry();
    r.register(toyAdapter);
    r.setDisabled(['toy-kv']);
    const res = detectFormat(encodeToy([[['a', '1']]]), makeHints(null), r);
    expect(res.outcome).toBe('disabled');
    expect(res.error?.message).toContain('not enabled');
  });
});
