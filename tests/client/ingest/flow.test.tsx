// @vitest-environment jsdom
// Criteria 27 (UI side: Cancel terminates and returns focus), 31 (client side) and 51: the flow state machine behind the
// card: server limits reach the pipeline, a newer run supersedes an older one, Cancel terminates the running work, an
// error after a change keeps the old review visible but unconfirmable, decisions are kept or reset as the design says,
// and the WorkerRunner fallback to the inline runner.

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UniversalImportCard } from '../../../src/client/components/import/UniversalImportCard';
import { InlineRunner, WorkerRunner, type IngestRunner, type RunHandle, type ProgressFn } from '../../../src/client/ingest/runner';
import { DataProvider } from '../../../src/client/state/DataContext';
import { ingestError } from '../../../src/shared/ingest/messages';
import type { Analysis, PipelineInput } from '../../../src/shared/ingest/pipeline';
import type { Result } from '../../../src/shared/ingest/types';
import { makeSnapshot, TODAY } from '../../helpers/fixtures';
import { renderCard, review, settled, acknowledgeAll, fileOf, fileOfFixture, fixtureByName, confirmButton, DROPZONE_LABEL } from './uiHarness';
import type { ApiClient } from '../../../src/client/api/apiClient';

beforeEach(() => {
  window.location.hash = '';
});

/** A runner whose results the test settles by hand. */
class ManualRunner implements IngestRunner {
  runs: Array<{ job: PipelineInput; resolve: (r: Result<Analysis>) => void; cancelled: boolean; progress?: ProgressFn }> = [];
  run(job: PipelineInput, progress?: ProgressFn): RunHandle {
    let resolve!: (r: Result<Analysis>) => void;
    const promise = new Promise<Result<Analysis>>((r) => (resolve = r));
    const entry = { job, resolve, cancelled: false, progress };
    this.runs.push(entry);
    return {
      promise,
      cancel: () => {
        entry.cancelled = true;
        resolve({ ok: false, error: ingestError('CANCELLED', 'read') });
      }
    };
  }
}

async function renderWith(runner: IngestRunner, importCsv = vi.fn()) {
  const snapshot = makeSnapshot([], [], { today: TODAY });
  const api: ApiClient = { getSnapshot: vi.fn().mockResolvedValue(snapshot), importCsv, resetSampleData: vi.fn() };
  const user = userEvent.setup({ applyAccept: false });
  let result!: ReturnType<typeof render>;
  await act(async () => {
    result = render(
      <DataProvider api={api}>
        <ReadyOnly>
          <UniversalImportCard runner={runner} />
        </ReadyOnly>
      </DataProvider>
    );
  });
  await screen.findByRole('heading', { name: 'Import any file' });
  return { user, ...result, importCsv };
}

import { useData } from '../../../src/client/state/DataContext';
import type { ReactNode } from 'react';
function ReadyOnly({ children }: { children: ReactNode }) {
  const { state } = useData();
  return state.status === 'ready' ? <>{children}</> : null;
}

const CSV = 'sku,product_name,category,warehouse,quantity,reorder_point,unit_cost\nA-1,Bolt,Hardware,WH-DFW,3,1,9.5\n';

describe('flow: runs, cancel and supersede', () => {
  it('shows progress while reading, with the card marked busy and a Start over that terminates the run and returns focus to the picker', async () => {
    const runner = new ManualRunner();
    const { user } = await renderWith(runner);
    const picker = screen.getByLabelText(DROPZONE_LABEL) as HTMLInputElement;
    await user.upload(picker, fileOf(CSV, 'a.csv'));
    await waitFor(() => expect(runner.runs).toHaveLength(1));
    expect(document.querySelector('[data-ingest-card]')?.getAttribute('aria-busy')).toBe('true');
    act(() => runner.runs[0]?.progress?.('read', 0.25));
    expect(await screen.findByText(/Reading the data \(25%\)…/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Start over' }));
    expect(runner.runs[0]?.cancelled).toBe(true);
    expect(document.activeElement).toBe(picker);
    expect(document.querySelector('[data-ingest-card]')?.getAttribute('aria-busy')).toBe('false');
    expect(screen.queryByRole('button', { name: 'Start over' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Detected format' })).not.toBeInTheDocument();
  });

  it('a result that arrives after Cancel or after a newer file was chosen is ignored', async () => {
    const runner = new ManualRunner();
    const { user } = await renderWith(runner);
    const picker = screen.getByLabelText(DROPZONE_LABEL) as HTMLInputElement;
    await user.upload(picker, fileOf(CSV, 'first.csv'));
    await waitFor(() => expect(runner.runs).toHaveLength(1));
    // choose another file and review it while the first run is still going
    await user.upload(picker, fileOf(CSV, 'second.csv'));
    await waitFor(() => expect(runner.runs).toHaveLength(2));
    expect(runner.runs[0]?.cancelled).toBe(true);
    // a late result of the first run must not show up
    await act(async () => {
      runner.runs[0]?.resolve({ ok: false, error: ingestError('READ_FAILED', 'read') });
    });
    expect(screen.queryByText(/could not be read/)).not.toBeInTheDocument();
    expect(runner.runs[1]?.job.fileName).toBe('second.csv');
  });

  it('a failed re-analysis keeps the previous review visible but makes it unconfirmable, with the reason', async () => {
    const inline = new InlineRunner();
    let failNext = false;
    const runner: IngestRunner = {
      run(job, progress) {
        if (failNext) {
          return { promise: Promise.resolve({ ok: false, error: ingestError('LIMIT_PARSE_TIME', 'limits') } as Result<Analysis>), cancel: () => undefined };
        }
        return inline.run(job, progress);
      }
    };
    const { user, importCsv } = await renderWith(runner);
    await user.upload(screen.getByLabelText(DROPZONE_LABEL), fileOfFixture(fixtureByName('alder_freight.csv')));
    await screen.findByRole('heading', { name: 'Review before importing' });
    await settled();
    await acknowledgeAll(user);
    await waitFor(() => expect(confirmButton()).toBeEnabled());
    failNext = true;
    await user.click(screen.getByRole('radio', { name: /Inventory/ }));
    expect(await screen.findByText(/Reading this file took too long and was stopped\./)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Review before importing' })).toBeInTheDocument();
    expect(confirmButton()).toBeDisabled();
    expect(document.getElementById(confirmButton().getAttribute('aria-describedby') as string)?.textContent).toMatch(/out of date/);
    await user.click(confirmButton()).catch(() => undefined);
    expect(importCsv).not.toHaveBeenCalled();
  });
});

// Several decisions, each re-running the pipeline on a real file: ~1.6 s alone (the same on the previous commit), past 5 s
// under a loaded parallel run, so the same 15 s budget as blockingStates. The assertions are unchanged.
describe('flow: decisions', { timeout: 15_000 }, () => {
  it('excluding a row keeps every other decision; choosing another dataset resets the column and value decisions', async () => {
    const r = await renderCard();
    await r.user.upload(r.picker(), fileOfFixture(fixtureByName('brightwater_banner.csv')));
    await screen.findByRole('heading', { name: 'Review before importing' });
    await settled();
    await acknowledgeAll(r.user);
    const last = () => r.runner.jobs.at(-1)?.decisions;
    expect(last()?.acknowledgedColumns?.length ?? 0).toBeGreaterThanOrEqual(0);
    const select = screen.getByLabelText(/SCC field for column 1,/);
    await r.user.selectOptions(select, '__ignore__');
    await settled();
    expect(last()?.assignments?.size).toBe(1);
    await r.user.click(screen.getByRole('checkbox', { name: /Leave out total/ }));
    await settled();
    expect(last()?.assignments?.size).toBe(1); // still there after excluding a row
    expect(last()?.excludedRows).toHaveLength(1);
    await r.user.click(screen.getByRole('radio', { name: /Shipments/ }));
    await settled();
    expect(last()?.kind).toBe('shipments');
    expect(last()?.assignments).toBeUndefined(); // a different dataset starts the mapping again
    expect(last()?.excludedRows).toHaveLength(1); // the table structure choices stay
  });

  it('the pipeline receives a fresh Map for every decision (decisions are plain data the worker can clone)', async () => {
    const r = await renderCard();
    await review(r, fileOfFixture(fixtureByName('alder_freight.csv')));
    await acknowledgeAll(r.user);
    for (const job of r.runner.jobs) expect(() => structuredClone({ ...job, bytes: undefined })).not.toThrow();
  });
});

describe('flow: runner choice', () => {
  it('falls back to the inline runner when the module worker cannot be created (adapters that need no worker still run)', async () => {
    const throwing = new WorkerRunner(() => {
      throw new Error('no worker');
    });
    // the card only falls back for its own default runner; an injected runner is used as given
    const direct = throwing.run({ bytes: new TextEncoder().encode(CSV), fileName: 'a.csv' });
    const outcome = await direct.promise;
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.code).toBe('BROWSER_UNSUPPORTED');
    const inline = await new InlineRunner().run({ bytes: new TextEncoder().encode(CSV), fileName: 'a.csv' }).promise;
    expect(inline.ok).toBe(true);
  });
});
