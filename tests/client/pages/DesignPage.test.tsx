// @vitest-environment jsdom
// The design reference (#/_design) renders without a console error, under one h1, and holds every block: the six type sizes;
// the type roles, each still declared by its stylesheet rule; the colors with their contrast on paper and on the band,
// recomputed from tokens.css; the spacing scale and the 12-column grid; and the shared components in their states, whose
// static hover, pressed and focus samples copy the live rules declaration for declaration.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { DesignPage } from '../../../src/client/pages/DesignPage';

const BLOCKS = [
  'Type',
  'Type roles',
  'Color',
  'Spacing',
  'Grid',
  'Buttons',
  'States',
  'Fields',
  'Links',
  'Table',
  'Pagination',
  'Section header',
  'Empty state',
  'Loading and error',
  'Figures',
  'Badges',
  'Page band',
  'Chip'
];
const block = (name: string) => screen.getByRole('region', { name });

const STYLES = path.resolve('src/client/styles');
/** Every `selector { body }` pair of a stylesheet (comments removed, whitespace collapsed), at any nesting depth. */
function rulesOf(file: string): Array<{ selector: string; body: string }> {
  const css = fs.readFileSync(path.join(STYLES, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map((m) => ({ selector: (m[1] as string).replace(/\s+/g, ' ').trim(), body: (m[2] as string).replace(/\s+/g, ' ').trim() }))
    .filter((r) => !r.selector.startsWith('@'));
}
/** A rule body as its declarations, `prop: value` each. */
const declsOf = (body: string): string[] =>
  body
    .split(';')
    .map((d) => d.trim())
    .filter(Boolean);
/** The rows of a table (header row left out), as the text of their cells. */
const cellsOf = (table: HTMLElement): string[][] =>
  within(table)
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell').map((c) => (c.textContent ?? '').trim()));

// WCAG 2 contrast from the values tokens.css gives a token: :root first, then .surface-stage.
const tokensCss = fs.readFileSync(path.join(STYLES, 'tokens.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const given = (name: string): string[] =>
  [...tokensCss.matchAll(new RegExp(`(?:^|[;{\\s])${name}:\\s*([^;]+);`, 'g'))].map((m) => (m[1] as string).trim());
/** A value with its var() followed to the :root value of the token it names. */
const plain = (value: string): string => {
  const m = /^var\((--[\w-]+)\)$/.exec(value);
  return m ? plain(given(m[1] as string)[0] ?? '') : value;
};
const rgba = (value: string): number[] =>
  value.startsWith('#') ? [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16)).concat(1) : [...(value.match(/[\d.]+/g) ?? []).map(Number), 1].slice(0, 4);
const luminance = (c: number[]): number => {
  const f = (x: number) => (x / 255 <= 0.03928 ? x / 255 / 12.92 : ((x / 255 + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(c[0] as number) + 0.7152 * f(c[1] as number) + 0.0722 * f(c[2] as number);
};
/** The contrast of a color laid over a background (its alpha composited first). */
function contrast(color: string, background: string): number {
  const bg = rgba(background);
  const fg = rgba(color);
  const a = fg[3] as number;
  const mixed = [0, 1, 2].map((i) => (fg[i] as number) * a + (bg[i] as number) * (1 - a));
  const x = luminance(mixed);
  const y = luminance(bg);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** The live state rules the page copies, in the order design.css keeps them (hover before pressed, as components.css). */
const LIVE_STATES: ReadonlyArray<readonly [file: string, selector: string]> = [
  ['components.css', '.button:hover:not(:disabled)'],
  ['components.css', '.button--primary:hover:not(:disabled)'],
  ['components.css', '.button--ghost:hover:not(:disabled)'],
  ['components.css', '.button--danger:hover:not(:disabled)'],
  ['components.css', '.button--link:hover:not(:disabled)'],
  ['components.css', '.button:active:not(:disabled)'],
  ['components.css', '.button--primary:active:not(:disabled)'],
  ['components.css', '.button--ghost:active:not(:disabled)'],
  ['components.css', '.button--danger:active:not(:disabled)'],
  ['components.css', '.button--link:active:not(:disabled)'],
  ['components.css', '.select-field__control:hover:not(:disabled)'],
  ['base.css', ':focus-visible'],
  ['atlas.css', '.atlas-page .dash-link:hover']
];
const HOVER = ":is([data-state='hover'], [data-state='active'])";
/** The selector of a live rule's static copy: a pressed control is hovered too, so a hover copy also matches "active". */
const toStatic = (selector: string): string =>
  selector
    .replace(':hover:not(:disabled)', HOVER)
    .replace(':active:not(:disabled)', "[data-state='active']")
    .replace(/:hover$/, HOVER)
    .replace(/^:focus-visible$/, "[data-state='focus']");

describe('DesignPage', () => {
  it('renders without a console error, under its own h1, with unique ids', () => {
    const error = vi.spyOn(console, 'error');
    render(<DesignPage />);
    expect(error).not.toHaveBeenCalled();
    // One h1: the slim band sample draws its title as a paragraph.
    expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual(['Design system']);
    const ids = [...document.querySelectorAll('[id]')].map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has one section per part of the system, named by its h2, in order', () => {
    render(<DesignPage />);
    expect(screen.getAllByRole('region').map((r) => document.getElementById(r.getAttribute('aria-labelledby') ?? '')?.textContent)).toEqual(BLOCKS);
  });

  it('type, color, spacing, grid: the six sizes, three surfaces and nine colors with their meaning, thirteen steps, twelve columns', () => {
    render(<DesignPage />);
    const sizes = within(block('Type')).getAllByRole('listitem');
    expect(sizes).toHaveLength(6);
    expect(sizes.map((li) => li.querySelector('.design-sheet__note')?.textContent?.split(' · ')[0])).toEqual(['--text-xs', '--text-sm', '--text-md', '--text-lg', '--text-xl', '--text-display']);
    expect(block('Color').querySelectorAll('.design-sheet__swatch')).toHaveLength(3);
    expect(block('Color').querySelectorAll('.design-sheet__dot')).toHaveLength(18);
    for (const name of ['Critical', 'Warning', 'Neutral', 'Good', 'Accent', 'Text', 'Muted text', 'Subtle text', 'Control edge']) {
      expect(within(block('Color')).getByText(name)).toBeInTheDocument();
    }
    expect(block('Spacing').querySelectorAll('.design-sheet__bar')).toHaveLength(13);
    expect(within(block('Spacing')).getByText('--space-32 · 128px')).toBeInTheDocument();
    expect(block('Grid').querySelectorAll('.design-sheet__cell')).toHaveLength(12);
  });

  // The table says what each rule declares, so it cannot drift from the stylesheets: every line of its CSS column is read back
  // from the rule its last column names.
  it('type roles: each row shows declarations its stylesheet rule still has', () => {
    render(<DesignPage />);
    const rows = cellsOf(within(block('Type roles')).getByRole('table'));
    expect(rows).toHaveLength(10);
    for (const [, , css, rule] of rows) {
      const [selector, file] = (rule as string).split(' · ') as [string, string];
      const declared = rulesOf(file)
        .filter((r) => r.selector.split(',').map((s) => s.trim()).includes(selector))
        .flatMap((r) => declsOf(r.body));
      expect(declared.length, `${selector} in ${file}`).toBeGreaterThan(0);
      for (const d of (css as string).split('; ')) expect(declared, `${selector}: ${d}`).toContain(d);
    }
  });

  it('color: every ratio is the WCAG contrast of its token on the paper floor and on the band (tokens.css)', () => {
    render(<DesignPage />);
    const rows = cellsOf(within(block('Color')).getByRole('table'));
    expect(rows.map((r) => r[1])).toEqual([
      '--critical',
      '--warning',
      '--neutral',
      '--good',
      '--color-accent',
      '--color-text',
      '--color-text-muted',
      '--color-text-subtle',
      '--color-border'
    ]);
    const paper = plain(given('--color-bg')[0] ?? '');
    const band = plain(given('--stage-bg')[0] ?? '');
    for (const [, token, , onPaper, onBand] of rows) {
      const values = given(token as string);
      expect(values, `${token}: one value on paper, one on the band`).toHaveLength(2);
      expect(onPaper, `${token} on paper`).toBe(`${contrast(plain(values[0] as string), paper).toFixed(1)}:1`);
      expect(onBand, `${token} on the band`).toBe(`${contrast(plain(values[1] as string), band).toFixed(1)}:1`);
    }
  });

  // jsdom cannot hover, press or focus-visible; the copies are compared with the live rules as text (the browser compares the
  // rendered looks: tests/tester/designPage.dev.browser.test.ts).
  it('states: each static hover, pressed and focus sample copies its live rule, declaration for declaration, in order', () => {
    const design = rulesOf('design.css');
    const at = LIVE_STATES.map(([file, selector]) => {
      const live = rulesOf(file).filter((r) => r.selector === selector);
      expect(live, `${selector} in ${file}`).toHaveLength(1);
      const copy = design.findIndex((r) => r.selector === toStatic(selector));
      expect(copy, `${toStatic(selector)} in design.css`).toBeGreaterThanOrEqual(0);
      expect(declsOf((design[copy] as { body: string }).body), toStatic(selector)).toEqual(declsOf((live[0] as { body: string }).body));
      return copy;
    });
    expect(at).toEqual([...at].sort((a, b) => a - b));
  });

  it('states table: five button variants at rest, hover, pressed, focus and unavailable; a select at rest, hover, focus, disabled', () => {
    render(<DesignPage />);
    const states = block('States');
    expect(within(states).getAllByRole('row')).toHaveLength(7);
    expect(states.querySelectorAll("[data-state='hover']")).toHaveLength(6);
    expect(states.querySelectorAll("[data-state='active']")).toHaveLength(5);
    expect(states.querySelectorAll("[data-state='focus']")).toHaveLength(6);
    for (const sample of states.querySelectorAll('[data-state]')) expect(sample).toHaveAttribute('tabindex', '-1');
    expect(states.querySelectorAll(".button[aria-disabled='true']")).toHaveLength(5);
    expect(states.querySelectorAll('select:disabled')).toHaveLength(1);
  });

  it('buttons: five variants at two sizes, each default, disabled and busy', () => {
    render(<DesignPage />);
    const buttons = within(block('Buttons')).getAllByRole('button') as HTMLButtonElement[];
    expect(buttons).toHaveLength(30);
    for (const v of ['primary', 'ghost', 'danger', 'link']) expect(buttons.filter((b) => b.classList.contains(`button--${v}`)), v).toHaveLength(6);
    expect(buttons.filter((b) => !/button--(primary|ghost|danger|link)\b/.test(b.className)), 'secondary').toHaveLength(6);
    expect(buttons.filter((b) => b.classList.contains('button--sm'))).toHaveLength(15);
    expect(buttons.filter((b) => b.getAttribute('aria-busy') === 'true')).toHaveLength(10);
    expect(buttons.filter((b) => b.getAttribute('aria-disabled') === 'true')).toHaveLength(20); // aria-disabled, not disabled
    expect(buttons.filter((b) => b.disabled)).toHaveLength(0);
  });

  it('fields: a select, a disabled one and one with its label hidden; a search empty and one with text', () => {
    render(<DesignPage />);
    const fields = block('Fields');
    expect(fields.querySelector('.filter-bar')).not.toBeNull();
    const selects = within(fields).getAllByRole('combobox') as HTMLSelectElement[];
    expect(selects).toHaveLength(3);
    expect(selects.filter((s) => s.disabled)).toHaveLength(1);
    expect(within(fields).getByText('Sort by, label hidden')).toHaveClass('visually-hidden');
    expect(within(fields).getByRole('combobox', { name: 'Sort by, label hidden' })).toBeInTheDocument();
    expect(within(fields).getAllByRole('searchbox')).toHaveLength(2);
    expect(within(fields).getAllByRole('button', { name: 'Clear search' })).toHaveLength(1);
  });

  it('links on paper and on the dark map, a number table, loading and error', () => {
    render(<DesignPage />);
    const links = block('Links');
    expect(links.querySelectorAll('a.text-link')).toHaveLength(2);
    expect(links.querySelectorAll('.atlas-page .scene--dark.surface-stage a.dash-link')).toHaveLength(3);
    expect(links.querySelectorAll('[data-state]')).toHaveLength(3);
    const table = within(block('Table')).getByRole('table', { name: 'Stock, a sample' });
    expect(table.querySelectorAll('th.data-table__header--right')).toHaveLength(3);
    expect(within(table).getByRole('columnheader', { name: 'Qty' })).toHaveAttribute('aria-sort', 'descending');
    expect(cellsOf(table).map((r) => r.slice(2))).toEqual([
      ['1,240', '$617.07', '$765,167'],
      ['84', '$245.50', '$20,622'],
      ['0', '$12.40', '$0']
    ]);
    const loading = block('Loading and error');
    expect(within(loading).getByRole('status')).toHaveAttribute('aria-busy', 'true');
    expect(within(within(loading).getByRole('alert')).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('pagination on the first page and in the middle; section header with and without an action; empty state short and full', () => {
    render(<DesignPage />);
    const navs = within(block('Pagination')).getAllByRole('navigation', { name: 'Pagination' });
    expect(navs).toHaveLength(2);
    expect(within(navs[0] as HTMLElement).getByRole('button', { name: 'Previous' })).toHaveAttribute('aria-disabled', 'true');
    expect(within(navs[1] as HTMLElement).getByRole('button', { name: 'Previous' })).not.toHaveAttribute('aria-disabled');
    expect(block('Section header').querySelectorAll('.section-bar')).toHaveLength(3); // the block's own and two samples
    expect(block('Section header').querySelectorAll('.section-bar__actions')).toHaveLength(1);
    const states = within(block('Empty state')).getAllByRole('status');
    expect(states).toHaveLength(2);
    expect(within(states[1] as HTMLElement).getByRole('button', { name: 'Clear filters' })).toBeInTheDocument();
  });

  it('figures in three tones without and with a link on the stage; five badges; the compact and slim bands; the source chips', () => {
    render(<DesignPage />);
    const figures = block('Figures');
    expect(figures.querySelector('.surface-stage')).not.toBeNull();
    expect(figures.querySelectorAll('ul.figure-stage__figures > li')).toHaveLength(6);
    expect(within(figures).getAllByRole('link')).toHaveLength(3);
    expect(figures.querySelectorAll('.stage-figure--critical')).toHaveLength(2);
    expect(figures.querySelectorAll('.stage-figure--warning')).toHaveLength(2);
    expect([...figures.querySelectorAll('.stage-figure')].filter((f) => f.className === 'stage-figure')).toHaveLength(2);
    expect([...block('Badges').querySelectorAll('.badge')].map((b) => b.className)).toEqual([
      'badge badge--neutral',
      'badge badge--info',
      'badge badge--good',
      'badge badge--warning',
      'badge badge--critical'
    ]);
    // The context line says what the page holds: the scales and the shared components, not every token and component.
    expect(document.querySelector('.page-stage--compact .page-stage__context')?.textContent).toBe(
      'The type, color and spacing scales, the grid, and the shared components most pages use, with their states. Development builds only.'
    );
    expect(block('Page band').querySelectorAll('.page-stage--slim')).toHaveLength(1);
    expect(block('Page band').querySelector('.page-stage--slim .page-stage__title')?.tagName).toBe('P');
    expect([...block('Chip').querySelectorAll('.topbar__chip')].map((c) => c.textContent)).toEqual(['Sample data', 'Inventory: carrier-export.csv']);
    expect(document.querySelector('.topbar__chip--sample')).toBeNull(); // the anchor name belongs to the real top bar
  });
});
