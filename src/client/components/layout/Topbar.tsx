// Page header (plan §8.1): mobile menu toggle, "Data as of ..." + data source chips, and a Refresh button with a polite
// live region announcing "Refreshing…". It does not repeat the page title: the page's h1 is its only visible title.

import type { RefObject } from 'react';
import type { DataSourceInfo, DayString } from '../../../shared/types';
import { formatDay } from '../../../shared/format';
import { Icon } from '../ui/Icon';
import { displaySourceLabel } from '../../import/sampleFiles';

export interface TopbarProps {
  today: DayString | null;
  dataSources: { inventory: DataSourceInfo; shipments: DataSourceInfo } | null;
  refreshing: boolean;
  onRefresh: () => void;
  drawerOpen: boolean;
  onMenuClick: () => void;
  menuButtonRef: RefObject<HTMLButtonElement | null>;
}

/** The topbar: mobile nav toggle, the data date, data-source chips, and a manual refresh control. */
export function Topbar({ today, dataSources, refreshing, onRefresh, drawerOpen, onMenuClick, menuButtonRef }: TopbarProps) {
  return (
    <header className="topbar surface-stage">
      <button
        ref={menuButtonRef}
        type="button"
        className="sidebar-toggle"
        aria-expanded={drawerOpen}
        aria-controls="sidebar"
        onClick={onMenuClick}
      >
        <Icon name={drawerOpen ? 'close' : 'menu'} />
        <span className="visually-hidden">{drawerOpen ? 'Close navigation' : 'Open navigation'}</span>
      </button>

      <div className="topbar__title">
        {today !== null && <span className="topbar__date">Data as of {formatDay(today)}</span>}
      </div>

      {dataSources !== null && (
        <div className="topbar__sources">
          <span className="topbar__chip">Inventory: {displaySourceLabel(dataSources.inventory.label)}</span>
          <span className="topbar__chip">Shipments: {displaySourceLabel(dataSources.shipments.label)}</span>
        </div>
      )}

      <div className="topbar__actions">
        <button type="button" className="button" onClick={onRefresh} disabled={refreshing}>
          <Icon name="refresh" />
          Refresh
        </button>
        <span className="visually-hidden" aria-live="polite">
          {refreshing ? 'Refreshing…' : ''}
        </span>
      </div>
    </header>
  );
}
