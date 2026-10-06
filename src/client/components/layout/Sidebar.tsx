// Main navigation (plan §8.1). Fixed at >=1024px; an off-canvas drawer below that, toggled by `Topbar`'s menu
// button. The active link carries `aria-current="page"`.

import type { RouteId } from '../../router';
import { buildHash } from '../../router';
import { Icon, type IconName } from '../ui/Icon';

export interface SidebarProps {
  activeRouteId: RouteId | 'not_found';
  alertCount: number | null;
  open: boolean;
  onNavigate: () => void;
}

type NavItem = { id: RouteId; label: string; icon: IconName };

const NAV_GROUPS: ReadonlyArray<{ id: string; label: string; items: ReadonlyArray<NavItem> }> = [
  { id: 'overview', label: 'Overview', items: [{ id: 'dashboard', label: 'Dashboard', icon: 'dashboard' }] },
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

/** The app's main navigation sidebar / off-canvas drawer. */
export function Sidebar({ activeRouteId, alertCount, open, onNavigate }: SidebarProps) {
  return (
    <nav aria-label="Main" id="sidebar" className={open ? 'sidebar surface-stage is-open' : 'sidebar surface-stage'}>
      <div className="sidebar__brand">
        <span className="sidebar__brand-mark" aria-hidden="true" />
        <span className="sidebar__brand-name">SCC</span> <span className="sidebar__brand-sub">Command Center</span>
      </div>
      <ul className="sidebar__nav">
        {NAV_GROUPS.map((group) => (
          <li key={group.id} className="sidebar__group">
            <span className="sidebar__group-label" id={`nav-group-${group.id}`}>
              {group.label}
            </span>
            <ul aria-labelledby={`nav-group-${group.id}`}>
              {group.items.map((item) => {
                const isActive = item.id === activeRouteId;
                const isAlerts = item.id === 'alerts';
                return (
                  <li key={item.id}>
                    <a
                      href={buildHash(item.id)}
                      className="sidebar__link"
                      aria-current={isActive ? 'page' : undefined}
                      onClick={onNavigate}
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
    </nav>
  );
}
