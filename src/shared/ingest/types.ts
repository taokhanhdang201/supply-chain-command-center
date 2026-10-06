// Contracts of the universal-ingestion pipeline (format-agnostic core). Nothing in here names a file format, a
// delimiter or an extension: every format-specific fact arrives through an adapter descriptor (see registry.ts).
// Extraction results are a union (tables / records / positioned text / images-only) so nested, paginated and
// spreadsheet sources fit the same contracts as flat text.

/** Where a value came from, used to translate errors back to the user's own file. */
export type SourceRef =
  | { kind: 'line'; line: number; column?: number }
  | { kind: 'cell'; sheet: string; row: number; col: number }
  | { kind: 'path'; path: string; index?: number }
  | { kind: 'page'; page: number; bbox?: [number, number, number, number] }
  | { kind: 'segment'; index: number; element?: number }
  | { kind: 'record'; index: number };

export type SourceRefKind = SourceRef['kind'];

export type CellType = 'text' | 'number' | 'date' | 'bool' | 'error' | 'empty';

/** `v` is ALWAYS a string (numbers as exact decimal strings, dates as YYYY-MM-DD[THH:MM:SS] when the source types them). */
export interface RawCell {
  v: string;
  t: CellType;
  /** Source display text when it differs from `v` (for example "$1,250.50" shown, 1250.5 stored). */
  src?: string;
}

export interface RawColumn {
  header: string | null;
  path?: string[];
  typeHint?: 'text' | 'number' | 'date' | 'bool' | 'mixed';
  hidden?: boolean;
}

export interface TableRef {
  adapterId: string;
  name: string;
  index: number;
}

export interface ExtractionNote {
  code: string;
  message: string;
  count?: number;
}

export type MetaValue = string | number | boolean;

export interface RawTable {
  ref: TableRef;
  name: string;
  hidden: boolean;
  /** Present when the source itself names its columns (keys, fields); otherwise header detection decides. */
  columns?: RawColumn[];
  rows: RawCell[][];
  rowCount: number;
  colCount: number;
  /** Extraction stopped at a cap (never silent: the pipeline turns it into an error on import, allowed in preview). */
  truncated: boolean;
  /** Where row `rowIndex` (and optionally column `colIndex`) of `rows` came from in the user's file. */
  origin(rowIndex: number, colIndex?: number): SourceRef;
  notes: ExtractionNote[];
  /** Format-specific facts for evidence only; the core never branches on them. */
  meta?: Record<string, MetaValue>;
}

/** Nested data: entries are kept as ordered pairs (never a plain object keyed by user text). */
export type RecordValue = string | null | RecordNode | RecordNode[];
export interface RecordNode {
  /** Path of this node in the source, for example "$.shipments[3]". */
  path: string;
  index: number;
  entries: Array<[key: string, value: RecordValue]>;
}

export interface TextRun {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export type ExtractionResult =
  | { kind: 'tables'; tables: RawTable[] }
  | { kind: 'records'; records: RecordNode[]; name: string }
  | { kind: 'positioned-text'; pages: TextRun[][]; name: string }
  | { kind: 'images-only'; pages: number };

export type IngestStage = 'detect' | 'probe' | 'read' | 'structure' | 'map' | 'normalize' | 'validate' | 'limits';

export type LimitName =
  | 'sourceBytes'
  | 'sourceBytesGlobal'
  | 'expandedBytes'
  | 'expansionRatio'
  | 'archiveEntries'
  | 'dataRows'
  | 'scanRows'
  | 'columns'
  | 'complexity'
  | 'parseTime'
  | 'validateTime'
  | 'memory'
  | 'payloadBytes'
  | 'payloadRows';

export interface IngestError {
  code: string;
  stage: IngestStage;
  message: string;
  source?: SourceRef;
  limit?: LimitName;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: IngestError };

// ---- limits (values are resolved in limits.ts) ---------------------------------------------------------------

export interface ResolvedLimits {
  /** (a) effective source-file limit for the adapter this object was resolved for. */
  sourceBytes: number;
  sourceBytesGlobal: number;
  /** (b) */
  expandedEntryBytes: number;
  expandedTotalBytes: number;
  expansionRatio: number;
  archiveEntries: number;
  /** (c) */
  maxDataRows: number;
  maxScanRows: number;
  maxColumns: number;
  maxCells: number;
  maxTables: number;
  maxDepth: number;
  maxNodes: number;
  maxTextNode: number;
  /** (d) */
  parseBudgetMs: number;
  validateBudgetMs: number;
  /** (e) canonical payload sent to the server */
  payloadBytes: number;
  maxImportRows: number;
  maxImportColumns: number;
  maxErrorsReturned: number;
  requestTimeoutMs: number;
}

// ---- adapters -------------------------------------------------------------------------------------------------

export interface Signature {
  offset: number;
  bytes: readonly number[];
  mask?: readonly number[];
}

export type EvidenceClass = 'magic' | 'container' | 'sniff' | 'hint' | 'none';
export type YieldKind = 'tables' | 'records' | 'positioned-text' | 'images-only';
export type AdapterStatus = 'stable' | 'experimental' | 'refusal';

export interface AdapterDescriptor {
  id: string;
  version: string;
  /** Human family name used in messages, for example "Delimited text". */
  family: string;
  status: AdapterStatus;
  /** Advisory only, never decisive. Extensions include the dot ('.csv'), lowercase. */
  hints: { extensions: string[]; mimeTypes: string[] };
  /** Magic-byte rules used for cheap pre-filtering. */
  signatures: Signature[];
  /** True when the adapter inspects content beyond fixed signatures (it is then always asked to vote). */
  contentSniff: boolean;
  yields: YieldKind[];
  multiTable: boolean;
  hierarchical: boolean;
  typedCells: boolean;
  streaming: 'none' | 'incremental';
  sourceRefKind: SourceRefKind[];
  /** True when the adapter can read bytes that come out of a wrapper (for example a decompressed stream). */
  wrappable: boolean;
  /** Values the adapter asks the limits layers to apply (clamped by core ceilings; they can only lower a limit). */
  resourceHints: {
    sourceBytes?: number;
    expandedBytes?: number;
    ratio?: number;
    maxDepth?: number;
    maxRecords?: number;
    needsWorker: boolean;
  };
  messages: { refuse?: Record<string, string> };
}

export interface Hints {
  /** Lowercase extension with the dot, or null. */
  extension: string | null;
  mimeType: string | null;
  fileName: string | null;
}

export interface DetectionVote {
  confidence: number; // 0..1
  evidenceClass: EvidenceClass;
  evidence: string[];
}

export const NO_VOTE: DetectionVote = { confidence: 0, evidenceClass: 'none', evidence: [] };

/** Random access to the source bytes (an in-memory array today; a Blob slice reader later). */
export interface ByteSource {
  readonly size: number;
  /** Returns bytes [start, end) (clamped). The returned array must not be mutated by callers. */
  read(start: number, end: number): Uint8Array;
}

/** What the registry exposes to adapters (a wrapper such as gzip delegates to other registered adapters). */
export interface AdapterLookup {
  list(): readonly FormatAdapter[];
  get(id: string): FormatAdapter | undefined;
}

export interface Ctx {
  signal: AbortSignal;
  limits: ResolvedLimits;
  registry: AdapterLookup;
  progress(n: number): void;
  clock(): number;
  /** Optional: true when a header cell is a known column name (supplied by the pipeline; used only as evidence). */
  recognizeHeader?: (text: string) => boolean;
  /** Wrapper nesting depth (0 = the file itself). */
  depth: number;
  /** The hints of the file being read (extension, MIME, name); advisory only. */
  hints?: Hints;
}

export interface ChoiceOption {
  value: string;
  label: string;
}

/** A format-specific setting the user may need to confirm or choose (encoding, separator, sheet, ...). */
export interface AdapterChoice {
  key: string;
  label: string;
  status: 'detected' | 'needs-confirmation' | 'choose';
  value: string | null;
  options: ChoiceOption[];
  evidence: string[];
  /** True when the file cannot be read at all until this choice is confirmed (the pipeline stops before reading). */
  blocksRead?: boolean;
  /** Decoded or parsed sample lines shown next to a choice that needs confirmation. */
  sample?: string[];
}

export interface TableInfo {
  name: string;
  hidden: boolean;
  rowCountEstimate?: number;
  colCountEstimate?: number;
}

export interface ProbeResult {
  tables: TableInfo[];
  choices: AdapterChoice[];
  evidence: string[];
  notices: string[];
  facts: Record<string, MetaValue>;
}

export interface Selection {
  tableIndex: number;
  /** Values for the adapter's choices, keyed by `AdapterChoice.key`. */
  options: Record<string, string>;
}

export interface ReadOptions {
  /** Materialize at most this many raw rows; set `truncated` when more exist. */
  maxRows: number;
  skipRows?: number;
  sampleOnly?: boolean;
}

export interface FormatAdapter {
  descriptor: AdapterDescriptor;
  /** Pure, total, bounded; never throws. */
  detect(head: Uint8Array, hints: Hints): DetectionVote;
  /** `options` are the user's current choices (keyed like `AdapterChoice.key`), so detection can follow an override. */
  probe(src: ByteSource, ctx: Ctx, options?: Record<string, string>): Promise<Result<ProbeResult>>;
  read(src: ByteSource, sel: Selection, opts: ReadOptions, ctx: Ctx): Promise<Result<ExtractionResult>>;
}

// ---- detection -------------------------------------------------------------------------------------------------

export interface DetectionCandidate {
  adapterId: string;
  family: string;
  status: AdapterStatus;
  evidenceClass: EvidenceClass;
  confidence: number;
  evidence: string[];
}

export interface DetectionResult {
  outcome: 'chosen' | 'refused' | 'ambiguous' | 'unknown' | 'empty' | 'disabled';
  candidates: DetectionCandidate[];
  chosen: DetectionCandidate | null;
  notices: string[];
  error?: IngestError;
}

// ---- preview-facing helpers ------------------------------------------------------------------------------------

/** A human-readable description of a source reference, produced by one formatter per kind (preview/sourceRef.ts). */
export type SourceRefText = string;
