// One catalogue of user-facing ingestion texts keyed by error code, plus the texts generated from the adapter
// registry (supported families, unsupported-type text, file-picker `accept`). No format list is written in this file:
// adding an adapter changes every generated text without editing it. Texts are plain strings (rendered as React text);
// file-derived values are truncated before they are placed in a message.

import type { AdapterDescriptor, AdapterLookup, IngestError, IngestStage, LimitName, SourceRef } from './types';

export type MessageParams = Record<string, string | number>;

function mb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

function str(p: MessageParams, key: string): string {
  const v = p[key];
  return v === undefined ? '' : String(v);
}

function num(p: MessageParams, key: string): number {
  const v = p[key];
  return typeof v === 'number' ? v : Number(v ?? 0);
}

/** Truncates file-derived text for use in a message. */
export function clip(text: string, max = 60): string {
  const flat = text.replace(/[\u0000-\u001f\u007f]/g, ' ');
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

type Template = (p: MessageParams) => string;

/** The catalogue. Every limit text contains a concrete next step (criterion 32). */
export const MESSAGE_CATALOGUE = {
  EMPTY_FILE: () => 'The file is empty.',
  NO_DATA_ROWS: () => 'The file has a header but no data rows.',
  UNKNOWN_TYPE: () => 'This file could not be identified as a supported type.',
  AMBIGUOUS_FILE: () => 'This file could not be identified safely. It looks like more than one file type at once.',
  NOT_ENABLED: (p) => `This file type is not enabled (${str(p, 'family')}).`,
  CANCELLED: () => 'Reading the file was cancelled.',
  READ_FAILED: () => 'The file could not be read. It may be damaged. Try exporting it again.',
  INTERNAL: () => 'Something went wrong while reading the file. Nothing was imported.',
  BROWSER_UNSUPPORTED: () => 'Your browser cannot safely read this file type. Use a current version of Chrome, Edge, Firefox or Safari, or export the data as plain text.',

  // encodings and text
  ENCODING_INVALID: () => 'The file text could not be decoded safely (it looks damaged or is not text). Save it as UTF-8 text and try again.',
  ENCODING_NEEDS_CONFIRMATION: (p) => `This file is probably ${str(p, 'label')} text. Check the preview and confirm the encoding before it is read.`,
  ENCODING_UNDEFINED_BYTES: () =>
    'The file contains bytes that are not valid in any supported text encoding. It may be a binary file or damaged. Save it as UTF-8 text and try again.',
  CHOICE_REQUIRED: (p) => `${str(p, 'label')} of this file could not be detected. Choose it to continue.`,
  CURRENCY_UNSUPPORTED: (p) => `This file's amounts are in ${str(p, 'markers')}. SCC only supports US dollars, so the file cannot be imported. Convert the amounts to USD and upload again.`,
  CURRENCY_MIXED: (p) => `This column mixes currencies (${str(p, 'markers')}). SCC only supports US dollars, so the file cannot be imported. Convert all amounts to USD and upload again.`,
  CHOOSE_NUMBER_FORMAT: () => 'Choose the number format of this file: for example 1,234.56 (comma thousands) or 1.234,56 (dot thousands, decimal comma).',
  CHOOSE_DATE_FORMAT: () => 'Choose the date format of this file: for example 8/15/2026 (month first) or 15/8/2026 (day first).',
  NO_READABLE_TEXT: () => 'This file has no readable text content (it looks like a scanned image). SCC reads text-based tables only. Export the data from the source system instead.',
  NO_TABLE: () => 'No table could be found in this document. Export the data as a plain table from the source system.',
  SINGLE_COLUMN: () => 'This file has only one column, so it cannot be an inventory or shipments file.',
  MALFORMED_TEXT: (p) => `The text is not well formed: ${str(p, 'detail')}`,

  // gzip / wrappers
  PACKED_DAMAGED: () => 'The compressed file looks damaged or incomplete, so it could not be opened.',
  PACKED_NESTED: () => 'This compressed file contains another compressed or packaged file, which is not supported. Decompress it and upload the data file.',
  PACKED_INNER_UNSUPPORTED: (p) =>
    `The compressed file contains ${str(p, 'family')}, which SCC cannot import. Decompress it and upload a supported data file.`,

  // limits (a)-(f)
  LIMIT_SOURCE_BYTES: (p) =>
    `File is ${mb(num(p, 'size'))} MB; the limit is ${mb(num(p, 'limit'))} MB. Split the file, remove columns you do not need, or choose fewer rows.`,
  LIMIT_SOURCE_BYTES_FAMILY: (p) =>
    `This ${str(p, 'family')} file is ${mb(num(p, 'size'))} MB; the limit for this kind of file is ${mb(num(p, 'limit'))} MB. Remove unused data, split the file, or export only the data you need.`,
  LIMIT_SOURCE_GLOBAL: (p) => `This file is too large to import (maximum ${mb(num(p, 'limit'))} MB). Split it into smaller files.`,
  LIMIT_EXPANDED: (p) =>
    `The file expands to more than ${mb(num(p, 'limit'))} MB, which is too much to process safely. Export a smaller file or split it.`,
  LIMIT_RATIO: () => 'The file looks like a decompression bomb and was not opened. Export the data again without compression.',
  LIMIT_ENTRIES: (p) => `The archive contains more than ${num(p, 'limit')} entries, which is too many to process safely. Split it or upload the data file alone.`,
  LIMIT_ROWS: (p) =>
    `The file has more than ${num(p, 'limit')} data rows. Split the file or filter the rows, or ask your administrator to raise SCC_MAX_IMPORT_ROWS.`,
  LIMIT_SCAN_ROWS: (p) =>
    `This file has too many rows to scan (more than ${num(p, 'limit')}). Choose another table or export the data range only.`,
  LIMIT_COLUMNS: (p) => `Line ${num(p, 'line')} has more than ${num(p, 'limit')} columns. Remove columns you do not need and try again.`,
  LIMIT_COMPLEXITY: () => 'This file is too complex to read safely (too many cells or levels). Export a simpler or smaller version.',
  LIMIT_PARSE_TIME: () => 'Reading this file took too long and was stopped. Try a smaller file, choose a table, or export it as CSV.',
  LIMIT_VALIDATE_TIME: () => 'Checking this file took too long and was stopped. Try fewer rows.',
  LIMIT_MEMORY: () => 'Your browser ran out of memory reading this file. Try a smaller file.',
  LIMIT_PAYLOAD_BYTES: (p) =>
    `After conversion the data is ${mb(num(p, 'size'))} MB but the server accepts at most ${mb(num(p, 'limit'))} MB per import. Use fewer rows or columns, import one sheet at a time, or ask your administrator to raise SCC_MAX_UPLOAD_BYTES.`,
  LIMIT_PAYLOAD_ROWS: (p) =>
    `After conversion the data has ${num(p, 'size')} rows but the server accepts at most ${num(p, 'limit')} rows per import. Use fewer rows, or ask your administrator to raise SCC_MAX_IMPORT_ROWS.`
} satisfies Record<string, Template>;

export type MessageCode = keyof typeof MESSAGE_CATALOGUE;

/** Renders a catalogue message. */
export function messageText(code: MessageCode, params: MessageParams = {}): string {
  return (MESSAGE_CATALOGUE[code] as Template)(params);
}

/** Builds an `IngestError` whose text comes from the catalogue. */
export function ingestError(
  code: MessageCode,
  stage: IngestStage,
  params: MessageParams = {},
  extra: { source?: SourceRef; limit?: LimitName; message?: string } = {}
): IngestError {
  const error: IngestError = { code, stage, message: extra.message ?? messageText(code, params) };
  if (extra.source !== undefined) error.source = extra.source;
  if (extra.limit !== undefined) error.limit = extra.limit;
  return error;
}

// ---- texts generated from the registry --------------------------------------------------------------------------

function isReadable(d: AdapterDescriptor): boolean {
  return d.status !== 'refusal';
}

function familyWithExtensions(d: AdapterDescriptor): string {
  return d.hints.extensions.length > 0 ? `${d.family} (${d.hints.extensions.join(', ')})` : d.family;
}

/** The descriptors a user can import, in registration order. */
export function supportedDescriptors(registry: AdapterLookup): AdapterDescriptor[] {
  return registry.list().map((a) => a.descriptor).filter(isReadable);
}

/** "Delimited text (.csv, .tsv, .txt), Gzip-compressed file (.gz)". Empty string when nothing is registered. */
export function supportedFamiliesList(registry: AdapterLookup): string {
  return supportedDescriptors(registry).map(familyWithExtensions).join(', ');
}

/** "You can import Delimited text (.csv, .tsv, .txt), ...". */
export function supportedFormatsText(registry: AdapterLookup): string {
  const list = supportedFamiliesList(registry);
  return list === '' ? 'No file types are available for import.' : `You can import ${list}.`;
}

/** All extensions and MIME types of readable adapters, for the file picker `accept` attribute (a hint, not a gate). */
export function acceptAttribute(registry: AdapterLookup): string {
  const parts: string[] = [];
  for (const d of supportedDescriptors(registry)) {
    for (const e of d.hints.extensions) if (!parts.includes(e)) parts.push(e);
  }
  for (const d of supportedDescriptors(registry)) {
    for (const m of d.hints.mimeTypes) if (!parts.includes(m)) parts.push(m);
  }
  return parts.join(',');
}

function withArticle(phrase: string): string {
  // Acronyms are read letter by letter: "an HTML page", "an XML file", "an RTF document", "a PDF", "a UTF-32 file".
  if (/^[A-Z]{2,}/.test(phrase)) return /^[AEFHILMNORSX]/.test(phrase) ? `an ${phrase}` : `a ${phrase}`;
  return /^[aeiou]/i.test(phrase) ? `an ${phrase}` : `a ${phrase}`;
}

/**
 * Text for a recognized-but-refused file ("recognized" = matched a refusal adapter) or for an unknown type
 * (`refusal` null). The family names and supported formats come from the registry.
 */
export function unsupportedTypeMessage(registry: AdapterLookup, refusal: AdapterDescriptor | null): string {
  const what = refusal === null ? 'a file of an unknown type' : withArticle(refusal.family);
  const hint = refusal?.messages.refuse?.default;
  const supported = supportedFamiliesList(registry);
  const tail = supported === '' ? '' : ` You can import: ${supported}. Export the data in one of those formats.`;
  return `This looks like ${what}. SCC cannot import that type.${hint !== undefined ? ` ${hint}` : ''}${tail}`;
}

/** Notice shown when the extension points to a different family than the bytes do. */
export function extensionMismatchNotice(extension: string, family: string): string {
  return `This file is named ${clip(extension, 12)} but its content looks like ${family}. It was read by its content.`;
}
