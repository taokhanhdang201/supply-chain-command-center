// Evidence for what the importer decided, and the column mapping table that carries it. Everything shown here comes
// from the preview model (file-derived text is carried as data) and is rendered as React text, truncated.

import { useId, useState } from 'react';
import { clip } from '../../../shared/ingest/messages';
import type { ColumnState } from '../../../shared/ingest/mapping/assign';
import type { PreviewColumn } from '../../../shared/ingest/preview/model';
import { Badge } from '../ui/Badge';
import { Icon } from '../ui/Icon';

const IGNORE_VALUE = '__ignore__';

export interface EvidenceListProps {
  items: readonly string[];
  /** The id the expander button points to with aria-controls. */
  id?: string;
  className?: string;
}

/** The lines of evidence behind one decision. Nothing is hidden: an empty list says so. */
export function EvidenceList({ items, id, className }: EvidenceListProps) {
  if (items.length === 0) {
    return (
      <p id={id} className={className ?? 'ingest-evidence'}>
        No further evidence.
      </p>
    );
  }
  return (
    <ul id={id} className={className ?? 'ingest-evidence'}>
      {items.map((line, i) => (
        <li key={i}>{clip(line, 240)}</li>
      ))}
    </ul>
  );
}

export interface WhyButtonProps {
  label: string;
  items: readonly string[];
}

/** A "Why?" expander: a button with aria-expanded and aria-controls that reveals the evidence. */
export function Why({ label, items }: WhyButtonProps) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <>
      <button type="button" className="ingest-why" aria-expanded={open} aria-controls={id} aria-label={`Why? ${label}`} onClick={() => setOpen((o) => !o)}>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={12} /> Why?
      </button>
      <div id={id} hidden={!open}>
        {open && <EvidenceList items={items} />}
      </div>
    </>
  );
}

function percent(value: number | null): string {
  return value === null ? '' : ` ${Math.round(value * 100)}%`;
}

export interface ConfidenceBadgeProps {
  state: ColumnState;
  confidence: number | null;
  chosenByUser: boolean;
  acknowledged: boolean;
}

/** Confidence by text AND icon, never by colour alone. */
export function ConfidenceBadge({ state, confidence, chosenByUser, acknowledged }: ConfidenceBadgeProps) {
  if (chosenByUser && state === 'ignored') return <Badge tone="neutral">Not imported</Badge>;
  if (chosenByUser) {
    return (
      <Badge tone="info">
        <Icon name="check" size={12} /> Chosen by you
      </Badge>
    );
  }
  if (state === 'matched') {
    return (
      <Badge tone="good">
        <Icon name="check" size={12} /> Matched{percent(confidence)}
      </Badge>
    );
  }
  if (state === 'check') {
    return acknowledged ? (
      <Badge tone="info">
        <Icon name="check" size={12} /> Checked{percent(confidence)}
      </Badge>
    ) : (
      <Badge tone="warning">
        <Icon name="warning" size={12} /> Check this{percent(confidence)}
      </Badge>
    );
  }
  if (state === 'choose') {
    return (
      <Badge tone="critical">
        <Icon name="critical" size={12} /> Choose a field
      </Badge>
    );
  }
  return <Badge tone="neutral">Not imported</Badge>;
}

export interface MappingTableProps {
  columns: readonly PreviewColumn[];
  fields: ReadonlyArray<{ name: string; required: boolean }>;
  busy: boolean;
  onAssign: (columnIndex: number, field: string | null) => void;
  onAcknowledge: (columnIndex: number) => void;
}

function displayHeader(header: string): string {
  return header.trim() === '' ? '(blank)' : clip(header.trim(), 60);
}

function selectValue(c: PreviewColumn): string {
  if (c.field !== null) return c.field;
  if (c.state === 'choose' && !c.chosenByUser) return '';
  return IGNORE_VALUE;
}

function evidenceFor(c: PreviewColumn, headerOf: (i: number) => string): string[] {
  const lines = [...c.evidence, ...c.warnings.map((w) => `Warning: ${w}`)];
  if (c.candidates.length > 0 && c.field === null) {
    lines.push(`Could match: ${c.candidates.map((x) => `${x.field}${x.confidence === null ? '' : ` (${Math.round(x.confidence * 100)}%)`}`).join(', ')}.`);
  }
  if (c.competingWith.length > 0) lines.push(`Competing with column ${c.competingWith.map((i) => `${i + 1} "${headerOf(i)}"`).join(', ')}: choose which one is this field.`);
  return lines.length === 0 ? ['No evidence was recorded for this column.'] : lines;
}

/** One row per file column: example, SCC field select, confidence badge, "Why?" and the per-row "Looks right" for CHECK. */
export function MappingTable({ columns, fields, busy, onAssign, onAcknowledge }: MappingTableProps) {
  const base = useId();
  const headerOf = (i: number): string => displayHeader(columns[i]?.header ?? '');
  return (
    <div className="table-scroll">
      <table className="data-table ingest-table">
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
          {columns.map((c) => {
            const name = displayHeader(c.header);
            const needsCheck = c.state === 'check' && !c.acknowledged && !c.chosenByUser;
            return (
              <tr key={c.index}>
                <td className="ingest-table__name">{name}</td>
                <td>{clip(c.example, 40)}</td>
                <td>
                  <select
                    id={`${base}-${c.index}`}
                    className="select-field__control"
                    aria-label={`SCC field for column ${c.index + 1}, ${name}`}
                    value={selectValue(c)}
                    disabled={busy}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === '') return;
                      onAssign(c.index, v === IGNORE_VALUE ? null : v);
                    }}
                  >
                    {selectValue(c) === '' && <option value="">Choose a field…</option>}
                    <option value={IGNORE_VALUE}>Do not import</option>
                    {fields.map((f) => (
                      <option key={f.name} value={f.name}>
                        {f.required ? `${f.name} (required)` : f.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <ConfidenceBadge state={c.state} confidence={c.confidence} chosenByUser={c.chosenByUser} acknowledged={c.acknowledged} />
                  {needsCheck && (
                    <button type="button" className="button ingest-small-button" disabled={busy} aria-label={`Looks right: column ${c.index + 1}, ${name} is ${c.field ?? ''}`} onClick={() => {
                        onAcknowledge(c.index);
                        // the button disappears once acknowledged: focus moves to the column's select, never to <body>
                        document.getElementById(`${base}-${c.index}`)?.focus();
                      }}>
                      Looks right
                    </button>
                  )}
                  <Why label={`column ${c.index + 1}, ${name}`} items={evidenceFor(c, headerOf)} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
