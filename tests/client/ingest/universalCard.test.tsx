// @vitest-environment jsdom
// Criteria 4, 18, 19, 27 (UI side), 31 (client side) and 51: the universal import card end to end with the real pipeline
// (inline runner) and a fake api: detection, structure, mapping, dataset choice and override, Confirm gating, cancel,
// new file resets, the canonical upload through the unchanged two-argument importCsv, limits from the snapshot.

import { describe, expect, it, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { SAMPLE_COMMA_CSV, utf16le, cp1252 } from '../../ingest-kit/corpus';
import { renderCard, review, settled, acknowledgeAll, fileOf, fileOfFixture, fixtureByName, confirmButton, SUCCESS } from './uiHarness';

beforeEach(() => {
  window.location.hash = '';
});

const ALDER = () => fileOfFixture(fixtureByName('alder_freight.csv'));

describe('universal import card: states', () => {
  it('is titled "Import any file", has its own label and an action that is not named "Import"', async () => {
    const r = await renderCard();
    expect(screen.getByRole('heading', { name: 'Import any file' })).toBeInTheDocument();
    expect(r.picker()).toBeInTheDocument();
    // Choosing a file starts the review at once: there is no separate "Review file" action.
    expect(screen.queryByRole('button', { name: 'Review file' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Import' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start over' })).not.toBeInTheDocument();
    // G1: the waiting state shows one line made from the registry and the size limit (it used to show the full
    // "You can import ..." sentence, which now sits behind "What SCC can read"); the file picker hint comes from the registry
    expect(screen.getByText('CSV, TSV, TXT or GZ file. Up to 2 MB.')).toBeInTheDocument();
    expect(screen.queryByText(/You can import/)).not.toBeInTheDocument();
    expect(r.picker().getAttribute('accept')).toContain('.csv');
    expect(r.picker().getAttribute('accept')).toContain('.gz');
  });

  it('shows the detected format with evidence, the mapping with confidence, the preview and the restatement for a messy file', async () => {
    const r = await renderCard();
    await review(r, ALDER());
    expect(screen.getByRole('heading', { name: 'Detected format' })).toBeInTheDocument();
    expect(within(screen.getByRole('heading', { name: 'Detected format' }).closest('section') as HTMLElement).getByText(/Delimited text/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Match columns to SCC fields' })).toBeInTheDocument();
    expect(screen.getAllByText(/Matched/i).length).toBeGreaterThan(3);
    expect(screen.getByRole('heading', { name: 'Review before importing' })).toBeInTheDocument();
    expect(screen.getByText(/This will REPLACE the entire Shipments dataset \(0 rows from Sample data \(seed 42\)\) with 12 rows from alder_freight\.csv\./)).toBeInTheDocument();
    expect(r.importCsv).not.toHaveBeenCalled();
  });

  it('uploads the canonical CSV with the two-argument importCsv under the original file name, then focuses the result banner', async () => {
    const r = await renderCard();
    await review(r, ALDER());
    await acknowledgeAll(r.user);
    await waitFor(() => expect(confirmButton()).toBeEnabled());
    await r.user.click(confirmButton());
    // G1: the done state says "Done. Dashboard updated." and names what came in (it used to read "Imported 12 shipments
    // rows from alder_freight.csv. All views are updated."); its sentence takes the focus
    const done = await screen.findByRole('heading', { name: 'Done. Dashboard updated.' });
    expect(screen.getByText('12 shipments from alder_freight.csv.')).toBeInTheDocument();
    expect(r.importCsv).toHaveBeenCalledTimes(1);
    const args = r.importCsv.mock.calls[0] as unknown[];
    expect(args).toHaveLength(2);
    expect(args[0]).toBe('shipments');
    const sent = args[1] as File;
    expect(sent.name).toBe('alder_freight.csv');
    expect(sent.type).toBe('text/csv');
    const text = await new Promise<string>((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result as string);
      fr.readAsText(sent);
    });
    expect(text.split('\n')[0]).toBe('shipment_id,origin,destination,carrier,status,ship_date,estimated_delivery,actual_delivery,shipping_cost');
    expect(done).toHaveAttribute('tabindex', '-1');
    await waitFor(() => expect(document.activeElement).toBe(done));
    // the review is gone, nothing is left selected
    expect(screen.queryByRole('heading', { name: 'Review before importing' })).not.toBeInTheDocument();
    expect(r.picker().value).toBe('');
    expect(SUCCESS.rowCount).toBe(12);
  });

  it('shows the server message and keeps the review when the upload is rejected', async () => {
    const { ApiError } = await import('../../../src/client/api/apiClient');
    const importCsv = (await import('vitest')).vi.fn().mockRejectedValue(new ApiError(422, 'VALIDATION_FAILED', 'The file was rejected: 1 problem(s) found. No data was changed.', [{ line: 3, column: 'sku', code: 'REQUIRED', message: 'Value is required.' }], 1));
    const r = await renderCard({ api: { importCsv } });
    await review(r, ALDER());
    await acknowledgeAll(r.user);
    await waitFor(() => expect(confirmButton()).toBeEnabled());
    await r.user.click(confirmButton());
    // G1: the server message is shown as the state's sentence and line (it used to be one banner)
    expect(await screen.findByRole('heading', { name: 'The file was rejected: 1 problem(s) found.' })).toBeInTheDocument();
    expect(screen.getByText('No data was changed.')).toBeInTheDocument();
    expect(screen.getByText('Value is required.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Review before importing' })).toBeInTheDocument();
  });

  it('passes the server limits to the pipeline: payload bytes and rows come from snapshot.limits', async () => {
    const r = await renderCard({ maxUploadBytes: 5_000, maxRows: 7 });
    await review(r, ALDER());
    expect(r.runner.jobs[0]?.limitConfig).toEqual({ payloadBytes: 5_000, maxImportRows: 7 });
    // 12 rows against a 7-row server limit: stopped client side with the next step, before any upload
    expect(await screen.findByText(/more than 7 data rows/)).toBeInTheDocument();
    expect(r.importCsv).not.toHaveBeenCalled();
  });

  it('refuses a file of an unknown type with the registry text and never calls the api', async () => {
    const r = await renderCard();
    await review(r, fileOf(new Uint8Array(100), 'data.xlsx', 'application/vnd.ms-excel'));
    // G1: the refusal is the "cannot import" state: its first sentence is the heading, the rest is the line, and the full
    // list of what SCC reads sits behind "What SCC can read"
    expect(await screen.findByRole('heading', { name: 'This looks like a binary file.' })).toBeInTheDocument();
    expect(screen.getByText('SCC reads text files (CSV, TSV and plain text).')).toBeInTheDocument(); // the one line: the registry's hint
    expect(screen.getByText('What SCC can read')).toBeInTheDocument();
    expect(screen.getByText(/You can import Delimited text \(\.csv, \.tsv, \.txt\)/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose another file' })).toBeInTheDocument();
    expect(r.importCsv).not.toHaveBeenCalled();
    expect(screen.queryByRole('heading', { name: 'Detected format' })).not.toBeInTheDocument();
  });

  it('refuses an empty file with the existing text', async () => {
    const r = await renderCard();
    await review(r, fileOf('', 'empty.csv'));
    expect(await screen.findByText('The file is empty.')).toBeInTheDocument();
  });

  it('reads a UTF-16 file by its content (the .csv name is only a hint)', async () => {
    const r = await renderCard();
    await review(r, fileOf(utf16le(SAMPLE_COMMA_CSV), 'stock.csv'));
    expect(await screen.findByRole('heading', { name: 'Match columns to SCC fields' })).toBeInTheDocument();
    expect(screen.getAllByText(/UTF-16/).length).toBeGreaterThan(0);
  });
});

describe('universal import card: choices and blocking', () => {
  it('asks for the dataset when the columns do not say, with nothing preselected, and Confirm stays disabled until it is chosen', async () => {
    const r = await renderCard();
    await review(r, fileOfFixture(fixtureByName('both_kinds_16_columns.csv')));
    const group = screen.getByRole('group', { name: /What does this file contain\?/ });
    const radios = within(group).getAllByRole('radio') as HTMLInputElement[];
    expect(radios.map((x) => x.checked)).toEqual([false, false]);
    expect(confirmButton()).toBeDisabled();
    expect(document.getElementById(confirmButton().getAttribute('aria-describedby') as string)?.textContent).toMatch(/inventory or shipments/);
    await r.user.click(within(group).getByRole('radio', { name: /Inventory/ }));
    await settled();
    expect((within(screen.getByRole('group', { name: /What does this file contain\?/ })).getByRole('radio', { name: /Inventory/ }) as HTMLInputElement).checked).toBe(true);
  });

  it('lets the user override a detected dataset (wrong-kind override) and re-derives the mapping', async () => {
    const r = await renderCard();
    await review(r, ALDER());
    const group = () => screen.getByRole('group', { name: /What does this file contain\?/ });
    expect((within(group()).getByRole('radio', { name: /Shipments/ }) as HTMLInputElement).checked).toBe(true);
    await r.user.click(within(group()).getByRole('radio', { name: /Inventory/ }));
    await settled();
    expect((within(group()).getByRole('radio', { name: /Inventory/ }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText('Chosen by you')).toBeInTheDocument();
    expect(confirmButton()).toBeDisabled(); // inventory requires columns this file does not have
    expect(screen.getByText(/Required field sku has no column/)).toBeInTheDocument();
  });

  it('requires the user to confirm a guessed Windows-1252 encoding before the file is read', async () => {
    const r = await renderCard();
    await review(r, fileOf(cp1252('sku,product_name,category,warehouse,quantity,reorder_point,unit_cost\nA-1,Café table,Home,WH-DFW,3,1,9.5\n'), 'cafe.csv'));
    const format = screen.getByRole('heading', { name: 'Detected format' });
    expect(format).toBeInTheDocument();
    expect(screen.getAllByText(/Needs confirmation/).length).toBeGreaterThan(0);
    expect(screen.queryByRole('heading', { name: 'Match columns to SCC fields' })).not.toBeInTheDocument();
    expect(screen.getByText(/Café table/)).toBeInTheDocument(); // the decoded sample is shown
    await r.user.click(screen.getByRole('button', { name: /Confirm text encoding/i }));
    await settled();
    expect(await screen.findByRole('heading', { name: 'Match columns to SCC fields' })).toBeInTheDocument();
    expect(r.importCsv).not.toHaveBeenCalled();
  });

  it('Start over stops the work, clears the review and returns focus to the file picker', async () => {
    const r = await renderCard();
    await review(r, ALDER());
    await r.user.click(screen.getByRole('button', { name: 'Start over' }));
    expect(screen.queryByRole('heading', { name: 'Detected format' })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(r.picker());
    expect(r.picker().value).toBe('');
    // nothing is chosen any more
    expect(screen.queryByText(/alder_freight\.csv \(/)).not.toBeInTheDocument();
  });

  it('choosing a new file resets the previous review', async () => {
    const r = await renderCard();
    await review(r, ALDER());
    expect(screen.getByRole('heading', { name: 'Review before importing' })).toBeInTheDocument();
    // choosing the new file starts its review at once; nothing of the previous review is left
    await r.user.upload(r.picker(), fileOf(SAMPLE_COMMA_CSV, 'stock.csv'));
    // G1: there is no file-name line any more (state 2 names the file while reading); the old review is gone at once
    expect(screen.queryByText(/alder_freight\.csv/)).not.toBeInTheDocument();
    await screen.findByRole('heading', { name: 'Review before importing' });
    await settled();
    expect(screen.getByText(/rows from stock\.csv/)).toBeInTheDocument();
    expect(screen.queryByText(/alder_freight\.csv/)).not.toBeInTheDocument();
  });

  it('a file over the source limit is stopped with the text and next step, before any reading', async () => {
    const r = await renderCard({ maxUploadBytes: 1024 });
    await review(r, fileOf(`${SAMPLE_COMMA_CSV}${'x'.repeat(4000)}`, 'big.csv'));
    // G1: the "cannot import" state splits the text into its sentence and its next step
    expect(await screen.findByRole('heading', { name: 'File is 0.0 MB; the limit is 0.0 MB.' })).toBeInTheDocument();
    expect(screen.getByText('Split the file, remove columns you do not need, or choose fewer rows.')).toBeInTheDocument();
    expect(r.importCsv).not.toHaveBeenCalled();
  });
});
