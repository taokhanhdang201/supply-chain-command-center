// Refusal adapters: formats that are RECOGNIZED and explained but never read. "We recognize it but will not read it" is
// data, not code: each one is registered like any other adapter (status 'refusal') and its family name and hint feed the
// registry-generated unsupported-type message. When a real reader for one of these families arrives it replaces the
// refusal by registering an ordinary adapter (and removing the refusal line) without touching the core.

import type { AdapterDescriptor, ByteSource, Ctx, DetectionVote, FormatAdapter, Hints, ReadOptions, Selection, Signature } from '../../types';
import { NO_VOTE } from '../../types';
import { ingestError, unsupportedTypeMessage } from '../../messages';
import { asciiBytes, matchesSignature } from '../../detect/bytes';
import { detectEncoding, isValidUtf8 } from '../delimited/encoding';

type DetectFn = (head: Uint8Array, hints: Hints) => DetectionVote;

interface RefusalSpec {
  id: string;
  family: string;
  hint: string;
  extensions?: string[];
  mimeTypes?: string[];
  /** Signatures used as the cheap pre-filter (and as the vote itself when no `detect` is given). */
  signatures?: Signature[];
  /** Content sniffing (asked on every file). */
  sniff?: boolean;
  detect?: DetectFn;
  evidence?: string;
}

function magicVote(evidence: string): DetectionVote {
  return { confidence: 1, evidenceClass: 'magic', evidence: [evidence] };
}

function sniffVote(confidence: number, evidence: string): DetectionVote {
  return { confidence, evidenceClass: 'sniff', evidence: [evidence] };
}

function makeRefusal(spec: RefusalSpec): FormatAdapter {
  const descriptor: AdapterDescriptor = {
    id: spec.id,
    version: '1.0.0',
    family: spec.family,
    status: 'refusal',
    hints: { extensions: spec.extensions ?? [], mimeTypes: spec.mimeTypes ?? [] },
    signatures: spec.signatures ?? [],
    contentSniff: spec.sniff === true,
    yields: ['images-only'],
    multiTable: false,
    hierarchical: false,
    typedCells: false,
    streaming: 'none',
    sourceRefKind: [],
    wrappable: false,
    resourceHints: { needsWorker: false },
    messages: { refuse: { default: spec.hint } }
  };
  const refuse = (ctx: Ctx, stage: 'probe' | 'read') => ({
    ok: false as const,
    error: ingestError('UNKNOWN_TYPE', stage, {}, { message: unsupportedTypeMessage(ctx.registry, descriptor) })
  });
  return {
    descriptor,
    detect(head: Uint8Array, hints: Hints): DetectionVote {
      try {
        if (spec.detect !== undefined) return spec.detect(head, hints);
        const hit = (spec.signatures ?? []).some((s) => matchesSignature(head, s));
        return hit ? magicVote(spec.evidence ?? `${spec.family} signature`) : NO_VOTE;
      } catch {
        return NO_VOTE;
      }
    },
    probe: async (_src: ByteSource, ctx: Ctx) => refuse(ctx, 'probe'),
    read: async (_src: ByteSource, _sel: Selection, _opts: ReadOptions, ctx: Ctx) => refuse(ctx, 'read')
  };
}

const sig = (offset: number, ...bytes: number[]): Signature => ({ offset, bytes });
const ascii = (offset: number, text: string): Signature => ({ offset, bytes: asciiBytes(text) });

/** Text of the head when it is valid UTF-8 (BOM allowed), else null. */
function headText(head: Uint8Array): string | null {
  const start = head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf ? 3 : 0;
  const body = head.subarray(start, Math.min(head.length, start + 4096));
  if (!isValidUtf8(body, true)) return null;
  return new TextDecoder('utf-8').decode(body);
}

function detectPe(head: Uint8Array): DetectionVote {
  if (!matchesSignature(head, ascii(0, 'MZ')) || head.length < 0x40) return NO_VOTE;
  const peOffset = (head[0x3c] as number) | ((head[0x3d] as number) << 8) | ((head[0x3e] as number) << 16);
  if (peOffset > 0 && peOffset + 4 <= head.length && matchesSignature(head, sig(peOffset, 0x50, 0x45, 0, 0))) {
    return magicVote('Windows executable header');
  }
  return NO_VOTE;
}

function detectPdf(head: Uint8Array): DetectionVote {
  if (matchesSignature(head, ascii(0, '%PDF-'))) return magicVote('PDF header at the start of the file');
  // A PDF header later in the first 1 KiB (readers tolerate leading junk). If another container matched at offset 0
  // the arbiter sees two magic votes and refuses the file as ambiguous.
  const window = head.subarray(0, Math.min(head.length, 1024 + 5));
  const needle = asciiBytes('%PDF-');
  for (let i = 1; i + needle.length <= window.length; i++) {
    if (matchesSignature(window, { offset: i, bytes: needle })) return magicVote('PDF header after leading bytes');
  }
  return NO_VOTE;
}

function detectBzip2(head: Uint8Array): DetectionVote {
  if (matchesSignature(head, ascii(0, 'BZh')) && (head[3] as number) >= 0x31 && (head[3] as number) <= 0x39) return magicVote('bzip2 signature');
  return NO_VOTE;
}

function detectUtf32(head: Uint8Array): DetectionVote {
  return detectEncoding(head, false).refusal === 'utf-32' ? magicVote('UTF-32 byte order mark') : NO_VOTE;
}

/** UTF-16 without a BOM: NUL bytes at every other position, real characters at the others. */
function detectUtf16WithoutBom(head: Uint8Array): DetectionVote {
  if (head.length < 8 || (head[0] === 0xff && head[1] === 0xfe) || (head[0] === 0xfe && head[1] === 0xff)) return NO_VOTE;
  const n = Math.min(head.length, 4096) & ~1;
  let evenNul = 0;
  let oddNul = 0;
  for (let i = 0; i < n; i += 2) {
    if (head[i] === 0) evenNul++;
    if (head[i + 1] === 0) oddNul++;
  }
  const pairs = n / 2;
  const le = oddNul / pairs >= 0.3 && evenNul / pairs <= 0.1;
  const be = evenNul / pairs >= 0.3 && oddNul / pairs <= 0.1;
  return le || be ? sniffVote(0.9, 'NUL bytes at alternating positions: UTF-16 text without a byte order mark') : NO_VOTE;
}

function detectBinary(head: Uint8Array): DetectionVote {
  const d = detectEncoding(head, false);
  if (d.encoding === null && d.refusal !== 'utf-32') return sniffVote(0.8, d.evidence[0] ?? 'binary content');
  return NO_VOTE;
}

function detectJson(head: Uint8Array): DetectionVote {
  const text = headText(head);
  if (text === null) return NO_VOTE;
  const m = /^\s*(\{\s*["}]|\[\s*["{\[\]\d-])/.exec(text);
  return m === null ? NO_VOTE : sniffVote(0.85, 'starts like a JSON document');
}

const HTML_START = /^\s*(<!doctype\s+html|<html[\s>]|<head[\s>]|<body[\s>]|<table[\s>])/i;

function detectHtml(head: Uint8Array): DetectionVote {
  const text = headText(head);
  return text !== null && HTML_START.test(text) ? sniffVote(0.92, 'starts like an HTML document') : NO_VOTE;
}

function detectXml(head: Uint8Array): DetectionVote {
  const text = headText(head);
  if (text === null || HTML_START.test(text)) return NO_VOTE;
  return /^\s*(<\?xml\s|<[A-Za-z_][\w:.-]*[\s>/])/.test(text) ? sniffVote(0.9, 'starts like an XML document') : NO_VOTE;
}

export const refusalAdapters: readonly FormatAdapter[] = [
  makeRefusal({
    id: 'refuse-image',
    family: 'image',
    hint: 'SCC reads text-based tables only. Export the data from the source system instead.',
    extensions: ['.png', '.jpg', '.jpeg', '.gif', '.tif', '.tiff', '.webp'],
    mimeTypes: ['image/png', 'image/jpeg', 'image/gif', 'image/tiff', 'image/webp'],
    signatures: [
      sig(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
      sig(0, 0xff, 0xd8, 0xff),
      ascii(0, 'GIF87a'),
      ascii(0, 'GIF89a'),
      sig(0, 0x49, 0x49, 0x2a, 0x00),
      sig(0, 0x4d, 0x4d, 0x00, 0x2a),
      ascii(8, 'WEBP')
    ],
    detect: (head) => {
      const plain = [sig(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), sig(0, 0xff, 0xd8, 0xff), ascii(0, 'GIF87a'), ascii(0, 'GIF89a'), sig(0, 0x49, 0x49, 0x2a, 0x00), sig(0, 0x4d, 0x4d, 0x00, 0x2a)];
      const webp = matchesSignature(head, ascii(0, 'RIFF')) && matchesSignature(head, ascii(8, 'WEBP'));
      return webp || plain.some((s) => matchesSignature(head, s)) ? magicVote('image file signature') : NO_VOTE;
    }
  }),
  makeRefusal({
    id: 'refuse-sqlite',
    family: 'SQLite database',
    hint: 'Export the tables as text files first.',
    extensions: ['.sqlite', '.db'],
    signatures: [ascii(0, 'SQLite format 3')],
    evidence: 'SQLite database signature'
  }),
  makeRefusal({
    id: 'refuse-parquet',
    family: 'Parquet data file',
    hint: 'Export the data as text first.',
    extensions: ['.parquet'],
    signatures: [ascii(0, 'PAR1')],
    evidence: 'Parquet signature'
  }),
  makeRefusal({
    id: 'refuse-executable',
    family: 'program file',
    hint: 'SCC never opens programs.',
    extensions: ['.exe', '.dll', '.msi', '.app'],
    signatures: [ascii(0, 'MZ'), sig(0, 0x7f, 0x45, 0x4c, 0x46), sig(0, 0xfe, 0xed, 0xfa, 0xce), sig(0, 0xfe, 0xed, 0xfa, 0xcf), sig(0, 0xce, 0xfa, 0xed, 0xfe), sig(0, 0xcf, 0xfa, 0xed, 0xfe)],
    detect: (head) => {
      if (matchesSignature(head, ascii(0, 'MZ'))) return detectPe(head);
      return [sig(0, 0x7f, 0x45, 0x4c, 0x46), sig(0, 0xfe, 0xed, 0xfa, 0xce), sig(0, 0xfe, 0xed, 0xfa, 0xcf), sig(0, 0xce, 0xfa, 0xed, 0xfe), sig(0, 0xcf, 0xfa, 0xed, 0xfe)].some((s) => matchesSignature(head, s))
        ? magicVote('executable file signature')
        : NO_VOTE;
    }
  }),
  makeRefusal({
    id: 'refuse-zip',
    family: 'ZIP-based file (for example an Excel, OpenDocument or Word document)',
    hint: 'Excel and OpenDocument spreadsheets are not supported yet. Open the file and save the data as CSV or text.',
    extensions: ['.xlsx', '.xlsm', '.xlsb', '.ods', '.docx', '.zip'],
    mimeTypes: ['application/zip', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.oasis.opendocument.spreadsheet'],
    signatures: [sig(0, 0x50, 0x4b, 0x03, 0x04), sig(0, 0x50, 0x4b, 0x05, 0x06), sig(0, 0x50, 0x4b, 0x07, 0x08)],
    evidence: 'ZIP container signature (PK)'
  }),
  makeRefusal({
    id: 'refuse-cfb',
    family: 'legacy Microsoft Office file (for example an old .xls, or a password-protected workbook)',
    hint: 'Open it in Excel and save it as CSV UTF-8.',
    extensions: ['.xls', '.doc', '.ppt'],
    mimeTypes: ['application/vnd.ms-excel', 'application/msword'],
    signatures: [sig(0, 0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1)],
    evidence: 'Office compound file signature'
  }),
  makeRefusal({
    id: 'refuse-pdf',
    family: 'PDF document',
    hint: 'SCC cannot read tables from PDF files yet. Export the data as CSV from the source system.',
    extensions: ['.pdf'],
    mimeTypes: ['application/pdf'],
    signatures: [ascii(0, '%PDF-')],
    sniff: true, // also accepts a PDF header after leading bytes, see detectPdf
    detect: detectPdf
  }),
  makeRefusal({
    id: 'refuse-rtf',
    family: 'RTF document',
    hint: 'Copy the table into a spreadsheet and save it as CSV.',
    extensions: ['.rtf'],
    signatures: [ascii(0, '{\\rtf')],
    evidence: 'RTF signature'
  }),
  makeRefusal({
    id: 'refuse-archive',
    family: 'compressed archive',
    hint: 'Only a single gzip (.gz) file can be opened. Extract the archive and upload the data file.',
    extensions: ['.7z', '.rar', '.bz2', '.xz', '.tar'],
    signatures: [sig(0, 0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c), ascii(0, 'Rar!'), ascii(0, 'BZh'), sig(0, 0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00)],
    detect: (head) =>
      matchesSignature(head, sig(0, 0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c)) || matchesSignature(head, ascii(0, 'Rar!')) || matchesSignature(head, sig(0, 0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00))
        ? magicVote('archive signature')
        : detectBzip2(head)
  }),
  makeRefusal({
    id: 'refuse-utf32',
    family: 'UTF-32 text file',
    hint: 'Save it as UTF-8 or UTF-16 text and upload it again.',
    signatures: [sig(0, 0xff, 0xfe, 0x00, 0x00), sig(0, 0x00, 0x00, 0xfe, 0xff)],
    detect: detectUtf32
  }),
  makeRefusal({
    id: 'refuse-utf16-no-bom',
    family: 'UTF-16 text file without a byte order mark',
    hint: 'Save it as UTF-8, or as UTF-16 with a byte order mark (in Excel: "Unicode Text").',
    sniff: true,
    detect: detectUtf16WithoutBom
  }),
  makeRefusal({
    id: 'refuse-binary',
    family: 'binary file',
    hint: 'SCC reads text files (CSV, TSV and plain text).',
    sniff: true,
    detect: detectBinary
  }),
  makeRefusal({
    id: 'refuse-json',
    family: 'JSON file',
    hint: 'JSON files are not supported yet. Export the data as CSV.',
    extensions: ['.json', '.jsonl', '.ndjson'],
    mimeTypes: ['application/json', 'application/x-ndjson'],
    sniff: true,
    detect: detectJson
  }),
  makeRefusal({
    id: 'refuse-html',
    family: 'HTML page',
    hint: 'HTML tables are not supported yet. Copy the table into a spreadsheet and save it as CSV.',
    extensions: ['.html', '.htm'],
    mimeTypes: ['text/html'],
    sniff: true,
    detect: detectHtml
  }),
  makeRefusal({
    id: 'refuse-xml',
    family: 'XML file',
    hint: 'XML files are not supported yet. Export the data as CSV.',
    extensions: ['.xml'],
    mimeTypes: ['application/xml', 'text/xml'],
    sniff: true,
    detect: detectXml
  })
];
