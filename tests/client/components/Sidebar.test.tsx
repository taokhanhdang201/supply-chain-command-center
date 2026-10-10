// @vitest-environment jsdom
// The sidebar's frame: the Main navigation landmark holds only the page links; the credit foot (two links that leave SCC)
// sits outside it as the page's content information, and the menu button's target (#sidebar) still exists around both.
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Sidebar } from '../../../src/client/components/layout/Sidebar';

function renderSidebar(overrides: Partial<Parameters<typeof Sidebar>[0]> = {}) {
  const props = { activeRouteId: 'dashboard' as const, alertCount: 3, open: false, onNavigate: vi.fn(), onClose: vi.fn(), ...overrides };
  return { ...render(<Sidebar {...props} />), props };
}

describe('Sidebar frame', () => {
  it('keeps the two credit links out of the Main navigation landmark', () => {
    const { container } = renderSidebar();
    const nav = screen.getByRole('navigation', { name: 'Main' });
    const footer = container.querySelector('.sidebar__footer') as HTMLElement;
    expect(footer).not.toBeNull();
    expect(nav).not.toContainElement(footer);
    expect(within(nav).queryByRole('link', { name: /LinkedIn|GitHub/ })).toBeNull();
    expect(within(footer).getAllByRole('link')).toHaveLength(2);
  });

  it('lists every page link inside Main, with only the open page marked current', () => {
    renderSidebar({ activeRouteId: 'analytics' });
    const nav = screen.getByRole('navigation', { name: 'Main' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((l) => l.textContent?.replace(/\d+$/, ''))).toEqual(['Dashboard', 'Inventory', 'Shipments', 'Routes', 'Analytics', 'Alerts', 'Data Import']);
    expect(links.filter((l) => l.getAttribute('aria-current') === 'page').map((l) => l.textContent)).toEqual(['Analytics']);
  });

  it('keeps id "sidebar" on the outer box that holds the brand, the navigation and the foot, so aria-controls still points at it', () => {
    const { container } = renderSidebar({ open: true });
    const box = container.querySelector('#sidebar') as HTMLElement;
    expect(box).not.toBeNull();
    expect(box).toHaveClass('is-open');
    expect(box).toContainElement(screen.getByRole('navigation', { name: 'Main' }));
    expect(box).toContainElement(container.querySelector('.sidebar__footer') as HTMLElement);
    expect(box).toContainElement(screen.getByRole('button', { name: 'Close navigation' }));
    expect(container.querySelectorAll('[id="sidebar"]')).toHaveLength(1);
  });

  it('puts the foot links after the page links in the Tab order, as before', async () => {
    const user = userEvent.setup();
    renderSidebar();
    const order: string[] = [];
    for (let i = 0; i < 10; i += 1) {
      await user.tab();
      order.push(document.activeElement?.textContent?.replace(/\d+$/, '') ?? '');
    }
    expect(order.slice(0, 8)).toEqual(['Close navigation', 'Dashboard', 'Inventory', 'Shipments', 'Routes', 'Analytics', 'Alerts', 'Data Import']);
    expect(order[8]).toMatch(/^LinkedIn/);
    expect(order[9]).toMatch(/^GitHub/);
  });

  it('asks to close from the drawer button and navigates from a page link', async () => {
    const user = userEvent.setup();
    const { props } = renderSidebar();
    await user.click(screen.getByRole('button', { name: 'Close navigation' }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('link', { name: 'Inventory' }));
    expect(props.onNavigate).toHaveBeenCalledWith('inventory');
  });
});
