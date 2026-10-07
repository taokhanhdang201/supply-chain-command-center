// @vitest-environment jsdom
// Data Import presentation (G1): the page opens on one drop area (no stage figures, no step bar: approved in G0 §4, the
// top bar already names each source), the column reference is a stacked table under More, and the sample source reads
// "Sample data (seed 7)" in the top bar (it used to be read on the removed "Current data sources" figures).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { ImportPage } from '../../../src/client/pages/ImportPage';
import { Topbar } from '../../../src/client/components/layout/Topbar';
import { renderWithData } from '../../helpers/renderWithData';
import { makeInventoryRecord, makeShipmentRecord, makeSnapshot, TODAY } from '../../helpers/fixtures';

beforeEach(() => {
  window.location.hash = '';
});

describe('ImportPage: presentation', () => {
  it('drops the slogan and the current-data figures: the page title, then the drop area', async () => {
    const snapshot = makeSnapshot([makeInventoryRecord(), makeInventoryRecord()], [makeShipmentRecord()], { today: TODAY });
    await renderWithData(<ImportPage />, { snapshot });
    expect(screen.getByRole('heading', { level: 1, name: 'Data Import' })).toBeInTheDocument();
    expect(document.querySelector('.page-stage__display')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Current data sources' })).toBeNull();
    expect(document.querySelector('.stage-figure')).toBeNull();
    expect(screen.getByText('Drop your file')).toBeInTheDocument();
  });

  it('has no step bar: the waiting state is one sentence, one line, one main button and one small link', async () => {
    await renderWithData(<ImportPage />, { snapshot: makeSnapshot([], [], { today: TODAY }) });
    expect(screen.queryByRole('list', { name: 'How importing works' })).toBeNull();
    expect(screen.queryByRole('list', { name: 'Import steps' })).toBeNull();
    const drop = screen.getByText('Drop your file').closest('label') as HTMLElement;
    expect(within(drop).getByText('CSV, TSV, TXT or GZ file. Up to 2 MB.')).toBeInTheDocument();
    expect(within(drop).getByText('Choose a file')).toHaveClass('button--primary');
    expect(screen.getByRole('button', { name: 'No file? Try one.' })).toHaveClass('ingest-link');
    // everything else waits under More, closed
    expect((screen.getByText('More').closest('details') as HTMLDetailsElement).open).toBe(false);
  });

  it('keeps the Column guide closed by default, with Inventory and Shipments tabs', async () => {
    await renderWithData(<ImportPage />, { snapshot: makeSnapshot([], [], { today: TODAY }) });
    const guide = screen.getByText('Column guide').closest('details') as HTMLDetailsElement;
    expect(guide.open).toBe(false);
    const tabs = within(guide).getAllByRole('tab');
    expect(tabs.map((t) => [t.textContent, t.getAttribute('aria-selected')])).toEqual([
      ['Inventory', 'true'],
      ['Shipments', 'false']
    ]);
    // the per-kind upload of each dataset sits in its tab, with its unchanged label
    expect(within(guide).getByLabelText('Choose inventory CSV file')).toBeInTheDocument();
    expect(within(guide).getByLabelText('Choose shipments CSV file')).toBeInTheDocument();
  });

  it('shows a sample data source as "Sample data (seed 7)" in the top bar', () => {
    const snapshot = makeSnapshot([makeInventoryRecord()], [], { today: TODAY });
    snapshot.dataSources.shipments = { kind: 'import', label: 'sample-shipments-seed-7.csv', loadedAt: '2026-06-15T00:00:00.000Z', rowCount: 480 };
    render(<Topbar title="Data Import" today={TODAY} dataSources={snapshot.dataSources} refreshing={false} onRefresh={vi.fn()} drawerOpen={false} onMenuClick={vi.fn()} menuButtonRef={{ current: null }} />);
    expect(screen.getByText('Shipments: Sample data (seed 7)')).toBeInTheDocument();
    expect(screen.getByText(`Inventory: ${snapshot.dataSources.inventory.label}`)).toBeInTheDocument(); // any other label is shown as is
  });

  it('lists each column reference as a stacked table with explicit roles and labelled values', async () => {
    await renderWithData(<ImportPage />, { snapshot: makeSnapshot([], [], { today: TODAY }) });
    for (const name of ['Inventory column reference', 'Shipments column reference']) {
      const table = screen.getByRole('table', { name });
      expect(table).toHaveClass('data-table--stack');
      expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Column', 'Required', 'Format', 'Example']);
      const first = table.querySelector('tbody tr') as HTMLElement;
      expect(first.querySelector('td.data-table__col--example .data-table__phone-label')).toHaveTextContent('Example');
    }
    expect(within(screen.getByRole('table', { name: 'Inventory column reference' })).getByText('sku')).toBeInTheDocument();
  });
});
