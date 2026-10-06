import { describe, expect, it } from 'vitest';
import { delimitedAdapter } from '../../../src/shared/ingest/adapters/delimited/adapter';
import { createDefaultRegistry } from '../../../src/shared/ingest/adapters';
import { decodeText, detectEncoding, isValidUtf8 } from '../../../src/shared/ingest/adapters/delimited/encoding';
import { parseDelimited } from '../../../src/shared/ingest/adapters/delimited/parse';
import type { ExtractionResult, ProbeResult, Result } from '../../../src/shared/ingest/types';
import { concat, cp1252, makeCtx, sourceOf, utf16be, utf16le, utf8, utf8Bom, SAMPLE_COMMA_CSV } from '../../ingest-kit/corpus';

const registry = createDefaultRegistry();
const ctx = (over: Partial<Parameters<typeof makeCtx>[0]> = {}) => makeCtx({ registry, descriptor: delimitedAdapter.descriptor, ...over });

async function read(bytes: Uint8Array, options: Record<string, string> = {}, over: Partial<Parameters<typeof makeCtx>[0]> = {}, maxRows = 100_000) {
  return delimitedAdapter.read(sourceOf(bytes), { tableIndex: 0, options }, { maxRows }, ctx(over));
}
async function probe(bytes: Uint8Array, options: Record<string, string> = {}, over: Partial<Parameters<typeof makeCtx>[0]> = {}) {
  return delimitedAdapter.probe(sourceOf(bytes), ctx(over), options);
}
function table(result: Result<ExtractionResult>) {
  if (!result.ok || result.value.kind !== 'tables') throw new Error(result.ok ? 'not tables' : result.error.message);
  return result.value.tables[0]!;
}
const values = (t: ReturnType<typeof table>) => t.rows.map((r) => r.map((c) => c.v));
function choices(result: Result<ProbeResult>) {
  if (!result.ok) throw new Error(result.error.message);
  return new Map(result.value.choices.map((c) => [c.key, c]));
}

describe('encoding detection and decoding', () => {
  it('detects UTF-8 with and without BOM, UTF-16 LE/BE with BOM, and proposes Windows-1252 only with confirmation', () => {
    expect(detectEncoding(utf8('a,b\n'))).toMatchObject({ encoding: 'utf-8', bom: false, needsConfirmation: false });
    expect(detectEncoding(utf8Bom('a,b\n'))).toMatchObject({ encoding: 'utf-8', bom: true });
    expect(detectEncoding(utf16le('a,b\n'))).toMatchObject({ encoding: 'utf-16le', bom: true });
    expect(detectEncoding(utf16be('a,b\n'))).toMatchObject({ encoding: 'utf-16be', bom: true });
    expect(detectEncoding(cp1252('almacén;Bogotá\n'))).toMatchObject({ encoding: 'windows-1252', needsConfirmation: true });
  });

  it('refuses UTF-32, NUL content and undefined Windows-1252 bytes', () => {
    expect(detectEncoding(Uint8Array.of(0xff, 0xfe, 0, 0, 65, 0, 0, 0))).toMatchObject({ encoding: null, refusal: 'utf-32' });
    expect(detectEncoding(Uint8Array.of(0, 0, 0xfe, 0xff, 0, 0, 0, 65))).toMatchObject({ encoding: null, refusal: 'utf-32' });
    expect(detectEncoding(new Uint8Array(10))).toMatchObject({ encoding: null, refusal: 'binary' });
    for (const b of [0x81, 0x8d, 0x8f, 0x90, 0x9d]) {
      expect(detectEncoding(Uint8Array.of(65, b, 66))).toMatchObject({ encoding: null, refusal: 'undefined-bytes' });
    }
  });

  it('validates UTF-8 strictly (overlong, surrogates, out of range) and tolerates a cut tail only on request', () => {
    expect(isValidUtf8(utf8('héllo €𝄞'))).toBe(true);
    expect(isValidUtf8(Uint8Array.of(0xc0, 0xaf))).toBe(false); // overlong
    expect(isValidUtf8(Uint8Array.of(0xe0, 0x80, 0xaf))).toBe(false);
    expect(isValidUtf8(Uint8Array.of(0xed, 0xa0, 0x80))).toBe(false); // surrogate
    expect(isValidUtf8(Uint8Array.of(0xf4, 0x90, 0x80, 0x80))).toBe(false); // above U+10FFFF
    expect(isValidUtf8(Uint8Array.of(0xff))).toBe(false);
    const euro = utf8('€');
    expect(isValidUtf8(euro.subarray(0, 2))).toBe(false);
    expect(isValidUtf8(euro.subarray(0, 2), true)).toBe(true);
    expect(isValidUtf8(Uint8Array.of(0xe2, 0x41), true)).toBe(false);
  });

  it('decodes each encoding and drops the BOM', () => {
    expect(decodeText(utf8Bom('año'), 'utf-8')).toEqual({ ok: true, text: 'año' });
    expect(decodeText(utf16le('año €'), 'utf-16le')).toEqual({ ok: true, text: 'año €' });
    expect(decodeText(utf16be('año €'), 'utf-16be')).toEqual({ ok: true, text: 'año €' });
    expect(decodeText(cp1252('año € Ÿ'), 'windows-1252')).toEqual({ ok: true, text: 'año € Ÿ' });
    expect(decodeText(utf16le('𝄞 clef'), 'utf-16le')).toEqual({ ok: true, text: '𝄞 clef' });
  });

  it('reports damaged text as errors instead of replacement characters', () => {
    expect(decodeText(concat(utf16le('ab'), Uint8Array.of(1)), 'utf-16le')).toEqual({ ok: false, reason: 'odd-length' });
    expect(decodeText(Uint8Array.of(0xff, 0xfe, 0x00, 0xd8, 0x41, 0x00), 'utf-16le')).toEqual({ ok: false, reason: 'invalid-surrogate' });
    expect(decodeText(Uint8Array.of(0xff, 0xfe, 0x00, 0xdc), 'utf-16le')).toEqual({ ok: false, reason: 'invalid-surrogate' });
    expect(decodeText(Uint8Array.of(0xc0, 0xaf), 'utf-8')).toEqual({ ok: false, reason: 'invalid-utf8' });
    expect(decodeText(Uint8Array.of(0x81), 'windows-1252')).toEqual({ ok: false, reason: 'undefined-byte' });
  });
});

describe('delimited parser', () => {
  const opts: Parameters<typeof parseDelimited>[2] = { maxRows: 1000, maxColumns: 50, maxCells: 100_000 };
  const parse = (text: string, d = ',', o = opts) => {
    const r = parseDelimited(text, d, o);
    if (!r.ok) throw new Error(r.failure.code);
    return r.value;
  };

  it('parses quotes, escaped quotes, embedded newlines and all line endings with physical line numbers', () => {
    const v = parse('a,b\r\n1,"x\ny"\r\n\r\n2,"say ""hi"""\r3,4');
    expect(v.rows).toEqual([['a', 'b'], ['1', 'x\ny'], ['2', 'say "hi"'], ['3', '4']]);
    expect(v.lines).toEqual([1, 2, 5, 6]);
  });

  it('skips blank records, keeps stray quotes as literals, and supports every separator', () => {
    expect(parse('a;b\n\n   ;  \n5" pipe;x\n', ';').rows).toEqual([['a', 'b'], ['5" pipe', 'x']]);
    expect(parse('a\tb', '\t').rows).toEqual([['a', 'b']]);
    expect(parse('a|b|', '|').rows).toEqual([['a', 'b', '']]);
  });

  it('stops at maxRows and marks truncation, without counting blank rows', () => {
    const v = parse('h\n1\n2\n\n3\n', ',', { ...opts, maxRows: 3 });
    expect(v.rows).toEqual([['h'], ['1'], ['2']]);
    expect(v.truncated).toBe(true);
    expect(parse('h\n1\n', ',', { ...opts, maxRows: 2 }).truncated).toBe(false);
  });

  it('fails on an unterminated quote, too many columns and too many cells', () => {
    expect(parseDelimited('a,"b\n', ',', opts)).toEqual({ ok: false, failure: { code: 'unterminated-quote', line: 1 } });
    const wide = Array.from({ length: 51 }, (_, i) => `c${i}`).join(',');
    expect(parseDelimited(`a,b\n${wide}\n`, ',', opts)).toEqual({ ok: false, failure: { code: 'too-many-columns', line: 2 } });
    expect(parseDelimited('a,b\n1,2\n3,4\n', ',', { ...opts, maxCells: 4 })).toEqual({ ok: false, failure: { code: 'too-many-cells', line: 3 } });
  });

  it('exactly 50 columns is fine and trailing empty columns are not counted', () => {
    const fifty = Array.from({ length: 50 }, (_, i) => `c${i}`).join(',');
    expect(parse(`${fifty}\n`).rows[0]).toHaveLength(50);
    expect(parse(`${fifty}${','.repeat(10)}\n`).rows[0]).toHaveLength(60);
  });

});

describe('delimited adapter: probe and read', () => {
  it('reads a comma file into one table of text cells with line references', async () => {
    const t = table(await read(utf8(SAMPLE_COMMA_CSV)));
    expect(t.rowCount).toBe(3);
    expect(t.colCount).toBe(7);
    expect(t.rows[0]![0]).toEqual({ v: 'sku', t: 'text' });
    expect(t.origin(0)).toEqual({ kind: 'line', line: 1 });
    expect(t.origin(2, 3)).toEqual({ kind: 'line', line: 3, column: 4 });
    expect(t.meta).toMatchObject({ encoding: 'utf-8', delimiter: 'comma' });
  });

  it('keeps physical line numbers across blank lines and banner rows', async () => {
    const t = table(await read(utf8('Stock report\n\nsku,qty,wh\nA-1,5,X\n')));
    expect(t.rows.map((r) => r[0]!.v)).toEqual(['Stock report', 'sku', 'A-1']);
    expect(t.origin(1)).toEqual({ kind: 'line', line: 3 });
    expect(t.origin(2)).toEqual({ kind: 'line', line: 4 });
  });

  it('reads semicolon, tab, pipe, UTF-16 and BOM variants to the same values', async () => {
    const expected = values(table(await read(utf8(SAMPLE_COMMA_CSV))));
    const forms = [
      utf8(SAMPLE_COMMA_CSV.split(',').join(';')),
      utf8(SAMPLE_COMMA_CSV.split(',').join('\t')),
      utf8(SAMPLE_COMMA_CSV.split(',').join('|')),
      utf8Bom(SAMPLE_COMMA_CSV),
      utf16le(SAMPLE_COMMA_CSV.split(',').join('\t')),
      utf16be(SAMPLE_COMMA_CSV.split(',').join(';'))
    ];
    for (const f of forms) expect(values(table(await read(f)))).toEqual(expected);
  });

  it('Windows-1252 is never applied silently: probe asks for confirmation with a decoded preview, read refuses until confirmed', async () => {
    const bytes = cp1252('sku;producto;almacén\nA-100;Camión ligero;Bogotá\n');
    const c = choices(await probe(bytes));
    expect(c.get('encoding')).toMatchObject({ status: 'needs-confirmation', value: 'windows-1252' });
    expect(c.get('encoding')?.sample?.[0]).toBe('sku;producto;almacén');
    expect(c.get('encoding')?.options.map((o) => o.value)).toEqual(['utf-8', 'utf-16le', 'utf-16be', 'windows-1252']);
    const refused = await read(bytes);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.code).toBe('ENCODING_NEEDS_CONFIRMATION');
    const t = table(await read(bytes, { encoding: 'windows-1252' }));
    expect(values(t)[1]).toEqual(['A-100', 'Camión ligero', 'Bogotá']);
    // once confirmed, the probe reports the choice as detected (by you)
    expect(choices(await probe(bytes, { encoding: 'windows-1252' })).get('encoding')?.status).toBe('detected');
  });

  it('an unclear separator is a choice with nothing preselected; choosing it makes the file readable', async () => {
    const bytes = utf8('a,b;c\n1,2;3\n4,5;6\n');
    expect(choices(await probe(bytes)).get('delimiter')).toMatchObject({ status: 'choose', value: null });
    const blocked = await read(bytes);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error.code).toBe('CHOICE_REQUIRED');
    expect(values(table(await read(bytes, { delimiter: 'semicolon' })))[1]).toEqual(['1,2', '3']);
    expect(values(table(await read(bytes, { delimiter: 'comma' })))[1]).toEqual(['1', '2;3']);
  });

  it('uses the recognizeHeader evidence supplied by the pipeline', async () => {
    const recognize = (t: string) => ['a', 'b', 'c'].includes(t);
    const tie = utf8('a,b;c\n1,2;3\n');
    expect(choices(await probe(tie, {}, { recognizeHeader: recognize })).get('delimiter')?.status).toBe('choose');
    const t2 = utf8('a;b;c\n1;2;3\n');
    expect(choices(await probe(t2, {}, { recognizeHeader: recognize })).get('delimiter')).toMatchObject({ status: 'detected', value: 'semicolon' });
  });

  it('a sep= line is an ordinary banner row: it never declares the separator (AD-1)', async () => {
    const bytes = utf8('sep=;\na;b;c\n1;2;3\n');
    expect(choices(await probe(bytes)).get('delimiter')).toMatchObject({ status: 'needs-confirmation', value: 'semicolon' });
    const t = table(await read(bytes));
    expect(values(t)).toEqual([['sep=', ''], ['a', 'b', 'c'], ['1', '2', '3']]);
    expect(t.origin(1)).toEqual({ kind: 'line', line: 2 });
    expect(t.notes).toEqual([]);
  });

  it('structure-only evidence is a CHECK (preselected, needs confirmation); a single column is refused until the user chooses', async () => {
    const check = choices(await probe(utf8('Col1;Col2;Col3;Col4\n1;2;3;4\n5;6;7;8\n')));
    expect(check.get('delimiter')).toMatchObject({ status: 'needs-confirmation', value: 'semicolon' });
    const single = utf8('sku\nA1\nB2\n');
    expect(choices(await probe(single)).get('delimiter')).toMatchObject({ status: 'choose', value: null });
    const blocked = await read(single);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error.message).toBe('This file has only one column, so it cannot be an inventory or shipments file.');
    expect(values(table(await read(single, { delimiter: 'comma' })))).toEqual([['sku'], ['A1'], ['B2']]);
  });

  it('an ambiguous decision offers only the tied separators', async () => {
    const recognize = (t: string) => ['sku', 'product_name', 'category', 'warehouse', 'quantity', 'reorder_point', 'unit_cost'].includes(t);
    const text = 'sku,product_name,category,warehouse;quantity;reorder_point;unit_cost\nA1,Bolt,Hardware,WH-DFW;5;2;1.5\nA2,Nut,Hardware,WH-ATL;9;3;0.5\n';
    const c = choices(await probe(utf8(text), {}, { recognizeHeader: recognize })).get('delimiter');
    expect(c).toMatchObject({ status: 'choose', value: null });
    expect(c?.options.map((o) => o.value)).toEqual(['comma', 'semicolon']);
  });

  it('maps parse failures to catalogue errors with the legacy wordings', async () => {
    const unterminated = await read(utf8('a,b\n1,"open\n'), { delimiter: 'comma' });
    expect(unterminated.ok).toBe(false);
    if (!unterminated.ok) expect(unterminated.error.message).toBe('The text is not well formed: Unterminated quoted field starting on line 2.');
    const wide = Array.from({ length: 51 }, (_, i) => `c${i}`).join(',');
    const tooWide = await read(utf8(`${wide}\n${wide}\n`));
    expect(tooWide.ok).toBe(false);
    if (!tooWide.ok) expect(tooWide.error.message).toMatch(/^Line 1 has more than 50 columns\./);
  });

  it('applies skipRows, sampleOnly and the scan-row cap', async () => {
    const rows = ['h,k,z', ...Array.from({ length: 300 }, (_, i) => `${i},x,y`)].join('\n');
    const skipped = table(await delimitedAdapter.read(sourceOf(utf8(rows)), { tableIndex: 0, options: {} }, { maxRows: 100, skipRows: 2 }, ctx()));
    expect(skipped.rows[0]![0]!.v).toBe('1');
    expect(skipped.origin(0)).toEqual({ kind: 'line', line: 3 });
    const sample = table(await delimitedAdapter.read(sourceOf(utf8(rows)), { tableIndex: 0, options: {} }, { maxRows: 100_000, sampleOnly: true }, ctx()));
    expect(sample.rows).toHaveLength(200);
    expect(sample.truncated).toBe(true);
    const capped = await delimitedAdapter.read(sourceOf(utf8(rows)), { tableIndex: 0, options: {} }, { maxRows: 100_000 }, ctx({ limits: { maxScanRows: 50 } }));
    expect(capped.ok).toBe(false);
    if (!capped.ok) expect(capped.error.message).toMatch(/too many rows to scan/);
  });

  it('probe reports evidence, facts and extension notices', async () => {
    const r = await probe(utf16le(SAMPLE_COMMA_CSV.split(',').join('\t')), {}, { hints: { extension: '.csv', fileName: 'stock.csv' } });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.facts).toMatchObject({ encoding: 'utf-16le', delimiter: 'tab', bom: true });
      expect(r.value.evidence.join(' ')).toContain('UTF-16 little-endian byte order mark');
      expect(r.value.notices.join(' ')).toContain('named .csv but it is UTF-16 (little-endian) text');
      expect(r.value.notices.join(' ')).toContain('columns are separated by tabs');
    }
    const txt = await probe(utf8(SAMPLE_COMMA_CSV), {}, { hints: { extension: '.txt' } });
    if (txt.ok) expect(txt.value.notices.join(' ')).toContain('named .txt');
  });

  it('refuses empty, whitespace-only, binary and oversize input with structured errors', async () => {
    const codes = async (bytes: Uint8Array, over: Partial<Parameters<typeof makeCtx>[0]> = {}) => {
      const r = await probe(bytes, {}, over);
      return r.ok ? 'ok' : r.error.code;
    };
    expect(await codes(new Uint8Array(0))).toBe('EMPTY_FILE');
    expect(await codes(utf8('  \n \n'))).toBe('EMPTY_FILE');
    expect(await codes(new Uint8Array(20))).toBe('ENCODING_INVALID');
    expect(await codes(utf8(SAMPLE_COMMA_CSV), { limits: { sourceBytes: 10 } })).toBe('LIMIT_SOURCE_BYTES');
  });

  it('detect never claims binary or UTF-32 and abstains on an empty head', () => {
    const hints = { extension: null, mimeType: null, fileName: null };
    expect(delimitedAdapter.detect(new Uint8Array(0), hints).confidence).toBe(0);
    expect(delimitedAdapter.detect(new Uint8Array(50), hints).confidence).toBe(0);
    expect(delimitedAdapter.detect(Uint8Array.of(0xff, 0xfe, 0, 0, 65, 0, 0, 0), hints).confidence).toBe(0);
    expect(delimitedAdapter.detect(utf8(SAMPLE_COMMA_CSV), hints)).toMatchObject({ evidenceClass: 'sniff' });
  });
});
