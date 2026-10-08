// @vitest-environment jsdom
// Phase 1 spec §6 component contracts: Button, SelectField, Pagination, SectionHeader, EmptyState, SearchInput, Figure, the
// control states in components.css (hover, active, disabled, the bare disabled button in base.css) and the Figure link states in pages.css.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from '../../../src/client/components/ui/Button';
import { EmptyState } from '../../../src/client/components/ui/EmptyState';
import { Figure } from '../../../src/client/components/ui/Figure';
import { Pagination } from '../../../src/client/components/ui/Pagination';
import { SearchInput } from '../../../src/client/components/ui/SearchInput';
import { SectionHeader } from '../../../src/client/components/ui/SectionHeader';
import { SelectField } from '../../../src/client/components/ui/SelectField';

describe('Button', () => {
  it('is a real button of type button, wearing exactly .button, enabled and not busy', () => {
    render(<Button>Refresh</Button>);
    const button = screen.getByRole('button', { name: 'Refresh' });
    expect(button).toHaveAttribute('type', 'button');
    expect(button.className).toBe('button');
    expect(button).toBeEnabled();
    expect(button).not.toHaveAttribute('aria-busy');
  });

  it.each([
    { props: { variant: 'primary' }, expected: 'button button--primary' },
    { props: { variant: 'ghost', size: 'sm' }, expected: 'button button--ghost button--sm' },
    { props: { variant: 'danger' }, expected: 'button button--danger' },
    { props: { variant: 'link', className: 'ingest-link' }, expected: 'button button--link ingest-link' },
    { props: { size: 'sm' }, expected: 'button button--sm' }
  ] as const)('wears "$expected" for $props', ({ props, expected }) => {
    render(<Button {...props}>Go</Button>);
    expect(screen.getByRole('button', { name: 'Go' }).className).toBe(expected);
  });

  it('passes native props through, calls onClick once, and honours type="submit" and disabled', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const { rerender } = render(
      <Button aria-pressed={false} aria-label="Why? Carrier" onClick={onClick}>
        Why?
      </Button>
    );
    const button = screen.getByRole('button', { name: 'Why? Carrier' });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    await user.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);

    rerender(
      <Button aria-pressed={false} aria-label="Why? Carrier" type="submit" disabled onClick={onClick}>
        Why?
      </Button>
    );
    const off = screen.getByRole('button', { name: 'Why? Carrier' });
    expect(off).toHaveAttribute('type', 'submit');
    // Lô 9 (WCAG 2.4.3): unavailable is aria-disabled, not the disabled attribute, so a focused button keeps its focus.
    expect(off).toHaveAttribute('aria-disabled', 'true');
    expect(off).not.toBeDisabled();
    await user.click(off);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  // Lô 9 (WCAG 2.4.3 / 4.1.2): busy is unavailable too, said with aria-disabled: the button keeps its focus (the disabled
  // attribute dropped it to <body>) and ignores a click or a key.
  it('busy sets aria-busy and aria-disabled, keeps the button focusable, and ignores a click or Enter', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button variant="link" busy onClick={onClick}>
        Undoing…
      </Button>
    );
    const button = screen.getByRole('button', { name: 'Undoing…' });
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).not.toBeDisabled();
    await user.click(button);
    expect(button).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onClick).not.toHaveBeenCalled();
  });

  it('an unavailable submit button does not submit its form', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        <Button type="submit" disabled>
          Save
        </Button>
      </form>
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  // react-reviewer: aria-busy was written after the native props, so it overwrote the caller's.
  it("keeps a caller's aria-busy", () => {
    render(<Button aria-busy>Saving</Button>);
    expect(screen.getByRole('button', { name: 'Saving' })).toHaveAttribute('aria-busy', 'true');
  });
});

const RANGE_OPTIONS = [
  { value: '30d', label: 'Last 30 days' },
  { value: '180d', label: 'Last 180 days' }
];

describe('SelectField', () => {
  it('is enabled with a visible label by default', () => {
    render(<SelectField label="Range" value="30d" options={RANGE_OPTIONS} onChange={vi.fn()} />);
    expect(screen.getByLabelText('Range')).toBeEnabled();
    expect(screen.getByText('Range')).not.toHaveClass('visually-hidden');
  });

  it('turns the control off with disabled', () => {
    render(<SelectField label="Range" value="30d" options={RANGE_OPTIONS} onChange={vi.fn()} disabled />);
    expect(screen.getByLabelText('Range')).toBeDisabled();
  });

  it('hideLabel hides the label from sight only: it stays the accessible name', () => {
    render(<SelectField label="Range" value="30d" options={RANGE_OPTIONS} onChange={vi.fn()} hideLabel />);
    expect(screen.getByRole('combobox', { name: 'Range' })).toBeInTheDocument();
    expect(screen.getByText('Range')).toHaveClass('visually-hidden');
  });
});

describe('Pagination', () => {
  const props = { page: 1, pageCount: 20, pageSize: 25, total: 480, start: 1, end: 25 };

  it('is a navigation landmark named Pagination holding Previous, Next, the page-size select and the summary', () => {
    render(<Pagination {...props} onPageChange={vi.fn()} onPageSizeChange={vi.fn()} />);
    const nav = screen.getByRole('navigation', { name: 'Pagination' });
    // Lô 9: Previous on the first page is unavailable but keeps its place in the Tab order (aria-disabled).
    expect(within(nav).getByRole('button', { name: 'Previous' })).toHaveAttribute('aria-disabled', 'true');
    expect(within(nav).getByRole('button', { name: 'Next' })).not.toHaveAttribute('aria-disabled');
    expect(within(nav).getByLabelText('Rows per page')).toBeInTheDocument();
    expect(within(nav).getByText('Showing 1–25 of 480')).toBeInTheDocument();
  });

  it('draws Previous and Next as md buttons (36px), never the small size', () => {
    render(<Pagination {...props} page={2} onPageChange={vi.fn()} onPageSizeChange={vi.fn()} />);
    for (const name of ['Previous', 'Next']) {
      const button = screen.getByRole('button', { name });
      expect(button).toHaveClass('button');
      expect(button).not.toHaveClass('button--sm');
      expect(button).toHaveAttribute('type', 'button');
    }
  });

  it('asks for the next page when Next is pressed', async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    render(<Pagination {...props} onPageChange={onPageChange} onPageSizeChange={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(onPageChange).toHaveBeenCalledTimes(1);
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it('ignores Previous on the first page and Next on the last', async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    const { rerender } = render(<Pagination {...props} onPageChange={onPageChange} onPageSizeChange={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Previous' }));
    rerender(<Pagination {...props} page={20} start={476} end={480} onPageChange={onPageChange} onPageSizeChange={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(onPageChange).not.toHaveBeenCalled();
  });
});

describe('SectionHeader', () => {
  it('renders a real h2 with the given id over the section rule', () => {
    const { container } = render(<SectionHeader title="How these are calculated" id="analytics-formulas" />);
    const heading = screen.getByRole('heading', { level: 2, name: 'How these are calculated' });
    expect(heading).toHaveAttribute('id', 'analytics-formulas');
    expect(heading).toHaveClass('section-label');
    expect(heading.parentElement).toHaveClass('section-bar');
    expect(container.querySelector('.section-bar__actions')).toBeNull();
  });

  it('puts the actions last in the bar', () => {
    const { container } = render(<SectionHeader title="Charts" actions={<button type="button">Sort</button>} />);
    const actions = container.querySelector('.section-bar__actions');
    expect(actions).not.toBeNull();
    expect(actions).toContainElement(screen.getByRole('button', { name: 'Sort' }));
    expect(container.querySelector('.section-bar')?.lastElementChild).toBe(actions);
  });
});

describe('EmptyState', () => {
  it('is a status region holding the title, the message and the action', () => {
    render(<EmptyState title="No shipments" message="Try another filter." action={<a href="#/import">Import a CSV</a>} />);
    const status = screen.getByRole('status');
    expect(status).toHaveClass('empty-state');
    expect(within(status).getByText('No shipments')).toBeInTheDocument();
    expect(within(status).getByText('Try another filter.')).toBeInTheDocument();
    expect(within(status).getByRole('link', { name: 'Import a CSV' })).toBeInTheDocument();
  });
});

describe('SearchInput', () => {
  function Harness() {
    const [query, setQuery] = useState('ELC');
    return <SearchInput label="Search" value={query} onChange={setQuery} />;
  }

  it('shows Clear search only once there is text, as a small ghost button', () => {
    const { rerender } = render(<SearchInput label="Search" value="" onChange={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull();
    rerender(<SearchInput label="Search" value="ELC" onChange={vi.fn()} />);
    const clear = screen.getByRole('button', { name: 'Clear search' });
    expect(clear).toHaveClass('button', 'button--ghost', 'button--sm');
  });

  it('clears the text and gives focus back to the field, so it does not fall to <body>', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const field = screen.getByRole('searchbox', { name: 'Search' });
    expect(field).toHaveValue('ELC');
    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(field).toHaveValue('');
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull();
    expect(field).toHaveFocus();
  });
});

describe('Figure', () => {
  const classesOf = (el: Element) => [...el.children].map((c) => c.className);

  it('is a plain list item with no link, no detail and the exact class stage-figure', () => {
    render(
      <ul>
        <Figure value="5" label="Items" />
      </ul>
    );
    const item = screen.getByRole('listitem');
    expect(item.className).toBe('stage-figure');
    expect(screen.queryByRole('link')).toBeNull();
    expect(classesOf(item)).toEqual(['stage-figure__value', 'stage-figure__label']);
    expect(item.textContent).toBe('5 Items');
  });

  it('with href is one link named value, label, detail; the class sits on the link, not on the li', () => {
    render(
      <ul>
        <Figure value="73" label="Delayed" detail="12 overdue · 61 late" tone="critical" href="#/shipments?flag=delayed" />
      </ul>
    );
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(1);
    const link = screen.getByRole('link', { name: '73 Delayed 12 overdue · 61 late' });
    expect(link).toBe(links[0]);
    expect(link).toHaveAttribute('href', '#/shipments?flag=delayed');
    expect(link.className).toBe('stage-figure stage-figure--critical');
    expect(screen.getByRole('listitem')).not.toHaveAttribute('class');
    expect(classesOf(link)).toEqual(['stage-figure__value', 'stage-figure__label', 'stage-figure__detail']);
  });

  it.each([
    { tone: 'critical', expected: 'stage-figure stage-figure--critical' },
    { tone: 'warning', expected: 'stage-figure stage-figure--warning' },
    { tone: 'neutral', expected: 'stage-figure' },
    { tone: undefined, expected: 'stage-figure' }
  ] as const)('tone $tone gives the class "$expected" exactly', ({ tone, expected }) => {
    render(
      <ul>
        <Figure value="1" label="Items" tone={tone} />
      </ul>
    );
    expect(screen.getByRole('listitem').className).toBe(expected);
  });

  it('puts children between the value and the label (the Analytics gauge), before the detail', () => {
    render(
      <ul>
        <Figure value="90.0%" label="On-time rate" detail="9 of 10 delivered on time">
          <span className="stage-gauge" aria-hidden="true" />
        </Figure>
      </ul>
    );
    expect(classesOf(screen.getByRole('listitem'))).toEqual([
      'stage-figure__value',
      'stage-gauge',
      'stage-figure__label',
      'stage-figure__detail'
    ]);
  });
});

// The states of buttons and selects live in components.css; jsdom cannot hover or press, so the rules are read as text.
describe('control states in components.css', () => {
  const css = readFileSync(resolve('src/client/styles/components.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  /** Every `selector { body }` pair, at any nesting depth, with the selector's whitespace collapsed. */
  const rules: Array<{ selector: string; body: string }> = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = (m[1] as string).trim().replace(/\s+/g, ' ');
    if (!selector.startsWith('@')) rules.push({ selector, body: m[2] as string });
  }
  const indexOf = (selector: string): number => rules.findIndex((r) => r.selector === selector);
  const bodyOf = (selector: string): string => rules[indexOf(selector)]?.body ?? '';
  const NO_SHIFT = /transform|translate|\btop:|\bleft:|margin|inset/;

  it('lets the link variant drop the box of .button', () => {
    const body = bodyOf('.button--link');
    expect(body).toMatch(/height:\s*auto/);
    expect(body).toMatch(/padding:\s*0/);
    expect(body).toMatch(/border:\s*0/);
    expect(body).toMatch(/background:\s*none/);
    expect(body).toMatch(/white-space:\s*normal/);
  });

  it('places the link rules after the .button rules they undo, and keeps the link without a background', () => {
    const hover = '.button--link:hover:not(:disabled)';
    const active = '.button--link:active:not(:disabled)';
    expect(indexOf('.button:hover:not(:disabled)')).toBeGreaterThanOrEqual(0);
    expect(indexOf(hover)).toBeGreaterThan(indexOf('.button:hover:not(:disabled)'));
    expect(indexOf(active)).toBeGreaterThan(indexOf('.button:active:not(:disabled)'));
    expect(bodyOf(hover)).toMatch(/background:\s*none/);
    expect(bodyOf(active)).toMatch(/background:\s*none/);
  });

  it('gives every variant a pressed step that changes colour and never shifts the button', () => {
    const selectors = [
      '.button:active:not(:disabled)',
      '.button--primary:active:not(:disabled)',
      '.button--ghost:active:not(:disabled)',
      '.button--danger:active:not(:disabled)',
      '.button--link:active:not(:disabled)'
    ];
    for (const selector of selectors) expect(indexOf(selector), selector).toBeGreaterThanOrEqual(0);
    const pressed = rules.filter((r) => r.selector.includes(':active'));
    expect(pressed.length).toBeGreaterThanOrEqual(selectors.length);
    for (const r of pressed) expect(r.body, r.selector).not.toMatch(NO_SHIFT);
  });

  it('uses one disabled opacity for buttons and selects', () => {
    const disabled = rules.filter((r) => /:disabled/.test(r.selector.replace(/:not\(:disabled\)/g, '')) && /opacity:/.test(r.body));
    expect(new Set(disabled.map((r) => /opacity:\s*([\d.]+)/.exec(r.body)?.[1]))).toEqual(new Set(['0.45']));
    expect(disabled.some((r) => r.selector.includes('.button:disabled') && r.selector.includes('.select-field__control:disabled'))).toBe(true);
  });

  it('fades a bare disabled button as much as the component buttons (base.css)', () => {
    const base = readFileSync(resolve('src/client/styles/base.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const bare = [...base.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => (m[1] as string).trim() === 'button:disabled');
    expect(bare).toHaveLength(1);
    expect((bare[0] as RegExpMatchArray)[2]).toMatch(/opacity:\s*0\.45;/);
  });

  it('darkens the select border on hover unless it is disabled', () => {
    expect(bodyOf('.select-field__control:hover:not(:disabled)')).toMatch(/border-color:\s*var\(--color-text-muted\)/);
  });

  // Lô 9: Button's unavailable and busy states (aria-disabled) fade like a disabled control, and the mouse passes through.
  it('fades an aria-disabled button like a disabled one and lets the mouse through it', () => {
    const body = bodyOf(".button[aria-disabled='true']");
    expect(body).toMatch(/opacity:\s*0\.45/);
    expect(body).toMatch(/pointer-events:\s*none/);
  });

  // Lô 9 review S1: opacity fades the whole button, its focus ring too (2.03:1 on the paper at 0.45). Tab still reaches an
  // unavailable button (Previous on page 1, Next on the last), so while it has the focus the fade lifts: 0.7 keeps the ring
  // above 3:1 and the button paler than a usable one.
  it('lifts the fade of a focused aria-disabled button, so its focus ring keeps 3:1', () => {
    const body = bodyOf(".button[aria-disabled='true']:focus-visible");
    expect(Number(/opacity:\s*([\d.]+)/.exec(body)?.[1])).toBeGreaterThanOrEqual(0.7);
  });

  // Lô 9: without the Popover API the sample note would sit in the top bar as a plain paragraph (Chromium cannot show it).
  it('hides the sample note where the browser has no popovers', () => {
    expect(css).toMatch(/@supports not selector\(:popover-open\)\s*\{\s*\.topbar__note\s*\{\s*display:\s*none;?\s*\}/);
  });
});

// The link states of a figure live in pages.css; jsdom cannot hover, so the rules are read as text.
describe('Figure link states in pages.css', () => {
  const css = readFileSync(resolve('src/client/styles/pages.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  /** Every `selector { body }` pair, with the selector's whitespace collapsed. */
  const rules: Array<{ selector: string; body: string }> = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = (m[1] as string).trim().replace(/\s+/g, ' ');
    if (!selector.startsWith('@')) rules.push({ selector, body: m[2] as string });
  }
  const bodyOf = (selector: string): string => rules.find((r) => r.selector === selector)?.body ?? '';

  it('gives the hover arrow empty alternative text, so it stays out of the link name', () => {
    expect(bodyOf('a.stage-figure .stage-figure__label::after')).toMatch(/content:\s*' →'\s*\/\s*''\s*;/);
  });

  it('underlines the label and shows the arrow on hover and focus, and keeps the ring 4px away', () => {
    const hover = 'a.stage-figure:hover .stage-figure__label, a.stage-figure:focus-visible .stage-figure__label';
    expect(bodyOf(hover)).toMatch(/text-decoration-color:\s*currentColor/);
    expect(bodyOf(hover.replaceAll('__label', '__label::after'))).toMatch(/opacity:\s*1/);
    expect(bodyOf('.stage-figure:focus-visible')).toMatch(/outline-offset:\s*4px/);
  });
});
