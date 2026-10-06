import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEFAULT_MAX_UPLOAD_BYTES, MAX_ERRORS_RETURNED, MAX_IMPORT_COLUMNS, MAX_IMPORT_ROWS } from '../../../src/shared/constants';
import {
  IMPORT_ROWS_WARNING_THRESHOLD,
  LIMIT_CEILINGS,
  LIMIT_DEFAULTS,
  RATIO_MIN_OUTPUT_BYTES,
  exceedsRatio,
  expandedTooLarge,
  expansionBomb,
  limitConfigFromEnv,
  limitsForAdapter,
  outOfMemory,
  parseTimedOut,
  payloadTooLarge,
  payloadTooManyRows,
  resolveLimits,
  sourceTooLarge,
  tooComplex,
  tooManyColumns,
  tooManyRows,
  tooManyScanRows,
  validateTimedOut
} from '../../../src/shared/ingest/limits';
import { delimitedAdapter } from '../../../src/shared/ingest/adapters/delimited/adapter';
import { toyAdapter } from '../../ingest-kit/fakeAdapters';
import type { AdapterDescriptor } from '../../../src/shared/ingest/types';

const NEXT_STEP = /(split|remove|choose|ask your administrator|export|use fewer|try|upload|decompress)/i;

describe('limits: defaults equal today\'s effective values (criterion 29, SA-2)', () => {
  const base = resolveLimits();
  it('pins bytes, rows, columns, errors and the request timeout', () => {
    expect(base.payloadBytes).toBe(2_097_152);
    expect(base.payloadBytes).toBe(DEFAULT_MAX_UPLOAD_BYTES);
    expect(base.maxImportRows).toBe(20_000);
    expect(base.maxImportRows).toBe(MAX_IMPORT_ROWS);
    expect(base.maxImportColumns).toBe(50);
    expect(base.maxImportColumns).toBe(MAX_IMPORT_COLUMNS);
    expect(base.maxErrorsReturned).toBe(500);
    expect(base.maxErrorsReturned).toBe(MAX_ERRORS_RETURNED);
    expect(base.requestTimeoutMs).toBe(30_000);
    expect(base.maxDataRows).toBe(20_000);
    expect(base.maxColumns).toBe(50);
  });

  it('the request timeout constant matches the server (app.ts is protected and untouched)', () => {
    const app = readFileSync(resolve(process.cwd(), 'src/server/app.ts'), 'utf8');
    expect(app).toContain('server.requestTimeout = 30_000');
  });

  it('the source limit of the delimited family defaults to the payload limit', () => {
    expect(limitsForAdapter(base, delimitedAdapter.descriptor).sourceBytes).toBe(base.payloadBytes);
    expect(limitsForAdapter(resolveLimits({ payloadBytes: 1_048_576 }), delimitedAdapter.descriptor).sourceBytes).toBe(1_048_576);
  });

  it('documents the other layers: expanded 64/100 MiB, ratio 200, 1,000 entries, scan 200,000, budgets 20 s / 10 s', () => {
    expect(base.expandedEntryBytes).toBe(64 * 1024 * 1024);
    expect(base.expandedTotalBytes).toBe(100 * 1024 * 1024);
    expect(base.expansionRatio).toBe(200);
    expect(base.archiveEntries).toBe(1000);
    expect(base.maxScanRows).toBe(200_000);
    expect(base.maxCells).toBe(2_000_000);
    expect(base.parseBudgetMs).toBe(20_000);
    expect(base.validateBudgetMs).toBe(10_000);
    expect(base.sourceBytesGlobal).toBe(100 * 1024 * 1024);
    expect(IMPORT_ROWS_WARNING_THRESHOLD).toBe(20_000);
  });
});

describe('limits: resolution rule effective = min(ceiling, configured or default)', () => {
  it('no default exceeds its ceiling', () => {
    expect(LIMIT_DEFAULTS.payloadBytes).toBeLessThanOrEqual(LIMIT_CEILINGS.payloadBytes);
    expect(LIMIT_DEFAULTS.maxImportRows).toBeLessThanOrEqual(LIMIT_CEILINGS.maxImportRows);
    expect(LIMIT_DEFAULTS.maxScanRows).toBeLessThanOrEqual(LIMIT_CEILINGS.maxScanRows);
    expect(LIMIT_DEFAULTS.maxColumns).toBeLessThanOrEqual(LIMIT_CEILINGS.maxColumns);
    expect(LIMIT_DEFAULTS.parseBudgetMs).toBeLessThanOrEqual(LIMIT_CEILINGS.parseBudgetMs);
    expect(LIMIT_DEFAULTS.validateBudgetMs).toBeLessThanOrEqual(LIMIT_CEILINGS.validateBudgetMs);
  });

  it('honours a configured value below the ceiling, at the ceiling, and clamps above it', () => {
    expect(resolveLimits({ payloadBytes: 5_000_000 }).payloadBytes).toBe(5_000_000);
    expect(resolveLimits({ payloadBytes: LIMIT_CEILINGS.payloadBytes }).payloadBytes).toBe(10_485_760);
    expect(resolveLimits({ payloadBytes: 99_000_000 }).payloadBytes).toBe(10_485_760);
    expect(resolveLimits({ maxImportRows: 100_000 }).maxImportRows).toBe(100_000);
    expect(resolveLimits({ maxImportRows: 500_000 }).maxImportRows).toBe(100_000);
    expect(resolveLimits({ maxScanRows: 5_000_000 }).maxScanRows).toBe(1_000_000);
    expect(resolveLimits({ maxColumns: 5000 }).maxColumns).toBe(1000);
    expect(resolveLimits({ parseBudgetMs: 10 ** 9 }).parseBudgetMs).toBe(120_000);
    expect(resolveLimits({ validateBudgetMs: 10 ** 9 }).validateBudgetMs).toBe(60_000);
  });

  it('falls back to the default for invalid values (zero, negative, NaN, infinity)', () => {
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const l = resolveLimits({ payloadBytes: bad, maxImportRows: bad, maxColumns: bad });
      expect(l.payloadBytes).toBe(2_097_152);
      expect(l.maxImportRows).toBe(20_000);
      expect(l.maxColumns).toBe(50);
    }
  });

  it('the payload rows also bound the data rows of layer (c)', () => {
    expect(resolveLimits({ maxImportRows: 30_000 }).maxDataRows).toBe(30_000);
  });

  it('adapter hints can only LOWER a limit', () => {
    const base = resolveLimits();
    const lowered = (hints: AdapterDescriptor['resourceHints']) => limitsForAdapter(base, { ...toyAdapter.descriptor, resourceHints: hints });
    expect(lowered({ needsWorker: false, sourceBytes: 1000 }).sourceBytes).toBe(1000);
    expect(lowered({ needsWorker: false, sourceBytes: 50_000_000 }).sourceBytes).toBe(base.sourceBytes); // cannot raise
    expect(lowered({ needsWorker: false, ratio: 50 }).expansionRatio).toBe(50);
    expect(lowered({ needsWorker: false, ratio: 5000 }).expansionRatio).toBe(200);
    expect(lowered({ needsWorker: false, maxDepth: 8 }).maxDepth).toBe(8);
    expect(lowered({ needsWorker: false, expandedBytes: 1024 }).expandedEntryBytes).toBe(1024);
    expect(lowered({ needsWorker: false, maxRecords: 10 }).maxNodes).toBe(10);
  });

  it('a per-adapter configured source limit is clamped to the family ceiling and then lowered by hints', () => {
    const base = resolveLimits();
    const id = toyAdapter.descriptor.id;
    expect(limitsForAdapter(base, toyAdapter.descriptor, { sourceBytesByAdapter: { [id]: 8 * 1024 * 1024 } }).sourceBytes).toBe(8 * 1024 * 1024);
    expect(limitsForAdapter(base, toyAdapter.descriptor, { sourceBytesByAdapter: { [id]: 90 * 1024 * 1024 } }).sourceBytes).toBe(LIMIT_CEILINGS.sourceBytesFamily);
    const hinted = { ...toyAdapter.descriptor, resourceHints: { needsWorker: false, sourceBytes: 4096 } };
    expect(limitsForAdapter(base, hinted, { sourceBytesByAdapter: { [id]: 8 * 1024 * 1024 } }).sourceBytes).toBe(4096);
  });

  it('parses VITE_SCC_INGEST_* overrides generically and ignores invalid ones', () => {
    const cfg = limitConfigFromEnv({
      VITE_SCC_INGEST_PARSE_BUDGET_MS: '30000',
      VITE_SCC_INGEST_VALIDATE_BUDGET_MS: 'abc',
      VITE_SCC_INGEST_MAX_SCAN_ROWS: '300000',
      VITE_SCC_INGEST_SOURCE_BYTES_DELIMITED_TEXT: '3145728',
      VITE_SCC_INGEST_SOURCE_BYTES_: '1'
    });
    expect(cfg).toEqual({ parseBudgetMs: 30_000, maxScanRows: 300_000, sourceBytesByAdapter: { 'delimited-text': 3_145_728 } });
    expect(limitConfigFromEnv({})).toEqual({});
  });
});

describe('limits: boundaries and user-facing texts with a concrete next step (criteria 31, 32)', () => {
  const l = resolveLimits();
  const d = delimitedAdapter.descriptor;

  it('layer (a): exactly at the limit passes, one byte over fails with the legacy prefix and a next step', () => {
    expect(sourceTooLarge(l, d, l.sourceBytes)).toBeNull();
    const err = sourceTooLarge(l, d, l.sourceBytes + 1);
    expect(err?.limit).toBe('sourceBytes');
    expect(err?.message).toMatch(/^File is 2\.0 MB; the limit is 2\.0 MB\./);
    expect(err?.message).toMatch(NEXT_STEP);
  });

  it('layer (a): global ceiling text', () => {
    const err = sourceTooLarge(l, d, l.sourceBytesGlobal + 1);
    expect(err?.limit).toBe('sourceBytesGlobal');
    expect(err?.message).toContain('too large to import (maximum 100.0 MB)');
    expect(err?.message).toMatch(NEXT_STEP);
  });

  it('layer (a): a family with its own limit names the family', () => {
    const hinted: AdapterDescriptor = { ...d, resourceHints: { needsWorker: false, sourceBytes: 1024 } };
    const limits = limitsForAdapter(l, hinted);
    const err = sourceTooLarge(limits, hinted, 2048);
    expect(err?.message).toContain('Delimited text');
    expect(err?.message).toMatch(NEXT_STEP);
  });

  it('layer (b): size and ratio caps', () => {
    expect(expandedTooLarge(64 * 1024 * 1024).message).toMatch(/expands to more than 64\.0 MB.*Export a smaller file or split it\./);
    expect(expansionBomb().message).toMatch(/decompression bomb.*Export/);
    expect(exceedsRatio(l, 1000, RATIO_MIN_OUTPUT_BYTES - 1)).toBe(false); // tiny outputs are exempt
    expect(exceedsRatio(l, 10_000, 200 * 10_000)).toBe(false); // exactly 200:1 is allowed
    expect(exceedsRatio(l, 10_000, 200 * 10_000 + 1)).toBe(true);
    expect(exceedsRatio(l, 1, RATIO_MIN_OUTPUT_BYTES)).toBe(true);
  });

  it('layer (c): rows, scan rows, columns, complexity', () => {
    expect(tooManyRows(l).message).toMatch(/^The file has more than 20000 data rows\./);
    expect(tooManyRows(l).message).toContain('SCC_MAX_IMPORT_ROWS');
    expect(tooManyRows(l).message).toMatch(NEXT_STEP);
    expect(tooManyScanRows(l).message).toMatch(/more than 200000.*Choose another table/);
    expect(tooManyColumns(l, 7).message).toMatch(/^Line 7 has more than 50 columns\. Remove columns you do not need/);
    expect(tooManyColumns(l, 7).source).toEqual({ kind: 'line', line: 7 });
    expect(tooComplex().message).toMatch(NEXT_STEP);
  });

  it('layer (d): time and memory', () => {
    expect(parseTimedOut().message).toMatch(/took too long.*smaller file/);
    expect(validateTimedOut().message).toMatch(/took too long.*fewer rows/);
    expect(outOfMemory().message).toMatch(/ran out of memory.*smaller file/);
  });

  it('layer (e): canonical payload is separate from the source limit and names the administrator variable', () => {
    expect(payloadTooLarge(l, l.payloadBytes)).toBeNull();
    const err = payloadTooLarge(l, 2_726_297);
    expect(err?.message).toBe(
      'After conversion the data is 2.6 MB but the server accepts at most 2.0 MB per import. Use fewer rows or columns, import one sheet at a time, or ask your administrator to raise SCC_MAX_UPLOAD_BYTES.'
    );
    expect(payloadTooManyRows(l, 20_000)).toBeNull();
    expect(payloadTooManyRows(l, 20_001)?.message).toContain('SCC_MAX_IMPORT_ROWS');
  });

  it('every limit error names its layer and carries a next step', () => {
    const errors = [
      sourceTooLarge(l, d, l.sourceBytes + 1), sourceTooLarge(l, d, l.sourceBytesGlobal + 1), expandedTooLarge(1024), expansionBomb(), tooManyRows(l), tooManyScanRows(l),
      tooManyColumns(l, 1), tooComplex(), parseTimedOut(), validateTimedOut(), outOfMemory(), payloadTooLarge(l, l.payloadBytes + 1), payloadTooManyRows(l, l.maxImportRows + 1)
    ];
    for (const e of errors) {
      expect(e?.stage).toBe('limits');
      expect(e?.limit).toBeDefined();
      expect(e?.message).toMatch(NEXT_STEP);
    }
  });
});

describe('limits: no production default was raised (criterion 33)', () => {
  it('ceilings equal the documented values and the only defaults are the current ones', () => {
    expect(LIMIT_CEILINGS.payloadBytes).toBe(10_485_760);
    expect(LIMIT_CEILINGS.maxImportRows).toBe(100_000);
    expect(LIMIT_CEILINGS.maxImportColumns).toBe(50);
    expect(LIMIT_CEILINGS.maxErrorsReturned).toBe(500);
    expect(LIMIT_CEILINGS.requestTimeoutMs).toBe(30_000);
    expect(LIMIT_DEFAULTS.maxImportRows).toBe(20_000);
    expect(LIMIT_DEFAULTS.payloadBytes).toBe(2_097_152);
  });
});
