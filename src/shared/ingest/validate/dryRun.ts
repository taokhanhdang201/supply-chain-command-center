// Dry-run validation: the canonical CSV goes through the UNCHANGED V1 importers (the authority, run here for the preview
// and again by the server for the real import). Their issues speak about lines of the canonical CSV; this module
// translates them back to the user's own file: the source reference of the line, the value quoted as it appears in the
// file, and the number/date format the file was read with. The V1 issue itself is kept untouched next to the display text.

import type { ImportIssue, ImportKind } from '../../types';
import { importInventoryCsv } from '../../csv/importInventory';
import { importShipmentsCsv } from '../../csv/importShipments';
import { truncateForMessage } from '../../format';
import type { ResolvedLimits, SourceRef } from '../types';
import type { RaggedRow } from '../canonical/buildCsv';
import { MAX_ERRORS_RETURNED } from '../../constants';
import { fieldInfo, fieldsOf } from '../canonical/schemaRegistry';
import { NUMBER_PRESET_EXAMPLE, type NumberPreset } from '../normalize/numbers';
import { DATE_PRESET_EXAMPLE, type DatePreset } from '../normalize/dates';
import { formatRowRef } from '../preview/sourceRef';

export interface DisplayIssue {
  /** The V1 issue exactly as the importer produced it (line = line of the canonical CSV). */
  issue: ImportIssue;
  source: SourceRef | null;
  /** Index of the row in the extracted table (null for file-level problems). */
  rowIndex: number | null;
  /** The row in the user's file: "line 57", "Sheet 'Loads', row 57", "$.items[3] (record 4)", or "File" for file-level problems. */
  where: string;
  /** The text to show: the value as written in the user's file, the source line of any referenced row, the format note. */
  message: string;
}

export type DryRunResult =
  | { ok: true; rowCount: number; warnings: string[] }
  | { ok: false; issues: DisplayIssue[]; totalErrors: number; warnings: string[] };

export interface DryRunInput {
  kind: ImportKind;
  csv: string;
  lineToSource: ReadonlyArray<SourceRef | undefined>;
  rowLines: readonly number[];
  canonicalRows: ReadonlyArray<readonly string[]>;
  rawRows: ReadonlyArray<readonly string[]>;
  numberPreset: NumberPreset;
  datePreset: DatePreset;
  limits: ResolvedLimits;
  /** Rows left out of the CSV because their width differs from the header (reported as FIELD_COUNT, like V1 does). */
  ragged?: ReadonlyArray<RaggedRow>;
  /** Index into the table rows of each data row, and where a table row came from (to order and place the problems). */
  sourceRowIndex?: readonly number[];
  originOf?: (rowIndex: number) => SourceRef;
}

const NUMBER_NOTE: Record<NumberPreset, string> = {
  plain: '',
  us: 'comma thousands, dot decimal',
  eu: 'decimal comma',
  fr: 'decimal comma, space thousands'
};

const NUMBER_CODES = new Set(['INVALID_NUMBER', 'TOO_MANY_DECIMALS', 'NOT_INTEGER', 'NEGATIVE', 'OUT_OF_RANGE']);
const DATE_CODES = new Set(['INVALID_DATE', 'OUT_OF_RANGE']);

function translate(issue: ImportIssue, input: DryRunInput, rowOfLine: ReadonlyMap<number, number>): DisplayIssue {
  const source = issue.line === null ? null : (input.lineToSource[issue.line] ?? null);
  let message = issue.message;
  const row = issue.line === null ? undefined : rowOfLine.get(issue.line);
  const fields = fieldsOf(input.kind);
  const column = issue.column === null ? -1 : fields.findIndex((f) => f.name === issue.column);
  if (row !== undefined && column >= 0) {
    const canonical = (input.canonicalRows[row] as readonly string[])[column] as string;
    const raw = (input.rawRows[row] as readonly string[])[column] as string;
    if (raw !== '' && raw !== canonical) message = message.replace(`"${truncateForMessage(canonical)}"`, `"${truncateForMessage(raw)}"`);
    const info = fieldInfo(input.kind, issue.column as string);
    if (info !== undefined && raw !== '') {
      if ((info.valueKind === 'integer' || info.valueKind === 'decimal' || info.valueKind === 'money') && NUMBER_CODES.has(issue.code) && input.numberPreset !== 'plain') {
        message += ` Number format: ${NUMBER_PRESET_EXAMPLE[input.numberPreset]} (${NUMBER_NOTE[input.numberPreset]}).`;
      } else if (info.valueKind === 'date' && DATE_CODES.has(issue.code) && input.datePreset !== 'iso') {
        message += ` Date format: ${DATE_PRESET_EXAMPLE[input.datePreset]}.`;
      }
    }
  }
  // "first seen on line 12" refers to a line of the canonical CSV: show the user's position instead.
  message = message.replace(/\bline (\d+)/g, (whole, n: string) => {
    const ref = input.lineToSource[Number(n)];
    return ref === undefined ? whole : formatRowRef(ref);
  });
  return { issue, source, rowIndex: row === undefined ? null : (input.sourceRowIndex?.[row] ?? row), where: source === null ? 'File' : formatRowRef(source), message };
}

export function dryRun(input: DryRunInput): DryRunResult {
  const limits = { maxRows: input.limits.maxImportRows, maxColumns: input.limits.maxImportColumns };
  const result = input.kind === 'inventory' ? importInventoryCsv(input.csv, limits) : importShipmentsCsv(input.csv, limits);
  const ragged = input.ragged ?? [];
  if (result.ok && ragged.length === 0) return { ok: true, rowCount: result.rows.length, warnings: result.warnings };
  const rowOfLine = new Map<number, number>(input.rowLines.map((line, k) => [line, k]));
  const ordered: Array<{ order: number; display: DisplayIssue }> = [];
  if (!result.ok) {
    for (const e of result.errors) {
      const k = e.line === null ? undefined : rowOfLine.get(e.line);
      ordered.push({ order: k === undefined ? -1 : (input.sourceRowIndex?.[k] ?? k), display: translate(e, input, rowOfLine) });
    }
  }
  for (const r of ragged) {
    const source = input.originOf?.(r.sourceRowIndex) ?? null;
    const message = `Expected ${r.expected} fields but found ${r.found}.`;
    ordered.push({ order: r.sourceRowIndex, display: { issue: { line: source !== null && source.kind === 'line' ? source.line : null, column: null, code: 'FIELD_COUNT', message }, source, rowIndex: r.sourceRowIndex, where: source === null ? 'File' : formatRowRef(source), message } });
  }
  ordered.sort((a, b) => a.order - b.order || (a.display.issue.column === null ? -1 : 0) - (b.display.issue.column === null ? -1 : 0));
  const total = (result.ok ? 0 : result.totalErrors) + ragged.length;
  return { ok: false, issues: ordered.slice(0, MAX_ERRORS_RETURNED).map((o) => o.display), totalErrors: total, warnings: result.warnings };
}
