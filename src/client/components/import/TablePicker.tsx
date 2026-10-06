// Two radio groups (fieldset/legend, operable by keyboard): which table of the file to import, and whether the table is
// inventory or shipments data. Nothing is preselected while the choice is genuinely open; a detected dataset is
// preselected and can be overridden at any time.

import { useId, useRef } from 'react';
import type { ImportKind } from '../../../shared/types';
import { clip } from '../../../shared/ingest/messages';
import { DATASET_LABEL, type PreviewModel } from '../../../shared/ingest/preview/model';
import { usePanelFocus } from '../../ingest/useIngestFlow';
import { Badge } from '../ui/Badge';
import { Icon } from '../ui/Icon';

export interface TablePickerProps {
  preview: PreviewModel;
  busy: boolean;
  onSelect: (index: number) => void;
}

/** The sheet/table choice. Rendered only when the file has more than one visible table. */
export function TablePicker({ preview, busy, onSelect }: TablePickerProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  usePanelFocus(headingRef);
  const name = useId();
  const open = preview.blockers.some((b) => b.code === 'choose-table');
  const indexed = preview.tables.map((t, index) => ({ t, index }));
  const visible = indexed.filter((x) => !x.t.hidden);
  const hidden = indexed.filter((x) => x.t.hidden);
  const radio = ({ t, index }: { t: PreviewModel['tables'][number]; index: number }) => (
    <label key={index} className="ingest-radio">
      <input type="radio" name={name} value={String(index)} checked={!open && t.selected} disabled={busy} onChange={() => onSelect(index)} />
      <span>
        {t.name === '' ? '(unnamed table)' : clip(t.name, 60)}
        <span className="ingest-radio__hint"> {t.rows === null ? 'rows not counted' : `${t.rows.toLocaleString('en-US')} rows`}</span>
      </span>
    </label>
  );
  return (
    <section className="ingest-panel" data-ingest-panel="tables" aria-labelledby="ingest-tables-heading">
      <h3 id="ingest-tables-heading" tabIndex={-1} ref={headingRef}>
        Tables in this file
      </h3>
      <fieldset className="ingest-choice" disabled={busy}>
        <legend>
          Choose the table to import{' '}
          {open && (
            <Badge tone="critical">
              <Icon name="critical" size={12} /> Choose
            </Badge>
          )}
        </legend>
        {visible.map(radio)}
        {hidden.length > 0 && (
          <details className="ingest-details">
            <summary>Hidden tables ({hidden.length})</summary>
            {hidden.map(radio)}
          </details>
        )}
      </fieldset>
    </section>
  );
}

export interface DatasetChoiceProps {
  preview: PreviewModel;
  busy: boolean;
  onSelect: (kind: ImportKind) => void;
}

const KINDS: readonly ImportKind[] = ['inventory', 'shipments'];

/** Inventory or shipments: preselected only when the headers and values agree on one; always overridable. */
export function DatasetChoice({ preview, busy, onSelect }: DatasetChoiceProps) {
  const name = useId();
  const { kind, chosenByUser, scores } = preview.dataset;
  return (
    <fieldset className="ingest-choice" data-ingest-panel="dataset" disabled={busy}>
      <legend>
        What does this file contain?{' '}
        {kind === null ? (
          <Badge tone="critical">
            <Icon name="critical" size={12} /> Choose
          </Badge>
        ) : (
          <Badge tone={chosenByUser ? 'info' : 'good'}>
            <Icon name="check" size={12} /> {chosenByUser ? 'Chosen by you' : 'Detected'}
          </Badge>
        )}
      </legend>
      {kind === null && <p>The column names do not say clearly whether this is inventory or shipments data. Choose one.</p>}
      {KINDS.map((k) => {
        const score = scores.find((s) => s.kind === k)?.score;
        return (
          <label key={k} className="ingest-radio">
            <input type="radio" name={name} value={k} checked={kind === k} onChange={() => onSelect(k)} />
            <span>
              {DATASET_LABEL[k]}
              {score !== undefined && <span className="ingest-radio__hint"> required columns found: {Math.round(score * 100)}%</span>}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}
