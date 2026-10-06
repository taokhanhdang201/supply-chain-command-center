// Where the table starts and which rows are not data: the header row ("Header is on row N" can always be overridden),
// banner rows above it, and repeated headers, totals and footers, listed with their row so the user confirms each
// exclusion. Nothing is excluded without the user's confirmation, except blank rows (as before).

import { useId, useRef, useState } from 'react';
import { clip } from '../../../shared/ingest/messages';
import type { StructuralKind } from '../../../shared/ingest/structure/detectStructure';
import type { PreviewModel } from '../../../shared/ingest/preview/model';
import { usePanelFocus } from '../../ingest/useIngestFlow';
import { Badge } from '../ui/Badge';
import { Icon } from '../ui/Icon';
import { Why } from './EvidenceList';

const KIND_LABEL: Record<StructuralKind, string> = {
  'repeated-header': 'Repeated header',
  total: 'Total or subtotal',
  footer: 'Footer'
};

export interface StructurePanelProps {
  structure: NonNullable<PreviewModel['structure']>;
  needsConfirmation: boolean;
  busy: boolean;
  onHeaderRow: (rowIndex: number) => void;
  onExclude: (rowIndex: number, excluded: boolean) => void;
}

/** Whether the structure step has anything to say (otherwise the panel is not shown). */
export function structureHasContent(structure: NonNullable<PreviewModel['structure']>): boolean {
  return structure.banners > 0 || structure.structuralRows.length > 0 || structure.confidence !== 'detected';
}

export function StructurePanel({ structure, needsConfirmation, busy, onHeaderRow, onExclude }: StructurePanelProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  usePanelFocus(headingRef);
  const inputId = useId();
  const current = structure.banners + 1;
  const [draft, setDraft] = useState(String(current));
  const parsed = Number(draft);
  const valid = Number.isInteger(parsed) && parsed >= 1;
  return (
    <section className="ingest-panel" data-ingest-panel="structure" aria-labelledby="ingest-structure-heading">
      <h3 id="ingest-structure-heading" tabIndex={-1} ref={headingRef}>
        Structure of the table
      </h3>
      <p>
        Column names are on {structure.headerRow}.{' '}
        {structure.confidence === 'detected' ? (
          <Badge tone="good">
            <Icon name="check" size={12} /> Detected
          </Badge>
        ) : (
          <Badge tone={structure.confidence === 'check' ? 'warning' : 'critical'}>
            <Icon name="warning" size={12} /> {structure.confidence === 'check' ? 'Check this' : 'Choose'}
          </Badge>
        )}
      </p>
      {structure.banners > 0 && (
        <p>
          {structure.banners} row{structure.banners === 1 ? '' : 's'} above the column names {structure.banners === 1 ? 'is' : 'are'} not imported (titles or notes).
        </p>
      )}
      <Why label="header row" items={structure.evidence} />
      <form
        className="ingest-field"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onHeaderRow(parsed - 1);
        }}
      >
        <label htmlFor={inputId} className="ingest-field__label">
          Header is on row
        </label>
        <input id={inputId} className="ingest-input" type="number" min={1} step={1} inputMode="numeric" value={draft} disabled={busy} onChange={(e) => setDraft(e.target.value)} />
        <button type="submit" className="button ingest-small-button" disabled={busy || !valid}>
          Use this row
        </button>
        {needsConfirmation && (
          <button type="button" className="button ingest-small-button" disabled={busy} onClick={() => {
              onHeaderRow(structure.banners);
              document.getElementById(inputId)?.focus();
            }}>
            Confirm header row {current}
          </button>
        )}
      </form>
      {structure.structuralRows.length > 0 && (
        <>
          <p>These rows look like totals, repeated headers or footers. Tick the ones to leave out of the import.</p>
          <div className="table-scroll">
            <table className="data-table ingest-table">
              <caption className="visually-hidden">Rows that may not be data</caption>
              <thead>
                <tr>
                  <th scope="col">Row</th>
                  <th scope="col">Looks like</th>
                  <th scope="col">Starts with</th>
                  <th scope="col">Leave out</th>
                </tr>
              </thead>
              <tbody>
                {structure.structuralRows.map((r) => (
                  <tr key={r.rowIndex}>
                    <td>{clip(r.where, 40)}</td>
                    <td>{KIND_LABEL[r.kind]}</td>
                    <td className="data-table__cell--wrap">{r.label === '' ? '(blank)' : clip(r.label, 60)}</td>
                    <td>
                      <label className="ingest-check">
                        <input type="checkbox" checked={r.excluded} disabled={busy} onChange={(e) => onExclude(r.rowIndex, e.target.checked)} />
                        <span className="visually-hidden">Leave out {KIND_LABEL[r.kind].toLowerCase()} at {clip(r.where, 40)}</span>
                        <span aria-hidden="true">Leave out</span>
                      </label>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
