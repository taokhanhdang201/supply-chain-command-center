// Inventory CSV import: strict, all-or-nothing validation of raw CSV text into `InventoryRecord[]` (plan §5.5).

import type { ImportIssue, ImportIssueCode, InventoryRecord } from '../types';
import { DEFAULT_LEAD_TIME_DAYS, MAX_IMPORT_COLUMNS, MAX_IMPORT_ROWS } from '../constants';
import { parseCsv } from './parseCsv';
import { INVENTORY_COLUMNS } from './schemas';
import { mapHeader, finalizeIssues, type ColumnMap, type ImportLimits, type ImportResult } from './importCommon';
import {
  hasControlChars,
  parseDecimal,
  parseId,
  parseInteger,
  parseMoneyCents,
  parseText,
  parseWarehouseCode,
  type FieldResult
} from './fieldParsers';

export type { ImportLimits, ImportResult };

const COLUMN_ORDER = INVENTORY_COLUMNS.map((c) => c.name);

function singleIssueResult<T>(issue: ImportIssue): ImportResult<T> {
  return { ok: false, errors: [issue], totalErrors: 1, warnings: [] };
}

type ParsedField<T> = { ok: true; value: T } | { ok: false; issue: ImportIssue };

function parseField<T>(
  raw: string | undefined,
  column: string,
  line: number,
  requiredValue: boolean,
  defaultValue: T | undefined,
  parser: (v: string) => FieldResult<T>
): ParsedField<T> {
  const value = raw ?? '';
  if (value === '') {
    if (requiredValue) {
      return { ok: false, issue: { line, column, code: 'REQUIRED', message: 'Value is required.' } };
    }
    return { ok: true, value: defaultValue as T };
  }
  if (hasControlChars(value)) {
    return {
      ok: false,
      issue: { line, column, code: 'CONTROL_CHARS', message: 'Value contains control characters (tabs, line breaks or other non-printing characters).' }
    };
  }
  const result = parser(value);
  if (!result.ok) {
    return { ok: false, issue: { line, column, code: result.code, message: result.message } };
  }
  return { ok: true, value: result.value };
}

function readRaw(fields: readonly string[], index: Map<string, number>, name: string): string | undefined {
  const idx = index.get(name);
  if (idx === undefined) return undefined;
  return (fields[idx] ?? '').trim();
}

/** Imports inventory CSV text into records, or a validation failure listing every problem found. */
export function importInventoryCsv(text: string, limits?: Partial<ImportLimits>, columnMap?: ColumnMap): ImportResult<InventoryRecord> {
  const stripped = text.replace(/^﻿/, '');
  if (stripped.trim() === '') {
    return singleIssueResult({ line: null, column: null, code: 'EMPTY_FILE', message: 'The file is empty.' });
  }
  if (text.includes('\u0000')) {
    return singleIssueResult({
      line: null,
      column: null,
      code: 'MALFORMED_CSV',
      message: 'The file contains NUL bytes; it looks like a binary file, not CSV.'
    });
  }

  const maxRows = limits?.maxRows ?? MAX_IMPORT_ROWS;
  const maxColumns = limits?.maxColumns ?? MAX_IMPORT_COLUMNS;
  const parsed = parseCsv(text, { maxRows, maxColumns });
  if (!parsed.ok) return singleIssueResult(parsed.error);

  const { records } = parsed;
  if (records.length === 0) {
    const required = INVENTORY_COLUMNS.filter((c) => c.requiredColumn).map((c) => c.name);
    return singleIssueResult({
      line: 1,
      column: null,
      code: 'MISSING_COLUMNS',
      message: `Missing required column(s): ${required.join(', ')}. Found columns: (none).`
    });
  }

  const header = records[0]!;
  const mapped = mapHeader(header, INVENTORY_COLUMNS, columnMap);
  if (!mapped.ok) {
    const { errors, totalErrors } = finalizeIssues(mapped.issues, COLUMN_ORDER);
    return { ok: false, errors, totalErrors, warnings: [] };
  }

  if (records.length === 1) {
    return singleIssueResult({ line: null, column: null, code: 'NO_DATA_ROWS', message: 'The file has a header but no data rows.' });
  }

  const warnings = [...mapped.warnings];
  if (!mapped.index.has('avg_daily_usage')) {
    warnings.push('Column avg_daily_usage not present; stockout risk and turnover will be unavailable for these items.');
  }
  if (!mapped.index.has('lead_time_days')) {
    warnings.push('Column lead_time_days not present; the default of 14 days is used.');
  }

  const headerLen = header.fields.length;
  const issues: ImportIssue[] = [];
  const rows: InventoryRecord[] = [];
  const seenKeys = new Map<string, number>();

  for (const record of records.slice(1)) {
    const { fields, line } = record;
    if (fields.length < headerLen) {
      issues.push({ line, column: null, code: 'FIELD_COUNT', message: `Expected ${headerLen} fields but found ${fields.length}.` });
      continue;
    }
    if (fields.length > headerLen && fields.slice(headerLen).some((f) => f.trim() !== '')) {
      issues.push({ line, column: null, code: 'FIELD_COUNT', message: `Expected ${headerLen} fields but found ${fields.length}.` });
      continue;
    }

    const rowIssues: ImportIssue[] = [];

    const sku = parseField(readRaw(fields, mapped.index, 'sku'), 'sku', line, true, undefined, (v) => parseId(v, 'SKU'));
    if (!sku.ok) rowIssues.push(sku.issue);

    const productName = parseField(readRaw(fields, mapped.index, 'product_name'), 'product_name', line, true, undefined, (v) => parseText(v, 120));
    if (!productName.ok) rowIssues.push(productName.issue);

    const category = parseField(readRaw(fields, mapped.index, 'category'), 'category', line, true, undefined, (v) => parseText(v, 60));
    if (!category.ok) rowIssues.push(category.issue);

    const warehouse = parseField(readRaw(fields, mapped.index, 'warehouse'), 'warehouse', line, true, undefined, parseWarehouseCode);
    if (!warehouse.ok) rowIssues.push(warehouse.issue);

    const quantity = parseField(readRaw(fields, mapped.index, 'quantity'), 'quantity', line, true, undefined, (v) => parseInteger(v, 0, 10_000_000));
    if (!quantity.ok) rowIssues.push(quantity.issue);

    const reorderPoint = parseField(readRaw(fields, mapped.index, 'reorder_point'), 'reorder_point', line, true, undefined, (v) => parseInteger(v, 0, 10_000_000));
    if (!reorderPoint.ok) rowIssues.push(reorderPoint.issue);

    const unitCostCents = parseField(readRaw(fields, mapped.index, 'unit_cost'), 'unit_cost', line, true, undefined, (v) => parseMoneyCents(v, 100_000_000));
    if (!unitCostCents.ok) rowIssues.push(unitCostCents.issue);

    const avgDailyUsage = parseField<number | null>(
      readRaw(fields, mapped.index, 'avg_daily_usage'),
      'avg_daily_usage',
      line,
      false,
      null,
      (v) => parseDecimal(v, 0, 1_000_000, 2)
    );
    if (!avgDailyUsage.ok) rowIssues.push(avgDailyUsage.issue);

    const leadTimeDays = parseField<number>(
      readRaw(fields, mapped.index, 'lead_time_days'),
      'lead_time_days',
      line,
      false,
      DEFAULT_LEAD_TIME_DAYS,
      (v) => parseInteger(v, 1, 365)
    );
    if (!leadTimeDays.ok) rowIssues.push(leadTimeDays.issue);

    if (sku.ok && warehouse.ok) {
      const key = `${sku.value}@${warehouse.value}`;
      const firstLine = seenKeys.get(key);
      if (firstLine !== undefined) {
        rowIssues.push({
          line,
          column: 'sku',
          code: 'DUPLICATE_ID' as ImportIssueCode,
          message: `Duplicate SKU + warehouse "${sku.value} @ ${warehouse.value}" (first seen on line ${firstLine}).`
        });
      } else {
        seenKeys.set(key, line);
      }
    }

    if (rowIssues.length > 0) {
      issues.push(...rowIssues);
      continue;
    }

    rows.push({
      sku: (sku as { ok: true; value: string }).value,
      productName: (productName as { ok: true; value: string }).value,
      category: (category as { ok: true; value: string }).value,
      warehouse: (warehouse as { ok: true; value: string }).value,
      quantity: (quantity as { ok: true; value: number }).value,
      reorderPoint: (reorderPoint as { ok: true; value: number }).value,
      unitCostCents: (unitCostCents as { ok: true; value: number }).value,
      avgDailyUsage: (avgDailyUsage as { ok: true; value: number | null }).value,
      leadTimeDays: (leadTimeDays as { ok: true; value: number }).value
    });
  }

  if (issues.length > 0) {
    const { errors, totalErrors } = finalizeIssues(issues, COLUMN_ORDER);
    return { ok: false, errors, totalErrors, warnings };
  }

  return { ok: true, rows, warnings };
}
