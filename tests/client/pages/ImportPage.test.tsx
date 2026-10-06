// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ImportPage } from '../../../src/client/pages/ImportPage';
import { renderWithData } from '../../helpers/renderWithData';
import { makeSnapshot, TODAY } from '../../helpers/fixtures';
import { ApiError } from '../../../src/client/api/apiClient';

beforeEach(() => {
  window.location.hash = '';
});

function file(name: string, size: number, type = 'text/csv'): File {
  return new File([new Uint8Array(size)], name, { type });
}

describe('ImportPage', () => {
  it('rejects a non-.csv file client-side without calling the API', async () => {
    const snapshot = makeSnapshot([], [], { today: TODAY });
    const importCsv = vi.fn();
    const user = userEvent.setup({ applyAccept: false });
    await renderWithData(<ImportPage />, { snapshot, api: { importCsv } });

    const input = screen.getByLabelText('Choose inventory CSV file');
    await user.upload(input, file('data.xlsx', 100, 'application/vnd.ms-excel'));
    await user.click(screen.getAllByRole('button', { name: 'Import' })[0] as HTMLElement);

    expect(screen.getByText('This looks like a binary file. SCC cannot import that type. SCC reads text files (CSV, TSV and plain text). You can import: Delimited text (.csv, .tsv, .txt), Gzip-compressed file (.gz). Export the data in one of those formats.')).toBeInTheDocument();
    expect(importCsv).not.toHaveBeenCalled();
  });

  it('rejects a 0-byte file client-side', async () => {
    const snapshot = makeSnapshot([], [], { today: TODAY });
    const importCsv = vi.fn();
    const user = userEvent.setup();
    await renderWithData(<ImportPage />, { snapshot, api: { importCsv } });

    await user.upload(screen.getByLabelText('Choose inventory CSV file'), file('empty.csv', 0));
    await user.click(screen.getAllByRole('button', { name: 'Import' })[0] as HTMLElement);

    expect(screen.getByText('The file is empty.')).toBeInTheDocument();
    expect(importCsv).not.toHaveBeenCalled();
  });

  it('rejects an oversize file client-side using the snapshot upload limit', async () => {
    const snapshot = makeSnapshot([], [], { today: TODAY });
    snapshot.limits.maxUploadBytes = 1024;
    const importCsv = vi.fn();
    const user = userEvent.setup();
    await renderWithData(<ImportPage />, { snapshot, api: { importCsv } });

    await user.upload(screen.getByLabelText('Choose inventory CSV file'), file('big.csv', 2048));
    await user.click(screen.getAllByRole('button', { name: 'Import' })[0] as HTMLElement);

    expect(screen.getByText('File is 0.0 MB; the limit is 0.0 MB.')).toBeInTheDocument();
    expect(importCsv).not.toHaveBeenCalled();
  });

  it('shows a success banner with row count and warnings, then refreshes', async () => {
    const snapshot = makeSnapshot([], [], { today: TODAY });
    const importCsv = vi.fn().mockResolvedValue({
      ok: true,
      kind: 'inventory',
      rowCount: 10,
      warnings: ['Column lead_time_days not present; the default of 14 days is used.'],
      dataSource: { kind: 'import', label: 'stock.csv', loadedAt: '2026-06-15T00:00:00.000Z', rowCount: 10 }
    });
    const getSnapshot = vi.fn().mockResolvedValue(snapshot);
    const user = userEvent.setup();
    await renderWithData(<ImportPage />, { snapshot, api: { importCsv, getSnapshot } });

    await user.upload(screen.getByLabelText('Choose inventory CSV file'), file('stock.csv', 100));
    await user.click(screen.getAllByRole('button', { name: 'Import' })[0] as HTMLElement);

    expect(await screen.findByText('Imported 10 inventory rows from stock.csv. All views are updated.')).toBeInTheDocument();
    expect(screen.getByText('Column lead_time_days not present; the default of 14 days is used.')).toBeInTheDocument();
    expect(getSnapshot).toHaveBeenCalledTimes(2); // initial load + refresh() after import
  });

  it('shows the server validation error table on a 422, including the truncation note', async () => {
    const snapshot = makeSnapshot([], [], { today: TODAY });
    const importCsv = vi.fn().mockRejectedValue(
      new ApiError(
        422,
        'VALIDATION_FAILED',
        'The file was rejected: 502 problem(s) found. No data was changed.',
        [
          { line: 3, column: 'sku', code: 'REQUIRED', message: 'Value is required.' },
          { line: null, column: null, code: 'MISSING_COLUMNS', message: 'Missing required column(s): sku.' }
        ],
        502
      )
    );
    const user = userEvent.setup();
    await renderWithData(<ImportPage />, { snapshot, api: { importCsv } });

    await user.upload(screen.getByLabelText('Choose inventory CSV file'), file('bad.csv', 100));
    await user.click(screen.getAllByRole('button', { name: 'Import' })[0] as HTMLElement);

    expect(await screen.findByText('The file was rejected: 502 problem(s) found. No data was changed.')).toBeInTheDocument();
    expect(screen.getByText('Value is required.')).toBeInTheDocument();
    expect(screen.getByText('File')).toBeInTheDocument(); // null line -> "File"
    expect(screen.getByText('Showing first 500 of 502 problems.')).toBeInTheDocument();
  });

  it('shows a banner for a network error', async () => {
    const snapshot = makeSnapshot([], [], { today: TODAY });
    const importCsv = vi.fn().mockRejectedValue(new ApiError(0, 'NETWORK_ERROR', 'Could not reach the server. Check that it is running and try again.'));
    const user = userEvent.setup();
    await renderWithData(<ImportPage />, { snapshot, api: { importCsv } });

    await user.upload(screen.getByLabelText('Choose inventory CSV file'), file('data.csv', 100));
    await user.click(screen.getAllByRole('button', { name: 'Import' })[0] as HTMLElement);

    expect(await screen.findByText('Could not reach the server. Check that it is running and try again.')).toBeInTheDocument();
  });

  it('disables the Import button and shows "Importing…" while the request is pending', async () => {
    const snapshot = makeSnapshot([], [], { today: TODAY });
    let resolveImport!: (v: unknown) => void;
    const importCsv = vi.fn().mockReturnValue(new Promise((resolve) => (resolveImport = resolve)));
    const user = userEvent.setup();
    await renderWithData(<ImportPage />, { snapshot, api: { importCsv } });

    await user.upload(screen.getByLabelText('Choose inventory CSV file'), file('data.csv', 100));
    const button = screen.getAllByRole('button', { name: 'Import' })[0] as HTMLElement;
    await user.click(button);

    expect(await screen.findByRole('button', { name: 'Importing…' })).toBeDisabled();

    resolveImport({
      ok: true,
      kind: 'inventory',
      rowCount: 1,
      warnings: [],
      dataSource: { kind: 'import', label: 'data.csv', loadedAt: '2026-06-15T00:00:00.000Z', rowCount: 1 }
    });
    expect(await screen.findByText(/Imported 1 inventory rows/)).toBeInTheDocument();
  });

  it('requires confirmation before restoring sample data, and calls resetSampleData on confirm', async () => {
    const snapshot = makeSnapshot([], [], { today: TODAY });
    const resetSampleData = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    await renderWithData(<ImportPage />, { snapshot, api: { resetSampleData } });

    await user.click(screen.getByRole('button', { name: 'Restore sample data' }));
    expect(screen.getByText('This replaces all current inventory and shipment data with generated sample data.')).toBeInTheDocument();
    expect(resetSampleData).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('This replaces all current inventory and shipment data with generated sample data.')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Restore sample data' }));
    await user.click(screen.getByRole('button', { name: 'Replace data' }));
    expect(resetSampleData).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Sample data restored.')).toBeInTheDocument();
  });
});
