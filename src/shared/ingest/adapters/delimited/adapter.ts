// The delimited-text adapter: the first registered adapter. Comma, semicolon, tab and pipe separated text in UTF-8,
// UTF-16 (with BOM) and, after the user's confirmation, Windows-1252. It yields one table of text cells with `line`
// source references and knows nothing about SCC fields: mapping, dates and numbers are pipeline stages.

import type {
  AdapterChoice,
  ByteSource,
  Ctx,
  DetectionVote,
  ExtractionNote,
  FormatAdapter,
  Hints,
  ProbeResult,
  RawCell,
  RawTable,
  ReadOptions,
  Result,
  Selection,
  SourceRef
} from '../../types';
import { NO_VOTE } from '../../types';
import { sourceTooLarge, tooComplex, tooManyColumns, tooManyScanRows } from '../../limits';
import { ingestError } from '../../messages';
import { readAll } from '../../detect/bytes';
import { ENCODING_LABELS, decodeText, detectEncoding, isEncodingId, type EncodingDetection, type TextEncodingId } from './encoding';
import { DELIMITER_LABELS, DELIMITER_NAMES, detectDelimiter, type Delim, type DelimiterDecision } from './sniff';
import { parseDelimited } from './parse';

export const DELIMITED_ADAPTER_ID = 'delimited-text';

function separatorName(char: string): string {
  return DELIMITER_NAMES.find(([, c]) => c === char)?.[0] ?? char;
}

function separatorChar(name: string): Delim | null {
  return DELIMITER_NAMES.find(([n]) => n === name)?.[1] ?? null;
}

/** What the adapter reports about the separator, derived from the R3 decision (AD-1). */
interface Guess {
  delimiter: Delim | null;
  status: AdapterChoice['status'];
  /** Separators offered in the select: only the tied ones for an ambiguous decision, else all four. */
  options: Delim[];
  evidence: string[];
  single: boolean;
}

const ALL_DELIMS: Delim[] = DELIMITER_NAMES.map(([, c]) => c);

function toGuess(d: DelimiterDecision): Guess {
  switch (d.kind) {
    case 'detected':
      return { delimiter: d.delimiter, status: 'detected', options: ALL_DELIMS, evidence: d.evidence, single: false };
    case 'check':
      return { delimiter: d.delimiter, status: 'needs-confirmation', options: ALL_DELIMS, evidence: d.evidence, single: false };
    case 'ambiguous':
      return { delimiter: null, status: 'choose', options: d.candidates, evidence: d.evidence, single: false };
    case 'none':
      return { delimiter: null, status: 'choose', options: ALL_DELIMS, evidence: d.evidence, single: false };
    case 'single-column':
      return { delimiter: null, status: 'choose', options: ALL_DELIMS, evidence: d.evidence, single: true };
  }
}

const HEAD_SAMPLE_LINES = 5;

interface Loaded {
  bytes: Uint8Array;
  detection: EncodingDetection;
  encoding: TextEncodingId;
  text: string;
  guess: Guess;
}

const decodedCache = new WeakMap<ByteSource, Map<string, string>>();
const detectionCache = new WeakMap<ByteSource, EncodingDetection>();

function cachedDetection(src: ByteSource, bytes: Uint8Array): EncodingDetection {
  let d = detectionCache.get(src);
  if (d === undefined) {
    d = detectEncoding(bytes, true);
    detectionCache.set(src, d);
  }
  return d;
}

function cachedDecode(src: ByteSource, bytes: Uint8Array, encoding: TextEncodingId): ReturnType<typeof decodeText> {
  let perSource = decodedCache.get(src);
  const hit = perSource?.get(encoding);
  if (hit !== undefined) return { ok: true, text: hit };
  const result = decodeText(bytes, encoding);
  if (result.ok) {
    if (perSource === undefined) {
      perSource = new Map();
      decodedCache.set(src, perSource);
    }
    perSource.set(encoding, result.text);
  }
  return result;
}

function load(src: ByteSource, ctx: Ctx, options: Record<string, string>, stage: 'probe' | 'read'): Result<Loaded> {
  if (ctx.signal.aborted) return { ok: false, error: ingestError('CANCELLED', stage) };
  const tooLarge = sourceTooLarge(ctx.limits, DESCRIPTOR, src.size);
  if (tooLarge !== null) return { ok: false, error: tooLarge };
  if (src.size === 0) return { ok: false, error: ingestError('EMPTY_FILE', stage) };
  const bytes = readAll(src);
  const detection = cachedDetection(src, bytes);
  if (detection.encoding === null) {
    const code = detection.refusal === 'undefined-bytes' ? 'ENCODING_UNDEFINED_BYTES' : 'ENCODING_INVALID';
    return { ok: false, error: ingestError(code, stage) };
  }
  let encoding = detection.encoding;
  const chosen = options.encoding;
  if (chosen !== undefined) {
    if (!isEncodingId(chosen)) return { ok: false, error: ingestError('ENCODING_INVALID', stage) };
    encoding = chosen;
  }
  const decoded = cachedDecode(src, bytes, encoding);
  if (!decoded.ok) {
    const code = decoded.reason === 'undefined-byte' ? 'ENCODING_UNDEFINED_BYTES' : 'ENCODING_INVALID';
    return { ok: false, error: ingestError(code, stage) };
  }
  if (decoded.text.trim() === '') return { ok: false, error: ingestError('EMPTY_FILE', stage) };
  const override = options.delimiter !== undefined ? separatorChar(options.delimiter) : null;
  const guess: Guess =
    override !== null
      ? { delimiter: override, status: 'detected', options: ALL_DELIMS, evidence: ['separator chosen by you'], single: false }
      : toGuess(detectDelimiter(decoded.text, ctx.recognizeHeader));
  return { ok: true, value: { bytes, detection, encoding, text: decoded.text, guess } };
}

function firstLines(text: string, n: number): string[] {
  const out: string[] = [];
  let i = 0;
  while (out.length < n && i < text.length) {
    let j = i;
    while (j < text.length && text.charCodeAt(j) !== 10 && text.charCodeAt(j) !== 13) j++;
    out.push(text.slice(i, Math.min(j, i + 160)).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' '));
    i = j + (text.charCodeAt(j) === 13 && text.charCodeAt(j + 1) === 10 ? 2 : 1);
  }
  return out;
}

function countLines(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

function notesFor(loaded: Loaded, hints: Hints | undefined): string[] {
  const notices: string[] = [];
  const ext = hints?.extension ?? null;
  const delimiter = loaded.guess.delimiter;
  if (loaded.encoding === 'utf-16le' || loaded.encoding === 'utf-16be') {
    const lead = ext === null ? 'This file is' : `This file is named ${ext} but it is`;
    notices.push(`${lead} ${ENCODING_LABELS[loaded.encoding]} text. It was read by its content.`);
  }
  if (ext !== null && delimiter !== null) {
    const natural = ext === '.csv' ? [',', ';'] : ext === '.tsv' ? ['\t'] : null;
    if (natural !== null && !natural.includes(delimiter)) {
      notices.push(`This file is named ${ext} but its columns are separated by ${(DELIMITER_LABELS[delimiter]).replace(/ \(.*\)$/, '').toLowerCase()}s. It was read by its content.`);
    } else if (ext === '.txt') {
      notices.push(`This file is named .txt; it was read as ${separatorName(delimiter)}-separated text based on its content.`);
    }
  }
  return notices;
}

function encodingChoice(loaded: Loaded, userChose: boolean): AdapterChoice {
  const needs = loaded.detection.needsConfirmation && !userChose;
  const choice: AdapterChoice = {
    key: 'encoding',
    label: 'Text encoding',
    status: needs ? 'needs-confirmation' : 'detected',
    value: needs ? loaded.encoding : loaded.encoding,
    options: (Object.keys(ENCODING_LABELS) as TextEncodingId[]).map((value) => ({ value, label: ENCODING_LABELS[value] })),
    evidence: userChose ? ['encoding chosen by you'] : loaded.detection.evidence
  };
  if (needs) {
    choice.sample = firstLines(loaded.text, HEAD_SAMPLE_LINES);
    choice.blocksRead = true; // a guessed encoding is never applied silently
  }
  return choice;
}

function delimiterChoice(loaded: Loaded, userChose: boolean): AdapterChoice {
  const g = loaded.guess;
  return {
    key: 'delimiter',
    label: 'Separator',
    status: userChose ? 'detected' : g.status,
    value: g.delimiter === null ? null : separatorName(g.delimiter),
    options: g.options.map((char) => ({ value: separatorName(char), label: DELIMITER_LABELS[char] })),
    evidence: userChose ? ['separator chosen by you'] : g.evidence
  };
}

const DESCRIPTOR: FormatAdapter['descriptor'] = {
  id: DELIMITED_ADAPTER_ID,
  version: '1.0.0',
  family: 'Delimited text',
  status: 'stable',
  hints: {
    extensions: ['.csv', '.tsv', '.txt'],
    mimeTypes: ['text/csv', 'text/tab-separated-values', 'text/plain', 'application/csv']
  },
  signatures: [],
  contentSniff: true,
  yields: ['tables'],
  multiTable: false,
  hierarchical: false,
  typedCells: false,
  streaming: 'incremental',
  sourceRefKind: ['line'],
  wrappable: true,
  // No source-size hint: the family follows the canonical payload limit (2 MiB by default).
  resourceHints: { needsWorker: false },
  messages: {}
};

const DETECT_HEAD_TEXT_LIMIT = 64 * 1024;

export const delimitedAdapter: FormatAdapter = {
  descriptor: DESCRIPTOR,

  detect(head: Uint8Array, _hints: Hints): DetectionVote {
    try {
      if (head.length === 0) return NO_VOTE;
      const detection = detectEncoding(head, false);
      if (detection.encoding === null) return NO_VOTE;
      const window = head.length > DETECT_HEAD_TEXT_LIMIT ? head.subarray(0, DETECT_HEAD_TEXT_LIMIT) : head;
      const decoded = decodeText(window.length % 2 === 1 && detection.encoding.startsWith('utf-16') ? window.subarray(0, window.length - 1) : window, detection.encoding);
      if (!decoded.ok) {
        // A byte order mark says "text" but the text is damaged: still ours, so the user gets the precise error.
        return detection.bom ? { confidence: 0.5, evidenceClass: 'sniff', evidence: [...detection.evidence, 'the text is damaged and cannot be decoded'] } : NO_VOTE;
      }
      const decision = detectDelimiter(decoded.text);
      const evidence = [...detection.evidence, ...decision.evidence];
      let confidence: number;
      if (decision.kind === 'detected' || decision.kind === 'check') confidence = 0.8;
      else if (decision.kind === 'ambiguous') confidence = 0.6;
      else confidence = 0.4;
      if (detection.needsConfirmation) confidence = Math.min(confidence, 0.7);
      return { confidence, evidenceClass: 'sniff', evidence };
    } catch {
      return NO_VOTE;
    }
  },

  async probe(src: ByteSource, ctx: Ctx, options: Record<string, string> = {}): Promise<Result<ProbeResult>> {
    const loaded = load(src, ctx, options, 'probe');
    if (!loaded.ok) return loaded;
    const l = loaded.value;
    const evidence = [...l.detection.evidence];
    if (l.guess.delimiter !== null) evidence.push(`${separatorName(l.guess.delimiter)}-separated`, ...l.guess.evidence);
    const facts: ProbeResult['facts'] = {
      encoding: l.encoding,
      bom: l.detection.bom,
      delimiter: l.guess.delimiter === null ? 'unknown' : separatorName(l.guess.delimiter),
      lineCount: countLines(l.text)
    };
    return {
      ok: true,
      value: {
        tables: [{ name: 'Data', hidden: false, rowCountEstimate: countLines(l.text) }],
        choices: [encodingChoice(l, options.encoding !== undefined), delimiterChoice(l, options.delimiter !== undefined)],
        evidence,
        notices: notesFor(l, ctx.hints),
        facts
      }
    };
  },

  async read(src: ByteSource, sel: Selection, opts: ReadOptions, ctx: Ctx) {
    const loaded = load(src, ctx, sel.options, 'read');
    if (!loaded.ok) return loaded;
    const l = loaded.value;
    if (l.detection.needsConfirmation && sel.options.encoding === undefined) {
      return { ok: false as const, error: ingestError('ENCODING_NEEDS_CONFIRMATION', 'read', { label: ENCODING_LABELS[l.encoding] }) };
    }
    if (l.guess.delimiter === null) {
      return { ok: false as const, error: l.guess.single ? ingestError('SINGLE_COLUMN', 'read') : ingestError('CHOICE_REQUIRED', 'read', { label: 'The separator' }) };
    }

    const cap = Math.max(1, Math.min(opts.sampleOnly === true ? Math.min(opts.maxRows, 200) : opts.maxRows, ctx.limits.maxScanRows));
    const skip = Math.max(0, Math.floor(opts.skipRows ?? 0));
    const parsed = parseDelimited(l.text, l.guess.delimiter, {
      maxRows: cap + skip,
      maxColumns: ctx.limits.maxColumns,
      maxCells: ctx.limits.maxCells
    });
    if (ctx.signal.aborted) return { ok: false as const, error: ingestError('CANCELLED', 'read') };
    if (!parsed.ok) {
      const f = parsed.failure;
      if (f.code === 'too-many-columns') return { ok: false as const, error: tooManyColumns(ctx.limits, f.line) };
      if (f.code === 'too-many-cells') return { ok: false as const, error: tooComplex() };
      return {
        ok: false as const,
        error: ingestError('MALFORMED_TEXT', 'read', { detail: `Unterminated quoted field starting on line ${f.line}.` }, { source: { kind: 'line', line: f.line } })
      };
    }
    const records = parsed.value;
    if (records.truncated && opts.maxRows > ctx.limits.maxScanRows) {
      return { ok: false as const, error: tooManyScanRows(ctx.limits) };
    }
    const rowsText = skip > 0 ? records.rows.slice(skip) : records.rows;
    const lines = skip > 0 ? records.lines.slice(skip) : records.lines;
    const rows: RawCell[][] = rowsText.map((r) => r.map((v): RawCell => ({ v, t: 'text' })));
    let colCount = 0;
    for (const r of rows) if (r.length > colCount) colCount = r.length;
    const notes: ExtractionNote[] = [];
    const table: RawTable = {
      ref: { adapterId: DELIMITED_ADAPTER_ID, name: 'Data', index: 0 },
      name: 'Data',
      hidden: false,
      rows,
      rowCount: rows.length,
      colCount,
      truncated: records.truncated,
      origin(rowIndex: number, colIndex?: number): SourceRef {
        const line = lines[rowIndex] ?? lines[lines.length - 1] ?? 1;
        return colIndex === undefined ? { kind: 'line', line } : { kind: 'line', line, column: colIndex + 1 };
      },
      notes,
      meta: { encoding: l.encoding, bom: l.detection.bom, delimiter: separatorName(l.guess.delimiter), firstLine: lines[0] ?? 1 }
    };
    return { ok: true as const, value: { kind: 'tables' as const, tables: [table] } };
  }
};

