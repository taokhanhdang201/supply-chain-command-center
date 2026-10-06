// Shipment CSV import: strict, all-or-nothing validation of raw CSV text into `ShipmentRecord[]` (plan §5.6).
// Logical inconsistencies between dates/status (e.g. actual delivery before ship date) are accepted here and
// surfaced later as `invalid_data` alerts; only syntactic/type/range/duplicate problems are rejected on import.

import type { ImportIssue, ImportIssueCode, ShipmentRecord } from '../types';
import { MAX_IMPORT_COLUMNS, MAX_IMPORT_ROWS } from '../constants';
import { parseCsv } from './parseCsv';
import { SHIPMENT_COLUMNS } from './schemas';
import { mapHeader, finalizeIssues, type ColumnMap, type ImportLimits, type ImportResult } from './importCommon';
import { hasControlChars, parseDate, parseId, parseMoneyCents, parseStatus, parseText, type FieldResult } from './fieldParsers';

export type { ImportLimits, ImportResult };

const COLUMN_ORDER = SHIPMENT_COLUMNS.map((c) => c.name);

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

function parseLocationText(v: string): FieldResult<string> {
  return parseText(v.replace(/\s+/g, ' '), 64);
}

/** Imports shipment CSV text into records, or a validation failure listing every problem found. */
export function importShipmentsCsv(text: string, limits?: Partial<ImportLimits>, columnMap?: ColumnMap): ImportResult<ShipmentRecord> {
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
    const required = SHIPMENT_COLUMNS.filter((c) => c.requiredColumn).map((c) => c.name);
    return singleIssueResult({
      line: 1,
      column: null,
      code: 'MISSING_COLUMNS',
      message: `Missing required column(s): ${required.join(', ')}. Found columns: (none).`
    });
  }

  const header = records[0]!;
  const mapped = mapHeader(header, SHIPMENT_COLUMNS, columnMap);
  if (!mapped.ok) {
    const { errors, totalErrors } = finalizeIssues(mapped.issues, COLUMN_ORDER);
    return { ok: false, errors, totalErrors, warnings: [] };
  }

  if (records.length === 1) {
    return singleIssueResult({ line: null, column: null, code: 'NO_DATA_ROWS', message: 'The file has a header but no data rows.' });
  }

  const warnings = [...mapped.warnings];
  const headerLen = header.fields.length;
  const issues: ImportIssue[] = [];
  const rows: ShipmentRecord[] = [];
  const seenIds = new Map<string, number>();

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

    const shipmentId = parseField(readRaw(fields, mapped.index, 'shipment_id'), 'shipment_id', line, true, undefined, (v) => parseId(v, 'shipment ID'));
    if (!shipmentId.ok) rowIssues.push(shipmentId.issue);

    const origin = parseField(readRaw(fields, mapped.index, 'origin'), 'origin', line, true, undefined, parseLocationText);
    if (!origin.ok) rowIssues.push(origin.issue);

    const destination = parseField(readRaw(fields, mapped.index, 'destination'), 'destination', line, true, undefined, parseLocationText);
    if (!destination.ok) rowIssues.push(destination.issue);

    const carrier = parseField(readRaw(fields, mapped.index, 'carrier'), 'carrier', line, true, undefined, (v) => parseText(v, 60));
    if (!carrier.ok) rowIssues.push(carrier.issue);

    const status = parseField(readRaw(fields, mapped.index, 'status'), 'status', line, true, undefined, parseStatus);
    if (!status.ok) rowIssues.push(status.issue);

    const shipDate = parseField(readRaw(fields, mapped.index, 'ship_date'), 'ship_date', line, true, undefined, parseDate);
    if (!shipDate.ok) rowIssues.push(shipDate.issue);

    const estimatedDelivery = parseField<string | null>(
      readRaw(fields, mapped.index, 'estimated_delivery'),
      'estimated_delivery',
      line,
      false,
      null,
      parseDate
    );
    if (!estimatedDelivery.ok) rowIssues.push(estimatedDelivery.issue);

    const actualDelivery = parseField<string | null>(
      readRaw(fields, mapped.index, 'actual_delivery'),
      'actual_delivery',
      line,
      false,
      null,
      parseDate
    );
    if (!actualDelivery.ok) rowIssues.push(actualDelivery.issue);

    const shippingCostCents = parseField(
      readRaw(fields, mapped.index, 'shipping_cost'),
      'shipping_cost',
      line,
      true,
      undefined,
      (v) => parseMoneyCents(v, 100_000_000)
    );
    if (!shippingCostCents.ok) rowIssues.push(shippingCostCents.issue);

    if (shipmentId.ok) {
      const key = shipmentId.value.toUpperCase();
      const firstLine = seenIds.get(key);
      if (firstLine !== undefined) {
        rowIssues.push({
          line,
          column: 'shipment_id',
          code: 'DUPLICATE_ID' as ImportIssueCode,
          message: `Duplicate shipment ID "${shipmentId.value}" (first seen on line ${firstLine}).`
        });
      } else {
        seenIds.set(key, line);
      }
    }

    if (rowIssues.length > 0) {
      issues.push(...rowIssues);
      continue;
    }

    rows.push({
      shipmentId: (shipmentId as { ok: true; value: string }).value,
      origin: (origin as { ok: true; value: string }).value,
      destination: (destination as { ok: true; value: string }).value,
      carrier: (carrier as { ok: true; value: string }).value,
      status: (status as { ok: true; value: ShipmentRecord['status'] }).value,
      shipDate: (shipDate as { ok: true; value: string }).value,
      estimatedDelivery: (estimatedDelivery as { ok: true; value: string | null }).value,
      actualDelivery: (actualDelivery as { ok: true; value: string | null }).value,
      shippingCostCents: (shippingCostCents as { ok: true; value: number }).value
    });
  }

  if (issues.length > 0) {
    const { errors, totalErrors } = finalizeIssues(issues, COLUMN_ORDER);
    return { ok: false, errors, totalErrors, warnings };
  }

  return { ok: true, rows, warnings };
}
