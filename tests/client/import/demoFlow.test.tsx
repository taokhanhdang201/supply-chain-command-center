// @vitest-environment jsdom
// The demo flow on the Import page (G1): "No file? Try one." builds the carrier export in the browser and the card takes
// it through one question to "Ready" and the import in three clicks, with Undo after it; the other samples, paste and
// templates sit under More; the file with errors stops at "has errors"; "Restore sample data" asks for confirmation first.
// (Before G1 this file covered the "Try a sample" menu, the step bar and the success links, all replaced by these states.)
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ImportPage } from '../../../src/client/pages/ImportPage';
import { ApiError } from '../../../src/client/api/apiClient';
import { renderWithData } from '../../helpers/renderWithData';
import { makeSnapshot, TODAY } from '../../helpers/fixtures';
import { generateSampleData } from '../../../src/shared/sample/generateSampleData';
import { arrivedCount, CARRIER_EXPORT_NAME } from '../../../src/client/import/sampleFiles';
import { settled } from '../ingest/uiHarness';
import type { ImportKind } from '../../../src/shared/types';

beforeEach(() => {
  window.location.hash = '';
});

const seed7 = generateSampleData({ seed: 7, today: TODAY });
const ARRIVED = arrivedCount(seed7.shipments);

async function setup(api: { undoImport?: (version: number) => Promise<void> } = {}) {
  const snapshot = makeSnapshot([], [], { today: TODAY });
  snapshot.dataSources.shipments.rowCount = 480;
  snapshot.dataSources.inventory.rowCount = 360;
  const importCsv = vi.fn().mockImplementation(async (kind: ImportKind, file: File) => {
    const rowCount = kind === 'shipments' ? seed7.shipments.length : seed7.inventory.length;
    return { ok: true, kind, rowCount, warnings: [], dataSource: { kind: 'import', label: file.name, loadedAt: '2026-06-15T00:00:00.000Z', rowCount }, undo: { version: 5 } };
  });
  const resetSampleData = vi.fn().mockResolvedValue(undefined);
  const undoImport = api.undoImport ?? vi.fn().mockResolvedValue(undefined);
  const user = userEvent.setup();
  await renderWithData(<ImportPage />, { snapshot, api: { importCsv, resetSampleData, undoImport } });
  return { user, importCsv, resetSampleData, undoImport };
}

const state = (): HTMLElement => document.getElementById('ingest-state-heading') as HTMLElement;

/** Clicks 1 and 2: try the demo file, answer its one question. */
async function tryOneAndAnswer(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole('button', { name: 'No file? Try one.' }));
  await screen.findByRole('heading', { name: 'What does “Arrived” mean?' });
  await settled();
  await user.click(screen.getByRole('button', { name: 'In transit' }));
  await screen.findByRole('heading', { name: `${seed7.shipments.length} shipments. Ready.` });
  await settled();
}

describe('demo flow: No file? Try one.', { timeout: 30_000 }, () => {
  it('the waiting state offers one demo link; the other samples, paste and templates sit under More', async () => {
    await setup();
    expect(screen.getByText('Drop your file')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'No file? Try one.' })).toBeInTheDocument();
    const more = screen.getByText('More').closest('details') as HTMLDetailsElement;
    expect(more.open).toBe(false);
    expect(within(more).getByRole('button', { name: 'Try a file with errors' })).toBeInTheDocument();
    expect(within(more).getByRole('button', { name: 'Try an inventory file' })).toBeInTheDocument();
    expect(within(more).getByRole('button', { name: /Paste rows from a spreadsheet/ })).toBeInTheDocument();
    expect(within(more).getByRole('link', { name: 'Shipments' })).toHaveAttribute('href', '/templates/shipments-template.csv');
    expect(within(more).getByRole('link', { name: 'Inventory' })).toHaveAttribute('href', '/templates/inventory-template.csv');
  });

  it('the carrier export goes through in three clicks: Try one, one question ("Arrived"), Use this data', async () => {
    const { user, importCsv } = await setup();
    await user.click(screen.getByRole('button', { name: 'No file? Try one.' }));
    // click 2: the one question, its answers are the buttons, the first one is the main button
    await screen.findByRole('heading', { name: 'What does “Arrived” mean?' });
    await settled();
    expect(screen.getByText(`${ARRIVED} shipments have this status. SCC does not guess.`)).toBeInTheDocument();
    const answers = within(screen.getByRole('group', { name: 'Answers' })).getAllByRole('button');
    expect(answers.map((b) => b.textContent)).toEqual(['In transit', 'Delivered', 'Pending', 'Cancelled']);
    // every answer looks the same: none is the main button, so SCC does not hint at one (it used to make the first one primary)
    expect(new Set(answers.map((b) => b.className))).toEqual(new Set(['button']));
    expect(state().closest('section')).toHaveClass('ingest-state--warning');
    expect(document.activeElement).toBe(state());
    await user.click(answers[0] as HTMLElement);
    // "Ready": one sentence, the effect on the Dashboard, one main button, "What I fixed (n)"
    await screen.findByRole('heading', { name: `${seed7.shipments.length} shipments. Ready.` });
    await settled();
    expect(screen.getByText(/Replaces the 480 sample shipments\.$/)).toBeInTheDocument();
    const fixed = screen.getByText(/^What I fixed \(\d+\)$/);
    const fixes = within(fixed.closest('details') as HTMLElement).getAllByRole('listitem').map((li) => li.textContent);
    expect(fixes).toContain('Read the status “Arrived” as in transit (your answer).');
    expect(fixes.some((f) => /^Read “ETA” as day\.month\.year: \d{2}\.\d{2}\.\d{4} can only be /.test(f ?? ''))).toBe(true);
    expect(fixes.some((f) => /^Read “Delivered Date” as month\/day\/year/.test(f ?? ''))).toBe(true);
    expect(fixes.some((f) => /^Removed the \$ sign from [\d,]+ amounts\.$/.test(f ?? ''))).toBe(true);
    // click 3
    await user.click(screen.getByRole('button', { name: 'Use this data' }));
    await screen.findByRole('heading', { name: 'Done. Dashboard updated.' });
    expect(screen.getByText(`${seed7.shipments.length} shipments from ${CARRIER_EXPORT_NAME}.`)).toBeInTheDocument();
    expect(importCsv).toHaveBeenCalledTimes(1);
    expect(importCsv.mock.calls[0]?.[0]).toBe('shipments');
    expect((importCsv.mock.calls[0]?.[1] as File).name).toBe(CARRIER_EXPORT_NAME);
    // the main action is Open Dashboard; Undo is the small link (it used to be the main button)
    expect(screen.getByRole('button', { name: 'Undo' })).toHaveClass('ingest-link');
    expect(screen.getByRole('link', { name: 'Open Dashboard' })).toHaveAttribute('href', '#/');
    expect(screen.getByRole('link', { name: 'Open Dashboard' })).toHaveClass('button', 'button--primary');
    await waitFor(() => expect(document.activeElement).toBe(state()));
  });

  it('Undo asks the server to undo that import (by its version) and says the data is back', async () => {
    const { user, undoImport } = await setup();
    await tryOneAndAnswer(user);
    await user.click(screen.getByRole('button', { name: 'Use this data' }));
    await user.click(await screen.findByRole('button', { name: 'Undo' }));
    await screen.findByRole('heading', { name: 'Undone. The data is back as it was.' });
    expect(undoImport).toHaveBeenCalledWith(5);
    expect(screen.getByText(`Nothing from ${CARRIER_EXPORT_NAME} was kept.`)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose a file' })).toBeInTheDocument();
  });

  it('an Undo that comes too late says so plainly, in red, and offers no second Undo', async () => {
    const message = 'This import can no longer be undone: the data changed after it. Use Restore sample data to start over.';
    const undoImport = vi.fn().mockRejectedValue(new ApiError(409, 'UNDO_STALE', message));
    const { user } = await setup({ undoImport });
    await tryOneAndAnswer(user);
    await user.click(screen.getByRole('button', { name: 'Use this data' }));
    await user.click(await screen.findByRole('button', { name: 'Undo' }));
    const heading = await screen.findByRole('heading', { name: 'This import can no longer be undone: the data changed after it.' });
    expect(screen.getByText('Use Restore sample data to start over.')).toBeInTheDocument();
    expect(heading.closest('section')).toHaveClass('ingest-state--critical');
    expect(heading.closest('[role="alert"]')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
  });

  it('the inventory file under More goes straight to Ready and imports as inventory', async () => {
    const { user, importCsv } = await setup();
    await user.click(screen.getByRole('button', { name: 'Try an inventory file' }));
    await screen.findByRole('heading', { name: `${seed7.inventory.length} inventory items. Ready.` });
    await settled();
    await waitFor(() => expect(document.activeElement).toBe(state()));
    await user.click(screen.getByRole('button', { name: 'Use this data' }));
    await screen.findByRole('heading', { name: 'Done. Dashboard updated.' });
    expect(importCsv.mock.calls[0]?.[0]).toBe('inventory');
    expect((importCsv.mock.calls[0]?.[1] as File).name).toBe('sample-inventory-seed-7.csv');
  });

  it('the file with errors stops at "has errors": the rows, a download, nothing imported; every problem behind the link', async () => {
    const { user, importCsv } = await setup();
    await user.click(screen.getByRole('button', { name: 'Try a file with errors' }));
    const heading = await screen.findByRole('heading', { name: '7 rows need fixing.' });
    await settled();
    expect(heading.closest('section')).toHaveClass('ingest-state--critical');
    expect(screen.getByText('Rows 5, 7, 10 and 4 more. Nothing was imported.')).toBeInTheDocument(); // "Rows" (was "Lines")
    expect(screen.getByRole('button', { name: 'Download the 7 rows to fix' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Use this data' })).not.toBeInTheDocument();
    // behind "See every problem": the problems grouped by column, each with a short fix, and the import locked
    expect(screen.getByText('See every problem')).toBeInTheDocument();
    const groups = [...document.querySelectorAll('.ingest-error-groups > li')].map((li) => li.querySelector('.ingest-error-groups__where')?.textContent);
    expect(groups).toEqual(['ship_date: 3 rows, lines 5, 10, 16', 'shipment_id: 2 rows, lines 7, 13', 'shipping_cost: 2 rows, lines 12, 19']);
    const hints = [...document.querySelectorAll('.ingest-error-groups__hint')].map((h) => h.textContent);
    expect(hints[0]).toMatch(/^Use YYYY-MM-DD/);
    expect(hints[2]).toBe('Fill in a value in every row.');
    expect(screen.getByRole('button', { name: 'Import 20 shipments' })).toBeDisabled();
    expect(importCsv).not.toHaveBeenCalled();
  });
});

describe('Restore sample data', () => {
  it('asks for confirmation before resetting, then restores both datasets', async () => {
    const { user, resetSampleData } = await setup();
    expect(screen.getByText('Use after a demo import to reset the data.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Restore sample data' }));
    expect(resetSampleData).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Replace data' }));
    await waitFor(() => expect(resetSampleData).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Sample data restored.')).toBeInTheDocument();
  });
});
