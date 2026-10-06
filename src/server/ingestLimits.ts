// Server-side ingestion limits (layer (e) of the layered limits, ke-hoach 10.3): the canonical payload the unchanged
// import endpoint accepts. `SCC_MAX_UPLOAD_BYTES` stays in `config.ts` and behaves exactly as before; this module only
// adds `SCC_MAX_IMPORT_ROWS` (integer 1..100,000, default 20,000, a startup warning above 20,000) and exposes the other
// effective values (columns, errors returned, request timeout) at their existing, unchanged defaults. It reads the
// layer values from the shared `limits.ts`, so the server and the client share one source of truth. It deliberately does
// not import `config.ts` and does not touch `AppConfig`.

import { DEFAULT_MAX_UPLOAD_BYTES } from '../shared/constants';
import { IMPORT_ROWS_WARNING_THRESHOLD, LIMIT_CEILINGS, LIMIT_DEFAULTS } from '../shared/ingest/limits';

export class IngestLimitsError extends Error {}

export interface IngestLimits {
  /** Maximum data rows of one import (`SCC_MAX_IMPORT_ROWS`; default 20,000). Also reported as `snapshot.limits.maxRows`. */
  maxRows: number;
  /** Maximum columns of one import (fixed at 50). */
  maxColumns: number;
  /** Validation problems returned to the client (fixed at 500; the real total is always reported). */
  maxErrorsReturned: number;
  /** Request timeout in ms (fixed at 30,000; `app.ts` owns the real value). */
  requestTimeoutMs: number;
  /** Reference only: the effective upload size remains `AppConfig.maxUploadBytes` (`SCC_MAX_UPLOAD_BYTES`). */
  defaultUploadBytes: number;
  /** Messages to print once at startup (for example a row limit above the performance-validated range). */
  warnings: string[];
}

/** Today's effective limits, exactly (used when no `ingestLimits` is supplied, so existing callers are unaffected). */
export const DEFAULT_INGEST_LIMITS: Readonly<IngestLimits> = Object.freeze({
  maxRows: LIMIT_DEFAULTS.maxImportRows,
  maxColumns: LIMIT_DEFAULTS.maxImportColumns,
  maxErrorsReturned: LIMIT_DEFAULTS.maxErrorsReturned,
  requestTimeoutMs: LIMIT_DEFAULTS.requestTimeoutMs,
  defaultUploadBytes: DEFAULT_MAX_UPLOAD_BYTES,
  warnings: []
});

export const MIN_IMPORT_ROWS = 1;
export const MAX_IMPORT_ROWS_CEILING = LIMIT_CEILINGS.maxImportRows;

/**
 * Reads `SCC_MAX_IMPORT_ROWS`. Empty or unset means the default; the value is trimmed first (as `config.ts` does). Any
 * non-integer or out-of-range value throws an `IngestLimitsError` naming the variable and the range.
 */
export function loadIngestLimits(env: Record<string, string | undefined>): IngestLimits {
  const raw = env.SCC_MAX_IMPORT_ROWS?.trim();
  let maxRows: number = DEFAULT_INGEST_LIMITS.maxRows;
  if (raw !== undefined && raw !== '') {
    if (!/^-?\d+$/.test(raw)) {
      throw new IngestLimitsError(`Invalid SCC_MAX_IMPORT_ROWS "${raw}": expected an integer between ${MIN_IMPORT_ROWS} and ${MAX_IMPORT_ROWS_CEILING}.`);
    }
    const value = Number(raw);
    if (value < MIN_IMPORT_ROWS || value > MAX_IMPORT_ROWS_CEILING) {
      throw new IngestLimitsError(`Invalid SCC_MAX_IMPORT_ROWS "${raw}": expected an integer between ${MIN_IMPORT_ROWS} and ${MAX_IMPORT_ROWS_CEILING}.`);
    }
    maxRows = value;
  }
  const warnings: string[] = [];
  if (maxRows > IMPORT_ROWS_WARNING_THRESHOLD) {
    warnings.push(
      `SCC_MAX_IMPORT_ROWS is ${maxRows}, above ${IMPORT_ROWS_WARNING_THRESHOLD}: imports of more than ${IMPORT_ROWS_WARNING_THRESHOLD} rows are not performance-validated and import work runs on the single server thread.`
    );
  }
  return { ...DEFAULT_INGEST_LIMITS, maxRows, warnings };
}
