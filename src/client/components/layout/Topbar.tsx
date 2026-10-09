// Page header (plan §8.1): mobile menu toggle, "Data as of ..." + data source chips, and a Refresh button with a polite
// live region announcing "Refreshing…". It does not repeat the page title: the page's h1 is its only visible title.
// While both sources are the generated sample, one "Sample data" chip opens a note with the seed and the daily rebuild;
// once a file is imported, one "Imported data" chip opens a note naming each source, at every width.

import { useRef } from 'react';
import type { PointerEvent, RefObject } from 'react';
import type { DataSourceInfo, DayString } from '../../../shared/types';
import { formatDay } from '../../../shared/format';
import { Icon } from '../ui/Icon';
import { Button } from '../ui/Button';
import { displaySourceLabel } from '../../import/sampleFiles';
import { isSampleData } from './ImportedDataBanner';

export interface TopbarProps {
  today: DayString | null;
  dataSources: { inventory: DataSourceInfo; shipments: DataSourceInfo } | null;
  refreshing: boolean;
  /** Read by the polite region when no reload is running (for example "Sample data restored."). */
  status?: string;
  onRefresh: () => void;
  drawerOpen: boolean;
  onMenuClick: () => void;
  menuButtonRef: RefObject<HTMLButtonElement | null>;
}

/** The id of the note the "Sample data" chip opens. */
const SAMPLE_NOTE_ID = 'topbar-sample-note';
/** The id of the note the "Imported data" chip opens. */
const IMPORTED_NOTE_ID = 'topbar-imported-note';

/** The seed a generated sample's label names ("Sample data (seed 42)", built by the server), or null. */
function sampleSeed(label: string): string | null {
  return /\(seed (\d+)\)/.exec(label)?.[1] ?? null;
}

/** The topbar: mobile nav toggle, the data date, data-source chips, and a manual refresh control. */
export function Topbar({ today, dataSources, refreshing, status = '', onRefresh, drawerOpen, onMenuClick, menuButtonRef }: TopbarProps) {
  const noteRef = useRef<HTMLParagraphElement>(null);
  // The server rebuilds the sample each day only while both sources are still the sample (src/server/api.ts).
  const bothSample = dataSources !== null && isSampleData(dataSources);
  const seed = dataSources === null ? null : sampleSeed(dataSources.inventory.label);
  const inventoryLabel = dataSources === null ? '' : displaySourceLabel(dataSources.inventory.label);
  const shipmentsLabel = dataSources === null ? '' : displaySourceLabel(dataSources.shipments.label);
  const noteId = bothSample ? SAMPLE_NOTE_ID : IMPORTED_NOTE_ID;

  // A mouse over the chip or its note opens the note and leaving both closes it, where the browser
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
          {/* One chip at every width, a button that opens its note: a native popover (a click, Enter or Space opens it,
              "show", so a click after a hover does not close it; Esc or a click elsewhere closes it). The note also
              describes the chip, so a screen reader reads it on focus. The sample's note gives no date: the "Data as of"
              line has it. Once a file is imported, the note names each source (the whole file name, however long). */}
          <div className={bothSample ? 'topbar__sample' : 'topbar__imported'} onPointerEnter={hoverNote(true)} onPointerLeave={hoverNote(false)}>
            <button
              type="button"
              className={bothSample ? 'topbar__chip topbar__chip--sample' : 'topbar__chip topbar__chip--imported'}
              popoverTarget={noteId}
              popoverTargetAction="show"
              aria-describedby={noteId}
            >
              {bothSample ? 'Sample data' : 'Imported data'}
            </button>
            <p ref={noteRef} id={noteId} popover="auto" className={bothSample ? 'topbar__note' : 'topbar__note topbar__note--imported'}>
              {bothSample
                ? `Generated sample${seed === null ? '' : `, seed ${seed}`}. Rebuilt every day until someone imports a file.`
                : `Inventory: ${inventoryLabel}. Shipments: ${shipmentsLabel}.`}
            </p>
          </div>
        </div>
      )}

      <div className="topbar__actions">
        {/* Busy, not disabled, while the data reloads: the button keeps the focus (WCAG 2.4.3). Below 768px the word is
            hidden (components.css) and still names the button. */}
        <Button busy={refreshing} onClick={onRefresh}>
          <Icon name="refresh" />
          <span className="topbar__refresh-label">Refresh</span>
        </Button>
        <span className="visually-hidden" aria-live="polite">
          {refreshing ? 'Refreshing…' : status}
        </span>
      </div>
    </header>
  );
}
