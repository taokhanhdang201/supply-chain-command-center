// "Import any file": the single way in. A chosen, dropped or sample file (or pasted text) is read in the browser by the
// ingestion pipeline at once; the user resolves any open question (Columns), checks the preview and imports; only then is
// the canonical CSV sent through the unchanged upload. Steps show as Choose file, Columns, Preview, Import. File-derived
// text is always rendered as text. Every panel opens with focus on its heading; Start over returns focus to the file
// picker; after the import focus is on the result banner.

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import type { ImportKind } from '../../../shared/types';
import { createDefaultRegistry } from '../../../shared/ingest/adapters';
import { acceptAttribute, clip, supportedFormatsText } from '../../../shared/ingest/messages';
import { fieldsOf } from '../../../shared/ingest/canonical/schemaRegistry';
import type { PipelineStage } from '../../../shared/ingest/pipeline';
import type { BlockerCode, PreviewModel } from '../../../shared/ingest/preview/model';
import { useIngestFlow, usePanelFocus, type IngestFlow, type UseIngestFlowOptions } from '../../ingest/useIngestFlow';
import { useSnapshot } from '../../state/DataContext';
import { buildHash } from '../../router';
import { buildSampleFile, SAMPLE_OPTIONS, type SampleId } from '../../import/sampleFiles';
import { Banner } from '../ui/Banner';
import { Card } from '../ui/Card';
import { Icon } from '../ui/Icon';
import { ImportIssueTable } from './ImportIssueTable';
import { FormatPanel } from './FormatPanel';
import { ImportPreview } from './ImportPreview';
import { PasteBox } from './PasteBox';
import { StructurePanel, structureHasContent } from './StructurePanel';
import { DatasetChoice, TablePicker } from './TablePicker';
import { ValueMappingPanel, valueMappingHasContent } from './ValueMappingPanel';
import { MappingTable } from './EvidenceList';

/** A file handed over from one of the per-kind cards ("Review as a different format"), with the dataset it was chosen for. */
export interface IncomingFile {
  file: File;
  kind: ImportKind;
  /** Changes on every hand-over so the same file can be handed over twice. */
  nonce: number;
}

export interface UniversalImportCardProps extends UseIngestFlowOptions {
  incoming?: IncomingFile | null;
}

const STAGE_TEXT: Record<PipelineStage, string> = {
  detect: 'Identifying the file type',
  probe: 'Checking the format',
  read: 'Reading the data',
  structure: 'Finding the header row',
  map: 'Matching columns',
  normalize: 'Checking numbers and dates',
  validate: 'Validating every row'
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function MappingSection({ preview, flow }: { preview: PreviewModel; flow: IngestFlow }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  usePanelFocus(headingRef);
  const kind = preview.dataset.kind;
  const fields = useMemo(() => (kind === null ? [] : fieldsOf(kind).map((f) => ({ name: f.name, required: f.spec.requiredColumn }))), [kind]);
  return (
    <section className="ingest-panel" data-ingest-panel="mapping" aria-labelledby="ingest-mapping-heading">
      <h3 id="ingest-mapping-heading" tabIndex={-1} ref={headingRef}>
        Match columns to SCC fields
      </h3>
      <DatasetChoice preview={preview} busy={flow.busy} onSelect={(k) => flow.setKind(k)} />
      {kind !== null && (
        <>
          <p>
            Each column is matched to an SCC field with the reason shown under Why. Columns marked Check this need your confirmation; columns marked Choose a field need your decision. Nothing is guessed silently.
          </p>
          <MappingTable columns={preview.columns} fields={fields} busy={flow.busy} onAssign={(i, field) => flow.assign(i, field)} onAcknowledge={(i) => flow.acknowledgeColumn(i)} />
        </>
      )}
    </section>
  );
}

/** Every question the Columns step answers (format, table, header row, dataset, columns, values); validation is the Preview's. */
const COLUMN_BLOCKERS: ReadonlySet<BlockerCode> = new Set<BlockerCode>([
  'choose-choice',
  'confirm-choice',
  'choose-table',
  'confirm-header',
  'choose-dataset',
  'choose-column',
  'check-column',
  'duplicate-field',
  'missing-required',
  'missing-constant',
  'choose-number-format',
  'choose-date-format',
  'currency',
  'choose-status',
  'choose-warehouse'
]);

const STEPS = ['Choose file', 'Columns', 'Preview', 'Import'] as const;

/** The universal import card. */
export function UniversalImportCard({ incoming = null, runner }: UniversalImportCardProps) {
  const flow = useIngestFlow({ runner });
  const snapshot = useSnapshot();
  const registry = useMemo(() => createDefaultRegistry(), []);
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const bannerRef = useRef<HTMLDivElement>(null);
  const sampleMenuRef = useRef<HTMLDetailsElement>(null);
  const [picked, setPicked] = useState<File | null>(null);
  const [importedKind, setImportedKind] = useState<ImportKind | null>(null);
  const lastNonce = useRef<number | null>(null);

  // Focus targets requested by the flow (Cancel -> file picker, import result -> banner).
  const { focus, clearFocus } = flow;
  useEffect(() => {
    if (focus === null) return;
    if (focus === 'picker') {
      if (inputRef.current !== null) {
        inputRef.current.value = '';
        inputRef.current.focus();
      }
      setPicked(null);
    } else if (focus === 'banner') {
      bannerRef.current?.focus();
    }
    clearFocus();
  }, [focus, clearFocus]);

  // A successful import clears the chosen file (the input is emptied so the same file can be chosen again).
  const resultTone = flow.result?.tone;
  useEffect(() => {
    if (resultTone === 'success') {
      setPicked(null);
      if (inputRef.current !== null) inputRef.current.value = '';
    }
  }, [resultTone]);

  // A file handed over from a per-kind card starts the review with that card's dataset already chosen.
  const { startFile } = flow;
  useEffect(() => {
    if (incoming === null || lastNonce.current === incoming.nonce) return;
    lastNonce.current = incoming.nonce;
    setPicked(incoming.file);
    startFile(incoming.file, incoming.kind);
  }, [incoming, startFile]);

  /** A chosen or dropped file starts the review at once (no separate "Review" press). */
  function start(file: File | null): void {
    setPicked(file);
    flow.reset();
    if (file !== null) flow.startFile(file);
  }

  function handleDrop(e: DragEvent<HTMLLabelElement>): void {
    e.preventDefault();
    start(e.dataTransfer.files.item(0));
  }

  /** "Try a sample": a file built in the browser enters the same flow as a chosen file. */
  function trySample(id: SampleId): void {
    if (sampleMenuRef.current !== null) sampleMenuRef.current.open = false;
    start(buildSampleFile(id, snapshot.today));
  }

  const { analysis, error, busy, phase, progress, source } = flow;
  const preview = analysis?.preview ?? null;
  const statusText = busy ? `${progress !== null ? STAGE_TEXT[progress.stage] : 'Reading the file'}${progress !== null ? ` (${Math.round(progress.fraction * 100)}%)` : ''}…` : '';
  const visibleTables = preview === null ? 0 : preview.tables.filter((t) => !t.hidden).length;
  const currentRows: Partial<Record<ImportKind, number>> = { inventory: snapshot.dataSources.inventory.rowCount, shipments: snapshot.dataSources.shipments.rowCount };

  // The step being worked on: questions about the file and its columns come first, then the preview, then the import.
  const columnsOpen = preview !== null && (preview.structure === null || preview.blockers.some((b) => COLUMN_BLOCKERS.has(b.code)));
  const step = flow.result?.tone === 'success' || phase === 'uploading' ? 3 : preview === null ? 0 : columnsOpen ? 1 : 2;

  // Once a file has had questions, its column panels stay open (answering the last one must not hide the control the user
  // is on); a file with nothing to decide shows one line, "All N columns matched", with the panels one click away.
  const sourceKey = source === null ? null : `${source.origin}|${source.name}|${source.size}`;
  const [questionsFor, setQuestionsFor] = useState<string | null>(null);
  useEffect(() => {
    if (columnsOpen && sourceKey !== null) setQuestionsFor(sourceKey);
  }, [columnsOpen, sourceKey]);
  const columnsExpanded = columnsOpen || (sourceKey !== null && questionsFor === sourceKey);

  const columnPanels =
    preview === null ? null : (
      <>
        <FormatPanel preview={preview} busy={busy} onOption={flow.setOption} onAcknowledgeChoice={flow.acknowledgeChoice} onNumberPreset={(p) => flow.setNumberPreset(p)} onDatePreset={(p) => flow.setDatePreset(p)} />
        {visibleTables > 1 && <TablePicker preview={preview} busy={busy} onSelect={flow.setTable} />}
        {preview.structure !== null && structureHasContent(preview.structure) && (
          <StructurePanel
            key={preview.structure.banners}
            structure={preview.structure}
            needsConfirmation={preview.blockers.some((b) => b.code === 'confirm-header')}
            busy={busy}
            onHeaderRow={flow.setHeaderRow}
            onExclude={flow.setExcluded}
          />
        )}
        {preview.structure !== null && <MappingSection preview={preview} flow={flow} />}
        {preview.structure !== null && valueMappingHasContent(preview) && (
          <ValueMappingPanel preview={preview} busy={busy} onStatus={flow.setStatus} onWarehouse={flow.setWarehouse} onConstant={flow.setConstant} />
        )}
      </>
    );
  const { columnsMapped = 0, columnsIgnored = 0 } = preview?.counts ?? {};

  return (
    <Card title="Import any file" className="sheet ingest-card">
      <ol className="import-steps" aria-label="Import steps">
        {STEPS.map((name, i) => (
          <li key={name} className={`import-steps__step${i < step ? ' is-done' : ''}${i === step ? ' is-current' : ''}`} aria-current={i === step ? 'step' : undefined}>
            {name}
          </li>
        ))}
      </ol>

      <p className="ingest-intro">
        SCC reads the file in your browser, matches its columns and shows the result before anything is imported. {supportedFormatsText(registry)}
      </p>

      {/* On a phone the drop area is a plain button: "Choose CSV file". */}
      <label className="dropzone" htmlFor={inputId} onDragOver={(e) => e.preventDefault()} onDrop={handleDrop}>
        <input id={inputId} ref={inputRef} type="file" accept={acceptAttribute(registry)} className="visually-hidden" onChange={(e) => start(e.target.files?.item(0) ?? null)} />
        <Icon name="upload" size={20} />
        <span className="dropzone__wide">Drop a CSV here or choose a file</span>
        <span className="dropzone__narrow">Choose CSV file</span>
      </label>

      <div className="ingest-links">
        <details className="ingest-menu" ref={sampleMenuRef}>
          <summary>Try a sample</summary>
          <ul className="ingest-menu__list">
            {SAMPLE_OPTIONS.map((o) => (
              <li key={o.id}>
                <button type="button" className="ingest-menu__option" disabled={phase === 'uploading'} onClick={() => trySample(o.id)}>
                  <span className="ingest-menu__label">{o.label}</span>
                  <span className="ingest-menu__note">{o.note}</span>
                </button>
              </li>
            ))}
          </ul>
        </details>
        <details className="ingest-menu">
          <summary>Download templates</summary>
          <ul className="ingest-menu__list">
            <li>
              <a className="ingest-menu__option" href="/templates/inventory-template.csv" download>
                <span className="ingest-menu__label">Inventory template</span>
              </a>
            </li>
            <li>
              <a className="ingest-menu__option" href="/templates/shipments-template.csv" download>
                <span className="ingest-menu__label">Shipments template</span>
              </a>
            </li>
          </ul>
        </details>
        <PasteBox busy={busy || phase === 'uploading'} onSubmit={(text) => flow.startPaste(text)} />
      </div>

      {/* The review region: everything below is derived from the file and is busy while the file is read. */}
      <div aria-busy={busy} data-ingest-card="">
        {picked !== null && (
          <p className="dropzone__file">
            {clip(picked.name, 80)} ({formatFileSize(picked.size)})
          </p>
        )}

        {source !== null && (preview === null || preview.structure === null) && (
          <div className="ingest-actions">
            <button type="button" className="button" disabled={phase === 'uploading'} onClick={() => flow.cancel()}>
              Start over
            </button>
          </div>
        )}

        <p className="ingest-status" aria-live="polite" aria-atomic="true">
          {statusText}
        </p>

        {flow.result !== null && (
          <div ref={bannerRef} tabIndex={-1}>
            <Banner tone={flow.result.tone} title={flow.result.title}>
              {flow.result.warnings !== undefined && flow.result.warnings.length > 0 && (
                <ul>
                  {flow.result.warnings.map((w) => (
                    <li key={w}>{clip(w, 240)}</li>
                  ))}
                </ul>
              )}
              {flow.result.issues !== undefined && <ImportIssueTable issues={flow.result.issues} totalErrors={flow.result.totalErrors} caption="Import errors" />}
              {flow.result.tone === 'success' && (
                <p className="ingest-next">
                  {importedKind === 'shipments' && <a href={buildHash('shipments')}>View shipments</a>}
                  {importedKind === 'inventory' && <a href={buildHash('inventory')}>View inventory</a>}
                  <a href={buildHash('dashboard')}>Back to dashboard</a>
                  <button type="button" className="button" onClick={() => flow.cancel()}>
                    Start over
                  </button>
                </p>
              )}
            </Banner>
          </div>
        )}

        {error !== null && <Banner tone="critical" title={error.message} />}

        {preview !== null && (
          <div className="ingest-stack">
            {/* The panels keep one place in the tree (never re-mounted), so focus stays where the user works. */}
            <div className={`ingest-columns${columnsExpanded ? ' is-expanded' : ''}`}>
              {!columnsExpanded && (
                <p className="ingest-columns-ok__line">
                  <Icon name="check" size={14} /> {`All ${columnsMapped} columns matched${columnsIgnored > 0 ? `, ${columnsIgnored} not imported` : ''}.`}
                </p>
              )}
              <details className="ingest-details ingest-columns__details" open={columnsExpanded ? true : undefined}>
                <summary>Show how the file was read</summary>
                {columnPanels}
              </details>
            </div>
            {preview.structure !== null && (
              <ImportPreview
                preview={preview}
                busy={busy}
                uploading={phase === 'uploading'}
                staleReason={error !== null ? 'The last change could not be applied, so the review above is out of date. Undo that change or choose another file.' : null}
                currentRows={currentRows}
                onConfirm={() => {
                  setImportedKind(preview.dataset.kind);
                  void flow.confirm();
                }}
                onCancel={() => flow.cancel()}
              />
            )}
          </div>
        )}
        {preview === null && source !== null && phase === 'review' && error !== null && (
          <p className="ingest-reason">Choose another file or paste other data to try again.</p>
        )}
      </div>
    </Card>
  );
}
