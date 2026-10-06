// "Detected format": what the file is (with evidence), and every format-specific setting that is guessed or ambiguous:
// the adapter's own choices (encoding, separator, ...) and the number and date formats of the values. A guess is shown
// as "Needs confirmation" with the decoded sample; an ambiguity is a choice with nothing preselected. All text is
// rendered as React text.

import { useId, useRef } from 'react';
import type { AdapterChoice } from '../../../shared/ingest/types';
import { clip } from '../../../shared/ingest/messages';
import type { PreviewModel, PresetView } from '../../../shared/ingest/preview/model';
import { DATE_PRESETS, DATE_PRESET_EXAMPLE, type DatePreset } from '../../../shared/ingest/normalize/dates';
import { NUMBER_PRESETS, NUMBER_PRESET_LABEL, type NumberPreset } from '../../../shared/ingest/normalize/numbers';
import { usePanelFocus } from '../../ingest/useIngestFlow';
import { Badge } from '../ui/Badge';
import { Banner } from '../ui/Banner';
import { Icon } from '../ui/Icon';
import { EvidenceList, Why } from './EvidenceList';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export interface FormatPanelProps {
  preview: PreviewModel;
  busy: boolean;
  onOption: (key: string, value: string) => void;
  onAcknowledgeChoice: (key: string) => void;
  onNumberPreset: (preset: NumberPreset) => void;
  onDatePreset: (preset: DatePreset) => void;
}

interface ChoiceRowProps {
  choice: AdapterChoice;
  confirmed: boolean;
  busy: boolean;
  onOption: (key: string, value: string) => void;
  onAcknowledge: (key: string) => void;
}

function ChoiceRow({ choice, confirmed, busy, onOption, onAcknowledge }: ChoiceRowProps) {
  const id = useId();
  const sampleId = useId();
  const needs = choice.status === 'needs-confirmation' && !confirmed;
  const open = choice.status === 'choose' && choice.value === null;
  return (
    <div className="ingest-field">
      <label htmlFor={id} className="ingest-field__label">
        {choice.label}
      </label>
      <select
        id={id}
        className="select-field__control"
        value={choice.value ?? ''}
        disabled={busy}
        aria-describedby={choice.sample !== undefined && choice.sample.length > 0 ? sampleId : undefined}
        onChange={(e) => {
          if (e.target.value !== '') onOption(choice.key, e.target.value);
        }}
      >
        {open && <option value="">Choose…</option>}
        {choice.options.map((o) => (
          <option key={o.value} value={o.value}>
            {clip(o.label, 60)}
          </option>
        ))}
      </select>
      {open ? (
        <Badge tone="critical">
          <Icon name="critical" size={12} /> Choose
        </Badge>
      ) : needs ? (
        <Badge tone="warning">
          <Icon name="warning" size={12} /> Needs confirmation
        </Badge>
      ) : (
        <Badge tone="good">
          <Icon name="check" size={12} /> {choice.status === 'needs-confirmation' ? 'Confirmed' : 'Detected'}
        </Badge>
      )}
      {needs && (
        <button type="button" className="button ingest-small-button" disabled={busy} onClick={() => {
            // A guess the file cannot be read without (the encoding) is confirmed by choosing it; any other guess is acknowledged.
            if (choice.blocksRead === true && choice.value !== null) onOption(choice.key, choice.value);
            else onAcknowledge(choice.key);
            document.getElementById(id)?.focus();
          }}>
          Confirm {choice.label.toLowerCase()}
        </button>
      )}
      {choice.sample !== undefined && choice.sample.length > 0 && (
        <div id={sampleId} className="ingest-sample">
          <p className="ingest-sample__title">How the first lines read with this setting:</p>
          <ol className="ingest-sample__lines">
            {choice.sample.slice(0, 6).map((line, i) => (
              <li key={i}>{clip(line, 160)}</li>
            ))}
          </ol>
        </div>
      )}
      {choice.evidence.length > 0 && <Why label={choice.label} items={choice.evidence} />}
    </div>
  );
}

interface PresetControlProps<P extends string> {
  legend: string;
  view: PresetView<P>;
  all: readonly P[];
  describe: (p: P) => string;
  busy: boolean;
  onChange: (p: P) => void;
}

function PresetControl<P extends string>({ legend, view, all, describe, busy, onChange }: PresetControlProps<P>) {
  const id = useId();
  if (view.kind === 'none') {
    return (
      <p className="ingest-field">
        <span className="ingest-field__label">{legend}</span> Nothing to convert.
      </p>
    );
  }
  if (view.kind === 'ambiguous' || view.kind === 'mixed') {
    const candidates = view.kind === 'ambiguous' ? view.candidates : view.groups.map((g) => g.preset);
    return (
      <fieldset className="ingest-choice" disabled={busy}>
        <legend>
          {legend}{' '}
          <Badge tone="critical">
            <Icon name="critical" size={12} /> Choose
          </Badge>
        </legend>
        <p>{view.note}</p>
        {candidates.map((p) => {
          const group = view.kind === 'mixed' ? view.groups.find((g) => g.preset === p) : undefined;
          return (
            <label key={p} className="ingest-radio">
              <input type="radio" name={`${id}-${legend}`} value={p} checked={false} onChange={() => onChange(p)} />
              <span>
                {describe(p)}
                {group !== undefined && group.examples.length > 0 && <span className="ingest-radio__hint"> for example {group.examples.slice(0, 3).map((x) => clip(x, 24)).join(', ')}</span>}
              </span>
            </label>
          );
        })}
      </fieldset>
    );
  }
  return (
    <div className="ingest-field">
      <label htmlFor={id} className="ingest-field__label">
        {legend}
      </label>
      <select id={id} className="select-field__control" value={view.preset} disabled={busy} onChange={(e) => onChange(e.target.value as P)}>
        {all.map((p) => (
          <option key={p} value={p}>
            {describe(p)}
          </option>
        ))}
      </select>
      <Badge tone={view.chosenByUser ? 'info' : 'good'}>
        <Icon name="check" size={12} /> {view.chosenByUser ? 'Chosen by you' : 'Detected'}
      </Badge>
      {view.kind === 'equivalent' && <span className="ingest-field__hint">{view.note}</span>}
    </div>
  );
}

/** The detected format, its evidence, the dialect choices and the number/date formats. */
export function FormatPanel({ preview, busy, onOption, onAcknowledgeChoice, onNumberPreset, onDatePreset }: FormatPanelProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  usePanelFocus(headingRef);
  const { file, choices, presets, blockers } = preview;
  const confirmed = (key: string): boolean => !blockers.some((b) => b.code === 'confirm-choice' && b.field === key);
  const notes: string[] = [];
  if (presets.timestampsStripped > 0) notes.push(`${presets.timestampsStripped} date-time value${presets.timestampsStripped === 1 ? '' : 's'} were cut to the date.`);
  if (presets.placeholders > 0) notes.push(`${presets.placeholders} placeholder value${presets.placeholders === 1 ? '' : 's'} (such as n/a) were read as blank.`);
  if (presets.markersStripped > 0) notes.push(`${presets.markersStripped} US dollar marker${presets.markersStripped === 1 ? '' : 's'} were removed from amounts.`);
  return (
    <section className="ingest-panel" data-ingest-panel="format" aria-labelledby="ingest-format-heading">
      <h3 id="ingest-format-heading" tabIndex={-1} ref={headingRef}>
        Detected format
      </h3>
      <p className="ingest-summary" role="status">
        {clip(file.family, 80)} · {formatSize(file.sizeBytes)} · {clip(file.name, 80)}
      </p>
      <Why label="detected format" items={file.evidence} />
      {file.notices.length > 0 && (
        <ul className="ingest-notices">
          {file.notices.map((n, i) => (
            <li key={i}>
              <Icon name="info" size={14} /> {clip(n, 240)}
            </li>
          ))}
        </ul>
      )}
      {choices.map((c) => (
        <ChoiceRow key={c.key} choice={c} confirmed={confirmed(c.key)} busy={busy} onOption={onOption} onAcknowledge={onAcknowledgeChoice} />
      ))}
      {presets.number !== null && <PresetControl legend="Number format" view={presets.number} all={NUMBER_PRESETS} describe={(p) => NUMBER_PRESET_LABEL[p]} busy={busy} onChange={onNumberPreset} />}
      {presets.date !== null && <PresetControl legend="Date format" view={presets.date} all={DATE_PRESETS} describe={(p) => DATE_PRESET_EXAMPLE[p]} busy={busy} onChange={onDatePreset} />}
      {notes.length > 0 && <EvidenceList items={notes} className="ingest-notices" />}
      {presets.currency.kind !== 'ok' && presets.currency.message !== null && <Banner tone="critical" title={presets.currency.message} />}
    </section>
  );
}
