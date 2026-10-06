// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DashboardPage } from '../../../src/client/pages/DashboardPage';
import { renderWithData } from '../../helpers/renderWithData';
import { makeInventoryRecord, makeShipmentRecord, makeSnapshot, TODAY } from '../../helpers/fixtures';

beforeEach(() => {
  window.location.hash = '';
});

describe('DashboardPage', () => {
  it('renders KPI cards with data derived from the snapshot', async () => {
    const inventory = [makeInventoryRecord({ quantity: 0 })]; // out of stock -> low-stock KPI + critical alert
    const shipments = [makeShipmentRecord()];
    const snapshot = makeSnapshot(inventory, shipments, { today: TODAY });
    await renderWithData(<DashboardPage />, { snapshot });

    expect(screen.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('Total inventory value')).toBeInTheDocument();
    expect(screen.getByText('Low-stock items')).toBeInTheDocument();
    expect(screen.getByText('Alerts needing attention')).toBeInTheDocument();
  });

  it('shows an empty-chart message when there is no shipment data', async () => {
    const snapshot = makeSnapshot([], [], { today: TODAY });
    await renderWithData(<DashboardPage />, { snapshot });
    expect(screen.getAllByText('No data for the selected range').length).toBeGreaterThan(0);
  });

  it('shows recent shipment activity and links to alerts from the panel', async () => {
    const shipments = [makeShipmentRecord({ shipmentId: 'SHP-100001' })];
    const snapshot = makeSnapshot([], shipments, { today: TODAY });
    await renderWithData(<DashboardPage />, { snapshot });
    expect(screen.getByText('SHP-100001')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View all alerts' })).toHaveAttribute('href', '#/alerts');
  });

  it('changes the chart range via the Range select', async () => {
    const snapshot = makeSnapshot([], [makeShipmentRecord()], { today: TODAY });
    const user = userEvent.setup();
    await renderWithData(<DashboardPage />, { snapshot });

    const rangeSelect = screen.getByRole('combobox', { name: 'Range' });
    expect(rangeSelect).toHaveValue('180d');
    await user.selectOptions(rangeSelect, '30d');
    expect(rangeSelect).toHaveValue('30d');
  });
});
