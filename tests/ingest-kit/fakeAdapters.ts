// Test-only fake adapters that prove the contracts are not CSV-shaped: a toy line format (T-DUMMY), a multi-table
// typed-cell source (spreadsheet-like: hidden table, merged-fill note, date-typed cells, `cell` refs), a nested-record
// source (JSON/XML-like: path refs, child arrays) and a positioned-text source (PDF-like: pages, runs, images-only).
// None of these exist under src/: they are registered into a test registry only.

import type {
  AdapterDescriptor,
  ByteSource,
  Ctx,
  DetectionVote,
  ExtractionNote,
  ExtractionResult,
  FormatAdapter,
  Hints,
  ProbeResult,
  RawCell,
  RawTable,
  ReadOptions,
  RecordNode,
  RecordValue,
  Result,
  Selection,
  SourceRef,
  TextRun
} from '../../src/shared/ingest/types';
import { NO_VOTE } from '../../src/shared/ingest/types';
import { ingestError } from '../../src/shared/ingest/messages';
import { sourceTooLarge } from '../../src/shared/ingest/limits';
import { asciiBytes, matchesSignature, readAll } from '../../src/shared/ingest/detect/bytes';
import { utf8 } from './corpus';

function baseDescriptor(over: Partial<AdapterDescriptor> & Pick<AdapterDescriptor, 'id' | 'family' | 'yields' | 'sourceRefKind' | 'signatures'>): AdapterDescriptor {
  return {
    version: '1.0.0',
    status: 'stable',
    hints: { extensions: [], mimeTypes: [] },
    contentSniff: false,
    multiTable: false,
    hierarchical: false,
    typedCells: false,
    streaming: 'none',
    wrappable: false,
    resourceHints: { needsWorker: false },
    messages: {},
    ...over
  };
}

function magicDetect(magic: string, label: string) {
  const bytes = asciiBytes(magic);
  return (head: Uint8Array): DetectionVote =>
    matchesSignature(head, { offset: 0, bytes }) ? { confidence: 1, evidenceClass: 'magic', evidence: [label] } : NO_VOTE;
}

function precheck(src: ByteSource, ctx: Ctx, descriptor: AdapterDescriptor, stage: 'probe' | 'read'): Result<string> {
  if (ctx.signal.aborted) return { ok: false, error: ingestError('CANCELLED', stage) };
  const tooLarge = sourceTooLarge(ctx.limits, descriptor, src.size);
  if (tooLarge !== null) return { ok: false, error: tooLarge };
  return { ok: true, value: new TextDecoder().decode(readAll(src)) };
}

function body(text: string, magic: string): string | null {
  return text.startsWith(magic) ? text.slice(magic.length) : null;
}

function malformed(stage: 'probe' | 'read'): Result<never> {
  return { ok: false, error: ingestError('READ_FAILED', stage) };
}

function makeTable(adapterId: string, name: string, index: number, hidden: boolean, rows: RawCell[][], origin: (r: number, c?: number) => SourceRef, notes: ExtractionNote[], cap: number, columns?: RawTable['columns']): RawTable {
  const truncated = rows.length > cap;
  const kept = truncated ? rows.slice(0, cap) : rows;
  let colCount = 0;
  for (const r of kept) if (r.length > colCount) colCount = r.length;
  const table: RawTable = { ref: { adapterId, name, index }, name, hidden, rows: kept, rowCount: kept.length, colCount, truncated, origin, notes };
  if (columns !== undefined) table.columns = columns;
  return table;
}

// ---- 1. toy key=value line format (T-DUMMY) ----------------------------------------------------------------------------

export const TOY_MAGIC = '#TOYFMT1\n';

export function encodeToy(records: Array<Array<[string, string]>>): Uint8Array {
  return utf8(TOY_MAGIC + records.map((r) => r.map(([k, v]) => `${k}=${v}`).join(';')).join('\n') + '\n');
}

const TOY_DESCRIPTOR = baseDescriptor({
  id: 'toy-kv',
  family: 'Toy key-value text',
  hints: { extensions: ['.toy'], mimeTypes: ['text/x-toy'] },
  signatures: [{ offset: 0, bytes: asciiBytes(TOY_MAGIC) }],
  yields: ['tables'],
  sourceRefKind: ['line']
});

export const toyAdapter: FormatAdapter = {
  descriptor: TOY_DESCRIPTOR,
  detect: magicDetect(TOY_MAGIC, 'toy format header line'),
  async probe(src, ctx): Promise<Result<ProbeResult>> {
    const text = precheck(src, ctx, TOY_DESCRIPTOR, 'probe');
    if (!text.ok) return text;
    const b = body(text.value, TOY_MAGIC);
    if (b === null) return malformed('probe');
    const n = b.split('\n').filter((l) => l.trim() !== '').length;
    return { ok: true, value: { tables: [{ name: 'Toy', hidden: false, rowCountEstimate: n }], choices: [], evidence: ['toy format header line'], notices: [], facts: {} } };
  },
  async read(src, _sel, opts, ctx): Promise<Result<ExtractionResult>> {
    const text = precheck(src, ctx, TOY_DESCRIPTOR, 'read');
    if (!text.ok) return text;
    const b = body(text.value, TOY_MAGIC);
    if (b === null) return malformed('read');
    const lines: number[] = [];
    const records: Array<Array<[string, string]>> = [];
    b.split('\n').forEach((line, i) => {
      if (line.trim() === '') return;
      lines.push(i + 2); // physical line: the magic line is line 1
      records.push(line.split(';').map((pair): [string, string] => {
        const eq = pair.indexOf('=');
        return eq === -1 ? [pair, ''] : [pair.slice(0, eq), pair.slice(eq + 1)];
      }));
    });
    const keys: string[] = [];
    for (const r of records) for (const [k] of r) if (!keys.includes(k)) keys.push(k);
    const rows: RawCell[][] = records.map((r) => keys.map((k): RawCell => ({ v: r.find(([key]) => key === k)?.[1] ?? '', t: 'text' })));
    const table = makeTable(TOY_DESCRIPTOR.id, 'Toy', 0, false, rows, (r, c) => (c === undefined ? { kind: 'line', line: lines[r] ?? 1 } : { kind: 'line', line: lines[r] ?? 1, column: c + 1 }), [], opts.maxRows, keys.map((header) => ({ header })));
    return { ok: true, value: { kind: 'tables', tables: [table] } };
  }
};

// ---- 2. multi-table typed-cell source ---------------------------------------------------------------------------------

export const MTC_MAGIC = '%MTC1\n';

export interface FakeSheet {
  name: string;
  hidden?: boolean;
  /** Rows of typed cells; `merged` lists [row, col] positions whose value was filled from the merged range. */
  rows: Array<Array<{ v: string; t: RawCell['t'] }>>;
  merged?: Array<[number, number]>;
}

export function encodeMulti(sheets: FakeSheet[]): Uint8Array {
  return utf8(MTC_MAGIC + JSON.stringify({ sheets }));
}

const MTC_DESCRIPTOR = baseDescriptor({
  id: 'fake-multi',
  family: 'Fake multi-sheet workbook',
  hints: { extensions: ['.mtc'], mimeTypes: [] },
  signatures: [{ offset: 0, bytes: asciiBytes(MTC_MAGIC) }],
  yields: ['tables'],
  multiTable: true,
  typedCells: true,
  streaming: 'incremental',
  sourceRefKind: ['cell']
});

function parseSheets(text: string): FakeSheet[] | null {
  const b = body(text, MTC_MAGIC);
  if (b === null) return null;
  try {
    const parsed = JSON.parse(b) as { sheets?: FakeSheet[] };
    return Array.isArray(parsed.sheets) ? parsed.sheets : null;
  } catch {
    return null;
  }
}

export const multiTableAdapter: FormatAdapter = {
  descriptor: MTC_DESCRIPTOR,
  detect: magicDetect(MTC_MAGIC, 'fake workbook header'),
  async probe(src, ctx): Promise<Result<ProbeResult>> {
    const text = precheck(src, ctx, MTC_DESCRIPTOR, 'probe');
    if (!text.ok) return text;
    const sheets = parseSheets(text.value);
    if (sheets === null) return malformed('probe');
    return {
      ok: true,
      value: {
        tables: sheets.map((s) => ({ name: String(s.name), hidden: s.hidden === true, rowCountEstimate: s.rows.length })),
        choices: [],
        evidence: [`${sheets.length} sheet(s)`],
        notices: [],
        facts: { sheets: sheets.length }
      }
    };
  },
  async read(src, sel, opts, ctx): Promise<Result<ExtractionResult>> {
    const text = precheck(src, ctx, MTC_DESCRIPTOR, 'read');
    if (!text.ok) return text;
    const sheets = parseSheets(text.value);
    if (sheets === null) return malformed('read');
    const chosen = sheets.map((s, i) => ({ s, i })).filter(({ i }) => i === sel.tableIndex || sel.tableIndex < 0);
    const tables = chosen.map(({ s, i }) => {
      const rows: RawCell[][] = s.rows.map((r) => r.map((c): RawCell => ({ v: String(c.v), t: c.t })));
      const notes: ExtractionNote[] = [];
      if ((s.merged?.length ?? 0) > 0) notes.push({ code: 'merged-filled', message: `${s.merged?.length} merged cell(s) were filled with the top-left value.`, count: s.merged?.length ?? 0 });
      const name = String(s.name);
      return makeTable(MTC_DESCRIPTOR.id, name, i, s.hidden === true, rows, (r, c) => ({ kind: 'cell', sheet: name, row: r + 1, col: (c ?? 0) + 1 }), notes, opts.maxRows);
    });
    if (tables.length === 0) return malformed('read');
    return { ok: true, value: { kind: 'tables', tables } };
  }
};

// ---- 3. nested-record source --------------------------------------------------------------------------------------------

export const REC_MAGIC = '%REC1\n';

export function encodeRecords(name: string, records: unknown[]): Uint8Array {
  return utf8(REC_MAGIC + JSON.stringify({ name, records }));
}

const REC_DESCRIPTOR = baseDescriptor({
  id: 'fake-records',
  family: 'Fake nested records',
  hints: { extensions: ['.rec'], mimeTypes: [] },
  signatures: [{ offset: 0, bytes: asciiBytes(REC_MAGIC) }],
  yields: ['records'],
  hierarchical: true,
  typedCells: true,
  streaming: 'incremental',
  sourceRefKind: ['path', 'record']
});

function toNode(value: unknown, path: string, index: number): RecordNode {
  const entries: Array<[string, RecordValue]> = [];
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const childPath = `${path}.${k}`;
      if (Array.isArray(v)) entries.push([k, v.map((item, i) => toNode(item, `${childPath}[${i}]`, i))]);
      else if (typeof v === 'object' && v !== null) entries.push([k, toNode(v, childPath, 0)]);
      else entries.push([k, v === null || v === undefined ? null : String(v)]);
    }
  }
  return { path, index, entries };
}

function parseRecords(text: string): { name: string; records: unknown[] } | null {
  const b = body(text, REC_MAGIC);
  if (b === null) return null;
  try {
    const parsed = JSON.parse(b) as { name?: string; records?: unknown[] };
    return Array.isArray(parsed.records) ? { name: String(parsed.name ?? 'records'), records: parsed.records } : null;
  } catch {
    return null;
  }
}

export const recordAdapter: FormatAdapter = {
  descriptor: REC_DESCRIPTOR,
  detect: magicDetect(REC_MAGIC, 'fake record header'),
  async probe(src, ctx): Promise<Result<ProbeResult>> {
    const text = precheck(src, ctx, REC_DESCRIPTOR, 'probe');
    if (!text.ok) return text;
    const parsed = parseRecords(text.value);
    if (parsed === null) return malformed('probe');
    return { ok: true, value: { tables: [{ name: parsed.name, hidden: false, rowCountEstimate: parsed.records.length }], choices: [], evidence: [`${parsed.records.length} record(s)`], notices: [], facts: {} } };
  },
  async read(src, _sel, opts, ctx): Promise<Result<ExtractionResult>> {
    const text = precheck(src, ctx, REC_DESCRIPTOR, 'read');
    if (!text.ok) return text;
    const parsed = parseRecords(text.value);
    if (parsed === null) return malformed('read');
    const records = parsed.records.slice(0, opts.maxRows).map((r, i) => toNode(r, `$.${parsed.name}[${i}]`, i));
    return { ok: true, value: { kind: 'records', records, name: parsed.name } };
  }
};

// ---- 4. positioned-text source ---------------------------------------------------------------------------------------

export const PTX_MAGIC = '%PTX1\n';
export const PTX_IMAGES_MAGIC = '%PTX1-IMG\n';

export function encodePositioned(pages: TextRun[][]): Uint8Array {
  return utf8(PTX_MAGIC + JSON.stringify({ pages }));
}

export function encodeImagesOnly(pages: number): Uint8Array {
  return utf8(PTX_IMAGES_MAGIC + JSON.stringify({ pages }));
}

const PTX_DESCRIPTOR = baseDescriptor({
  id: 'fake-positioned',
  family: 'Fake paginated document',
  hints: { extensions: ['.ptx'], mimeTypes: [] },
  signatures: [{ offset: 0, bytes: asciiBytes('%PTX1') }],
  yields: ['positioned-text', 'images-only'],
  sourceRefKind: ['page']
});

export const positionedAdapter: FormatAdapter = {
  descriptor: PTX_DESCRIPTOR,
  detect: (head: Uint8Array, _hints: Hints) => magicDetect('%PTX1', 'fake document header')(head),
  async probe(src, ctx): Promise<Result<ProbeResult>> {
    const text = precheck(src, ctx, PTX_DESCRIPTOR, 'probe');
    if (!text.ok) return text;
    if (!text.value.startsWith('%PTX1')) return malformed('probe');
    return { ok: true, value: { tables: [{ name: 'Pages', hidden: false }], choices: [], evidence: ['fake document header'], notices: [], facts: {} } };
  },
  async read(src, _sel, _opts, ctx): Promise<Result<ExtractionResult>> {
    const text = precheck(src, ctx, PTX_DESCRIPTOR, 'read');
    if (!text.ok) return text;
    try {
      if (text.value.startsWith(PTX_IMAGES_MAGIC)) {
        const parsed = JSON.parse(text.value.slice(PTX_IMAGES_MAGIC.length)) as { pages?: number };
        return { ok: true, value: { kind: 'images-only', pages: Number(parsed.pages ?? 1) } };
      }
      const b = body(text.value, PTX_MAGIC);
      if (b === null) return malformed('read');
      const parsed = JSON.parse(b) as { pages?: TextRun[][] };
      if (!Array.isArray(parsed.pages)) return malformed('read');
      return { ok: true, value: { kind: 'positioned-text', pages: parsed.pages, name: 'Pages' } };
    } catch {
      return malformed('read');
    }
  }
};

export const fakeAdapters: readonly FormatAdapter[] = [toyAdapter, multiTableAdapter, recordAdapter, positionedAdapter];
