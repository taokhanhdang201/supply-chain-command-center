// The review step: counts, the columns that are not imported, the first rows as written versus as they will be imported,
// up to ten problem rows with the user's own row references, the validation result, the sentence that restates the
// destructive effect, and the Confirm button. Confirm stays disabled until nothing is left to resolve; the reason is
// linked to it with aria-describedby. All text is rendered as React text.

import { useId, useRef } from 'react';
import { clip } from '../../../shared/ingest/messages';
import type { PreviewModel } from '../../../shared/ingest/preview/model';
import type { DisplayIssue } from '../../../shared/ingest/validate/dryRun';
import type { ImportKind } from '../../../shared/types';
import { usePanelFocus } from '../../ingest/useIngestFlow';
import { countOf } from '../../ingest/importStory';
import { Banner } from '../ui/Banner';
import { Icon } from '../ui/Icon';

export { countOf };

/** The preview shows the first rows only: enough to recognise the data at a glance. */
const PREVIEW_ROWS = 5;

/** The Import button names what it imports: "Import 480 shipments" (or "Import data" before the dataset is known). */
export function importLabel(kind: ImportKind | null, rows: number | null): string {
  return kind === null || rows === null ? 'Import data' : `Import ${countOf(kind, rows)}`;
}

/** A short fix for one problem: the importer's own "Use ..." advice when it gives one. */
function fixHint(d: DisplayIssue): string {
  if (d.issue.code === 'REQUIRED') return 'Fill in a value in every row.';
  const use = /(Use .*)$/.exec(d.issue.message);
  return use?.[1] ?? d.issue.message;
}

/** Problems grouped by column: "ship_date: 3 rows, lines 5, 10, 16", with one fix per column. */
function groupByColumn(issues: readonly DisplayIssue[]): Array<{ column: string; count: number; where: string; hint: string }> {
  const groups = new Map<string, DisplayIssue[]>();
  for (const d of issues) {
    const key = d.issue.column ?? 'File';
    groups.set(key, [...(groups.get(key) ?? []), d]);
  }
  return [...groups].map(([column, list]) => {
    const places = list.map((d) => d.where);
    const lines = places.every((p) => /^line \d+$/.test(p));
    const where = lines ? `${places.length === 1 ? 'line' : 'lines'} ${places.map((p) => p.slice(5)).join(', ')}` : places.join(', ');
    return { column, count: list.length, where, hint: fixHint(list[0] as DisplayIssue) };
  });
}

const REASON_LABEL: Record<string, string> = {
  'repeated-header': 'repeated header rows',
  total: 'total rows',
  footer: 'footer rows',
  user: 'rows you chose to leave out',
  blank: 'blank rows'
};

export interface ImportPreviewProps {
  preview: PreviewModel;
  /** An analysis is running or the import is being sent. */
  busy: boolean;
  uploading: boolean;
  /** The last analysis failed: what is shown is out of date and cannot be confirmed. */
  staleReason: string | null;
  /** Rows the app holds now for each dataset (for "replaces 480 current shipments"). */
  currentRows?: Partial<Record<ImportKind, number>>;
  onConfirm: () => void;
  onCancel: () => void;
}

function Cell({ raw, canonical }: { raw: string; canonical: string | undefined }) {
  const changed = canonical !== undefined && canonical !== raw;
  return (
    <>
      <span className="ingest-raw">{raw === '' ? '' : clip(raw, 40)}</span>
      {changed && (
        <span className="ingest-canon">
          <span className="visually-hidden">imported as </span>
          {canonical === '' ? '(blank)' : clip(canonical, 40)}
        </span>
      )}
    </>
  );
}

export function ImportPreview({ preview, busy, uploading, staleReason, currentRows = {}, onConfirm, onCancel }: ImportPreviewProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  usePanelFocus(headingRef);
  const reasonId = useId();
  const { counts, sample, validation, notImported, restatement, blockers } = preview;
  const reason = staleReason ?? preview.confirmBlockedReason;
  const canConfirm = preview.canConfirm && staleReason === null && !busy && !uploading;
  const imported = counts.rowsImported;
  const excluded = counts.excluded.filter((e) => e.count > 0);
  const kind = preview.dataset.kind;
  const current = kind === null ? undefined : currentRows[kind];
  const errors = validation.ran ? validation.totalErrors : null;
  // The one-line answer: how many rows, how many errors, and what the import replaces.
  const headline = [
    `${counts.rowsRead.toLocaleString('en-US')} rows`,
    errors === null ? null : `${errors.toLocaleString('en-US')} error${errors === 1 ? '' : 's'}`,
    kind === null || current === undefined ? null : `replaces ${countOf(kind, current).replace(/^([\d,]+) /, '$1 current ')}`
  ]
    .filter((part) => part !== null)
    .join(' · ');
  const rows = sample.rows.slice(0, PREVIEW_ROWS);
  const todo = validation.ran && !validation.ok ? blockers.filter((b) => b.code !== 'validation') : blockers;
  return (
    <section className="ingest-panel" data-ingest-panel="review" aria-labelledby="ingest-review-heading">
      <h3 id="ingest-review-heading" tabIndex={-1} ref={headingRef}>
        Review before importing
      </h3>
      <p className="ingest-headline">{headline}</p>
      <p className="ingest-summary" role="status">
        {counts.rowsRead.toLocaleString('en-US')} rows read
        {imported !== null ? `, ${imported.toLocaleString('en-US')} will be imported` : ''}
        {counts.rowsWithProblems > 0 ? `, ${counts.rowsWithProblems.toLocaleString('en-US')} with problems` : ''}. {counts.columnsMapped} of {counts.columnsTotal} columns mapped
        {counts.columnsConstant > 0 ? `, ${counts.columnsConstant} set to a constant` : ''}
        {counts.columnsIgnored > 0 ? `, ${counts.columnsIgnored} not imported` : ''}.
      </p>
      {excluded.length > 0 && (
        <p>
          Left out: {excluded.map((e) => `${e.count.toLocaleString('en-US')} ${REASON_LABEL[e.reason] ?? e.reason}`).join(', ')}.
        </p>
      )}
      {notImported.length > 0 && (
        <details className="ingest-details">
          <summary>Not imported ({notImported.length} column{notImported.length === 1 ? '' : 's'})</summary>
          <ul className="ingest-evidence">
            {notImported.map((n) => (
              <li key={n.index}>
                {n.header.trim() === '' ? '(blank)' : clip(n.header.trim(), 60)}: {clip(n.reason, 160)}
              </li>
            ))}
          </ul>
        </details>
      )}

      {rows.length > 0 && (
        <>
          <h4>First {rows.length} rows</h4>
          <div className="table-scroll">
            <table role="table" className="data-table ingest-table ingest-table--wide ingest-table--records">
              <caption className="visually-hidden">First rows as written in your file, and as they will be imported when different</caption>
              <thead role="rowgroup">
                <tr role="row">
                  <th role="columnheader" scope="col">Row</th>
                  {sample.columns.map((c) => (
                    <th key={c} role="columnheader" scope="col">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody role="rowgroup">
                {rows.map((r, i) => (
                  <tr key={i} role="row">
                    <td role="cell" data-label="Row">{clip(r.source, 40)}</td>
                    {sample.columns.map((c, j) => (
                      <td key={c} role="cell" data-label={c}>
                        <Cell raw={r.raw[j] ?? ''} canonical={r.canonical[j]} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {sample.problemRows.length > 0 && (
        <>
          <h4>Rows with problems</h4>
          {/* A list of records at every width: as a table, its many columns would only fit by breaking values mid-word. */}
          <ul className="ingest-records" aria-label="Rows with problems, with the problems found">
            {sample.problemRows.map((r, i) => (
              <li key={i} className="ingest-record">
                <dl className="ingest-record__fields">
                  <div>
                    <dt>Row</dt>
                    <dd>{clip(r.source, 40)}</dd>
                  </div>
                  {sample.columns.map((c, j) => (
                    <div key={c}>
                      <dt>{c}</dt>
                      <dd>
                        <Cell raw={r.raw[j] ?? ''} canonical={r.canonical.length === 0 ? undefined : r.canonical[j]} />
                      </dd>
                    </div>
                  ))}
                  <div className="ingest-record__problem">
                    <dt>Problem</dt>
                    <dd>
                      {r.issues.map((x, k) => (
                        <span key={k} className="ingest-problem">
                          {x.column === null ? '' : `${x.column}: `}
                          {clip(x.message, 240)}
                        </span>
                      ))}
                    </dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
        </>
      )}

      {validation.ran && validation.ok && <Banner tone="success" title={`All ${imported ?? 0} rows pass validation.`} />}
      {/* Warnings do not block the import: amber, apart from the green pass. */}
      {validation.ran && validation.ok && validation.warnings.length > 0 && (
        <Banner tone="warning" title={`${validation.warnings.length} warning${validation.warnings.length === 1 ? '' : 's'} (the import is still allowed)`}>
          <ul>
            {validation.warnings.map((w, i) => (
              <li key={i}>{clip(w, 240)}</li>
            ))}
          </ul>
        </Banner>
      )}
      {validation.ran && !validation.ok && (
        <Banner tone="critical" title={`${validation.totalErrors} problem${validation.totalErrors === 1 ? '' : 's'} found in the data. Nothing will be imported until the file is fixed.`}>
          {/* Grouped by column, with one fix each; every problem is listed below on demand. */}
          <ul className="ingest-error-groups">
            {groupByColumn(validation.issues).map((g) => (
              <li key={g.column}>
                <span className="ingest-error-groups__where">
                  <code>{clip(g.column, 60)}</code>: {g.count} row{g.count === 1 ? '' : 's'}, {clip(g.where, 200)}
                </span>
                <span className="ingest-error-groups__hint">{clip(g.hint, 200)}</span>
              </li>
            ))}
          </ul>
          {validation.totalErrors > validation.issues.length && <p>Showing first {validation.issues.length} of {validation.totalErrors} problems.</p>}
          <details className="ingest-details">
            <summary>Show every problem</summary>
            <div className="table-scroll">
              <table role="table" className="data-table ingest-table ingest-table--wide ingest-table--records">
                <caption className="visually-hidden">Validation problems</caption>
                <thead role="rowgroup">
                  <tr role="row">
                    <th role="columnheader" scope="col">Where</th>
                    <th role="columnheader" scope="col">Column</th>
                    <th role="columnheader" scope="col">Problem</th>
                  </tr>
                </thead>
                <tbody role="rowgroup">
                  {validation.issues.map((d, i) => (
                    <tr key={i} role="row">
                      <td role="cell" data-label="Where">{clip(d.where, 60)}</td>
                      <td role="cell" data-label="Column">{d.issue.column ?? '—'}</td>
                      <td role="cell" data-label="Problem" className="data-table__cell--wrap">{clip(d.message, 300)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </Banner>
      )}

      {/* The data problems are listed, grouped, in the red banner above; this list keeps the decisions still to make. */}
      {todo.length > 0 && (
        <div className="ingest-todo">
          <p className="ingest-todo__title">
            <Icon name="warning" size={14} /> Still to do before you can import:
          </p>
          <ul>
            {todo.map((b, i) => (
              <li key={i}>{clip(b.message, 300)}</li>
            ))}
          </ul>
        </div>
      )}

      {restatement !== null && <p className="ingest-restatement">{clip(restatement, 400)}</p>}

      <div className="ingest-actions">
        <button type="button" className="button button--primary" disabled={!canConfirm} aria-busy={uploading} aria-describedby={!canConfirm ? reasonId : undefined} onClick={onConfirm}>
          {/* Named after what it imports; while the data has errors (locked) it names the rows read. */}
          {uploading ? 'Importing…' : importLabel(kind, imported ?? (kind === null ? null : counts.rowsRead))}
        </button>
        <button type="button" className="button" disabled={uploading} onClick={onCancel}>
          Start over
        </button>
      </div>
      {!canConfirm && (
        <p id={reasonId} className="ingest-reason">
          {staleReason ?? (busy ? 'Updating the review…' : reason ?? '')}
        </p>
      )}
    </section>
  );
}
