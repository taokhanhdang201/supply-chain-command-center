// @vitest-environment jsdom
// DESIGN.md "The page band": the top bar does not repeat the page title (the h1 is the page's only visible title).
// While both sources are the generated sample, one "Sample data" chip opens a note
// (a native popover; jsdom has no popover API, so its keyboard, Esc and placement are driven in v16.ui.browser.test.ts).
import { afterEach, describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { DataSourceInfo } from '../../../src/shared/types';
import { Topbar } from '../../../src/client/components/layout/Topbar';
import { makeSnapshot, TODAY } from '../../helpers/fixtures';

type Sources = { inventory: DataSourceInfo; shipments: DataSourceInfo };
const chips = (container: HTMLElement) => [...container.querySelectorAll('.topbar__chip')].map((c) => c.textContent);
const renderTopbar = (dataSources: Sources) =>
  render(<Topbar today={TODAY} dataSources={dataSources} refreshing={false} onRefresh={vi.fn()} drawerOpen={false} onMenuClick={vi.fn()} menuButtonRef={{ current: null }} />);

describe('Topbar', () => {
  it('shows the data date, one "Sample data" chip and Refresh, and no page title', () => {
    const snapshot = makeSnapshot([], [], { today: TODAY });
    const { container } = render(
      <Topbar today={TODAY} dataSources={snapshot.dataSources} refreshing={false} onRefresh={vi.fn()} drawerOpen={false} onMenuClick={vi.fn()} menuButtonRef={{ current: null }} />
    );
    expect(container.querySelector('.topbar__page-title')).toBeNull();
    expect(screen.queryByRole('heading')).toBeNull();
    expect(container.querySelector('.topbar__date')).toHaveTextContent(/^Data as of /);
    expect(chips(container)).toEqual(['Sample data']);
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
  });

  it('keeps the title frame (it pushes the chips and Refresh right) before any data has loaded', () => {
    const { container } = render(
      <Topbar today={null} dataSources={null} refreshing={false} onRefresh={vi.fn()} drawerOpen={false} onMenuClick={vi.fn()} menuButtonRef={{ current: null }} />
    );
    expect(container.querySelector('.topbar__title')).not.toBeNull();
    expect(container.querySelector('.topbar__date')).toBeNull();
    expect(container.querySelector('.topbar__sources')).toBeNull();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
  });

  it('opens a note from the "Sample data" chip: the seed and the daily rebuild, and no date', () => {
    const { container } = renderTopbar(makeSnapshot([], [], { today: TODAY }).dataSources);
    const chip = screen.getByRole('button', { name: 'Sample data' });
    const note = container.querySelector('.topbar__note') as HTMLElement;
    expect(chip).toHaveClass('topbar__chip');
    expect(note.id).not.toBe('');
    expect(chip).toHaveAttribute('popovertarget', note.id);
    expect(note).toHaveAttribute('popover', 'auto');
    expect(note.textContent).toBe('Generated sample (seed 42). The live demo rebuilds it each day until a file is imported.');
  });

  it('reads the seed from the sample label, and leaves it out when the label names none', () => {
    const { dataSources } = makeSnapshot([], [], { today: TODAY });
    const labelled = (label: string): Sources => ({ inventory: { ...dataSources.inventory, label }, shipments: { ...dataSources.shipments, label } });
    const { container, unmount } = renderTopbar(labelled('Sample data (seed 7)'));
    expect(container.querySelector('.topbar__note')).toHaveTextContent(/^Generated sample \(seed 7\)\. The live demo/);
    unmount();
    const again = renderTopbar(labelled('Sample data'));
    expect(again.container.querySelector('.topbar__note')).toHaveTextContent(/^Generated sample\. The live demo/);
  });

  it('keeps one chip per source, and no note, once a file is imported', () => {
    const { dataSources } = makeSnapshot([], [], { today: TODAY });
    const imported: Sources = { ...dataSources, shipments: { kind: 'import', label: 'carrier-export.csv', loadedAt: '2026-06-15T00:00:00.000Z', rowCount: 480 } };
    const { container } = renderTopbar(imported);
    expect(chips(container)).toEqual(['Inventory: Sample data (seed 42)', 'Shipments: carrier-export.csv']);
    expect(container.querySelector('.topbar__note')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sample data' })).toBeNull();
  });

  // WCAG 1.3.1 / 4.1.2: focus on the chip announces its note (a hidden element still gives its words).
  it('describes the Sample data chip by its note', () => {
    renderTopbar(makeSnapshot([], [], { today: TODAY }).dataSources);
    expect(screen.getByRole('button', { name: 'Sample data' })).toHaveAttribute('aria-describedby', 'topbar-sample-note');
    expect(document.getElementById('topbar-sample-note')?.textContent).toMatch(/^Generated sample/);
  });

  // WCAG 2.4.3: while the data reloads, Refresh is busy, not disabled: it keeps the focus and ignores a click.
  it('keeps Refresh focusable while refreshing: busy and unavailable, and a click does nothing', () => {
    const onRefresh = vi.fn();
    render(<Topbar today={TODAY} dataSources={makeSnapshot([], [], { today: TODAY }).dataSources} refreshing onRefresh={onRefresh} drawerOpen={false} onMenuClick={vi.fn()} menuButtonRef={{ current: null }} />);
    const refresh = screen.getByRole('button', { name: 'Refresh' });
    expect(refresh).toHaveAttribute('aria-busy', 'true');
    expect(refresh).toHaveAttribute('aria-disabled', 'true');
    expect(refresh).not.toBeDisabled();
    fireEvent.click(refresh);
    expect(onRefresh).not.toHaveBeenCalled();
  });
});

// A mouse over the chip or its note opens the note and leaving both closes it, where the browser hangs
// the note under the chip (CSS position-area); elsewhere the note is centred on the screen, out of reach of the pointer
// (WCAG 1.4.13), so only a click, Enter or Space opens it. jsdom has no popover API (showPopover, hidePopover) and its
// ':popover-open' is always false, so both are stood in for here, and CSS.supports is pinned; a touch or a pen must not
// trigger them (a tap has its own click, and a hover it opened would close again at once).
describe('Topbar: a mouse hover opens the sample note', () => {
  const showPopover = vi.fn();
  const hidePopover = vi.fn();
  /** Install the popover API; `isOpen()` answers ':popover-open', `anchored` answers CSS.supports('position-area: bottom'). */
  function standInForPopovers(isOpen: () => boolean, anchored = true): void {
    vi.spyOn(CSS, 'supports').mockReturnValue(anchored);
    for (const [name, value] of [['showPopover', showPopover], ['hidePopover', hidePopover]] as const) {
      Object.defineProperty(HTMLElement.prototype, name, { value, configurable: true, writable: true });
    }
    const matches = Element.prototype.matches;
    vi.spyOn(Element.prototype, 'matches').mockImplementation(function (this: Element, selector: string) {
      return selector === ':popover-open' ? isOpen() : matches.call(this, selector);
    });
  }
  function renderSample() {
    const { container } = renderTopbar(makeSnapshot([], [], { today: TODAY }).dataSources);
    return { wrapper: container.querySelector('.topbar__sample') as HTMLElement, note: container.querySelector('.topbar__note') as HTMLElement };
  }

  afterEach(() => {
    vi.restoreAllMocks();
    showPopover.mockReset();
    hidePopover.mockReset();
    Reflect.deleteProperty(HTMLElement.prototype, 'showPopover');
    Reflect.deleteProperty(HTMLElement.prototype, 'hidePopover');
  });

  it('shows the note when a mouse enters the chip, and hides it when the mouse leaves', () => {
    let open = false;
    standInForPopovers(() => open);
    const { wrapper, note } = renderSample();
    fireEvent.pointerEnter(wrapper, { pointerType: 'mouse' });
    expect(showPopover).toHaveBeenCalledTimes(1);
    expect(showPopover.mock.contexts[0], 'it is the note that is shown').toBe(note);
    expect(hidePopover).not.toHaveBeenCalled();
    open = true;
    fireEvent.pointerLeave(wrapper, { pointerType: 'mouse' });
    expect(hidePopover).toHaveBeenCalledTimes(1);
    expect(hidePopover.mock.contexts[0], 'it is the note that is hidden').toBe(note);
    expect(showPopover).toHaveBeenCalledTimes(1);
  });

  it.each(['touch', 'pen'])('ignores a %s pointer, in both directions', (pointerType) => {
    let open = false;
    standInForPopovers(() => open);
    const { wrapper } = renderSample();
    fireEvent.pointerEnter(wrapper, { pointerType });
    open = true;
    fireEvent.pointerLeave(wrapper, { pointerType });
    expect(showPopover).not.toHaveBeenCalled();
    expect(hidePopover).not.toHaveBeenCalled();
  });

  it('does not show a note that is already showing, nor hide one that is already closed (each throws)', () => {
    let open = true;
    standInForPopovers(() => open);
    const { wrapper } = renderSample();
    fireEvent.pointerEnter(wrapper, { pointerType: 'mouse' });
    expect(showPopover).not.toHaveBeenCalled();
    open = false;
    fireEvent.pointerLeave(wrapper, { pointerType: 'mouse' });
    expect(hidePopover).not.toHaveBeenCalled();
  });

  it('leaves a hover alone where the browser cannot hang the note under the chip: only a click, Enter or Space opens it there', () => {
    let open = false;
    standInForPopovers(() => open, false);
    const { wrapper } = renderSample();
    fireEvent.pointerEnter(wrapper, { pointerType: 'mouse' });
    expect(CSS.supports).toHaveBeenCalledWith('position-area: bottom');
    expect(showPopover, 'a centred note would close before the pointer reached it').not.toHaveBeenCalled();
    open = true; // opened by a click: the mouse leaving must not close it either
    fireEvent.pointerLeave(wrapper, { pointerType: 'mouse' });
    expect(hidePopover).not.toHaveBeenCalled();
  });

  it('does nothing, and raises no error, where the browser has no popover API', () => {
    // React reports an error thrown in an event handler on the window rather than out of fireEvent.
    const errors: unknown[] = [];
    const onError = (event: ErrorEvent) => {
      errors.push(event.error);
      event.preventDefault();
    };
    window.addEventListener('error', onError);
    try {
      const { wrapper } = renderSample();
      fireEvent.pointerEnter(wrapper, { pointerType: 'mouse' });
      fireEvent.pointerLeave(wrapper, { pointerType: 'mouse' });
    } finally {
      window.removeEventListener('error', onError);
    }
    expect(errors).toEqual([]);
  });

  it('puts both the chip and the note inside the element that listens, so moving between them keeps the note open', () => {
    const { wrapper, note } = renderSample();
    expect(wrapper.contains(screen.getByRole('button', { name: 'Sample data' }))).toBe(true);
    expect(wrapper.contains(note)).toBe(true);
    expect(note.closest('span'), 'a <p> is flow content: a <span> may not hold it').toBeNull();
  });
});
