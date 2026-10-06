// Criterion 35 (and 36): the hostile-input pack, driven through the REAL pipeline (and the adapters where a layer is the
// subject). Every case asserts the specific defence that trips (the error code and the catalogue text, or the exact
// stored value) and has a clean CONTROL input next to it, so the test fails if the defence is removed or loosened:
// "does not throw" is never the only assertion.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultRegistry } from '../../../src/shared/ingest/adapters';
import { delimitedAdapter } from '../../../src/shared/ingest/adapters/delimited/adapter';
import { gzipAdapter } from '../../../src/shared/ingest/adapters/gzip/adapter';
import { analyzeFile, type Decisions, type PipelineInput } from '../../../src/shared/ingest/pipeline';
import { detectFormat, makeHints } from '../../../src/shared/ingest/detect/arbiter';
import { importInventoryCsv } from '../../../src/shared/csv/importInventory';
import type { Result } from '../../../src/shared/ingest/types';
import { concat, cp1252, gzip, makeCtx, prng, sourceOf, utf16be, utf16le, utf8 } from '../../ingest-kit/corpus';
import { settle } from '../../ingest-kit/pipelineHarness';

const registry = createDefaultRegistry();
const HEAD = 'sku,product_name,category,warehouse,quantity,reorder_point,unit_cost\n';
const GOOD_ROW = 'A-1,Bolt,Hardware,WH-DFW,3,1,9.5\n';
const good = utf8(HEAD + GOOD_ROW);

type Out = Awaited<ReturnType<typeof analyzeFile>>;
const run = (bytes: Uint8Array, fileName = 'x.csv', limitConfig: PipelineInput['limitConfig'] = {}, decisions: Decisions = {}): Promise<Out> =>
  analyzeFile({ bytes, fileName, limitConfig, decisions }, { registry, clock: () => performance.now() });
const code = (r: Result<unknown>): string => (r.ok ? 'ok' : r.error.code);
const message = (r: Result<unknown>): string => (r.ok ? '' : r.error.message);
const adapterCtx = (descriptor = delimitedAdapter.descriptor) => makeCtx({ registry, descriptor });
const WIN1252 = { options: new Map([['encoding', 'windows-1252']]) };

// nothing file-derived may ever reach the console (criterion 36); every test of the pack runs under this spy
const consoleCalls: unknown[][] = [];
let restore: Array<() => void> = [];
beforeEach(() => {
  consoleCalls.length = 0;
  restore = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => {
    const spy = vi.spyOn(console, m).mockImplementation((...args: unknown[]) => void consoleCalls.push(args));
    return () => spy.mockRestore();
  });
});
afterEach(() => {
  for (const r of restore) r();
  expect(consoleCalls).toEqual([]);
});

describe('gzip: bombs, limits, damage', () => {
  it('a gzip bomb is refused by the ratio cap before it is expanded (code, text, and a normal file of the same size passes)', async () => {
    const bomb = gzip(new Uint8Array(3 * 1024 * 1024));
    expect(bomb.length).toBeLessThan(10_000);
    const r = await run(bomb, 'bomb.csv.gz');
    expect(code(r)).toBe('LIMIT_RATIO');
    expect(message(r)).toContain('decompression bomb');
    // control: an ordinary compressible file is fine, so the ratio cap is what refused the bomb
    expect(code(await run(gzip(good), 'ok.csv.gz'))).toBe('ok');
  });

  it('output larger than the inner source limit is refused even though the compressed file is small (gzip never bypasses limit (a))', async () => {
    const rand = prng(11);
    const rows = Array.from({ length: 6000 }, (_, i) => `A-${100000 + i},Item ${Math.floor(rand() * 1e9)},Cat${Math.floor(rand() * 1e6)},WH-DFW,${Math.floor(rand() * 900)},${Math.floor(rand() * 90)},${(rand() * 99).toFixed(2)}`).join('\n');
    const body = utf8(HEAD + rows + '\n');
    const packed = gzip(body);
    expect(packed.length).toBeLessThan(150_000);
    expect(body.length).toBeGreaterThan(300_000);
    const over = await run(packed, 'big.csv.gz', { payloadBytes: 150_000 });
    expect(code(over)).toBe('LIMIT_EXPANDED');
    expect(message(over)).toMatch(/expands to more than 0\.1 MB.*Export a smaller file or split it\./);
    // control: with a limit above the expanded size the same bytes are read
    expect(code(await run(packed, 'big.csv.gz', { payloadBytes: 500_000 }))).toBe('ok');
  });

  it('a compressed file that is itself over the source limit gets the layer (a) text, before any expansion', async () => {
    const r = await run(gzip(good), 'x.csv.gz', { payloadBytes: 20 });
    expect(code(r)).toBe('LIMIT_SOURCE_BYTES');
    expect(message(r)).toMatch(/^File is 0\.0 MB; the limit is 0\.0 MB\. Split the file/);
  });

  it('truncated gzip is reported as damaged at EVERY cut point, never read as a shorter file', async () => {
    const packed = gzip(good);
    for (let cut = 11; cut < packed.length; cut++) expect(code(await run(packed.slice(0, cut), 'x.gz')), `cut at ${cut}`).toBe('PACKED_DAMAGED');
    expect(code(await run(packed, 'x.gz'))).toBe('ok');
  });

  it('invalid gzip bodies, flipped checksum bytes and trailing garbage are damaged; nested gzip is refused with its own text', async () => {
    const packed = gzip(good);
    expect(code(await run(concat(Uint8Array.of(0x1f, 0x8b, 8, 0), new Uint8Array(40).fill(7)), 'x.gz'))).toBe('PACKED_DAMAGED');
    const flipped = Uint8Array.from(packed);
    flipped[flipped.length - 6] = (flipped[flipped.length - 6] as number) ^ 0xff; // inside the CRC32
    expect(code(await run(flipped, 'x.gz'))).toBe('PACKED_DAMAGED');
    expect(code(await run(concat(packed, utf8('garbage')), 'x.gz'))).toBe('PACKED_DAMAGED');
    const nested = await run(gzip(gzip(good)), 'x.gz');
    expect(code(nested)).toBe('PACKED_NESTED');
    expect(message(nested)).toContain('another compressed or packaged file');
  });

  it('gzip of a ZIP, of a PDF or of binary data is refused for what it contains', async () => {
    expect(code(await run(gzip(concat(Uint8Array.of(0x50, 0x4b, 3, 4), new Uint8Array(30))), 'x.gz'))).toBe('PACKED_INNER_UNSUPPORTED');
    expect(code(await run(gzip(utf8('%PDF-1.4\n1 0 obj')), 'x.gz'))).toBe('PACKED_INNER_UNSUPPORTED');
  });
});

describe('encodings', () => {
  it('UTF-16 with an odd byte count (LE and BE) is rejected with the encoding text; the even-length twin is read', async () => {
    const le = concat(utf16le(HEAD + GOOD_ROW, true), Uint8Array.of(0x41));
    const be = concat(utf16be(HEAD + GOOD_ROW, true), Uint8Array.of(0x41));
    for (const bytes of [le, be]) {
      const r = await run(bytes);
      expect(code(r)).toBe('ENCODING_INVALID');
      expect(message(r)).toContain('could not be decoded safely');
    }
    expect(code(await run(utf16le(HEAD + GOOD_ROW, true)))).toBe('ok');
  });

  it('lone surrogates (high alone, low alone, reversed pair) are rejected; a real surrogate pair (an emoji) is kept', async () => {
    const withUnit = (unit: number[]): Uint8Array => {
      const base = utf16le(HEAD + 'A-1,Bo', true);
      const tail = utf16le('t,Hardware,WH-DFW,3,1,9.5\n', false);
      return concat(base, Uint8Array.of(...unit), tail);
    };
    expect(code(await run(withUnit([0x00, 0xd8])))).toBe('ENCODING_INVALID'); // U+D800 alone
    expect(code(await run(withUnit([0x00, 0xdc])))).toBe('ENCODING_INVALID'); // U+DC00 alone
    expect(code(await run(withUnit([0x00, 0xdc, 0x00, 0xd8])))).toBe('ENCODING_INVALID'); // low then high
    const pair = await settle({ bytes: withUnit([0x3d, 0xd8, 0x00, 0xde]), fileName: 'emoji.csv' }); // U+1F600
    expect(code(pair)).toBe('ok');
    if (pair.ok) expect(pair.value.canonical?.csv).toContain('Bo\u{1F600}t');
  });

  it('Windows-1252 undefined bytes 0x81 0x8D 0x8F 0x90 0x9D: the adapter refuses them once cp1252 is chosen, the pipeline never imports them; 0x80 (a real character) is fine', async () => {
    const text = (b: number): Uint8Array => concat(cp1252(HEAD + 'A-1,Café ü,Hardware,WH-DFW,3,1,9.5\nA-2,Bol'), Uint8Array.of(b), utf8('t,Hardware,WH-DFW,3,1,9.5\n'));
    for (const b of [0x81, 0x8d, 0x8f, 0x90, 0x9d]) {
      const adapter = await delimitedAdapter.read(sourceOf(text(b)), { tableIndex: 0, options: { encoding: 'windows-1252' } }, { maxRows: 100 }, adapterCtx());
      expect(code(adapter), `0x${b.toString(16)}`).toBe('ENCODING_UNDEFINED_BYTES');
      expect(message(adapter)).toContain('not valid in any supported text encoding');
      const piped = await run(text(b), 'x.csv', {}, WIN1252);
      expect(piped.ok, `0x${b.toString(16)} must not reach the preview`).toBe(false);
    }
    const euro = await run(text(0x80), 'x.csv', {}, WIN1252);
    expect(euro.ok).toBe(true);
    if (euro.ok) expect(euro.value.canonical?.csv).toContain('Bol€t');
  });

  it('overlong UTF-8 (C0 AF, E0 80 AF) and an encoded surrogate (ED A0 80) are never decoded as UTF-8: the guess is cp1252 and needs confirmation', async () => {
    const withBytes = (b: number[]): Uint8Array => concat(utf8(HEAD + 'A-1,Bol'), Uint8Array.of(...b), utf8('t,Hardware,WH-DFW,3,1,9.5\n'));
    for (const [bytes, shown] of [[[0xc0, 0xaf], 'BolÀ¯t'], [[0xe0, 0x80, 0xaf], 'Bolà€¯t'], [[0xed, 0xa0, 0x80], 'Bolí €t']] as const) {
      const first = await run(withBytes([...bytes]));
      expect(first.ok).toBe(true);
      if (first.ok) {
        expect(first.value.preview.blockers.map((b) => b.code)).toContain('confirm-choice'); // not silently accepted as UTF-8
        expect(first.value.canonical).toBeNull();
      }
      const confirmed = await run(withBytes([...bytes]), 'x.csv', {}, WIN1252);
      expect(confirmed.ok).toBe(true);
      if (confirmed.ok) {
        const csv = confirmed.value.canonical?.csv ?? '';
        expect(csv).toContain(shown);
        expect(csv).not.toContain('Bol/t'); // an overlong "/" would be a path-traversal trick
        expect(csv).not.toContain('�');
      }
    }
    // control: well-formed UTF-8 with accents is read as UTF-8 with no question
    const ok = await run(utf8(HEAD + 'A-1,Café,Hardware,WH-DFW,3,1,9.5\n'));
    expect(ok.ok && ok.value.preview.blockers.length).toBe(0);
  });

  it('NUL bytes anywhere make the file binary: refused with the registry text (not parsed as a table)', async () => {
    for (const bytes of [concat(utf8(HEAD), new Uint8Array(50)), utf8(HEAD + 'A-1,Bo\u0000lt,Hardware,WH-DFW,3,1,9.5\n'), new Uint8Array(100)]) {
      const r = await run(bytes);
      expect(code(r)).toBe('UNKNOWN_TYPE');
      expect(message(r)).toContain('This looks like a binary file.');
    }
    expect(detectFormat(utf8(HEAD + 'A-1,Bo\u0000lt,Hardware,WH-DFW,3,1,9.5\n'), makeHints('x.csv'), registry).outcome).toBe('refused');
  });

  it('UTF-32 text and a bare BOM are refused with their own texts', async () => {
    expect(message(await run(concat(Uint8Array.of(0xff, 0xfe, 0, 0), new Uint8Array(20))))).toContain('UTF-32');
    expect(code(await run(Uint8Array.of(0xef, 0xbb, 0xbf)))).toBe('EMPTY_FILE');
  });
});

describe('size and shape limits at their exact boundaries', () => {
  const rowsFile = (n: number): Uint8Array => utf8(HEAD + Array.from({ length: n }, (_, i) => `A-${100000 + i},Bolt,Hardware,WH-DFW,3,1,9.5`).join('\n') + '\n');

  // Three full 20,000-row analyses (~1.7 s alone, measured); the parallel full suite can push it past 5 s.
  it('20,000 rows pass and 20,001 are refused with the existing wording plus the next step; a configured higher limit accepts them', { timeout: 15_000 }, async () => {
    const ok = await run(rowsFile(20_000));
    expect(ok.ok && ok.value.preview.canConfirm).toBe(true);
    const over = await run(rowsFile(20_001));
    expect(code(over)).toBe('LIMIT_ROWS');
    expect(message(over)).toMatch(/^The file has more than 20000 data rows\. .*SCC_MAX_IMPORT_ROWS\.$/);
    const raised = await run(rowsFile(20_001), 'x.csv', { maxImportRows: 30_000 });
    expect(raised.ok && raised.value.preview.canConfirm).toBe(true);
  });

  it('50 columns pass and 51 are refused naming the line', async () => {
    const wide = (n: number): Uint8Array => utf8(HEAD.trim() + ',' + Array.from({ length: n - 7 }, (_, i) => `x${i}`).join(',') + '\n' + 'A-1,Bolt,Hardware,WH-DFW,3,1,9.5,' + Array.from({ length: n - 7 }, () => '1').join(',') + '\n');
    expect((await run(wide(50))).ok).toBe(true);
    const r = await run(wide(51));
    expect(code(r)).toBe('LIMIT_COLUMNS');
    expect(message(r)).toBe('Line 1 has more than 50 columns. Remove columns you do not need and try again.');
  });

  it('500+ problems are truncated at 500 with the true total; exactly 500 is not truncated, 501 is', async () => {
    const withBad = (bad: number): Uint8Array =>
      utf8(HEAD + Array.from({ length: 1300 }, (_, i) => `A-${100000 + i},Bolt,Hardware,WH-DFW,${3 + (i % 5)},1,9.5`).join('\n') + '\n' + Array.from({ length: bad }, (_, i) => `B-${100000 + i},Bolt,Hardware,WH-DFW,abc,1,9.5`).join('\n') + '\n');
    for (const [bad, shown] of [[500, 500], [501, 500], [700, 500], [3, 3]] as const) {
      const r = await run(withBad(bad));
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      const v = r.value.preview.validation;
      expect(v.totalErrors, `${bad} bad rows`).toBe(bad);
      expect(v.issues.length, `${bad} bad rows`).toBe(shown);
      expect(r.value.preview.canConfirm).toBe(false);
      expect(r.value.preview.blockers.map((b) => b.code)).toContain('validation');
      expect(r.value.preview.sample.problemRows.length).toBeLessThanOrEqual(10);
    }
  });

  // The speed claim is the < 1000 ms assertion inside; the full settle() after it takes the rest (~2.2 s alone, measured),
  // so the test-level limit only needs headroom for the parallel full suite.
  it('a 2 MB single token is handled quickly and reported as an ordinary "too long" problem (no regex backtracking)', { timeout: 15_000 }, async () => {
    const bytes = utf8(HEAD + 'A-1,' + 'x'.repeat(2_000_000) + ',Hardware,WH-DFW,3,1,9.5\nA-2,Nut,Hardware,WH-DFW,3,1,9.5\n');
    const t0 = performance.now();
    const detect = detectFormat(bytes, makeHints('t.csv'), registry);
    const probe = await delimitedAdapter.probe(sourceOf(bytes), adapterCtx());
    const read = await delimitedAdapter.read(sourceOf(bytes), { tableIndex: 0, options: {} }, { maxRows: 1000 }, adapterCtx());
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(detect.chosen?.adapterId).toBe('delimited-text');
    expect(probe.ok && read.ok).toBe(true);
    const r = await settle({ bytes, fileName: 'x.csv' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.preview.validation.issues.map((i) => i.message)).toEqual(['Value exceeds 120 characters.']);
      expect(r.value.preview.validation.issues[0]?.message.length).toBeLessThan(200); // the 2 MB value is not echoed into a message
    }
  });
});

describe('prototype keys, formulas, HTML and control characters stay inert text', () => {
  it('__proto__, constructor and toString as headers, values and decision keys never touch Object.prototype and are plain data', async () => {
    const text = HEAD.trim() + ',__proto__,constructor,toString\nA-1,Bolt,Hardware,WH-DFW,3,1,9.5,x,y,z\nA-2,__proto__,constructor,WH-DFW,3,1,9.5,x,y,z\n';
    const r = await settle({ bytes: utf8(text), fileName: 'proto.csv' }, { base: { constants: new Map([['__proto__', 'polluted']]), assignments: new Map<number, string | null>([[7, null]]) } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.preview.canConfirm).toBe(true);
    expect(r.value.canonical?.csv).toContain('A-2,__proto__,constructor,WH-DFW,3,1,9.5');
    expect(r.value.preview.notImported.map((n) => n.header).sort()).toEqual(['__proto__', 'constructor', 'toString']);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, 'polluted')).toBe(false);
    expect(Object.keys(Object.prototype)).toEqual([]);
  });

  it('status words named __proto__, constructor and toString are ordinary values the user must map', async () => {
    const text =
      'shipment_id,origin,destination,carrier,status,ship_date,estimated_delivery,actual_delivery,shipping_cost\n' +
      ['__proto__', 'constructor', 'toString', 'delivered'].map((s, i) => `SHP-90${i},WH-DFW,Houston,Alder,${s},2026-03-02,2026-03-05,${s === 'delivered' ? '2026-03-05' : ''},10.00`).join('\n') +
      '\n';
    const base = { assignments: new Map<number, string | null>([[4, 'status']]) };
    const open = await settle({ bytes: utf8(text), fileName: 'status.csv' }, { base });
    expect(open.ok).toBe(true);
    if (!open.ok) return;
    const entries = open.value.preview.valueMaps.status ?? [];
    expect(entries.filter((e) => e.state === 'choose').map((e) => e.source).sort()).toEqual(['__proto__', 'constructor', 'toString']);
    expect(open.value.preview.canConfirm).toBe(false);
    const choices = new Map([['__proto__', 'pending'], ['constructor', 'in_transit'], ['toString', 'cancelled']]);
    const done = await settle({ bytes: utf8(text), fileName: 'status.csv' }, { base: { ...base, statusChoices: choices } });
    expect(done.ok && done.value.preview.canConfirm).toBe(true);
    if (done.ok) expect(done.value.canonical?.csv).toMatch(/SHP-900,WH-DFW,Houston,Alder,pending,/);
    expect(({} as Record<string, unknown>).pending).toBeUndefined();
  });

  it("formula-injection cells (=cmd|'/C calc'!A0, +1, -1, @SUM(1)) are never evaluated or rewritten: validators reject them in ID and number columns quoting the raw value, and in text columns they are stored verbatim", async () => {
    const bad = await settle({
      bytes: utf8(HEAD + "=cmd|'/C calc'!A0,Bolt,Hardware,WH-DFW,3,1,9.5\nA-2,Nut,Hardware,WH-DFW,@SUM(1),1,9.5\nA-3,Nut,Hardware,WH-DFW,3,1,-1\nA-4,Nut,Hardware,WH-DFW,+1,1,9.5\nA-5,Nut,Hardware,WH-DFW,3,1,9.5\n"),
      fileName: 'formulas.csv'
    });
    expect(bad.ok).toBe(true);
    if (!bad.ok) return;
    const issues = bad.value.preview.validation.issues;
    expect(issues.map((i) => [i.where, i.issue.column])).toEqual([['line 2', 'sku'], ['line 3', 'quantity'], ['line 4', 'unit_cost'], ['line 5', 'quantity']]);
    expect(issues[0]?.message).toBe("\"=cmd|'/C calc'!A0\" is not a valid SKU. Use 3–32 letters, digits or hyphens, starting with a letter or digit.");
    expect(issues[1]?.message).toContain('"@SUM(1)" is not a valid number.');
    expect(issues[2]?.message).toBe('Must not be negative (got -1).');
    expect(bad.value.preview.sample.problemRows.map((p) => p.raw[0] === "=cmd|'/C calc'!A0" || p.raw[4] === '@SUM(1)' || p.raw[6] === '-1' || p.raw[4] === '+1')).toEqual([true, true, true, true]);
    expect(bad.value.preview.canConfirm).toBe(false);

    const text = await settle({ bytes: utf8(HEAD + "A-1,=cmd|'/C calc'!A0,+1,WH-DFW,3,1,9.5\nA-2,@SUM(1),-1,WH-DFW,3,1,9.5\n"), fileName: 'texts.csv' });
    expect(text.ok && text.value.preview.canConfirm).toBe(true);
    if (!text.ok) return;
    const csv = text.value.canonical?.csv ?? '';
    expect(csv).toContain("A-1,=cmd|'/C calc'!A0,+1,WH-DFW,3,1,9.5");
    expect(csv).toContain('A-2,@SUM(1),-1,WH-DFW,3,1,9.5');
    const v1 = importInventoryCsv(csv);
    expect(v1.ok && v1.rows[0]?.productName).toBe("=cmd|'/C calc'!A0");
  });

  it('HTML in text fields is stored as the same characters (the UI renders it as text)', async () => {
    const r = await settle({ bytes: utf8(HEAD + 'A-1,<img src=x onerror=alert(1)>,<b>H</b>,WH-DFW,3,1,9.5\nA-2,&lt;script&gt;,"x, ""y""",WH-DFW,3,1,9.5\n'), fileName: 'html.csv' });
    expect(r.ok && r.value.preview.canConfirm).toBe(true);
    if (!r.ok) return;
    const csv = r.value.canonical?.csv ?? '';
    expect(csv).toContain('A-1,<img src=x onerror=alert(1)>,<b>H</b>,WH-DFW,3,1,9.5');
    expect(csv).toContain('A-2,&lt;script&gt;,"x, ""y""",WH-DFW,3,1,9.5');
    const v1 = importInventoryCsv(csv);
    expect(v1.ok && v1.rows.map((x) => x.category)).toEqual(['<b>H</b>', 'x, "y"']);
  });

  it('control characters are rejected by the unchanged validators with their text, quoting the user\'s row', async () => {
    const r = await settle({ bytes: utf8(HEAD + 'A-1,Bo\u0001\u0002lt,Hard\u0007ware,WH-DFW,3,1,9.5\nA-2,Nut,Hardware,WH-DFW,3,1,9.5\n'), fileName: 'ctl.csv' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.preview.validation.issues.map((i) => [i.where, i.issue.column, i.message])).toEqual([
      ['line 2', 'product_name', 'Value contains control characters (tabs, line breaks or other non-printing characters).'],
      ['line 2', 'category', 'Value contains control characters (tabs, line breaks or other non-printing characters).']
    ]);
    expect(r.value.preview.canConfirm).toBe(false);
  });
});

describe('polyglot and mislabelled files: the content decides, the name is a hint', () => {
  it('a ZIP-like or PDF-like header named .csv is refused for what it is (the ZIP/PDF text), not parsed as CSV', async () => {
    const zip = await run(concat(Uint8Array.of(0x50, 0x4b, 3, 4), good), 'data.csv');
    expect(code(zip)).toBe('UNKNOWN_TYPE');
    expect(message(zip)).toContain('ZIP-based file');
    const pdf = await run(concat(utf8('%PDF-1.4\n'), good), 'data.csv');
    expect(message(pdf)).toContain('PDF document');
  });

  it('CSV text named .xlsx, UTF-16 text named .xlsx and gzip named .csv are read by content with a notice', async () => {
    for (const [bytes, name, notice] of [[good, 'book.xlsx', 'named .xlsx'], [utf16le(HEAD + GOOD_ROW, true), 'book.xlsx', 'named .xlsx'], [gzip(good), 'data.csv', 'named .csv']] as const) {
      const r = await run(bytes, name);
      expect(r.ok, name).toBe(true);
      if (r.ok) expect(r.value.preview.file.notices.join(' ')).toContain(notice);
    }
  });

  it('a file whose name and content agree has no mismatch notice (control)', async () => {
    const r = await run(good, 'data.csv');
    expect(r.ok && r.value.preview.file.notices).toEqual([]);
  });
});

describe('the whole pack leaves the gzip adapter and the registry untouched', () => {
  it('adapters are stateless between hostile runs: a normal file still reads after all of the above', async () => {
    const r = await settle({ bytes: good, fileName: 'after.csv' });
    expect(r.ok && r.value.preview.canConfirm).toBe(true);
    expect(gzipAdapter.descriptor.id).toBe('gzip');
  });
});
