// Page header (plan §8.1): mobile menu toggle, "Data as of ..." + data source chips, and a Refresh button with a polite
// live region announcing "Refreshing…". It does not repeat the page title: the page's h1 is its only visible title.
// While both sources are the generated sample, one "Sample data" chip opens a note with the seed and the daily rebuild
// (owner decision D6); once a file is imported, each source keeps its own chip.

import { useRef } from 'react';
import type { PointerEvent, RefObject } from 'react';
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

/** The id of the note the "Sample data" chip opens. */
const SAMPLE_NOTE_ID = 'topbar-sample-note';

/** The seed a generated sample's label names ("Sample data (seed 42)", built by the server), or null. */
function sampleSeed(label: string): string | null {
  return /\(seed (\d+)\)/.exec(label)?.[1] ?? null;
}

/** The topbar: mobile nav toggle, the data date, data-source chips, and a manual refresh control. */
export function Topbar({ today, dataSources, refreshing, onRefresh, drawerOpen, onMenuClick, menuButtonRef }: TopbarProps) {
  const noteRef = useRef<HTMLParagraphElement>(null);
  // The server rebuilds the sample each day only while both sources are still the sample (src/server/api.ts).
  const bothSample = dataSources !== null && dataSources.inventory.kind === 'sample' && dataSources.shipments.kind === 'sample';
  const seed = dataSources === null ? null : sampleSeed(dataSources.inventory.label);

  // A mouse over the chip or its note opens the note and leaving both closes it (owner decision D6), where the browser
  // hangs the note under the chip (position-area). Elsewhere the note is centred on the screen, out of reach of the
  // pointer: leaving the chip would close it before it could be hovered (WCAG 1.4.13), so only a click, Enter or Space
  // opens it there. pointerenter and pointerleave follow the DOM tree, so moving from the chip onto the note, a child of
  // the same wrapper, keeps it open. Only a mouse: a touch has the tap, and a hover it opened would close again at once.
  // The popover API may be missing (jsdom), and showing a note that is already showing throws, so the state is read first.
  const hoverNote = (open: boolean) => (event: PointerEvent) => {
    const note = noteRef.current;
    if (event.pointerType !== 'mouse' || note === null || typeof note.showPopover !== 'function' || !CSS.supports('position-area: bottom')) return;
    if (note.matches(':popover-open') === open) return;
    if (open) note.showPopover();
    else note.hidePopover();
  };

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
          {bothSample ? (
            <div className="topbar__sample" onPointerEnter={hoverNote(true)} onPointerLeave={hoverNote(false)}>
              {/* A native popover: a click, Enter or Space opens the note ("show", so a click after a hover does not close
                  it); Esc or a click elsewhere closes it. No date: the "Data as of" line has it. */}
              <button type="button" className="topbar__chip topbar__chip--sample" popoverTarget={SAMPLE_NOTE_ID} popoverTargetAction="show">
                Sample data
              </button>
              <p ref={noteRef} id={SAMPLE_NOTE_ID} popover="auto" className="topbar__note">
                {`Generated sample${seed === null ? '' : ` (seed ${seed})`}. The live demo rebuilds it each day until a file is imported.`}
              </p>
            </div>
          ) : (
            <>
              <span className="topbar__chip">Inventory: {displaySourceLabel(dataSources.inventory.label)}</span>
              <span className="topbar__chip">Shipments: {displaySourceLabel(dataSources.shipments.label)}</span>
            </>
          )}
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
