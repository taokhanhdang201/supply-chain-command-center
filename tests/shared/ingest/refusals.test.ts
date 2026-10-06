import { describe, expect, it } from 'vitest';
import { refusalAdapters } from '../../../src/shared/ingest/adapters/refusals';
import { createDefaultRegistry } from '../../../src/shared/ingest/adapters';
import { detectFormat, makeHints } from '../../../src/shared/ingest/detect/arbiter';
import { utf16le, utf8 } from '../../ingest-kit/corpus';
import { corpora } from '../../fixtures/ingest/adapters/refusals/corpus';

const registry = createDefaultRegistry();

describe('refusal adapters', () => {
  it('are ordinary registered adapters with status refusal', () => {
    for (const a of refusalAdapters) {
      expect(registry.get(a.descriptor.id)).toBe(a);
      expect(a.descriptor.status).toBe('refusal');
    }
  });

  it('every valid sample is recognized as its own family and refused with the registry text', () => {
    for (const corpus of corpora) {
      for (const entry of corpus.valid) {
        const r = detectFormat(entry.bytes, makeHints(null), registry);
        expect(r.outcome, `${corpus.adapterId}/${entry.name}`).toBe('refused');
        expect(r.chosen?.adapterId, `${corpus.adapterId}/${entry.name}`).toBe(corpus.adapterId);
        expect(r.error?.message).toContain('SCC cannot import that type');
        expect(r.error?.message).toContain('Delimited text');
      }
    }
  });

  it('does not mistake text that merely starts like a signature for a binary format', () => {
    for (const text of ['MZ-100,Widget\nMZ-101,Gadget\n', 'BZhx,b\n1,2\n', '[sku],[qty]\nA-1,2\n', 'PAR,x\n1,2\n', '{sku},{qty}\n1,2\n']) {
      expect(detectFormat(utf8(text), makeHints(null), registry).chosen?.adapterId, text).toBe('delimited-text');
    }
  });

  it('routes every Phase 1b+ format family to a refusal, never to the delimited adapter', () => {
    const cases: Array<[string, Uint8Array, string]> = [
      ['xlsx/ods (ZIP)', Uint8Array.of(0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0), 'refuse-zip'],
      ['legacy xls (CFB)', Uint8Array.of(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0), 'refuse-cfb'],
      ['json', utf8('[{"sku":"A-1"}]'), 'refuse-json'],
      ['xml', utf8('<?xml version="1.0"?><r/>'), 'refuse-xml'],
      ['html', utf8('<html><body><table></table></body></html>'), 'refuse-html'],
      ['pdf', utf8('%PDF-1.4'), 'refuse-pdf']
    ];
    for (const [name, bytes, id] of cases) expect(detectFormat(bytes, makeHints(null), registry).chosen?.adapterId, name).toBe(id);
  });

  it('refusal hint texts reach the message (for example how to convert the file)', () => {
    const zip = detectFormat(Uint8Array.of(0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0), makeHints('book.xlsx'), registry);
    expect(zip.error?.message).toContain('save the data as CSV');
    const utf16 = detectFormat(utf16le('a,b\n1,2\n', false), makeHints(null), registry);
    expect(utf16.error?.message).toContain('byte order mark');
  });

  it('probe and read always refuse', async () => {
    const adapter = registry.get('refuse-pdf')!;
    const ctx = { signal: new AbortController().signal, limits: {} as never, registry, progress: () => undefined, clock: () => 0, depth: 0 };
    const src = { size: 5, read: () => utf8('%PDF-') };
    const p = await adapter.probe(src, ctx);
    const r = await adapter.read(src, { tableIndex: 0, options: {} }, { maxRows: 1 }, ctx);
    for (const x of [p, r]) {
      expect(x.ok).toBe(false);
      if (!x.ok) expect(x.error.message).toContain('PDF document');
    }
  });
});
