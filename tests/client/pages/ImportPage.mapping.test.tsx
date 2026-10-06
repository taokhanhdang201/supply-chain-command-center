// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ImportPage } from '../../../src/client/pages/ImportPage';
import { renderWithData } from '../../helpers/renderWithData';
import { makeSnapshot, TODAY } from '../../helpers/fixtures';

beforeEach(() => {
  window.location.hash = '';
});

const read = (p: string): string => readFileSync(resolve(process.cwd(), p), 'utf-8');
const INV_ALT = read('tests/fixtures/import/inventory_alt_schema.csv');
const INV_TEMPLATE = read('public/templates/inventory-template.csv');
const COMPANY_B = 'Item Code,Product Description,Category,Warehouse,Available Stock,ROP,Cost,Avg Usage,Lead Time\nITM-2001,Pallet Wrap Film,Packaging,WH-DFW,300,100,24.99,12,5\n';
const INV_FIELDS = ['sku', 'product_name', 'category', 'warehouse', 'quantity', 'reorder_point', 'unit_cost', 'avg_daily_usage', 'lead_time_days'];

const csvFile = (text: string, name = 'inventory_alt_schema.csv'): File => new File([text], name, { type: 'text/csv' });

const success = {
  ok: true,
  kind: 'inventory',
  rowCount: 4,
  warnings: [],
  dataSource: { kind: 'import', label: 'inventory_alt_schema.csv', loadedAt: '2026-06-15T00:00:00.000Z', rowCount: 4 }
};

async function setup(text: string, name?: string) {
  const snapshot = makeSnapshot([], [], { today: TODAY });
  const importCsv = vi.fn().mockResolvedValue(success);
  const user = userEvent.setup();
  const rendered = await renderWithData(<ImportPage />, { snapshot, api: { importCsv } });
  const file = csvFile(text, name);
  await user.upload(screen.getByLabelText('Choose inventory CSV file'), file);
  await user.click(screen.getAllByRole('button', { name: 'Import' })[0] as HTMLElement);
  return { user, importCsv, file, api: rendered.api };
}

const field = (column: string) => screen.getByLabelText(`SCC field for column ${column}`) as HTMLSelectElement;
const confirmButton = () => screen.getByRole('button', { name: 'Confirm and import' });

// Whole-page UI flows (render, parse, preview, upload). Measured: 0.2-0.5 s per test alone, up to ~1.4 s in the parallel
// full suite, and past the 5 s default only when the machine is also busy (a preview server, build and Playwright). 15 s
// as in pipelineLimits.test.ts; no assertion depends on time.
describe('ImportPage column mapping', { timeout: 15_000 }, () => {
  it('uploads a canonical file directly with no mapping panel and no map argument', async () => {
    const { importCsv, file } = await setup(INV_TEMPLATE, 'inventory-template.csv');
    await screen.findByText(/Imported 4 inventory rows/);
    expect(importCsv).toHaveBeenCalledTimes(1);
    expect(importCsv.mock.calls[0]).toHaveLength(2);
    expect(importCsv).toHaveBeenCalledWith('inventory', file);
    expect(screen.queryByText(/Map columns for/)).not.toBeInTheDocument();
  });

  it('shows the mapping panel with the suggested fields for an alt-schema file, without uploading', async () => {
    const { importCsv } = await setup(INV_ALT);
    expect(await screen.findByRole('heading', { name: 'Map columns for inventory_alt_schema.csv' })).toBeInTheDocument();
    expect(field('Material Number').value).toBe('sku');
    expect(field('Item Description').value).toBe('product_name');
    expect(field('Plant').value).toBe('warehouse');
    expect(field('On Hand Qty').value).toBe('quantity');
    expect(field('Unit Price').value).toBe('unit_cost');
    expect(field('Supplier Lead Time').value).toBe('lead_time_days');
    expect(screen.getAllByText('Mapped')).toHaveLength(9);
    expect(screen.getByText('9 of 9 columns mapped.')).toBeInTheDocument();
    expect(importCsv).not.toHaveBeenCalled();
  });

  it('uploads the unchanged file with the confirmed map, shows the success banner and refreshes', async () => {
    const { user, importCsv, file, api } = await setup(INV_ALT);
    await screen.findByText('All 4 rows pass validation.');
    await user.click(confirmButton());
    expect(importCsv).toHaveBeenCalledWith('inventory', file, INV_FIELDS);
    expect(await screen.findByText('Imported 4 inventory rows from inventory_alt_schema.csv. All views are updated.')).toBeInTheDocument();
    expect(api.getSnapshot).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/Map columns for/)).not.toBeInTheDocument();
  });

  it('keeps Confirm disabled while a column is ambiguous, and enables it once the user chooses', async () => {
    const { user, importCsv } = await setup(COMPANY_B, 'company_b.csv');
    await screen.findByRole('heading', { name: 'Map columns for company_b.csv' });
    expect(field('Cost').value).toBe('');
    expect(field('Avg Usage').value).toBe('');
    expect(screen.getAllByText('Ambiguous')).toHaveLength(2);
    expect(screen.getByText(/"Cost" has more than one possible meaning \(for example unit_cost\)\. Choose the SCC field it represents\./)).toBeInTheDocument();
    expect(confirmButton()).toBeDisabled();
    expect(screen.getByText('Resolve the highlighted columns before importing.')).toBeInTheDocument();

    await user.selectOptions(field('Cost'), 'unit_cost');
    expect(confirmButton()).toBeDisabled();
    await user.selectOptions(field('Avg Usage'), 'avg_daily_usage');
    expect(confirmButton()).toBeEnabled();
    await user.click(confirmButton());
    expect(importCsv).toHaveBeenCalledWith('inventory', expect.anything(), INV_FIELDS);
  });

  it('flags two columns mapped to the same field as Duplicate and disables Confirm', async () => {
    const { user } = await setup(INV_ALT);
    await screen.findByRole('heading', { name: /Map columns for/ });
    await user.selectOptions(field('Item Description'), 'sku');
    expect(screen.getAllByText('Duplicate')).toHaveLength(2);
    expect(screen.getAllByText('sku is also chosen for another column.')).toHaveLength(2);
    expect(confirmButton()).toBeDisabled();
  });

  it('shows Required field missing when a required column is set to Do not import', async () => {
    const { user } = await setup(INV_ALT);
    await screen.findByRole('heading', { name: /Map columns for/ });
    await user.selectOptions(field('Material Number'), '__ignore__');
    expect(screen.getByText('Required SCC fields not mapped:')).toBeInTheDocument();
    expect(screen.getByText('Required field missing')).toBeInTheDocument();
    expect(screen.getByText('Not imported')).toBeInTheDocument();
    expect(confirmButton()).toBeDisabled();
  });

  it('closes the panel on Cancel without calling the API', async () => {
    const { user, importCsv } = await setup(INV_ALT);
    await screen.findByRole('heading', { name: /Map columns for/ });
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText(/Map columns for/)).not.toBeInTheDocument();
    expect(importCsv).not.toHaveBeenCalled();
  });

  it('shows the preview error table and disables Confirm when a mapped value is invalid', async () => {
    const { importCsv } = await setup(INV_ALT.replace(',12,40,', ',twelve,40,'));
    const banner = await screen.findByText(/problem\(s\) found in the data/);
    expect(banner).toBeInTheDocument();
    const table = screen.getByRole('table', { name: 'Preview errors' });
    expect(within(table).getByText('quantity')).toBeInTheDocument();
    expect(within(table).getByText('2')).toBeInTheDocument();
    expect(confirmButton()).toBeDisabled();
    expect(screen.getByText('Fix the data problems above before importing.')).toBeInTheDocument();
    expect(importCsv).not.toHaveBeenCalled();
  });

  it('previews the data under canonical field names with the raw values', async () => {
    await setup(INV_ALT);
    const table = await screen.findByRole('table', { name: 'Mapped data preview' });
    const headers = within(table).getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual(INV_FIELDS);
    expect(within(table).getByText('Bolt, M8 x 40mm')).toBeInTheDocument();
    expect(within(table).getByText('0.18')).toBeInTheDocument();
    expect(screen.getByText('Preview (first 4 of 4 rows)')).toBeInTheDocument();
  });

  it('resets the panel when a new file is picked', async () => {
    const { user } = await setup(INV_ALT);
    await screen.findByRole('heading', { name: /Map columns for/ });
    await user.upload(screen.getByLabelText('Choose inventory CSV file'), csvFile(INV_TEMPLATE, 'other.csv'));
    expect(screen.queryByText(/Map columns for/)).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Import' })[0]).toBeEnabled();
  });

  it('gives every mapping select an accessible name and focuses the heading', async () => {
    await setup(INV_ALT);
    const heading = await screen.findByRole('heading', { name: /Map columns for/ });
    expect(heading).toHaveFocus();
    const headers = INV_ALT.split('\n')[0]!.split(',');
    for (const h of headers) expect(field(h)).toBeInTheDocument();
    expect(screen.getAllByRole('combobox')).toHaveLength(9);
  });
});
