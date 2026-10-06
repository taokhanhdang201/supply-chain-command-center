// The V1.5 column-mapping step of the Import card: shows how each file column maps to an SCC field, lets the user
// change it, dry-runs the import with the shared import code, and only enables Confirm when the mapping is valid and
// the data passes validation. All file text is rendered as React text and truncated.

import { useEffect, useId, useMemo, useRef } from 'react';
import type { ImportKind } from '../../../shared/types';
import { truncateForMessage } from '../../../shared/format';
import {
  columnsForKind,
  previewImport,
  toColumnMap,
  validateMapping,
  type Assignment,
  type ColumnStatus,
  type ColumnSuggestion,
  type MappingSuggestion
} from '../../../shared/mapping/columnMapping';
import type { ColumnMap } from '../../../shared/csv/importCommon';
import { Badge } from '../ui/Badge';
import { Banner } from '../ui/Banner';
import { ImportIssueTable } from './ImportIssueTable';

const IGNORE_VALUE = '__ignore__';

export interface ColumnMappingPanelProps {
  kind: ImportKind;
  fileName: string;
  headers: readonly string[];
  sampleRows: readonly (readonly string[])[];
  dataRowCount: number;
  text: string;
  assignments: readonly Assignment[];
  suggestion: MappingSuggestion;
  busy: boolean;
  onChange: (index: number, assignment: Assignment) => void;
  onConfirm: (map: ColumnMap) => void;
  onCancel: () => void;
  /**
   * Optional (V2): when given, a "Review as a different format" button appears next to Cancel ONLY while the dry run reports
   * data problems, and hands the file to the universal import flow. Without it the panel renders exactly as in V1.5.
   */
  onReviewDifferentFormat?: () => void;
}

function selectValue(a: Assignment): string {
  if (a.type === 'undecided') return '';
  if (a.type === 'ignore') return IGNORE_VALUE;
  return a.field;
}

function toAssignment(value: string): Assignment {
  if (value === '') return { type: 'undecided' };
  if (value === IGNORE_VALUE) return { type: 'ignore' };
  return { type: 'field', field: value };
}

function StatusCell({ status, column, assignment }: { status: ColumnStatus; column: ColumnSuggestion | undefined; assignment: Assignment }) {
  if (status === 'mapped') return <Badge tone="good">Mapped</Badge>;
  if (status === 'unmapped') return <Badge tone="neutral">Not imported</Badge>;
  if (status === 'ambiguous') {
    const candidates = column?.candidates ?? [];
    const name = column === undefined || column.header === '' ? 'This column' : `"${truncateForMessage(column.header, 60)}"`;
    return (
      <>
        <Badge tone="warning">Ambiguous</Badge>
        {candidates.length === 1 && (
          <span className="mapping-panel__hint">
            {name} has more than one possible meaning (for example {candidates[0]}). Choose the SCC field it represents.
          </span>
        )}
        {candidates.length > 1 && <span className="mapping-panel__hint">Could match: {candidates.join(', ')}. Choose a field.</span>}
        {candidates.length === 0 && <span className="mapping-panel__hint">Choose a field.</span>}
      </>
    );
  }
  return (
    <>
      <Badge tone="critical">Duplicate</Badge>
      {assignment.type === 'field' && <span className="mapping-panel__hint">{assignment.field} is also chosen for another column.</span>}
    </>
  );
}

/** Mapping table, validation summary, data preview and Confirm/Cancel actions for one uploaded file. */
export function ColumnMappingPanel({
  kind,
  fileName,
  headers,
  sampleRows,
  dataRowCount,
  text,
  assignments,
  suggestion,
  busy,
  onChange,
  onConfirm,
  onCancel,
  onReviewDifferentFormat
}: ColumnMappingPanelProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const blockedId = useId();
  const schema = columnsForKind(kind);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const validation = useMemo(() => validateMapping(kind, assignments), [kind, assignments]);
  const columnMap = useMemo(() => toColumnMap(assignments), [assignments]);
  const mapKey = columnMap.map((f) => f ?? '').join(',');
  // The dry run only makes sense for a valid mapping. It is the same shared import code the server runs, so results match.
  const preview = useMemo(
    () => (validation.valid ? previewImport(kind, text, columnMap) : null),
    // columnMap is fully described by mapKey, so it is the dependency (a fresh array each render would defeat the memo)
    [kind, text, mapKey, validation.valid]
  );

  const mappedCount = assignments.filter((a) => a.type === 'field').length;
  const canConfirm = validation.valid && preview !== null && preview.ok;
  const blockedMessage = !validation.valid
    ? 'Resolve the highlighted columns before importing.'
    : preview !== null && !preview.ok
      ? 'Fix the data problems above before importing.'
      : null;

  // Preview columns: the assigned fields, in schema order, each read from the first column assigned to it.
  const previewColumns = schema.flatMap((spec) => {
    const idx = assignments.findIndex((a) => a.type === 'field' && a.field === spec.name);
    return idx === -1 ? [] : [{ name: spec.name, idx }];
  });

  return (
    <div className="mapping-panel">
      <h3 tabIndex={-1} ref={headingRef}>
        Map columns for {fileName}
      </h3>
      <p>
        Some column names in this file don&apos;t match SCC&apos;s field names. Check how each column maps to an SCC field, then confirm. Values are
        imported exactly as they appear in the file.
      </p>

      <div className="table-scroll">
        <table className="data-table mapping-panel__table">
          <caption className="visually-hidden">Column mapping</caption>
          <thead>
            <tr>
              <th scope="col">File column</th>
              <th scope="col">Example value</th>
              <th scope="col">SCC field</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {headers.map((header, i) => {
              const assignment = assignments[i] ?? { type: 'ignore' as const };
              const displayHeader = header === '' ? '(blank)' : truncateForMessage(header, 60);
              return (
                <tr key={i}>
                  <td>{displayHeader}</td>
                  <td>{truncateForMessage(sampleRows[0]?.[i] ?? '', 40)}</td>
                  <td>
                    <select
                      className="select-field__control"
                      aria-label={`SCC field for column ${displayHeader}`}
                      value={selectValue(assignment)}
                      disabled={busy}
                      onChange={(e) => onChange(i, toAssignment(e.target.value))}
                    >
                      {assignment.type === 'undecided' && <option value="">Choose a field…</option>}
                      <option value={IGNORE_VALUE}>Do not import</option>
                      {schema.map((spec) => (
                        <option key={spec.name} value={spec.name}>
                          {spec.requiredColumn ? `${spec.name} (required)` : spec.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <StatusCell status={validation.statuses[i] ?? 'unmapped'} column={suggestion.columns[i]} assignment={assignment} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {validation.missingRequired.length > 0 && (
        <>
          <p>Required SCC fields not mapped:</p>
          <ul>
            {validation.missingRequired.map((f) => (
              <li key={f}>
                <Badge tone="critical">Required field missing</Badge> {f}
              </li>
            ))}
          </ul>
        </>
      )}

      <p role="status">
        {mappedCount} of {headers.length} columns mapped.
      </p>

      <h4>
        Preview (first {sampleRows.length} of {dataRowCount} rows)
      </h4>
      {previewColumns.length === 0 ? (
        <p>No columns mapped yet.</p>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <caption className="visually-hidden">Mapped data preview</caption>
            <thead>
              <tr>
                {previewColumns.map((c) => (
                  <th key={c.name} scope="col">
                    {c.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sampleRows.map((row, r) => (
                <tr key={r}>
                  {previewColumns.map((c) => (
                    <td key={c.name}>{truncateForMessage(row[c.idx] ?? '', 40)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {preview !== null && preview.ok && (
        <Banner tone="success" title={`All ${preview.rowCount} rows pass validation.`}>
          {preview.warnings.length > 0 && (
            <ul>
              {preview.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
        </Banner>
      )}
      {preview !== null && !preview.ok && (
        <Banner tone="critical" title={`${preview.totalErrors} problem(s) found in the data. Nothing will be imported until the file is fixed.`}>
          <ImportIssueTable issues={preview.errors} totalErrors={preview.totalErrors} caption="Preview errors" />
        </Banner>
      )}

      <div className="mapping-panel__actions">
        <button
          type="button"
          className="button button--primary"
          disabled={!canConfirm || busy}
          aria-busy={busy}
          aria-describedby={blockedMessage !== null ? blockedId : undefined}
          onClick={() => onConfirm(columnMap)}
        >
          {busy ? 'Importing…' : 'Confirm and import'}
        </button>
        <button type="button" className="button" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
        {onReviewDifferentFormat !== undefined && preview !== null && !preview.ok && (
          <button type="button" className="button" disabled={busy} onClick={onReviewDifferentFormat}>
            Review as a different format
          </button>
        )}
      </div>
      {blockedMessage !== null && <p id={blockedId}>{blockedMessage}</p>}
    </div>
  );
}
