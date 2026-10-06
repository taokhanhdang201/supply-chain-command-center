// Shared helpers for the universal import UI tests (jsdom, fake api, the inline runner: jsdom has no Worker).

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, vi } from 'vitest';
import type { UserEvent } from '@testing-library/user-event';
import { UniversalImportCard } from '../../../src/client/components/import/UniversalImportCard';
import { InlineRunner, type IngestRunner, type RunHandle } from '../../../src/client/ingest/runner';
import type { ApiClient } from '../../../src/client/api/apiClient';
import type { PipelineInput } from '../../../src/shared/ingest/pipeline';
import { renderWithData } from '../../helpers/renderWithData';
import { makeSnapshot, TODAY } from '../../helpers/fixtures';
import { fixtureByName, type Fixture } from '../../fixtures/ingest/corpus45';
import { utf8 } from '../../ingest-kit/corpus';

export const SUCCESS = {
  ok: true,
  kind: 'shipments',
  rowCount: 12,
  warnings: [],
  dataSource: { kind: 'import', label: 'alder_freight.csv', loadedAt: '2026-06-15T00:00:00.000Z', rowCount: 12 }
};

/** An inline runner that remembers every job it was given. */
export class SpyRunner implements IngestRunner {
  jobs: PipelineInput[] = [];
  private readonly inner: InlineRunner;
  constructor(registry?: ConstructorParameters<typeof InlineRunner>[0]) {
    this.inner = new InlineRunner(registry);
  }
  run(job: PipelineInput, onProgress?: Parameters<IngestRunner['run']>[1]): RunHandle {
    this.jobs.push(job);
    return this.inner.run(job, onProgress);
  }
}

export const fileOf = (bytes: Uint8Array | string, name: string, type = ''): File => new File([new Uint8Array(typeof bytes === 'string' ? utf8(bytes) : bytes)], name, { type });
export const fileOfFixture = (f: Fixture): File => fileOf(f.bytes, f.hints.fileName);
export { fixtureByName };

export interface Rendered {
  user: UserEvent;
  runner: SpyRunner;
  importCsv: ReturnType<typeof vi.fn>;
  api: ApiClient;
  snapshot: ReturnType<typeof makeSnapshot>;
  picker: () => HTMLInputElement;
}

export async function renderCard(opts: { api?: Partial<ApiClient>; maxUploadBytes?: number; maxRows?: number; registry?: ConstructorParameters<typeof InlineRunner>[0] } = {}): Promise<Rendered> {
  const snapshot = makeSnapshot([], [], { today: TODAY });
  if (opts.maxUploadBytes !== undefined) snapshot.limits.maxUploadBytes = opts.maxUploadBytes;
  if (opts.maxRows !== undefined) snapshot.limits.maxRows = opts.maxRows;
  const importCsv = vi.fn().mockResolvedValue(SUCCESS);
  const runner = new SpyRunner(opts.registry);
  const user = userEvent.setup({ applyAccept: false });
  const rendered = await renderWithData(<UniversalImportCard runner={runner} />, { snapshot, api: { importCsv, ...opts.api } });
  return { user, runner, importCsv, api: rendered.api, snapshot, picker: () => screen.getByLabelText(DROPZONE_LABEL) as HTMLInputElement };
}

/** The single drop area (on a phone its visible text is "Choose CSV file"). */
export const DROPZONE_LABEL = /Drop a CSV here or choose a file/;

/** Chooses a file (the review starts at once), then waits until the review has been produced (or an error shown). */
export async function review(r: Rendered, file: File): Promise<void> {
  await r.user.upload(r.picker(), file);
  await settled();
}

/** Waits for the card to stop working (aria-busy false) after any decision. */
export async function settled(): Promise<void> {
  await waitFor(() => {
    const card = document.querySelector('[data-ingest-card]');
    expect(card?.getAttribute('aria-busy')).toBe('false');
  }, { timeout: 15_000 });
}

/** The review's Import button names what it imports ("Import 12 shipments"; "Import data" before the dataset is known). */
export const CONFIRM_NAME = /^Import (data|[\d,]+ (shipments?|inventory items?))$/;
export const confirmButton = (): HTMLButtonElement => screen.getByRole('button', { name: CONFIRM_NAME }) as HTMLButtonElement;

/** Presses every "Looks right" button (one column at a time: each press re-runs the analysis). */
export async function acknowledgeAll(user: UserEvent): Promise<void> {
  for (let guard = 0; guard < 30; guard += 1) {
    const button = screen.queryAllByRole('button', { name: /^Looks right/ })[0];
    if (button === undefined) return;
    await user.click(button);
    await settled();
  }
}
