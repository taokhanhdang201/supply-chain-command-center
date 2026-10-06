// @vitest-environment jsdom
// Criteria 1-4, 7 (client side), 19, 44 and 51: the Import page keeps the two per-kind cards (DOM order, labels, calls)
// for every file V1 handles; the new card sits above them with its own label and action; files only the pipeline can read
// are handed over with the dataset already chosen; a rejected file offers "Review as a different format"; the file type is
// decided by the registry, with the name only a hint.

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ImportPage } from '../../../src/client/pages/ImportPage';
import { ApiError } from '../../../src/client/api/apiClient';
import { renderWithData } from '../../helpers/renderWithData';
import { makeSnapshot, TODAY } from '../../helpers/fixtures';
import { cp1252, utf16le, SAMPLE_COMMA_CSV } from '../../ingest-kit/corpus';
import { SUCCESS, fileOf, DROPZONE_LABEL, CONFIRM_NAME } from './uiHarness';

beforeEach(() => {
  window.location.hash = '';
});

const read = (p: string): string => readFileSync(resolve(process.cwd(), p), 'utf-8');
const INV_TEMPLATE = read('public/templates/inventory-template.csv');
const SHIP_TEMPLATE = read('public/templates/shipments-template.csv');
const INV_ALT = read('tests/fixtures/import/inventory_alt_schema.csv');

async function setup(api: Partial<Parameters<typeof renderWithData>[1]['api']> = {}) {
  const snapshot = makeSnapshot([], [], { today: TODAY });
  const importCsv = vi.fn().mockResolvedValue(SUCCESS);
  const user = userEvent.setup({ applyAccept: false });
  await renderWithData(<ImportPage />, { snapshot, api: { importCsv, ...api } });
  return { user, importCsv };
}
const inventoryPicker = () => screen.getByLabelText('Choose inventory CSV file') as HTMLInputElement;
const importButtons = () => screen.getAllByRole('button', { name: 'Import' });

describe('criterion 4: the page structure', () => {
  it('keeps the two cards first in order (inventory, shipments) with unchanged labels; the new card has its own', async () => {
    await setup();
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings.indexOf('Import any file')).toBeLessThan(headings.indexOf('Inventory'));
    expect(headings.indexOf('Inventory')).toBeLessThan(headings.indexOf('Shipments'));
    expect(headings.indexOf('Shipments')).toBeLessThan(headings.indexOf('Restore sample data'));
    expect(screen.getByLabelText('Choose inventory CSV file')).toBeInTheDocument();
    expect(screen.getByLabelText('Choose shipments CSV file')).toBeInTheDocument();
    expect(screen.getByLabelText(DROPZONE_LABEL)).toBeInTheDocument();
    // the new card has no action named "Import": choosing a file starts its review, and its own Import button only
    // appears in the review, named after what it imports
    expect(importButtons()).toHaveLength(2);
    expect(screen.queryByRole('button', { name: CONFIRM_NAME })).not.toBeInTheDocument();
    // the two cards still accept only what they accepted
    expect(inventoryPicker().getAttribute('accept')).toBe('.csv,text/csv');
    expect(screen.getByLabelText(DROPZONE_LABEL).getAttribute('accept')).toContain('.tsv');
  });
});

describe('criteria 1 and 44: the legacy path is unchanged', () => {
  it('a canonical file goes straight to importCsv(kind, file): two arguments, no universal panels, same banner', async () => {
    const { user, importCsv } = await setup();
    const file = fileOf(INV_TEMPLATE, 'inventory-template.csv', 'text/csv');
    await user.upload(inventoryPicker(), file);
    await user.click(importButtons()[0] as HTMLElement);
    await screen.findByText(/Imported 12 inventory rows from alder_freight\.csv\. All views are updated\./);
    expect(importCsv).toHaveBeenCalledTimes(1);
    expect(importCsv.mock.calls[0]).toHaveLength(2);
    expect(importCsv).toHaveBeenCalledWith('inventory', file);
    expect(screen.queryByRole('heading', { name: 'Detected format' })).not.toBeInTheDocument();
  });

  it('a shipments template goes through the shipments card, not the universal one', async () => {
    const { user, importCsv } = await setup();
    const file = fileOf(SHIP_TEMPLATE, 'shipments-template.csv', 'text/csv');
    await user.upload(screen.getByLabelText('Choose shipments CSV file'), file);
    await user.click(importButtons()[1] as HTMLElement);
    await waitFor(() => expect(importCsv).toHaveBeenCalledWith('shipments', file));
    expect(importCsv.mock.calls[0]).toHaveLength(2);
  });

  it('an alias-schema file still shows the V1.5 mapping panel with no extra button while the data validates', async () => {
    const { user } = await setup();
    await user.upload(inventoryPicker(), fileOf(INV_ALT, 'inventory_alt_schema.csv', 'text/csv'));
    await user.click(importButtons()[0] as HTMLElement);
    expect(await screen.findByRole('heading', { name: 'Map columns for inventory_alt_schema.csv' })).toBeInTheDocument();
    await screen.findByText(/All \d+ rows pass validation\./);
    expect(screen.queryByRole('button', { name: 'Review as a different format' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm and import' })).toBeEnabled();
  });

  it('the mapping panel offers "Review as a different format" only while the dry run reports data problems', async () => {
    const { user } = await setup();
    const bad = INV_ALT.replace(/\n([^\n]*)$/, '\n$1').split('\n');
    bad[1] = (bad[1] as string).replace(/,(\d+),/, ',abc,');
    await user.upload(inventoryPicker(), fileOf(bad.join('\n'), 'inventory_alt_schema.csv', 'text/csv'));
    await user.click(importButtons()[0] as HTMLElement);
    await screen.findByRole('heading', { name: 'Map columns for inventory_alt_schema.csv' });
    expect(await screen.findByRole('button', { name: 'Review as a different format' })).toBeInTheDocument();
  });
});

describe('criterion 7 (client side): the type is decided by content, the name is a hint', () => {
  it('a .txt file that holds CSV is accepted by the per-kind card (registry detection), where the old extension check refused it', async () => {
    const { user, importCsv } = await setup();
    const file = fileOf(INV_TEMPLATE, 'stock.txt', 'text/plain');
    await user.upload(inventoryPicker(), file);
    await user.click(importButtons()[0] as HTMLElement);
    await waitFor(() => expect(importCsv).toHaveBeenCalledWith('inventory', file));
  });

  it('a file no adapter recognizes is refused with the registry text before any call', async () => {
    const { user, importCsv } = await setup();
    await user.upload(inventoryPicker(), fileOf(new Uint8Array(100), 'data.xlsx', 'application/vnd.ms-excel'));
    await user.click(importButtons()[0] as HTMLElement);
    expect(screen.getByText(/^This looks like a binary file\. SCC cannot import that type\./)).toBeInTheDocument();
    expect(importCsv).not.toHaveBeenCalled();
  });

  it('the oversize and empty pre-checks keep their exact texts and order', async () => {
    const snapshot = makeSnapshot([], [], { today: TODAY });
    snapshot.limits.maxUploadBytes = 1024;
    const importCsv = vi.fn();
    const user = userEvent.setup({ applyAccept: false });
    await renderWithData(<ImportPage />, { snapshot, api: { importCsv } });
    await user.upload(inventoryPicker(), fileOf('', 'empty.csv', 'text/csv'));
    await user.click(importButtons()[0] as HTMLElement);
    expect(screen.getByText('The file is empty.')).toBeInTheDocument();
    await user.upload(inventoryPicker(), fileOf(SAMPLE_COMMA_CSV + 'x'.repeat(2000), 'big.csv', 'text/csv'));
    await user.click(importButtons()[0] as HTMLElement);
    expect(screen.getByText('File is 0.0 MB; the limit is 0.0 MB.')).toBeInTheDocument();
    expect(importCsv).not.toHaveBeenCalled();
  });
});

describe('legacy-first routing and the handoff to the universal card', () => {
  it('a semicolon file sent to the inventory card is handed to the universal card with Inventory already chosen; the legacy card makes no call', async () => {
    const { user, importCsv } = await setup();
    const semicolon = INV_TEMPLATE.split('\n').map((l) => l.replace(/,/g, ';')).join('\n');
    await user.upload(inventoryPicker(), fileOf(semicolon, 'stock.csv', 'text/csv'));
    await user.click(importButtons()[0] as HTMLElement);
    const format = await screen.findByRole('heading', { name: 'Detected format' });
    expect(format).toBeInTheDocument();
    expect(document.activeElement).toBe(format);
    const group = screen.getByRole('group', { name: /What does this file contain\?/ });
    expect((within(group).getByRole('radio', { name: /Inventory/ }) as HTMLInputElement).checked).toBe(true);
    expect(within(group).getByText('Chosen by you')).toBeInTheDocument();
    expect(screen.getByText(/Semicolon/)).toBeInTheDocument();
    expect(importCsv).not.toHaveBeenCalled();
    // the per-kind card was reset
    expect(screen.queryByText(/stock\.csv \(/)).toBeInTheDocument(); // shown by the universal card
    expect(inventoryPicker().value).toBe('');
  });

  it('a Windows-1252 file sent to the inventory card is handed over and waits for the user to confirm the encoding', async () => {
    const { user, importCsv } = await setup();
    const bytes = cp1252('sku,product_name,category,warehouse,quantity,reorder_point,unit_cost\nA-1,Café table,Home,WH-DFW,3,1,9.5\n');
    await user.upload(inventoryPicker(), fileOf(bytes, 'cafe.csv', 'text/csv'));
    await user.click(importButtons()[0] as HTMLElement);
    await screen.findByRole('heading', { name: 'Detected format' });
    expect(screen.getAllByText(/Needs confirmation/).length).toBeGreaterThan(0);
    expect(importCsv).not.toHaveBeenCalled();
  });

  it('a UTF-16 file is handed over as well and can be confirmed through the universal card', async () => {
    const { user, importCsv } = await setup();
    await user.upload(inventoryPicker(), fileOf(utf16le(INV_TEMPLATE), 'utf16.csv', 'text/csv'));
    await user.click(importButtons()[0] as HTMLElement);
    await screen.findByRole('heading', { name: 'Review before importing' });
    await waitFor(() => expect(screen.getByRole('button', { name: CONFIRM_NAME })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: CONFIRM_NAME }));
    await screen.findByText(/All views are updated\./);
    const args = importCsv.mock.calls[0] as unknown[];
    expect(args).toHaveLength(2);
    expect(args[0]).toBe('inventory');
    expect((args[1] as File).name).toBe('utf16.csv');
  });

  it('a server rejection offers "Review as a different format" (400 and 422 only), and clicking it opens the universal review for that dataset', async () => {
    const importCsv = vi.fn().mockRejectedValue(new ApiError(422, 'VALIDATION_FAILED', 'The file was rejected: 1 problem(s) found. No data was changed.', [{ line: 2, column: 'ship_date', code: 'INVALID_DATE', message: 'Not a date.' }], 1));
    const { user } = await setup({ importCsv });
    await user.upload(inventoryPicker(), fileOf(INV_TEMPLATE, 'inventory-template.csv', 'text/csv'));
    await user.click(importButtons()[0] as HTMLElement);
    expect(await screen.findByText('The file was rejected: 1 problem(s) found. No data was changed.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Review as a different format' }));
    expect(await screen.findByRole('heading', { name: 'Detected format' })).toBeInTheDocument();
    expect(screen.queryByText('The file was rejected: 1 problem(s) found. No data was changed.')).not.toBeInTheDocument();
  });

  it('a network error does not offer it', async () => {
    const importCsv = vi.fn().mockRejectedValue(new ApiError(0, 'NETWORK_ERROR', 'Could not reach the server. Check that it is running and try again.'));
    const { user } = await setup({ importCsv });
    await user.upload(inventoryPicker(), fileOf(INV_TEMPLATE, 'inventory-template.csv', 'text/csv'));
    await user.click(importButtons()[0] as HTMLElement);
    await screen.findByText('Could not reach the server. Check that it is running and try again.');
    expect(screen.queryByRole('button', { name: 'Review as a different format' })).not.toBeInTheDocument();
  });

  it('a gzip file in a per-kind card says what it is and offers to review it (the registry decides the family)', async () => {
    const { user } = await setup();
    const gz = new Uint8Array([0x1f, 0x8b, 0x08, 0x00, 0, 0, 0, 0, 0, 0x03, 0x03, 0x00, 0, 0, 0, 0, 0, 0, 0, 0]);
    await user.upload(inventoryPicker(), fileOf(gz, 'stock.csv.gz', 'application/gzip'));
    await user.click(importButtons()[0] as HTMLElement);
    expect(await screen.findByText(/This looks like a Gzip-compressed file\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Review as a different format' })).toBeInTheDocument();
  });
});
