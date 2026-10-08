// Value mappings: the distinct status and warehouse words of the file with their counts and proposed SCC values (an
// unresolved value is a choice with nothing preselected), the "recognized versus unmapped routes" summary, the fields the
// file does not have (unknown, or ONE constant for the whole file for the low-risk fields that allow it) and nothing
// else: no value is ever derived. All text is rendered as React text.

import { useEffect, useId, useRef, useState } from 'react';
import { SHIPMENT_STATUSES } from '../../../shared/types';
import { WAREHOUSE_CODES } from '../../../shared/reference/locations';
import { clip } from '../../../shared/ingest/messages';
import type { PreviewModel } from '../../../shared/ingest/preview/model';
import { usePanelFocus } from '../../ingest/useIngestFlow';
import { Badge } from '../ui/Badge';
import { Icon } from '../ui/Icon';

type Entries = NonNullable<PreviewModel['valueMaps']['status']>;

const UNKNOWN_CONSEQUENCE: Record<string, string> = {
  estimated_delivery: 'No estimated delivery column: on-time analytics will be limited.',
  actual_delivery: 'No actual delivery column: delivery dates stay unknown.',
  avg_daily_usage: 'No average daily usage column: it stays unknown, so days of cover are not calculated.',
  lead_time_days: 'No lead time column: the default of 14 days is used.'
};

export interface ValueMappingPanelProps {
  preview: PreviewModel;
  busy: boolean;
  onStatus: (source: string, target: string | undefined) => void;
  onWarehouse: (source: string, target: string | undefined) => void;
  onConstant: (field: string, value: string | undefined) => void;
}

/** Whether this panel has anything to show for the current preview. */
export function valueMappingHasContent(preview: PreviewModel): boolean {
  const v = preview.valueMaps;
  return (v.status !== null && v.status.length > 0) || (v.warehouse !== null && v.warehouse.length > 0) || v.locations !== null || preview.fields.some((f) => f.state === 'missing' && (f.options.length > 0 || f.constant !== null)) || preview.constants.length > 0;
}

interface ValueTableProps {
  caption: string;
  sourceHeading: string;
  targetHeading: string;
  entries: Entries;
  options: readonly string[];
  placeholder: string;
  busy: boolean;
  label: (source: string) => string;
  onChange: (source: string, target: string | undefined) => void;
}

function ValueTable({ caption, sourceHeading, targetHeading, entries, options, placeholder, busy, label, onChange }: ValueTableProps) {
  return (
    <div className="table-scroll">
      <table className="data-table ingest-table">
        <caption className="visually-hidden">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">{sourceHeading}</th>
            <th scope="col" className="data-table__header--right">Rows</th>
            <th scope="col">{targetHeading}</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.source}>
              <td className="ingest-table__name">{clip(e.source, 60)}</td>
              <td className="data-table__cell--right">{e.count.toLocaleString('en-US')}</td>
              <td>
                <select
                  className="select-field__control"
                  aria-label={label(e.source)}
                  value={e.target ?? ''}
                  disabled={busy}
                  onChange={(ev) => onChange(e.source, ev.target.value === '' ? undefined : ev.target.value)}
                >
                  {e.target === null && <option value="">{placeholder}</option>}
                  {options.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                {e.state === 'choose' ? (
                  <Badge tone="critical">
                    <Icon name="critical" size={12} /> Choose
                  </Badge>
                ) : (
                  <Badge tone={e.chosenByUser ? 'info' : 'good'}>
                    <Icon name="check" size={12} /> {e.chosenByUser ? 'Chosen by you' : 'Matched'}
                  </Badge>
                )}
                <span className="ingest-field__hint">{clip(e.evidence, 160)}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface ConstantRowProps {
  field: string;
  value: string | null;
  busy: boolean;
  onConstant: (field: string, value: string | undefined) => void;
}

function ConstantRow({ field, value, busy, onConstant }: ConstantRowProps) {
  const id = useId();
  const [draft, setDraft] = useState(value ?? '');
  // the row stays mounted when its constant changes (so focus stays put); the field shows the current value
  useEffect(() => setDraft(value ?? ''), [value]);
  const options: readonly string[] | null = field === 'status' ? SHIPMENT_STATUSES : field === 'warehouse' ? WAREHOUSE_CODES : null;
  return (
    <form
      className="ingest-field"
      onSubmit={(e) => {
        e.preventDefault();
        if (draft.trim() !== '') onConstant(field, draft.trim());
      }}
    >
      <label htmlFor={id} className="ingest-field__label">
        {field}: one value for the whole file
      </label>
      {options !== null ? (
        <select id={id} className="select-field__control" value={draft} disabled={busy} onChange={(e) => setDraft(e.target.value)}>
          <option value="">Choose…</option>
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : (
        <input id={id} className="ingest-input" type="text" value={draft} maxLength={80} disabled={busy} onChange={(e) => setDraft(e.target.value)} />
      )}
      <button type="submit" className="button ingest-small-button" disabled={busy || draft.trim() === ''}>
        Use for the whole file
      </button>
      {value !== null && (
        <>
          <Badge tone="info">Constant you entered</Badge>
          <button
            type="button"
            className="button ingest-small-button"
            disabled={busy}
            onClick={() => {
              setDraft('');
              onConstant(field, undefined);
              document.getElementById(id)?.focus();
            }}
          >
            Remove {field} constant
          </button>
        </>
      )}
    </form>
  );
}

export function ValueMappingPanel({ preview, busy, onStatus, onWarehouse, onConstant }: ValueMappingPanelProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  usePanelFocus(headingRef);
  const { status, warehouse, locations } = preview.valueMaps;
  const missing = preview.fields.filter((f) => f.state === 'missing' && (f.options.length > 0 || f.constant !== null));
  const constantFields = missing.filter((f) => f.options.includes('constant') || f.constant !== null);
  const unknownFields = missing.filter((f) => f.unknown && f.constant === null);
  return (
    <section className="ingest-panel" data-ingest-panel="values" aria-labelledby="ingest-values-heading">
      <h3 id="ingest-values-heading" tabIndex={-1} ref={headingRef}>
        Values and missing fields
      </h3>
      {status !== null && status.length > 0 && (
        <>
          <h4>Status values</h4>
          <p>Each different status word in the file is matched to one SCC status. Words that could mean more than one status need your choice.</p>
          <ValueTable caption="Status value mapping" sourceHeading="Value in your file" targetHeading="SCC status" entries={status} options={SHIPMENT_STATUSES} placeholder="Choose a status…" busy={busy} label={(s) => `SCC status for value "${clip(s, 40)}"`} onChange={onStatus} />
        </>
      )}
      {warehouse !== null && warehouse.length > 0 && (
        <>
          <h4>Warehouse values</h4>
          <p>
            SCC knows five warehouses ({WAREHOUSE_CODES.join(', ')}). A value that is not one of them can only be pointed at one of these by you; nothing is assumed.
          </p>
          <ValueTable caption="Warehouse value mapping" sourceHeading="Value in your file" targetHeading="SCC warehouse" entries={warehouse} options={WAREHOUSE_CODES} placeholder="Choose a warehouse…" busy={busy} label={(s) => `SCC warehouse for value "${clip(s, 40)}"`} onChange={onWarehouse} />
        </>
      )}
      {locations !== null && (
        <>
          <h4>Locations</h4>
          <p role="status">
            Locations recognized: {locations.recognizedRows.toLocaleString('en-US')} of {locations.totalRows.toLocaleString('en-US')} rows; {locations.unmappedRows.toLocaleString('en-US')} will appear as unmapped routes.
          </p>
          {locations.unmapped.length > 0 && (
            <>
              <p>These values are imported as written:</p>
              <ul className="ingest-evidence">
                {locations.unmapped.slice(0, 10).map((u) => (
                  <li key={u.value}>
                    {clip(u.value, 60)} ({u.count.toLocaleString('en-US')})
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
      {constantFields.length > 0 && (
        <>
          <h4>Fields this file does not have</h4>
          <p>For these low-risk fields you may enter one value for every row. Nothing is guessed or calculated.</p>
          {constantFields.map((f) => (
            <ConstantRow key={f.field} field={f.field} value={f.constant} busy={busy} onConstant={onConstant} />
          ))}
        </>
      )}
      {unknownFields.length > 0 && (
        <ul className="ingest-notices">
          {unknownFields.map((f) => (
            <li key={f.field}>
              <Icon name="info" size={14} /> {UNKNOWN_CONSEQUENCE[f.field] ?? `No ${f.field} column: it is imported as unknown.`}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
