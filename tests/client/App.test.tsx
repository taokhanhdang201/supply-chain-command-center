// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../../src/client/App';
import type { ApiClient } from '../../src/client/api/apiClient';
import { ApiError } from '../../src/client/api/apiClient';
import { makeInventoryRecord, makeShipmentRecord, makeSnapshot, TODAY } from '../helpers/fixtures';
import type { Snapshot } from '../../src/shared/types';

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

  // A development build (Vitest runs with import.meta.env.DEV) answers #/_design with the design reference,
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
    // The menu button; the drawer's own Close navigation button has no aria-expanded.
    expect(screen.getByRole('button', { name: /close navigation/i, expanded: true })).toHaveAttribute('aria-controls', 'sidebar');

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /open navigation/i })).toHaveAttribute('aria-expanded', 'false');
    });
  });

  // WCAG 2.4.3 / 2.4.11: while the drawer is open the rest of the shell (the top bar, the page) and the skip link are
  // inert, so Tab cannot leave the drawer for what it covers (real focus: tests/tester/a11yFoundation.browser.test.ts).
  it('makes the rest of the shell inert while the drawer is open; Escape gives the focus back to the menu button', async () => {
    const user = userEvent.setup();
    render(<App api={makeApi()} />);
    await screen.findByRole('heading', { name: 'Dashboard' });
    const content = document.querySelector('.app-shell__content') as HTMLElement;
    const skip = document.querySelector('.skip-link') as HTMLElement;
    expect(content).not.toHaveAttribute('inert');
    await user.click(screen.getByRole('button', { name: /open navigation/i }));
    expect(content).toHaveAttribute('inert');
    expect(skip).toHaveAttribute('inert');
    expect(document.getElementById('sidebar')).not.toHaveAttribute('inert');
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(content).not.toHaveAttribute('inert'));
    expect(skip).not.toHaveAttribute('inert');
    expect(screen.getByRole('button', { name: /open navigation/i })).toHaveFocus();
  });

  // From 1024px the sidebar is fixed; a drawer left open while the window widens closes, so the shell is not left inert.
  it('closes a drawer left open when the window reaches 1024px', async () => {
    let onWide: (() => void) | undefined;
    const wide = { matches: false, addEventListener: (_: string, l: () => void) => { onWide = l; }, removeEventListener: () => undefined };
    const reduce = { matches: true, addEventListener: () => undefined, removeEventListener: () => undefined };
    vi.stubGlobal('matchMedia', (query: string) => (query === '(min-width: 1024px)' ? wide : reduce));
    try {
      const user = userEvent.setup();
      render(<App api={makeApi()} />);
      await screen.findByRole('heading', { name: 'Dashboard' });
      await user.click(screen.getByRole('button', { name: /open navigation/i }));
      expect(document.querySelector('.app-shell__content')).toHaveAttribute('inert');
      wide.matches = true;
      act(() => onWide?.());
      expect(screen.getByRole('button', { name: /open navigation/i })).toHaveAttribute('aria-expanded', 'false');
      expect(document.querySelector('.app-shell__content')).not.toHaveAttribute('inert');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  // The skip link moves the focus itself only on a plain click or Enter; a click with a modifier key
  // or another button is the browser's (a new tab or window).
  it('leaves a click on the skip link with a modifier key or another button to the browser', async () => {
    render(<App api={makeApi()} />);
    const h1 = await screen.findByRole('heading', { level: 1, name: 'Dashboard' });
    const link = screen.getByRole('link', { name: 'Skip to main content' });
    const taken: boolean[] = [];
    // runs after React's handler: note whether it took the click, then keep jsdom from following "#main"
    const after = (e: MouseEvent) => {
      taken.push(e.defaultPrevented);
      e.preventDefault();
    };
    window.addEventListener('click', after);
    try {
      h1.blur();
      for (const init of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) fireEvent.click(link, init);
      expect(h1).not.toHaveFocus();
      fireEvent.click(link);
      expect(taken).toEqual([false, false, false, false, false, true]);
      expect(h1).toHaveFocus();
    } finally {
      window.removeEventListener('click', after);
    }
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

// ---- The sidebar's foot and Close navigation, the drawer on a route change, and the "Someone imported a file." banner ----

const IMPORTED = { kind: 'import' as const, label: 'carrier-export.csv', loadedAt: '2026-06-15T00:00:00.000Z', rowCount: 480 };
/** The snapshot with one or both sources a file (in a mixed pair the other source stays the sample). */
function imported(which: 'both' | 'inventory' | 'shipments' = 'both'): Snapshot {
  const base = makeSnapshot([makeInventoryRecord({ quantity: 0 })], [makeShipmentRecord()], { today: TODAY });
  const { inventory, shipments } = base.dataSources;
  return {
    ...base,
    dataSources: {
      inventory: which === 'shipments' ? inventory : { ...IMPORTED, label: 'stock.csv' },
      shipments: which === 'inventory' ? shipments : IMPORTED
    }
  };
}
const sample = (): Snapshot => makeSnapshot([makeInventoryRecord({ quantity: 0 })], [makeShipmentRecord()], { today: TODAY });
const apiError = () => new ApiError(0, 'NETWORK_ERROR', 'Could not reach the server. Check that it is running and try again.');
const banner = () => screen.queryByRole('region', { name: 'Someone imported a file.' });
const politeWords = () => (document.querySelector('.topbar__actions [aria-live="polite"]') as HTMLElement).textContent;
const menuButton = () => document.querySelector('button[aria-controls="sidebar"]') as HTMLButtonElement;

describe('App: the drawer and the sidebar', () => {
  it('gives the drawer its own Close navigation button, which closes it and gives the focus back to the menu button', async () => {
    const user = userEvent.setup();
    render(<App api={makeApi()} />);
    await screen.findByRole('heading', { name: 'Dashboard' });
    await user.click(menuButton());
    const sidebar = document.getElementById('sidebar') as HTMLElement;
    expect(sidebar).toHaveClass('is-open');
    const close = within(sidebar).getByRole('button', { name: 'Close navigation' });
    // not a second menu button: it names nothing to control and has no state of its own
    expect(close).not.toHaveAttribute('aria-controls');
    expect(close).not.toHaveAttribute('aria-expanded');
    expect(document.querySelectorAll('button[aria-controls="sidebar"]')).toHaveLength(1);
    await user.click(close);
    expect(sidebar).not.toHaveClass('is-open');
    expect(document.querySelector('.app-shell__content')).not.toHaveAttribute('inert');
    expect(menuButton()).toHaveFocus();
  });

  it('closes with Enter on the Close navigation button too', async () => {
    const user = userEvent.setup();
    render(<App api={makeApi()} />);
    await screen.findByRole('heading', { name: 'Dashboard' });
    await user.click(menuButton());
    within(document.getElementById('sidebar') as HTMLElement).getByRole('button', { name: 'Close navigation' }).focus();
    await user.keyboard('{Enter}');
    expect(document.getElementById('sidebar')).not.toHaveClass('is-open');
    expect(menuButton()).toHaveFocus();
  });

  // Back (TalkBack's back gesture) changes the route under an open drawer: it closes, and the new page's h1 takes the focus.
  it('closes an open drawer when the route changes (Back), focuses the new h1 and logs nothing', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const warnings = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const user = userEvent.setup();
    render(<App api={makeApi()} />);
    await screen.findByRole('heading', { name: 'Dashboard' });
    await user.click(menuButton());
    expect(document.querySelector('.app-shell__content')).toHaveAttribute('inert');
    window.location.hash = '#/inventory';
    const h1 = await screen.findByRole('heading', { level: 1, name: 'Inventory' });
    await waitFor(() => expect(h1).toHaveFocus());
    expect(document.getElementById('sidebar')).not.toHaveClass('is-open');
    expect(document.querySelector('.app-shell__content')).not.toHaveAttribute('inert');
    expect(menuButton()).toHaveAttribute('aria-expanded', 'false');
    expect(errors).not.toHaveBeenCalled();
    expect(warnings).not.toHaveBeenCalled();
  });

  it("a link to another page closes the drawer and focuses that page's h1", async () => {
    const user = userEvent.setup();
    render(<App api={makeApi()} />);
    await screen.findByRole('heading', { name: 'Dashboard' });
    await user.click(menuButton());
    await user.click(within(document.getElementById('sidebar') as HTMLElement).getByRole('link', { name: 'Inventory' }));
    const h1 = await screen.findByRole('heading', { level: 1, name: 'Inventory' });
    await waitFor(() => expect(h1).toHaveFocus());
    expect(document.getElementById('sidebar')).not.toHaveClass('is-open');
  });

  // The link of the page already open changes no route, so no h1 takes the focus; it goes to the menu button, not to a link the closed drawer hides.
  it('the link of the open page closes the drawer and puts the focus on the menu button', async () => {
    const user = userEvent.setup();
    render(<App api={makeApi()} />);
    await screen.findByRole('heading', { name: 'Dashboard' });
    await user.click(menuButton());
    const link = within(document.getElementById('sidebar') as HTMLElement).getByRole('link', { name: 'Dashboard' });
    expect(link).toHaveAttribute('aria-current', 'page');
    await user.click(link);
    expect(document.getElementById('sidebar')).not.toHaveClass('is-open');
    expect(document.querySelector('.app-shell__content')).not.toHaveAttribute('inert');
    expect(menuButton()).toHaveFocus();
  });

  it('with no drawer (1024px and up) the link of the open page leaves the focus on the link', async () => {
    const user = userEvent.setup();
    render(<App api={makeApi()} />);
    await screen.findByRole('heading', { name: 'Dashboard' });
    const link = within(document.getElementById('sidebar') as HTMLElement).getByRole('link', { name: 'Dashboard' });
    await user.click(link);
    expect(link).toHaveFocus();
    expect(menuButton()).not.toHaveFocus();
  });

  it('keeps Dashboard first and standing alone, and groups the rest as Operations, Insights and Data', async () => {
    render(<App api={makeApi()} />);
    await screen.findByRole('heading', { name: 'Dashboard' });
    expect([...document.querySelectorAll('.sidebar__group-label')].map((n) => n.textContent)).toEqual(['Operations', 'Insights', 'Data']);
    expect(document.querySelector('#sidebar a')).toHaveTextContent('Dashboard');
    expect(screen.queryByText('Overview')).toBeNull();
  });

  it('credits the author at the foot, with two links that open in a new tab and name that in their label', async () => {
    render(<App api={makeApi()} />);
    await screen.findByRole('heading', { name: 'Dashboard' });
    const footer = document.querySelector('#sidebar .sidebar__footer') as HTMLElement;
    expect(footer).toHaveTextContent('Built by Đăng Tạo');
    const links = [...footer.querySelectorAll('a')];
    expect(links.map((a) => [a.getAttribute('href'), a.getAttribute('target'), a.getAttribute('rel'), a.getAttribute('aria-label')])).toEqual([
      ['https://www.linkedin.com/in/dangtao-scm', '_blank', 'noopener noreferrer', "LinkedIn: Đăng Tạo's profile (opens in a new tab)"],
      ['https://github.com/taokhanhdang201/supply-chain-command-center', '_blank', 'noopener noreferrer', 'GitHub: SCC source code (opens in a new tab)']
    ]);
    for (const a of links) expect(a.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('App: the "Someone imported a file." banner', () => {
  it('shows no banner while both sources are the sample', async () => {
    render(<App api={makeApi({ getSnapshot: vi.fn().mockResolvedValue(sample()) })} />);
    await screen.findByRole('heading', { name: 'Dashboard' });
    expect(banner()).toBeNull();
    expect(screen.queryByRole('button', { name: 'Restore sample data' })).toBeNull();
  });

  it.each(['both', 'inventory', 'shipments'] as const)('shows it when %s is a file, with the second sentence and a Restore button', async (which) => {
    render(<App api={makeApi({ getSnapshot: vi.fn().mockResolvedValue(imported(which)) })} />);
    await screen.findByRole('heading', { name: 'Dashboard' });
    const region = banner() as HTMLElement;
    expect(region).not.toBeNull();
    expect(region).toHaveTextContent('These figures come from that file, not the sample. Restoring resets it for everyone.');
    expect(within(region).getByRole('button', { name: 'Restore sample data' })).toBeInTheDocument();
    expect(screen.getAllByRole('region', { name: 'Someone imported a file.' })).toHaveLength(1);
  });

  it('shows it on every page, above the page and under a "Could not refresh data" banner', async () => {
    for (const hash of ['', '#/inventory', '#/shipments', '#/routes', '#/analytics', '#/alerts', '#/import']) {
      window.location.hash = hash;
      const { unmount } = render(<App api={makeApi({ getSnapshot: vi.fn().mockResolvedValue(imported()) })} />);
      await screen.findByRole('heading', { level: 1 });
      expect(screen.getAllByRole('region', { name: 'Someone imported a file.' }), hash).toHaveLength(1);
      unmount();
    }
    window.location.hash = '';
    const getSnapshot = vi.fn().mockResolvedValueOnce(imported()).mockRejectedValue(apiError());
    const user = userEvent.setup();
    render(<App api={makeApi({ getSnapshot })} />);
    await screen.findByRole('heading', { name: 'Dashboard' });
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    const refreshError = (await screen.findByText('Could not refresh data')).closest('.banner') as HTMLElement;
    const dataBanner = banner() as HTMLElement;
    const page = (document.querySelector('main') as HTMLElement).lastElementChild as HTMLElement; // the page's own root
    expect(refreshError.compareDocumentPosition(dataBanner) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(dataBanner.compareDocumentPosition(page) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows nothing, and raises nothing, while the data is loading or could not load', async () => {
    const pending = render(<App api={makeApi({ getSnapshot: vi.fn(() => new Promise<never>(() => {})) })} />);
    expect(banner()).toBeNull();
    expect(screen.queryByRole('button', { name: 'Restore sample data' })).toBeNull();
    pending.unmount();
    render(<App api={makeApi({ getSnapshot: vi.fn().mockRejectedValue(apiError()) })} />);
    expect(await screen.findByText('Could not load data')).toBeInTheDocument();
    expect(banner()).toBeNull();
  });

  it('Restore calls the reset once, reloads, drops the banner, shows one "Sample data" chip, says so politely and focuses the h1', async () => {
    const getSnapshot = vi.fn().mockResolvedValueOnce(imported()).mockResolvedValue(sample());
    const resetSampleData = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<App api={makeApi({ getSnapshot, resetSampleData })} />);
    const h1 = await screen.findByRole('heading', { level: 1, name: 'Dashboard' });
    expect([...document.querySelectorAll('.topbar__chip')].map((c) => c.textContent)).toEqual(['Imported data']);
    await user.click(within(banner() as HTMLElement).getByRole('button', { name: 'Restore sample data' }));
    await waitFor(() => expect(banner()).toBeNull());
    expect(resetSampleData).toHaveBeenCalledTimes(1);
    expect(getSnapshot).toHaveBeenCalledTimes(2);
    expect([...document.querySelectorAll('.topbar__chip')].map((c) => c.textContent)).toEqual(['Sample data']);
    await waitFor(() => expect(politeWords()).toBe('Sample data restored.'));
    await waitFor(() => expect(h1).toHaveFocus());
  });

  it('Restore works from the keyboard: Enter on the focused button', async () => {
    const getSnapshot = vi.fn().mockResolvedValueOnce(imported('shipments')).mockResolvedValue(sample());
    const resetSampleData = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<App api={makeApi({ getSnapshot, resetSampleData })} />);
    await screen.findByRole('heading', { level: 1, name: 'Dashboard' });
    within(banner() as HTMLElement).getByRole('button', { name: 'Restore sample data' }).focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(banner()).toBeNull());
    expect(resetSampleData).toHaveBeenCalledTimes(1);
  });

  // A second click while it runs: busy, not disabled; the second click does nothing.
  it('while it runs the button says "Restoring…", is busy and unavailable, and a second click does not call the reset again', async () => {
    let finish: () => void = () => undefined;
    const resetSampleData = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    const getSnapshot = vi.fn().mockResolvedValueOnce(imported()).mockResolvedValue(sample());
    const user = userEvent.setup();
    render(<App api={makeApi({ getSnapshot, resetSampleData })} />);
    await screen.findByRole('heading', { level: 1, name: 'Dashboard' });
    const button = within(banner() as HTMLElement).getByRole('button', { name: 'Restore sample data' });
    await user.click(button);
    const busy = await within(banner() as HTMLElement).findByRole('button', { name: 'Restoring…' });
    expect(busy).toBe(button);
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(busy).toHaveAttribute('aria-disabled', 'true');
    expect(busy).not.toBeDisabled();
    await user.click(busy);
    await user.click(busy);
    expect(resetSampleData).toHaveBeenCalledTimes(1);
    finish();
    await waitFor(() => expect(banner()).toBeNull());
    expect(resetSampleData).toHaveBeenCalledTimes(1);
  });

  // The reset fails (no network): the same banner, the same region, turns amber; the error is said in its live region, there
  // from the first render, and Try again is the same button.
  it('when the reset fails it says "Could not restore sample data" with the message, keeps the focus, and Try again calls it once more', async () => {
    const resetSampleData = vi.fn().mockRejectedValueOnce(apiError()).mockResolvedValue(undefined);
    const getSnapshot = vi.fn().mockResolvedValueOnce(imported()).mockResolvedValue(sample());
    const user = userEvent.setup();
    render(<App api={makeApi({ getSnapshot, resetSampleData })} />);
    await screen.findByRole('heading', { level: 1, name: 'Dashboard' });
    const region = banner() as HTMLElement;
    const live = region.querySelector('[aria-live]') as HTMLElement;
    expect(live).toHaveTextContent('');
    const button = within(region).getByRole('button', { name: 'Restore sample data' });
    await user.click(button);
    await waitFor(() => expect(live).toHaveTextContent('Could not restore sample data'));
    expect(live).toHaveTextContent('Could not reach the server. Check that it is running and try again.');
    expect(banner()).toBe(region);
    expect(region).toHaveClass('banner--warning');
    expect(screen.queryByRole('alert')).toBeNull();
    const retry = within(region).getByRole('button', { name: 'Try again' });
    expect(retry).toBe(button);
    expect(retry).toHaveFocus();
    expect(getSnapshot).toHaveBeenCalledTimes(1);
    await user.click(retry);
    await waitFor(() => expect(banner()).toBeNull());
    expect(resetSampleData).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(politeWords()).toBe('Sample data restored.'));
  });

  // The server reset, but the reload failed, so the page still shows the file's figures.
  it('when the reset works but the reload fails, the banner stays under "Could not refresh data", nothing says "restored" and the focus does not jump', async () => {
    const getSnapshot = vi.fn().mockResolvedValueOnce(imported()).mockRejectedValue(apiError());
    const resetSampleData = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<App api={makeApi({ getSnapshot, resetSampleData })} />);
    const h1 = await screen.findByRole('heading', { level: 1, name: 'Dashboard' });
    await user.click(within(banner() as HTMLElement).getByRole('button', { name: 'Restore sample data' }));
    expect(await screen.findByText('Could not refresh data')).toBeInTheDocument();
    expect(resetSampleData).toHaveBeenCalledTimes(1);
    expect(banner()).not.toBeNull();
    expect(politeWords()).toBe('');
    expect(screen.queryByText(/restored/i)).toBeNull();
    expect(h1).not.toHaveFocus();
  });

  // Restored from the Import page's own card (which asks first): the shell says nothing of its own and the banner goes.
  it("when the Import page's Restore card restores the sample, the banner goes and the shell adds no \"restored\" word of its own", async () => {
    window.location.hash = '#/import';
    const getSnapshot = vi.fn().mockResolvedValueOnce(imported()).mockResolvedValue(sample());
    const resetSampleData = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<App api={makeApi({ getSnapshot, resetSampleData })} />);
    await screen.findByRole('heading', { level: 1, name: 'Data Import' });
    expect(screen.getAllByRole('button', { name: 'Restore sample data' })).toHaveLength(2); // the banner's and the card's
    const card = (document.querySelector('.restore-note') as HTMLElement).closest('.card') as HTMLElement;
    await user.click(within(card).getByRole('button', { name: 'Restore sample data' }));
    await user.click(within(card).getByRole('button', { name: 'Replace data' }));
    await waitFor(() => expect(banner()).toBeNull());
    expect(resetSampleData).toHaveBeenCalledTimes(1);
    expect(await screen.findAllByText('Sample data restored.')).toHaveLength(1); // the card's own banner
    expect(politeWords()).toBe('');
  });
});
