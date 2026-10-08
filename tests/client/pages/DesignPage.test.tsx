// @vitest-environment jsdom
// Phase 1 spec §10: the design reference renders without a console error and holds every block: six type sizes, five colours
// with their meaning, the spacing scale, the 12-column grid, and every component of §6 in every state.
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { DesignPage } from '../../../src/client/pages/DesignPage';

const BLOCKS = ['Type', 'Color', 'Spacing', 'Grid', 'Buttons', 'Fields', 'Pagination', 'Section header', 'Empty state', 'Figures', 'Badges', 'Page band', 'Chip'];
const block = (name: string) => screen.getByRole('region', { name });

describe('DesignPage', () => {
  it('renders without a console error, under its own h1, with unique ids', () => {
    const error = vi.spyOn(console, 'error');
    render(<DesignPage />);
    expect(error).not.toHaveBeenCalled();
    expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual(['Design system', 'Data Import']);
    const ids = [...document.querySelectorAll('[id]')].map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has one section per part of the system, named by its h2, in order', () => {
    render(<DesignPage />);
    expect(screen.getAllByRole('region').map((r) => document.getElementById(r.getAttribute('aria-labelledby') ?? '')?.textContent)).toEqual(BLOCKS);
  });

  it('type, color, spacing, grid: the six sizes, five tones with their meaning, thirteen steps, twelve columns', () => {
    render(<DesignPage />);
    const sizes = within(block('Type')).getAllByRole('listitem');
    expect(sizes).toHaveLength(6);
    expect(sizes.map((li) => li.querySelector('.design-sheet__note')?.textContent?.split(' · ')[0])).toEqual(['--text-xs', '--text-sm', '--text-md', '--text-lg', '--text-xl', '--text-display']);
    expect(block('Color').querySelectorAll('.design-sheet__swatch')).toHaveLength(5);
    for (const name of ['Critical', 'Warning', 'Neutral', 'Good', 'Accent']) expect(within(block('Color')).getByText(name)).toBeInTheDocument();
    expect(block('Spacing').querySelectorAll('.design-sheet__bar')).toHaveLength(13);
    expect(within(block('Spacing')).getByText('--space-32 · 128px')).toBeInTheDocument();
    expect(block('Grid').querySelectorAll('.design-sheet__cell')).toHaveLength(12);
  });

  it('buttons: five variants at two sizes, each default, disabled and busy', () => {
    render(<DesignPage />);
    const buttons = within(block('Buttons')).getAllByRole('button') as HTMLButtonElement[];
    expect(buttons).toHaveLength(30);
    for (const v of ['primary', 'ghost', 'danger', 'link']) expect(buttons.filter((b) => b.classList.contains(`button--${v}`)), v).toHaveLength(6);
    expect(buttons.filter((b) => !/button--(primary|ghost|danger|link)\b/.test(b.className)), 'secondary').toHaveLength(6);
    expect(buttons.filter((b) => b.classList.contains('button--sm'))).toHaveLength(15);
    expect(buttons.filter((b) => b.getAttribute('aria-busy') === 'true')).toHaveLength(10);
    expect(buttons.filter((b) => b.disabled)).toHaveLength(20);
  });

  it('fields: a select, a disabled one and one with its label hidden; a search empty and one with text', () => {
    render(<DesignPage />);
    const fields = block('Fields');
    const selects = within(fields).getAllByRole('combobox') as HTMLSelectElement[];
    expect(selects).toHaveLength(3);
    expect(selects.filter((s) => s.disabled)).toHaveLength(1);
    expect(within(fields).getByText('Sort by, label hidden')).toHaveClass('visually-hidden');
    expect(within(fields).getByRole('combobox', { name: 'Sort by, label hidden' })).toBeInTheDocument();
    expect(within(fields).getAllByRole('searchbox')).toHaveLength(2);
    expect(within(fields).getAllByRole('button', { name: 'Clear search' })).toHaveLength(1);
  });

  it('pagination on the first page and in the middle; section header with and without an action; empty state short and full', () => {
    render(<DesignPage />);
    const navs = within(block('Pagination')).getAllByRole('navigation', { name: 'Pagination' });
    expect(navs).toHaveLength(2);
    expect(within(navs[0] as HTMLElement).getByRole('button', { name: 'Previous' })).toBeDisabled();
    expect(within(navs[1] as HTMLElement).getByRole('button', { name: 'Previous' })).toBeEnabled();
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
    expect(document.querySelector('.page-stage--compact .page-stage__context')?.textContent).toBe('Every token and component, in every state. Development builds only.');
    expect(block('Page band').querySelectorAll('.page-stage--slim')).toHaveLength(1);
    expect([...block('Chip').querySelectorAll('.topbar__chip')].map((c) => c.textContent)).toEqual(['Sample data', 'Inventory: carrier-export.csv']);
    expect(document.querySelector('.topbar__chip--sample')).toBeNull(); // the anchor name belongs to the real top bar
  });
});
