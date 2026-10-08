// @vitest-environment jsdom
// Phase 1 spec §6 component contracts: Button, SelectField, Pagination, SectionHeader, EmptyState, SearchInput and the control
// states in components.css (hover, active, disabled).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from '../../../src/client/components/ui/Button';
import { EmptyState } from '../../../src/client/components/ui/EmptyState';
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
    expect(off).toBeDisabled();
    await user.click(off);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('busy sets aria-busy="true" and disables the button, so a click does nothing', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button variant="link" busy onClick={onClick}>
        Undoing…
      </Button>
    );
    const button = screen.getByRole('button', { name: 'Undoing…' });
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toBeDisabled();
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
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
    expect(within(nav).getByRole('button', { name: 'Previous' })).toBeDisabled();
    expect(within(nav).getByRole('button', { name: 'Next' })).toBeEnabled();
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

  it('darkens the select border on hover unless it is disabled', () => {
    expect(bodyOf('.select-field__control:hover:not(:disabled)')).toMatch(/border-color:\s*var\(--color-text-muted\)/);
  });
});
