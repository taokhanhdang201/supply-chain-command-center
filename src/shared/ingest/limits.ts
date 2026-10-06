// Six explicit, separately configurable limit layers (ke-hoach 10.3). Effective value = min(hard ceiling,
// configured value or default); adapter resource hints can only LOWER a limit. The canonical-payload layer (e) is the
// existing server contract (2 MiB, 20,000 rows, 50 columns, 500 errors, 30 s) and is NOT the source-file limit (a).
// No production default is raised here: ceilings and overrides only (SA-2).
//
//   (a) source file        SOURCE_BYTES (per adapter family), SOURCE_BYTES_GLOBAL
//   (b) expanded/ratio     EXPANDED_ENTRY_BYTES, EXPANDED_TOTAL_BYTES, EXPANSION_RATIO, ARCHIVE_ENTRIES
//   (c) rows/columns/cells MAX_DATA_ROWS, MAX_SCAN_ROWS, MAX_COLUMNS, MAX_CELLS, MAX_TABLES, MAX_DEPTH, MAX_NODES, MAX_TEXT_NODE
//   (d) time and memory    PARSE_BUDGET_MS, VALIDATE_BUDGET_MS
//   (e) canonical payload  PAYLOAD_BYTES, MAX_IMPORT_ROWS, MAX_IMPORT_COLUMNS, MAX_ERRORS_RETURNED, REQUEST_TIMEOUT_MS
//   (f) delivery above (e) not needed in Phase 0 + 1a (see docs/ingestion/limits.md)

import { DEFAULT_MAX_UPLOAD_BYTES, MAX_ERRORS_RETURNED, MAX_IMPORT_COLUMNS, MAX_IMPORT_ROWS } from '../constants';
import type { AdapterDescriptor, IngestError, ResolvedLimits } from './types';
import { ingestError } from './messages';

const MIB = 1024 * 1024;

/** Default and hard ceiling of every configurable value. `fixed` values have default === ceiling. */
export const LIMIT_DEFAULTS = {
  // (a) the delimited family follows the payload limit (2 MiB); other families set their own approved values later
  sourceBytesGlobal: 100 * MIB,
  // (b)
  expandedEntryBytes: 64 * MIB,
  expandedTotalBytes: 100 * MIB,
  expansionRatio: 200,
  archiveEntries: 1000,
  // (c)
  maxDataRows: MAX_IMPORT_ROWS,
  maxScanRows: 200_000,
  maxColumns: MAX_IMPORT_COLUMNS,
  maxCells: 2_000_000,
  maxTables: 64,
  maxDepth: 32,
  maxNodes: 5_000_000,
  maxTextNode: MIB,
  // (d)
  parseBudgetMs: 20_000,
  validateBudgetMs: 10_000,
  // (e)
  payloadBytes: DEFAULT_MAX_UPLOAD_BYTES,
  maxImportRows: MAX_IMPORT_ROWS,
  maxImportColumns: MAX_IMPORT_COLUMNS,
  maxErrorsReturned: MAX_ERRORS_RETURNED,
  requestTimeoutMs: 30_000
} as const;

export const LIMIT_CEILINGS = {
  /** Per-family source limit ceiling for the families of Phase 0 + 1a (today's server ceiling). */
  sourceBytesFamily: 10 * MIB,
  sourceBytesGlobal: 100 * MIB,
  expandedEntryBytes: 64 * MIB,
  expandedTotalBytes: 100 * MIB,
  expansionRatio: 200,
  archiveEntries: 1000,
  maxDataRows: 100_000,
  maxScanRows: 1_000_000,
  maxColumns: 1000,
  maxCells: 8_000_000,
  maxTables: 256,
  maxDepth: 32,
  maxNodes: 20_000_000,
  maxTextNode: 4 * MIB,
  parseBudgetMs: 120_000,
  validateBudgetMs: 60_000,
  payloadBytes: 10 * MIB,
  maxImportRows: 100_000,
  maxImportColumns: MAX_IMPORT_COLUMNS,
  maxErrorsReturned: MAX_ERRORS_RETURNED,
  requestTimeoutMs: 30_000
} as const;

/** Above this many rows the server prints a startup warning ("not performance-validated"). */
export const IMPORT_ROWS_WARNING_THRESHOLD = 20_000;

/** The expansion ratio is only enforced once the output is at least this large (tiny files compress very well). */
export const RATIO_MIN_OUTPUT_BYTES = MIB;

/** Everything an operator or a build can configure. Every field is optional and clamped. */
export interface LimitConfig {
  /** Canonical payload bytes (server `SCC_MAX_UPLOAD_BYTES`, learned from `snapshot.limits.maxUploadBytes`). */
  payloadBytes?: number;
  /** Canonical payload rows (server `SCC_MAX_IMPORT_ROWS`, learned from `snapshot.limits.maxRows`). */
  maxImportRows?: number;
  /** Per-adapter source limits, keyed by adapter id. */
  sourceBytesByAdapter?: Record<string, number>;
  maxScanRows?: number;
  maxColumns?: number;
  parseBudgetMs?: number;
  validateBudgetMs?: number;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const v = Math.floor(value);
  if (v < min) return fallback;
  return v > max ? max : v;
}

/** Resolves the configuration into effective limits (layer (a) defaults to the payload limit). */
export function resolveLimits(config: LimitConfig = {}): ResolvedLimits {
  const payloadBytes = clampInt(config.payloadBytes, 1, LIMIT_CEILINGS.payloadBytes, LIMIT_DEFAULTS.payloadBytes);
  const maxImportRows = clampInt(config.maxImportRows, 1, LIMIT_CEILINGS.maxImportRows, LIMIT_DEFAULTS.maxImportRows);
  return {
    sourceBytes: Math.min(payloadBytes, LIMIT_CEILINGS.sourceBytesFamily),
    sourceBytesGlobal: LIMIT_DEFAULTS.sourceBytesGlobal,
    expandedEntryBytes: LIMIT_DEFAULTS.expandedEntryBytes,
    expandedTotalBytes: LIMIT_DEFAULTS.expandedTotalBytes,
    expansionRatio: LIMIT_DEFAULTS.expansionRatio,
    archiveEntries: LIMIT_DEFAULTS.archiveEntries,
    maxDataRows: maxImportRows,
    maxScanRows: clampInt(config.maxScanRows, 1, LIMIT_CEILINGS.maxScanRows, LIMIT_DEFAULTS.maxScanRows),
    maxColumns: clampInt(config.maxColumns, 1, LIMIT_CEILINGS.maxColumns, LIMIT_DEFAULTS.maxColumns),
    maxCells: LIMIT_DEFAULTS.maxCells,
    maxTables: LIMIT_DEFAULTS.maxTables,
    maxDepth: LIMIT_DEFAULTS.maxDepth,
    maxNodes: LIMIT_DEFAULTS.maxNodes,
    maxTextNode: LIMIT_DEFAULTS.maxTextNode,
    parseBudgetMs: clampInt(config.parseBudgetMs, 1, LIMIT_CEILINGS.parseBudgetMs, LIMIT_DEFAULTS.parseBudgetMs),
    validateBudgetMs: clampInt(config.validateBudgetMs, 1, LIMIT_CEILINGS.validateBudgetMs, LIMIT_DEFAULTS.validateBudgetMs),
    payloadBytes,
    maxImportRows,
    maxImportColumns: LIMIT_DEFAULTS.maxImportColumns,
    maxErrorsReturned: LIMIT_DEFAULTS.maxErrorsReturned,
    requestTimeoutMs: LIMIT_DEFAULTS.requestTimeoutMs
  };
}

/**
 * Limits for one adapter: its configured source limit (clamped to the family ceiling), then the adapter's own
 * resource hints, which can only lower a value.
 */
export function limitsForAdapter(base: ResolvedLimits, descriptor: AdapterDescriptor, config: LimitConfig = {}): ResolvedLimits {
  const configured = config.sourceBytesByAdapter?.[descriptor.id];
  let sourceBytes = base.sourceBytes;
  if (configured !== undefined) sourceBytes = clampInt(configured, 1, LIMIT_CEILINGS.sourceBytesFamily, sourceBytes);
  const hints = descriptor.resourceHints;
  const lower = (current: number, hint: number | undefined): number =>
    hint !== undefined && Number.isFinite(hint) && hint >= 1 ? Math.min(current, Math.floor(hint)) : current;
  return {
    ...base,
    sourceBytes: Math.min(lower(sourceBytes, hints.sourceBytes), base.sourceBytesGlobal),
    expandedEntryBytes: lower(base.expandedEntryBytes, hints.expandedBytes),
    expansionRatio: lower(base.expansionRatio, hints.ratio),
    maxDepth: lower(base.maxDepth, hints.maxDepth),
    maxNodes: lower(base.maxNodes, hints.maxRecords)
  };
}

/** Parses `VITE_SCC_INGEST_*` style overrides (strings) into a LimitConfig; invalid values are ignored. */
export function limitConfigFromEnv(env: Record<string, string | undefined>): LimitConfig {
  const int = (key: string): number | undefined => {
    const raw = env[key]?.trim();
    return raw !== undefined && /^\d+$/.test(raw) ? Number(raw) : undefined;
  };
  const config: LimitConfig = {};
  const scan = int('VITE_SCC_INGEST_MAX_SCAN_ROWS');
  if (scan !== undefined) config.maxScanRows = scan;
  const parse = int('VITE_SCC_INGEST_PARSE_BUDGET_MS');
  if (parse !== undefined) config.parseBudgetMs = parse;
  const validate = int('VITE_SCC_INGEST_VALIDATE_BUDGET_MS');
  if (validate !== undefined) config.validateBudgetMs = validate;
  // VITE_SCC_INGEST_SOURCE_BYTES_<ADAPTER_ID> with '_' standing for '-' (generic: no adapter id is named here).
  const prefix = 'VITE_SCC_INGEST_SOURCE_BYTES_';
  for (const key of Object.keys(env).sort()) {
    if (!key.startsWith(prefix) || key.length === prefix.length) continue;
    const value = int(key);
    if (value === undefined) continue;
    const id = key.slice(prefix.length).toLowerCase().replace(/_/g, '-');
    (config.sourceBytesByAdapter ??= {})[id] = value;
  }
  return config;
}

// ---- error builders (texts live in messages.ts and always name a next step) --------------------------------------

/** Layer (a): a source file above its family limit (or above the global limit). */
export function sourceTooLarge(limits: ResolvedLimits, descriptor: AdapterDescriptor | null, size: number): IngestError | null {
  if (size > limits.sourceBytesGlobal) {
    return ingestError('LIMIT_SOURCE_GLOBAL', 'limits', { limit: limits.sourceBytesGlobal }, { limit: 'sourceBytesGlobal' });
  }
  if (size > limits.sourceBytes) {
    const params = { size, limit: limits.sourceBytes };
    return descriptor !== null && descriptor.resourceHints.sourceBytes !== undefined
      ? ingestError('LIMIT_SOURCE_BYTES_FAMILY', 'limits', { ...params, family: descriptor.family }, { limit: 'sourceBytes' })
      : ingestError('LIMIT_SOURCE_BYTES', 'limits', params, { limit: 'sourceBytes' });
  }
  return null;
}

/** Layer (b): decompressed output above the expanded-size cap. */
export function expandedTooLarge(limit: number): IngestError {
  return ingestError('LIMIT_EXPANDED', 'limits', { limit }, { limit: 'expandedBytes' });
}

export function expansionBomb(): IngestError {
  return ingestError('LIMIT_RATIO', 'limits', {}, { limit: 'expansionRatio' });
}

/** True when `output` bytes from `input` compressed bytes exceed the ratio cap (only checked above a small floor). */
export function exceedsRatio(limits: ResolvedLimits, input: number, output: number): boolean {
  if (output < RATIO_MIN_OUTPUT_BYTES) return false;
  return output > Math.max(1, input) * limits.expansionRatio;
}

/** Layer (c): too many data rows (the legacy wording "The file has more than N data rows." is kept as the prefix). */
export function tooManyRows(limits: ResolvedLimits): IngestError {
  return ingestError('LIMIT_ROWS', 'limits', { limit: limits.maxDataRows }, { limit: 'dataRows' });
}

export function tooManyScanRows(limits: ResolvedLimits): IngestError {
  return ingestError('LIMIT_SCAN_ROWS', 'limits', { limit: limits.maxScanRows }, { limit: 'scanRows' });
}

/** Layer (c): a row wider than the column cap (the legacy wording "Line N has more than 50 columns." is kept). */
export function tooManyColumns(limits: ResolvedLimits, line: number): IngestError {
  return ingestError('LIMIT_COLUMNS', 'limits', { line, limit: limits.maxColumns }, { limit: 'columns', source: { kind: 'line', line } });
}

export function tooComplex(): IngestError {
  return ingestError('LIMIT_COMPLEXITY', 'limits', {}, { limit: 'complexity' });
}

/** Layer (d). */
export function parseTimedOut(): IngestError {
  return ingestError('LIMIT_PARSE_TIME', 'limits', {}, { limit: 'parseTime' });
}

export function validateTimedOut(): IngestError {
  return ingestError('LIMIT_VALIDATE_TIME', 'limits', {}, { limit: 'validateTime' });
}

export function outOfMemory(): IngestError {
  return ingestError('LIMIT_MEMORY', 'limits', {}, { limit: 'memory' });
}

/** Layer (e): the converted payload does not fit the server's limits (stopped client-side, before upload). */
export function payloadTooLarge(limits: ResolvedLimits, size: number): IngestError | null {
  return size > limits.payloadBytes ? ingestError('LIMIT_PAYLOAD_BYTES', 'limits', { size, limit: limits.payloadBytes }, { limit: 'payloadBytes' }) : null;
}

export function payloadTooManyRows(limits: ResolvedLimits, rows: number): IngestError | null {
  return rows > limits.maxImportRows ? ingestError('LIMIT_PAYLOAD_ROWS', 'limits', { size: rows, limit: limits.maxImportRows }, { limit: 'payloadRows' }) : null;
}
