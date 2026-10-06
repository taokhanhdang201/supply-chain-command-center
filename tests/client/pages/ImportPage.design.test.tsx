// @vitest-environment jsdom
// Data Import presentation: the stage shows the current data as figures, the column reference is a stacked table, and
// the import flow (five steps) and its controls are unchanged.
import { describe, it, expect, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import { ImportPage } from '../../../src/client/pages/ImportPage';
import { renderWithData } from '../../helpers/renderWithData';
import { makeInventoryRecord, makeShipmentRecord, makeSnapshot, TODAY } from '../../helpers/fixtures';

beforeEach(() => {
  window.location.hash = '';
});

describe('ImportPage: presentation', () => {
  it('drops the slogan and shows the current data sources as row figures with source and load time', async () => {
    const snapshot = makeSnapshot([makeInventoryRecord(), makeInventoryRecord()], [makeShipmentRecord()], { today: TODAY });
    await renderWithData(<ImportPage />, { snapshot });
    expect(screen.getByRole('heading', { level: 1, name: 'Data Import' })).toBeInTheDocument();
    expect(document.querySelector('.page-stage__display')).toBeNull();
    const sources = screen.getByRole('region', { name: 'Current data sources' });
    const figures = within(sources).getAllByRole('listitem');
    expect(figures.map((f) => f.querySelector('.stage-figure__value')?.textContent)).toEqual(['2', '1']);
    expect(figures.map((f) => f.querySelector('.stage-figure__label')?.textContent)).toEqual(['Inventory rows', 'Shipment rows']);
    for (const f of figures) expect(f).toHaveTextContent(/loaded /);
  });

  it('drops the 01-05 list from the stage; the card shows four steps in sentence case, the first one current', async () => {
    await renderWithData(<ImportPage />, { snapshot: makeSnapshot([], [], { today: TODAY }) });
    expect(screen.queryByRole('list', { name: 'How importing works' })).toBeNull();
    const steps = screen.getByRole('list', { name: 'Import steps' });
    expect(within(steps).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Choose file', 'Columns', 'Preview', 'Import']);
    expect(within(steps).getByText('Choose file')).toHaveAttribute('aria-current', 'step');
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

  it('shows a sample data source as "Sample data (seed 7)"', async () => {
    const snapshot = makeSnapshot([makeInventoryRecord()], [], { today: TODAY });
    snapshot.dataSources.shipments = { kind: 'import', label: 'sample-shipments-seed-7.csv', loadedAt: '2026-06-15T00:00:00.000Z', rowCount: 480 };
    await renderWithData(<ImportPage />, { snapshot });
    const sources = screen.getByRole('region', { name: 'Current data sources' });
    expect(within(sources).getByText('Sample data (seed 7)')).toBeInTheDocument();
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
