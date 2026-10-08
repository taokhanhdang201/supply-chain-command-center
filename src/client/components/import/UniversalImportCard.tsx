// The import card, as seven states with one sentence, one line, one main button and one small link each: waiting for a
// file, reading, ready ("480 shipments. Ready."), one question at a time (the answers are the buttons), has errors,
// cannot import, done (with Undo). Everything else (how the file was read, the panels to change any decision, the first
// rows, every problem) sits behind the state's small link, and the secondary tools sit under "More" at the bottom. A file
// dropped on the card at any time starts over with that file. File-derived text is always rendered as text.

import { useEffect, useId, useMemo, useRef } from 'react';
import type { DragEvent, ReactNode } from 'react';
import type { ImportKind } from '../../../shared/types';
import { createDefaultRegistry } from '../../../shared/ingest/adapters';
import { acceptAttribute, clip, supportedFormatsText } from '../../../shared/ingest/messages';
import { fieldsOf } from '../../../shared/ingest/canonical/schemaRegistry';
import type { PipelineStage } from '../../../shared/ingest/pipeline';
import type { PreviewModel } from '../../../shared/ingest/preview/model';
import { useIngestFlow, usePanelFocus, type IngestFlow, type UseIngestFlowOptions } from '../../ingest/useIngestFlow';
import { useSnapshot } from '../../state/DataContext';
import { buildHash } from '../../router';
import { buildSampleFile, MORE_SAMPLES, type SampleId } from '../../import/sampleFiles';
import { cannotLine, countOf, errorsText, FATAL_CODES, fixesOf, impactLine, problemsCsv, questionFor, waitingLine, type Answer, type Question } from '../../ingest/importStory';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
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
  /** More secondary tools for the "More" section (the page adds the column guide and Restore sample data). */
  more?: ReactNode;
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

/** The file input's name; the visible drop area says the same in two lines. */
const DROP_LABEL = 'Drop your file or choose a file';

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

/** The state the card shows, derived from the flow. */
type View =
  | { kind: 'waiting' }
  | { kind: 'reading' }
  | { kind: 'question'; question: Question; key: string }
  | { kind: 'errors' }
  | { kind: 'cannot'; message: string }
  | { kind: 'ready' }
  | { kind: 'done' }
  | { kind: 'undone' }
  | { kind: 'rejected' };

/** "This looks like a JSON file. SCC cannot import that type. ..." -> the first sentence, and the rest. */
function splitMessage(message: string): { sentence: string; rest: string } {
  const m = /^(.+?[.!?])\s+(.+)$/s.exec(message.trim());
  return m === null ? { sentence: message.trim(), rest: '' } : { sentence: m[1] as string, rest: m[2] as string };
}

function viewOf(flow: IngestFlow): View {
  const { phase, analysis, error, result, busy } = flow;
  const preview = analysis?.preview ?? null;
  if (result !== null && phase === 'idle') {
    if (result.undone === true) return { kind: 'undone' };
    if (result.imported !== undefined) return { kind: 'done' };
    return { kind: 'waiting' };
  }
  if (result !== null && result.tone === 'critical' && result.imported === undefined) return { kind: 'rejected' };
  if (error !== null) return { kind: 'cannot', message: error.message };
  if (preview === null) return phase === 'idle' ? { kind: 'waiting' } : { kind: 'reading' };
  if (busy && preview.structure === null) return { kind: 'reading' };
  const fatal = preview.blockers.find((b) => FATAL_CODES.has(b.code));
  if (fatal !== undefined) return { kind: 'cannot', message: fatal.message };
  const open = preview.blockers.find((b) => b.code !== 'validation');
  if (open !== undefined) return { kind: 'question', question: questionFor(preview, open), key: `${open.code}|${open.field ?? ''}|${open.columnIndex ?? ''}|${open.message}` };
  if (preview.blockers.some((b) => b.code === 'validation')) return { kind: 'errors' };
  return { kind: 'ready' };
}

/** Saves text as a file the user can open (nothing leaves the browser). A data URL, not an object URL: the ingestion
 *  code never creates object URLs (securityGuards), and the list of problems is small (MAX_ERRORS_RETURNED). */
function download(name: string, text: string): void {
  const a = document.createElement('a');
  a.href = `data:text/csv;charset=utf-8,${encodeURIComponent(text)}`;
  a.download = name;
  a.click();
}

/** The import card. */
export function UniversalImportCard({ incoming = null, runner, more }: UniversalImportCardProps) {
  const flow = useIngestFlow({ runner });
  const snapshot = useSnapshot();
  const registry = useMemo(() => createDefaultRegistry(), []);
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const moreRef = useRef<HTMLDetailsElement>(null);
  const lastNonce = useRef<number | null>(null);
  /** Set when a new file starts (also from More or a per-kind card): its first state takes the focus wherever it is. */
  const claimFocus = useRef(false);

  const { analysis, error, busy, phase, progress, source } = flow;
  const preview = analysis?.preview ?? null;
  const view = viewOf(flow);
  const viewKey = view.kind === 'question' ? `question|${view.key}` : view.kind;

  // Focus requested by the flow: Cancel -> the file input; an import or an undo -> the sentence that says what happened.
  const { focus, clearFocus } = flow;
  useEffect(() => {
    if (focus === null) return;
    if (focus === 'picker' && inputRef.current !== null) {
      inputRef.current.value = '';
      inputRef.current.focus();
    } else if (focus === 'banner') {
      headingRef.current?.focus();
    }
    clearFocus();
  }, [focus, clearFocus]);

  // A new state moves focus to its sentence, unless the user is working in the details or under More.
  const firstView = useRef(true);
  useEffect(() => {
    if (firstView.current) {
      firstView.current = false;
      return;
    }
    if (viewKey === 'waiting' || viewKey === 'done' || viewKey === 'undone') return; // the flow's own focus target handles these
    const active = document.activeElement;
    if (!claimFocus.current && active !== null && active.closest('.ingest-details, .ingest-more') !== null) return;
    claimFocus.current = false;
    headingRef.current?.focus();
  }, [viewKey]);

  // A successful import empties the input so the same file can be chosen again.
  const imported = flow.result?.imported !== undefined;
  useEffect(() => {
    if (imported && inputRef.current !== null) inputRef.current.value = '';
  }, [imported]);

  // A file handed over from a per-kind card starts with that card's dataset already chosen.
  const { startFile } = flow;
  useEffect(() => {
    if (incoming === null || lastNonce.current === incoming.nonce) return;
    lastNonce.current = incoming.nonce;
    claimFocus.current = true;
    if (moreRef.current !== null) moreRef.current.open = false;
    startFile(incoming.file, incoming.kind);
  }, [incoming, startFile]);

  function start(file: File | null): void {
    flow.reset();
    if (detailsRef.current !== null) detailsRef.current.open = false;
    if (file === null) return;
    claimFocus.current = true;
    flow.startFile(file);
  }

  function paste(text: string): void {
    claimFocus.current = true;
    if (moreRef.current !== null) moreRef.current.open = false;
    flow.startPaste(text);
  }

  function handleDrop(e: DragEvent<HTMLElement>): void {
    e.preventDefault();
    const file = e.dataTransfer.files.item(0);
    if (file !== null) start(file);
  }

  function trySample(id: SampleId): void {
    if (moreRef.current !== null) moreRef.current.open = false;
    start(buildSampleFile(id, snapshot.today));
  }

  function openDetails(): void {
    if (detailsRef.current === null) return;
    detailsRef.current.open = true;
    detailsRef.current.querySelector('summary')?.focus();
  }

  function answer(a: Answer): void {
    switch (a.kind) {
      case 'date':
        return flow.setDatePresetFor(a.field, a.preset);
      case 'number':
        return flow.setNumberPreset(a.preset);
      case 'status':
        return flow.setStatus(a.source, a.target);
      case 'warehouse':
        return flow.setWarehouse(a.source, a.target);
      case 'dataset':
        return flow.setKind(a.dataset);
      case 'acknowledge-column':
        return flow.acknowledgeColumn(a.index);
      case 'assign':
        return flow.assign(a.index, a.field);
      case 'option':
        return flow.setOption(a.key, a.value);
      case 'acknowledge-choice':
        return flow.acknowledgeChoice(a.key);
      case 'table':
        return flow.setTable(a.index);
    }
  }

  const fixes = useMemo(() => (preview === null ? [] : fixesOf(preview)), [preview]);
  const canonical = analysis?.canonical ?? null;
  const kind = analysis?.kind ?? null;
  const impact = useMemo(() => (view.kind !== 'ready' || kind === null || canonical === null ? '' : impactLine(kind, canonical.csv, snapshot)), [view.kind, kind, canonical, snapshot]);
  const visibleTables = preview === null ? 0 : preview.tables.filter((t) => !t.hidden).length;
  const currentRows: Partial<Record<ImportKind, number>> = { inventory: snapshot.dataSources.inventory.rowCount, shipments: snapshot.dataSources.shipments.rowCount };
  const stageLine = busy ? `${progress !== null ? STAGE_TEXT[progress.stage] : 'Reading the file'}${progress !== null ? ` (${Math.round(progress.fraction * 100)}%)` : ''}…` : '';
  const chooseAnother = (): void => inputRef.current?.click();

  // ---- the state: one sentence, one line, one main action; the small link is the details summary below ---------------------
  let sentence = '';
  let line: ReactNode = '';
  let actions: ReactNode = null;
  let detailsLabel = 'Show the details';
  const result = flow.result;
  switch (view.kind) {
    case 'waiting':
      break;
    case 'reading':
      sentence = `Reading ${source === null ? 'the file' : clip(source.name, 60)}`;
      actions = (
        <Button variant="link" className="ingest-link" onClick={() => flow.cancel()}>
          Cancel
        </Button>
      );
      break;
    case 'question':
      sentence = view.question.sentence;
      line = view.question.line;
      actions =
        view.question.answers.length === 0 ? (
          <button type="button" className="button button--primary" onClick={openDetails}>
            Open the details
          </button>
        ) : (
          // Every answer looks the same: SCC does not hint which one is right.
          <div className="ingest-answers" role="group" aria-label="Answers">
            {view.question.answers.map((a, i) => (
              <button key={`${i}|${a.label}`} type="button" className="button" disabled={busy} onClick={() => answer(a.answer)}>
                {a.label}
              </button>
            ))}
          </div>
        );
      break;
    case 'errors': {
      const text = errorsText(preview as PreviewModel);
      const rows = (preview as PreviewModel).counts.rowsWithProblems;
      sentence = text.sentence;
      line = text.line;
      actions = (
        <button type="button" className="button button--primary" disabled={busy} onClick={() => download('rows-to-fix.csv', problemsCsv(preview as PreviewModel))}>
          {`Download the ${rows === 1 ? 'row' : `${rows.toLocaleString('en-US')} rows`} to fix`}
        </button>
      );
      detailsLabel = 'See every problem';
      break;
    }
    case 'cannot': {
      const parts = splitMessage(view.message);
      sentence = parts.sentence;
      line = cannotLine(parts.rest);
      actions = (
        <button type="button" className="button button--primary" onClick={chooseAnother}>
          Choose another file
        </button>
      );
      detailsLabel = 'What SCC can read';
      break;
    }
    case 'ready':
      sentence = `${kind === null ? 'The data' : countOf(kind, canonical?.rowCount ?? 0)}. Ready.`;
      line = impact;
      actions = (
        <button type="button" className="button button--primary" disabled={busy || phase === 'uploading'} aria-busy={phase === 'uploading'} onClick={() => void flow.confirm()}>
          {phase === 'uploading' ? 'Importing…' : 'Use this data'}
        </button>
      );
      if (fixes.length > 0) detailsLabel = `What I fixed (${fixes.length})`;
      break;
    case 'done': {
      const failed = result?.tone === 'critical';
      sentence = failed ? splitMessage(result?.title ?? '').sentence : 'Done. Dashboard updated.';
      line = failed ? splitMessage(result?.title ?? '').rest : (result?.title ?? '');
      // The main action is to look at the result; Undo (or, once it cannot be undone, another file) is the small link.
      actions = (
        <>
          <a className="button button--primary" href={buildHash('dashboard')}>
            Open Dashboard
          </a>
          {result?.imported?.version !== undefined ? (
            <Button variant="link" className="ingest-link" busy={flow.undoing} onClick={() => void flow.undo()}>
              {flow.undoing ? 'Undoing…' : 'Undo'}
            </Button>
          ) : (
            <Button variant="link" className="ingest-link" onClick={chooseAnother}>
              Choose a file
            </Button>
          )}
        </>
      );
      break;
    }
    case 'undone':
      sentence = 'Undone. The data is back as it was.';
      line = result?.title ?? '';
      actions = (
        <>
          <button type="button" className="button button--primary" onClick={chooseAnother}>
            Choose a file
          </button>
          <a className="ingest-link" href={buildHash('dashboard')}>
            Open Dashboard
          </a>
        </>
      );
      break;
    case 'rejected': {
      const parts = splitMessage(result?.title ?? '');
      sentence = parts.sentence;
      line = parts.rest === '' ? 'Nothing was imported.' : parts.rest;
      actions = (
        <button type="button" className="button button--primary" onClick={chooseAnother}>
          Choose another file
        </button>
      );
      detailsLabel = 'See every problem';
      break;
    }
  }

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

  const critical = view.kind === 'cannot' || view.kind === 'rejected' || (view.kind === 'done' && result?.tone === 'critical');
  const showDetails = (source !== null || view.kind === 'rejected') && view.kind !== 'reading' && view.kind !== 'done' && view.kind !== 'undone';

  return (
    <Card title="Import any file" className="sheet ingest-card">
      <div className="ingest-body" aria-busy={busy} data-ingest-card="" onDragOver={(e) => e.preventDefault()} onDrop={handleDrop}>
        {/* The one file input: named, always present; outside "waiting" it is reached through the state's own buttons. */}
        <input
          id={inputId}
          ref={inputRef}
          type="file"
          aria-label={DROP_LABEL}
          accept={acceptAttribute(registry)}
          className="visually-hidden ingest-file"
          tabIndex={view.kind === 'waiting' ? 0 : -1}
          onChange={(e) => start(e.target.files?.item(0) ?? null)}
        />

        {view.kind === 'waiting' ? (
          <>
            <label className="dropzone ingest-drop" htmlFor={inputId}>
              <span className="ingest-state__main">Drop your file</span>
              <span className="ingest-state__line">{waitingLine(registry, snapshot.limits.maxUploadBytes)}</span>
              <span className="button button--primary" aria-hidden="true">
                Choose a file
              </span>
            </label>
            <p className="ingest-state__actions">
              <Button variant="link" className="ingest-link" onClick={() => trySample('carrier-export')}>
                No file? Try one.
              </Button>
            </p>
          </>
        ) : (
          // A file SCC cannot take is an alert (inserted fresh, so it is announced); the other states use the polite line.
          // Tone: red only for what stops the import, amber for a question, neutral otherwise.
          <section
            key={critical ? view.kind : 'state'}
            className={`ingest-state ingest-state--${view.kind}${critical || view.kind === 'errors' ? ' ingest-state--critical' : view.kind === 'question' ? ' ingest-state--warning' : ''}`}
            aria-labelledby="ingest-state-heading"
            role={critical ? 'alert' : undefined}
          >
            <h3 id="ingest-state-heading" className="ingest-state__main" tabIndex={-1} ref={headingRef}>
              {sentence}
            </h3>
            <p className="ingest-state__line" aria-live={critical ? undefined : 'polite'} aria-atomic={critical ? undefined : true}>
              {view.kind === 'reading' ? stageLine : line}
            </p>
            <div className="ingest-state__actions">{actions}</div>
          </section>
        )}

        {/* Progress for screen readers while a decision is re-checked (the state stays on screen, marked busy). */}
        <p className="ingest-status visually-hidden" aria-live="polite" aria-atomic="true">
          {view.kind === 'reading' ? '' : stageLine}
        </p>

        {showDetails && (
          <details className="ingest-details ingest-state__details" id="ingest-details" ref={detailsRef}>
            <summary>{detailsLabel}</summary>
            {fixes.length > 0 && (
              <ol className="ingest-fixes" aria-label="What SCC fixed on its own">
                {fixes.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ol>
            )}
            {view.kind === 'cannot' && <p className="ingest-reason">{supportedFormatsText(registry)}</p>}
            {result !== null && result.issues !== undefined && <ImportIssueTable issues={result.issues} totalErrors={result.totalErrors} caption="Import errors" />}
            {preview !== null && (
              <div className="ingest-stack">
                {columnPanels}
                {preview.structure !== null && (
                  <ImportPreview
                    preview={preview}
                    busy={busy}
                    uploading={phase === 'uploading'}
                    staleReason={error !== null ? 'The last change could not be applied, so the review above is out of date. Undo that change or choose another file.' : null}
                    currentRows={currentRows}
                    onConfirm={() => void flow.confirm()}
                    onCancel={() => flow.cancel()}
                  />
                )}
              </div>
            )}
            {(preview === null || preview.structure === null) && (
              <div className="ingest-actions">
                <button type="button" className="button" disabled={phase === 'uploading'} onClick={() => flow.cancel()}>
                  Start over
                </button>
              </div>
            )}
          </details>
        )}
      </div>

      <details className="ingest-more" ref={moreRef}>
        <summary>More</summary>
        <ul className="ingest-more__list">
          {MORE_SAMPLES.map((s) => (
            <li key={s.id}>
              <Button variant="link" className="ingest-link" disabled={phase === 'uploading'} onClick={() => trySample(s.id)}>
                {s.label}
              </Button>
            </li>
          ))}
          <li>
            <PasteBox label="Paste rows from a spreadsheet" busy={busy || phase === 'uploading'} onSubmit={paste} />
          </li>
          <li className="ingest-more__templates">
            Download a template:{' '}
            <a href="/templates/shipments-template.csv" download>
              Shipments
            </a>
            ,{' '}
            <a href="/templates/inventory-template.csv" download>
              Inventory
            </a>
          </li>
        </ul>
        {more}
      </details>
    </Card>
  );
}
