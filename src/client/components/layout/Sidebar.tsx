// Main navigation (plan §8.1). Fixed at >=1024px; an off-canvas drawer below that, toggled by `Topbar`'s menu
// button, with its own Close navigation button (the menu button is under the drawer, in the inert shell). The active link
// carries `aria-current="page"`. Its foot credits the author, the same in the sidebar and the drawer.

import type { RouteId } from '../../router';
import { buildHash } from '../../router';
import { Icon, type IconName } from '../ui/Icon';

export interface SidebarProps {
  activeRouteId: RouteId | 'not_found';
  alertCount: number | null;
  open: boolean;
  onNavigate: (routeId: RouteId) => void;
  onClose: () => void;
}

type NavItem = { id: RouteId; label: string; icon: IconName };

/** Dashboard stands first on its own (no "Overview" label over one link). */
const NAV_GROUPS: ReadonlyArray<{ id: string; label: string | null; items: ReadonlyArray<NavItem> }> = [
  { id: 'overview', label: null, items: [{ id: 'dashboard', label: 'Dashboard', icon: 'dashboard' }] },
  {
    id: 'operations',
    label: 'Operations',
    items: [
      { id: 'inventory', label: 'Inventory', icon: 'inventory' },
      { id: 'shipments', label: 'Shipments', icon: 'shipments' },
      { id: 'routes', label: 'Routes', icon: 'routes' }
    ]
  },
  {
    id: 'insights',
    label: 'Insights',
    items: [
      { id: 'analytics', label: 'Analytics', icon: 'analytics' },
      { id: 'alerts', label: 'Alerts', icon: 'alerts' }
    ]
  },
  { id: 'data', label: 'Data', items: [{ id: 'import', label: 'Data Import', icon: 'import' }] }
];

/** Opens in a new tab; the name keeps the visible word first (WCAG 2.5.3). */
const CREDIT_LINKS: ReadonlyArray<{ label: string; href: string; name: string }> = [
  { label: 'LinkedIn', href: 'https://www.linkedin.com/in/dangtao-scm', name: "LinkedIn: Đăng Tạo's profile (opens in a new tab)" },
  { label: 'GitHub', href: 'https://github.com/taokhanhdang201/supply-chain-command-center', name: 'GitHub: SCC source code (opens in a new tab)' }
];

/** The app's main navigation sidebar / off-canvas drawer. */
export function Sidebar({ activeRouteId, alertCount, open, onNavigate, onClose }: SidebarProps) {
  return (
    <nav aria-label="Main" id="sidebar" className={open ? 'sidebar surface-stage is-open' : 'sidebar surface-stage'}>
      <div className="sidebar__brand">
        <span className="sidebar__brand-mark" aria-hidden="true" />
        <span className="sidebar__brand-name">SCC</span> <span className="sidebar__brand-sub">Command Center</span>
        {/* Below 1024px only (components.css). */}
        <button type="button" className="sidebar__close" onClick={onClose}>
          <Icon name="close" />
          <span className="visually-hidden">Close navigation</span>
        </button>
      </div>
      <ul className="sidebar__nav">
        {NAV_GROUPS.map((group) => (
          <li key={group.id} className="sidebar__group">
            {group.label !== null && (
              <span className="sidebar__group-label" id={`nav-group-${group.id}`}>
                {group.label}
              </span>
            )}
            <ul aria-labelledby={group.label !== null ? `nav-group-${group.id}` : undefined}>
              {group.items.map((item) => {
                const isActive = item.id === activeRouteId;
                const isAlerts = item.id === 'alerts';
                return (
                  <li key={item.id}>
                    <a
                      href={buildHash(item.id)}
                      className="sidebar__link"
                      aria-current={isActive ? 'page' : undefined}
                      onClick={() => onNavigate(item.id)}
                    >
                      <Icon name={item.icon} size={16} />
                      <span>{item.label}</span>
                      {isAlerts && alertCount !== null && alertCount > 0 && (
                        <span className="sidebar__badge" aria-label={`Alerts, ${alertCount} need attention`}>
                          {alertCount}
                        </span>
                      )}
                    </a>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
      <div className="sidebar__footer">
        <p className="sidebar__credit">Built by Đăng Tạo</p>
        <p className="sidebar__credit-links">
          {CREDIT_LINKS.map((link) => (
            <a key={link.label} href={link.href} className="sidebar__credit-link" target="_blank" rel="noopener noreferrer" aria-label={link.name}>
              {link.label}
              <Icon name="external-link" size={12} />
            </a>
          ))}
        </p>
      </div>
    </nav>
  );
}
