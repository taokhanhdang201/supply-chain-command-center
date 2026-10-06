// @vitest-environment jsdom
// The demo flow on the Import page: "Try a sample" builds a file in the browser and the single import card takes it
// through Columns and Preview to the import; the sample with errors is blocked with its problems grouped by column;
// "Restore sample data" asks for confirmation first.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ImportPage } from '../../../src/client/pages/ImportPage';
import { renderWithData } from '../../helpers/renderWithData';
import { makeSnapshot, TODAY } from '../../helpers/fixtures';
import { generateSampleData } from '../../../src/shared/sample/generateSampleData';
import { CONFIRM_NAME, settled } from '../ingest/uiHarness';
import type { ImportKind } from '../../../src/shared/types';

beforeEach(() => {
  window.location.hash = '';
});

const seed7 = generateSampleData({ seed: 7, today: TODAY });

async function setup() {
  const snapshot = makeSnapshot([], [], { today: TODAY });
  snapshot.dataSources.shipments.rowCount = 480;
  snapshot.dataSources.inventory.rowCount = 360;
  const importCsv = vi.fn().mockImplementation(async (kind: ImportKind, file: File) => {
    const rowCount = kind === 'shipments' ? seed7.shipments.length : seed7.inventory.length;
    return { ok: true, kind, rowCount, warnings: [], dataSource: { kind: 'import', label: file.name, loadedAt: '2026-06-15T00:00:00.000Z', rowCount } };
  });
  const resetSampleData = vi.fn().mockResolvedValue(undefined);
  const user = userEvent.setup();
  await renderWithData(<ImportPage />, { snapshot, api: { importCsv, resetSampleData } });
  return { user, importCsv, resetSampleData };
}

async function trySample(user: ReturnType<typeof userEvent.setup>, name: RegExp): Promise<void> {
  await user.click(screen.getByText('Try a sample'));
  await user.click(screen.getByRole('button', { name }));
  await screen.findByRole('heading', { name: 'Review before importing' });
  await settled();
}

const currentStep = (): string | null => screen.getByRole('list', { name: 'Import steps' }).querySelector('[aria-current="step"]')?.textContent ?? null;

describe('demo flow: Try a sample', { timeout: 20_000 }, () => {
  it('offers three samples in a small menu under the drop area, next to templates and paste', async () => {
    await setup();
    const links = document.querySelector('.ingest-links') as HTMLElement;
    expect(within(links).getByText('Try a sample')).toBeInTheDocument();
    expect(within(links).getByText('Download templates')).toBeInTheDocument();
    expect(within(links).getByRole('button', { name: /Paste data instead/ })).toBeInTheDocument();
    expect(within(links).getAllByRole('button', { name: /sample/i }).map((b) => b.querySelector('.ingest-menu__label')?.textContent)).toEqual([
      'Shipments sample',
      'Inventory sample',
      'Sample with errors'
    ]);
  });

  it('the shipments sample goes through to the import: every column matched, a one-line preview, "Import N shipments"', async () => {
    const { user, importCsv } = await setup();
    await trySample(user, /^Shipments sample/);
    const n = seed7.shipments.length;
    expect(currentStep()).toBe('Preview');
    expect(screen.getByText('All 9 columns matched.')).toBeInTheDocument();
    expect(screen.getByText(`${n} rows · 0 errors · replaces 480 current shipments`)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'First 5 rows' })).toBeInTheDocument();
    const button = screen.getByRole('button', { name: CONFIRM_NAME });
    expect(button).toHaveTextContent(`Import ${n} shipments`);
    expect(button).toBeEnabled();
    await user.click(button);
    await screen.findByText(/All views are updated\./);
    expect(importCsv).toHaveBeenCalledTimes(1);
    expect(importCsv.mock.calls[0]?.[0]).toBe('shipments');
    expect((importCsv.mock.calls[0]?.[1] as File).name).toBe('sample-shipments-seed-7.csv');
    expect(currentStep()).toBe('Import');
    expect(screen.getByRole('link', { name: 'View shipments' })).toHaveAttribute('href', '#/shipments');
    expect(screen.getByRole('link', { name: 'Back to dashboard' })).toHaveAttribute('href', '#/');
    expect(screen.getByRole('button', { name: 'Start over' })).toBeInTheDocument();
  });

  it('the inventory sample goes through to the import as well, with a link to the inventory', async () => {
    const { user, importCsv } = await setup();
    await trySample(user, /^Inventory sample/);
    const n = seed7.inventory.length;
    expect(screen.getByText(`${n} rows · 0 errors · replaces 360 current inventory items`)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: `Import ${n} inventory items` }));
    await screen.findByText(/All views are updated\./);
    expect(importCsv.mock.calls[0]?.[0]).toBe('inventory');
    expect((importCsv.mock.calls[0]?.[1] as File).name).toBe('sample-inventory-seed-7.csv');
    expect(screen.getByRole('link', { name: 'View inventory' })).toHaveAttribute('href', '#/inventory');
  });

  it('the sample with errors locks the import and groups the problems by column, with a short fix each', async () => {
    const { user, importCsv } = await setup();
    await trySample(user, /^Sample with errors/);
    expect(screen.getByText('20 rows · 7 errors · replaces 480 current shipments')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import 20 shipments' })).toBeDisabled();
    const groups = [...document.querySelectorAll('.ingest-error-groups > li')].map((li) => li.querySelector('.ingest-error-groups__where')?.textContent);
    expect(groups).toEqual(['ship_date: 3 rows, lines 5, 10, 16', 'shipment_id: 2 rows, lines 7, 13', 'shipping_cost: 2 rows, lines 12, 19']);
    const hints = [...document.querySelectorAll('.ingest-error-groups__hint')].map((h) => h.textContent);
    expect(hints[0]).toMatch(/^Use YYYY-MM-DD/);
    expect(hints[2]).toBe('Fill in a value in every row.');
    // errors are red (critical); nothing was sent
    expect(document.querySelector('.ingest-error-groups')?.closest('.banner')).toHaveClass('banner--critical');
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
