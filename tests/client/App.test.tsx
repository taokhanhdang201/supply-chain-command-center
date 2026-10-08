// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../../src/client/App';
import type { ApiClient } from '../../src/client/api/apiClient';
import { ApiError } from '../../src/client/api/apiClient';
import { makeInventoryRecord, makeShipmentRecord, makeSnapshot, TODAY } from '../helpers/fixtures';

function makeApi(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    getSnapshot: vi.fn().mockResolvedValue(makeSnapshot([], [])),
    importCsv: vi.fn(),
    resetSampleData: vi.fn().mockResolvedValue(undefined),
    undoImport: vi.fn().mockResolvedValue(undefined),
    ...overrides
  };
}

beforeEach(() => {
  window.location.hash = '';
});

describe('App', () => {
  it('shows the loading status while the snapshot request is pending', () => {
    const api = makeApi({ getSnapshot: vi.fn(() => new Promise<never>(() => {})) });
    render(<App api={api} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('Loading data…')).toBeInTheDocument();
  });

  it('renders the dashboard heading once the snapshot resolves', async () => {
    const api = makeApi();
    render(<App api={api} />);
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
  });

  it('shows an error state on failure, and Retry recovers after a successful refetch', async () => {
    const getSnapshot = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(0, 'NETWORK_ERROR', 'Could not reach the server. Check that it is running and try again.'))
      .mockResolvedValueOnce(makeSnapshot([], []));
    const api = makeApi({ getSnapshot });
    const user = userEvent.setup();
    render(<App api={api} />);

    expect(await screen.findByText('Could not load data')).toBeInTheDocument();
    expect(screen.getByText(/could not reach the server/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(getSnapshot).toHaveBeenCalledTimes(2);
  });

  it('navigating via the sidebar changes the heading and aria-current', async () => {
    const api = makeApi();
    const user = userEvent.setup();
    render(<App api={api} />);
    await screen.findByRole('heading', { name: 'Dashboard' });

    const nav = screen.getByRole('navigation', { name: 'Main' });
    const dashboardLink = within(nav).getByRole('link', { name: /dashboard/i });
    const inventoryLink = within(nav).getByRole('link', { name: /inventory/i });
    expect(dashboardLink).toHaveAttribute('aria-current', 'page');
    expect(inventoryLink).not.toHaveAttribute('aria-current');

    await user.click(inventoryLink);
    expect(await screen.findByRole('heading', { name: 'Inventory' })).toBeInTheDocument();
    expect(inventoryLink).toHaveAttribute('aria-current', 'page');
    expect(dashboardLink).not.toHaveAttribute('aria-current');
  });

  it('names the document after the page and moves focus to its h1 on a route change', async () => {
    const api = makeApi();
    const user = userEvent.setup();
    render(<App api={api} />);
    await screen.findByRole('heading', { name: 'Dashboard' });
    expect(document.title).toBe('Dashboard · Supply Chain Command Center');

    await user.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name: /inventory/i }));
    const h1 = await screen.findByRole('heading', { level: 1, name: 'Inventory' });
    expect(document.title).toBe('Inventory · Supply Chain Command Center');
    await waitFor(() => expect(h1).toHaveFocus());
  });

  it('shows the Not found page for an unknown hash', async () => {
    window.location.hash = '#/nope';
    const api = makeApi();
    render(<App api={api} />);
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });

  // Phase 1 spec §10: a development build (Vitest runs with import.meta.env.DEV) answers #/_design with the design reference,
  // loaded on demand; it is no route, so a production build reads the hash as "Page not found"
  // (tests/tester/designPage.browser.test.ts).
  it('opens the design reference at #/_design in a development build', async () => {
    expect(import.meta.env.DEV).toBe(true);
    window.location.hash = '#/_design';
    render(<App api={makeApi()} />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Design system' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Page not found' })).toBeNull();
  });

  it('toggles the mobile menu with aria-expanded, and Escape closes it', async () => {
    const api = makeApi();
    const user = userEvent.setup();
    render(<App api={api} />);
    await screen.findByRole('heading', { name: 'Dashboard' });

    const toggle = screen.getByRole('button', { name: /open navigation/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await user.click(toggle);
    expect(screen.getByRole('button', { name: /close navigation/i })).toHaveAttribute('aria-expanded', 'true');

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /open navigation/i })).toHaveAttribute('aria-expanded', 'false');
    });
  });

  it('shows the alert badge with the critical + warning count', async () => {
    const inventory = [makeInventoryRecord({ quantity: 0 })]; // out of stock -> 1 critical low_stock alert
    const shipments = [makeShipmentRecord()];
    const snapshot = makeSnapshot(inventory, shipments, { today: TODAY });
    const api = makeApi({ getSnapshot: vi.fn().mockResolvedValue(snapshot) });
    render(<App api={api} />);
    await screen.findByRole('heading', { name: 'Dashboard' });

    expect(screen.getByLabelText('Alerts, 1 need attention')).toBeInTheDocument();
  });
});
