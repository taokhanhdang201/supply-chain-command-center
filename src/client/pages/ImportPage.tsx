// The Data Import page (plan §8.6): one import card in seven states (waiting, reading, ready, one question, errors, cannot
// import, done with Undo). Under the card's "More" (closed by default): the other samples, paste, templates, the "Column
// guide" whose tabs keep an upload card per dataset kind (column reference, template download, file picker, client-side
// pre-checks, server-validation error table; V1.5: a file whose headers are not already canonical goes through a
// column-mapping step before the upload), and a confirm-then-reset "Restore sample data" card. The per-kind cards keep
// their DOM and behaviour for every file V1 handles (legacy-first routing); files V1 cannot read are handed to the import
// card, and a rejected file offers "Review as a different format".

import { useEffect, useId, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import type { ImportIssue, ImportKind } from '../../shared/types';
import { INVENTORY_COLUMNS, SHIPMENT_COLUMNS, type ColumnSpec } from '../../shared/csv/schemas';
import { useData, useSnapshot } from '../state/DataContext';
import { ApiError } from '../api/apiClient';
import { Card } from '../components/ui/Card';
import { Icon } from '../components/ui/Icon';
import { PageStage } from '../components/layout/PageStage';
import { Banner, type BannerTone } from '../components/ui/Banner';
import { DataTable, type Column } from '../components/ui/DataTable';
import { ImportIssueTable } from '../components/import/ImportIssueTable';
import { ColumnMappingPanel } from '../components/import/ColumnMappingPanel';
import type { ColumnMap } from '../../shared/csv/importCommon';
import { analyzeImportFile, deterministicSuggester, type Assignment, type FileAnalysis } from '../../shared/mapping/columnMapping';
import { UniversalImportCard, type IncomingFile } from '../components/import/UniversalImportCard';
import { createDefaultRegistry } from '../../shared/ingest/adapters';
import { DELIMITED_ADAPTER_ID } from '../../shared/ingest/adapters/delimited/adapter';
import { detectFormat, makeHints } from '../../shared/ingest/detect/arbiter';
import { HEAD_BYTES } from '../../shared/ingest/detect/bytes';
import { unsupportedTypeMessage } from '../../shared/ingest/messages';
import { routeFile } from '../ingest/runner';

const GUIDE_TABS: ReadonlyArray<readonly [ImportKind, string]> = [
  ['inventory', 'Inventory'],
  ['shipments', 'Shipments']
];

interface MappingState {
  text: string;
  analysis: Extract<FileAnalysis, { mode: 'map' }>;
  assignments: Assignment[];
}

interface ImportBannerState {
  tone: BannerTone;
  title: string;
  warnings?: string[];
  issues?: ImportIssue[];
  totalErrors?: number;
  /** The file may be readable as another format: offer "Review as a different format". */
  canReview?: boolean;
}

// File type decisions come from the adapter registry; the file name is only a hint. A name ending in .csv keeps going
// through the V1 flow exactly as before (the server stays the authority for what is inside it).
const legacyRegistry = createDefaultRegistry();

type TypeCheck = { kind: 'ok' } | { kind: 'refused'; message: string } | { kind: 'review'; family: string };

async function readBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === 'function') return new Uint8Array(await blob.arrayBuffer());
  return new Promise<Uint8Array>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(new Error('read'));
    reader.readAsArrayBuffer(blob);
  });
}

async function checkFileType(file: File): Promise<TypeCheck> {
  if (/\.csv$/i.test(file.name)) return { kind: 'ok' };
  let head: Uint8Array;
  try {
    head = await readBytes(file.slice(0, HEAD_BYTES));
  } catch {
    return { kind: 'refused', message: unsupportedTypeMessage(legacyRegistry, null) };
  }
  const detection = detectFormat(head, makeHints(file.name, file.type), legacyRegistry, file.size);
  if (detection.outcome === 'chosen' && detection.chosen !== null) {
    return detection.chosen.adapterId === DELIMITED_ADAPTER_ID ? { kind: 'ok' } : { kind: 'review', family: detection.chosen.family };
  }
  return { kind: 'refused', message: detection.error?.message ?? unsupportedTypeMessage(legacyRegistry, null) };
}

/** True when V1 cannot read the file but the pipeline can (other separator or encoding): legacy-first routing hands it over. */
async function needsPipeline(file: File): Promise<boolean> {
  try {
    const bytes = await readBytes(file);
    const detection = detectFormat(bytes.subarray(0, HEAD_BYTES), makeHints(file.name, file.type), legacyRegistry, bytes.length);
    const readable = detection.outcome === 'chosen' && detection.chosen !== null && detection.chosen.adapterId === DELIMITED_ADAPTER_ID;
    return readable && routeFile(bytes, file.name, legacyRegistry).route === 'pipeline';
  } catch {
    return false;
  }
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatMegabytes(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

/** The column reference under each per-kind card. Below 1100px each column is a stacked record (labelled values). */
const REFERENCE_COLUMNS: Column<ColumnSpec>[] = [
  { key: 'column', header: 'Column', render: (c) => <span className="code-cell">{c.name}</span> },
  { key: 'required', header: 'Required', phoneLabel: 'Required', render: (c) => (c.requiredValue ? 'Yes' : 'No') },
  { key: 'format', header: 'Format', phoneLabel: 'Format', wrap: true, render: (c) => c.format },
  { key: 'example', header: 'Example', phoneLabel: 'Example', wrap: true, render: (c) => c.example }
];

interface ImportCardProps {
  kind: ImportKind;
  title: string;
  description: string;
  columns: readonly ColumnSpec[];
  templateHref: string;
  chooseLabel: string;
  /** Hands the chosen file to the universal card with this card's dataset already chosen. */
  onReview: (file: File, kind: ImportKind) => void;
}

/** One dataset's upload card: column reference, template link, drop zone, and result banner. */
function ImportCard({ kind, title, description, columns, templateHref, chooseLabel, onReview }: ImportCardProps) {
  const snapshot = useSnapshot();
  const { api, refresh } = useData();
  const inputId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [banner, setBanner] = useState<ImportBannerState | null>(null);
  const [mapping, setMapping] = useState<MappingState | null>(null);
  // When the mapping panel closes, the focused element inside it is unmounted, so focus is moved on purpose
  // (result banner after an import, file picker after Cancel) instead of falling back to <body>.
  const [focusAfter, setFocusAfter] = useState<'banner' | 'picker' | null>(null);
  const bannerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (focusAfter === null) return;
    const target = focusAfter === 'banner' ? bannerRef.current : inputRef.current;
    if (target !== null) {
      target.focus();
      setFocusAfter(null);
    }
  }, [focusAfter, banner, mapping]);

  function pickFile(next: File | null): void {
    setFile(next);
    setBanner(null);
    setMapping(null);
  }

  function reviewDifferently(chosen: File): void {
    onReview(chosen, kind);
    setFile(null);
    setBanner(null);
    setMapping(null);
    if (inputRef.current !== null) inputRef.current.value = '';
  }

  function handleDrop(e: DragEvent<HTMLLabelElement>): void {
    e.preventDefault();
    pickFile(e.dataTransfer.files.item(0));
  }

  async function handleImport(): Promise<void> {
    if (file === null) return;

    const typeCheck = await checkFileType(file);
    if (typeCheck.kind === 'refused') {
      setBanner({ tone: 'critical', title: typeCheck.message });
      return;
    }
    if (typeCheck.kind === 'review') {
      setBanner({ tone: 'critical', title: `This looks like a ${typeCheck.family}. It cannot be imported here, but you can review it as a different format.`, canReview: true });
      return;
    }
    if (file.size === 0) {
      setBanner({ tone: 'critical', title: 'The file is empty.' });
      return;
    }
    if (file.size > snapshot.limits.maxUploadBytes) {
      setBanner({
        tone: 'critical',
        title: `File is ${formatMegabytes(file.size)} MB; the limit is ${formatMegabytes(snapshot.limits.maxUploadBytes)} MB.`
      });
      return;
    }

    // Legacy-first routing: files V1 handles stay on this card; files only the pipeline can read go to the universal card.
    if (await needsPipeline(file)) {
      reviewDifferently(file);
      return;
    }

    setUploading(true);
    setBanner(null);
    // Decide whether the file needs the mapping step. Anything unanalyzable, or already canonical, uploads directly (V1).
    let analysis: FileAnalysis = { mode: 'direct' };
    let text = '';
    try {
      text = await file.text();
      analysis = analyzeImportFile(kind, text);
    } catch {
      analysis = { mode: 'direct' };
    }
    if (analysis.mode === 'map') {
      try {
        const suggestion = await deterministicSuggester.suggest(kind, analysis.headers);
        setMapping({ text, analysis, assignments: suggestion.columns.map((c) => c.assignment) });
      } finally {
        setUploading(false);
      }
      return;
    }
    await upload(undefined);
  }

  async function upload(columnMap: ColumnMap | undefined): Promise<void> {
    if (file === null) return;
    setUploading(true);
    setBanner(null);
    try {
      const result = columnMap === undefined ? await api.importCsv(kind, file) : await api.importCsv(kind, file, columnMap);
      setBanner({
        tone: 'success',
        title: `Imported ${result.rowCount} ${kind} rows from ${result.dataSource.label}. All views are updated.`,
        warnings: result.warnings
      });
      setFile(null);
      setMapping(null);
      if (columnMap !== undefined) setFocusAfter('banner');
      await refresh();
    } catch (err) {
      const apiErr = err as ApiError;
      setBanner({
        tone: 'critical',
        title: apiErr.message,
        issues: apiErr.issues.length > 0 ? apiErr.issues : undefined,
        totalErrors: apiErr.totalErrors,
        canReview: apiErr.status === 400 || apiErr.status === 422
      });
      if (columnMap !== undefined) setFocusAfter('banner');
    } finally {
      setUploading(false);
    }
  }

  function changeAssignment(index: number, assignment: Assignment): void {
    setMapping((current) => {
      if (current === null) return current;
      const assignments = current.assignments.slice();
      assignments[index] = assignment;
      return { ...current, assignments };
    });
  }

  function cancelMapping(): void {
    setMapping(null);
    setFile(null);
    setBanner(null);
    // Clear the input so the same file can be chosen again after Cancel (a same-value change would not fire).
    if (inputRef.current !== null) inputRef.current.value = '';
    setFocusAfter('picker');
  }

  return (
    <Card title={title} className="sheet">
      <p>{description}</p>
      <div className="import-reference">
        <DataTable caption={`${title} column reference`} columns={REFERENCE_COLUMNS} rows={[...columns]} rowKey={(c) => c.name} stackOnPhone />
      </div>
      <p>
        <a href={templateHref} download className="text-link">
          <Icon name="import" size={14} /> Download template
        </a>
      </p>

      <label className="dropzone" htmlFor={inputId} onDragOver={(e) => e.preventDefault()} onDrop={handleDrop}>
        <input
          id={inputId}
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          className="visually-hidden"
          onChange={(e) => pickFile(e.target.files?.item(0) ?? null)}
        />
        <Icon name="upload" size={20} />
        {chooseLabel}
      </label>

      {file !== null && (
        <p className="dropzone__file">
          {file.name} ({formatFileSize(file.size)})
        </p>
      )}

      {mapping === null && (
        <button type="button" className="button button--primary" disabled={file === null || uploading} aria-busy={uploading} onClick={handleImport}>
          {uploading ? 'Importing…' : 'Import'}
        </button>
      )}

      {mapping !== null && file !== null && (
        <ColumnMappingPanel
          kind={kind}
          fileName={file.name}
          headers={mapping.analysis.headers}
          sampleRows={mapping.analysis.sampleRows}
          dataRowCount={mapping.analysis.dataRowCount}
          text={mapping.text}
          assignments={mapping.assignments}
          suggestion={mapping.analysis.suggestion}
          busy={uploading}
          onChange={changeAssignment}
          onConfirm={(map) => void upload(map)}
          onCancel={cancelMapping}
          onReviewDifferentFormat={() => file !== null && reviewDifferently(file)}
        />
      )}

      {banner !== null && (
        <div ref={bannerRef} tabIndex={-1}>
        <Banner
          tone={banner.tone}
          title={banner.title}
          action={
            banner.canReview === true && file !== null ? (
              <button type="button" className="button" onClick={() => reviewDifferently(file)}>
                Review as a different format
              </button>
            ) : undefined
          }
        >
          {banner.warnings !== undefined && banner.warnings.length > 0 && (
            <ul>
              {banner.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
          {banner.issues !== undefined && <ImportIssueTable issues={banner.issues} totalErrors={banner.totalErrors} caption="Import errors" />}
        </Banner>
        </div>
      )}
    </Card>
  );
}

/** The Data Import page (plan §8.6): the import card; under its "More", the column guide with the per-kind uploads and "Restore sample data". */
export function ImportPage() {
  const { api, refresh } = useData();
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetBanner, setResetBanner] = useState<ImportBannerState | null>(null);
  const [incoming, setIncoming] = useState<IncomingFile | null>(null);
  const [guideTab, setGuideTab] = useState<ImportKind>('inventory');
  const handoffs = useRef(0);

  function handOver(file: File, kind: ImportKind): void {
    handoffs.current += 1;
    setIncoming({ file, kind, nonce: handoffs.current });
  }

  async function handleReset(): Promise<void> {
    setResetting(true);
    setResetBanner(null);
    try {
      await api.resetSampleData();
      await refresh();
      setResetBanner({ tone: 'success', title: 'Sample data restored.' });
    } catch (err) {
      const apiErr = err as ApiError;
      setResetBanner({ tone: 'critical', title: apiErr.message });
    } finally {
      setResetting(false);
      setConfirmingReset(false);
    }
  }

  // Under "More", after the card's own tools: the column guide (each tab keeps that dataset's direct upload, the per-kind
  // card, next to its template; the inactive tab is hidden by CSS so both cards keep their state) and Restore sample data.
  const more = (
    <>
        <details className="column-guide">
          <summary className="column-guide__summary">Column guide</summary>
          <div className="column-guide__tabs" role="tablist" aria-label="Datasets">
            {GUIDE_TABS.map(([kind, label]) => (
              <button
                key={kind}
                type="button"
                role="tab"
                id={`guide-tab-${kind}`}
                aria-controls={`guide-panel-${kind}`}
                aria-selected={guideTab === kind}
                tabIndex={guideTab === kind ? 0 : -1}
                className="column-guide__tab"
                onClick={() => setGuideTab(kind)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') setGuideTab(guideTab === 'inventory' ? 'shipments' : 'inventory');
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <div role="tabpanel" id="guide-panel-inventory" aria-labelledby="guide-tab-inventory" className={`column-guide__panel${guideTab === 'inventory' ? ' is-active' : ''}`}>
            <ImportCard
              kind="inventory"
              title="Inventory"
              description="Replaces the entire inventory dataset. If any row fails validation, nothing is imported."
              columns={INVENTORY_COLUMNS}
              templateHref="/templates/inventory-template.csv"
              chooseLabel="Choose inventory CSV file"
              onReview={handOver}
            />
          </div>
          <div role="tabpanel" id="guide-panel-shipments" aria-labelledby="guide-tab-shipments" className={`column-guide__panel${guideTab === 'shipments' ? ' is-active' : ''}`}>
            <ImportCard
              kind="shipments"
              title="Shipments"
              description="Replaces the entire shipments dataset. If any row fails validation, nothing is imported."
              columns={SHIPMENT_COLUMNS}
              templateHref="/templates/shipments-template.csv"
              chooseLabel="Choose shipments CSV file"
              onReview={handOver}
            />
          </div>
        </details>

        <Card title="Restore sample data" className="sheet sheet--quiet">
          <p>Replace all current inventory and shipment data with the starting sample data.</p>
          <p className="restore-note">Use after a demo import to reset the data.</p>
          {confirmingReset ? (
            <div className="confirm-inline">
              <p>This replaces all current inventory and shipment data with generated sample data.</p>
              <button type="button" className="button button--danger" disabled={resetting} onClick={handleReset}>
                Replace data
              </button>
              <button type="button" className="button" disabled={resetting} onClick={() => setConfirmingReset(false)}>
                Cancel
              </button>
            </div>
          ) : (
            <button type="button" className="button" onClick={() => setConfirmingReset(true)}>
              Restore sample data
            </button>
          )}
          {resetBanner !== null && <Banner tone={resetBanner.tone} title={resetBanner.title} />}
        </Card>
    </>
  );

  return (
    <div className="page">
      <PageStage title="Data Import" />
      <div className="page-floor import-floor">
        <UniversalImportCard incoming={incoming} more={more} />
      </div>
    </div>
  );
}
