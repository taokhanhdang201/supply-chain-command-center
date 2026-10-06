// @vitest-environment jsdom
// Criterion 40 (and 51): every panel opens with focus on its heading (tabIndex -1), every select and radio has a unique
// accessible name (blank header -> "(blank)", duplicate headers distinguishable by position), counters and errors are in
// live regions, the reason Confirm is disabled is linked with aria-describedby, evidence expanders are buttons with
// aria-expanded and aria-controls, confidence is text plus icon, tables have captions, nothing drops focus to <body>,
// and the new CSS is token-only with no motion.

import { describe, expect, it, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { screen, within } from '@testing-library/react';
import { renderCard, review, settled, acknowledgeAll, fileOf, fileOfFixture, fixtureByName, confirmButton } from './uiHarness';

beforeEach(() => {
  window.location.hash = '';
});

describe('accessibility of the universal import card', () => {
  it('every panel heading is focusable but not a tab stop, and the first panel that opens receives focus', async () => {
    const r = await renderCard();
    await review(r, fileOfFixture(fixtureByName('brightwater_banner.csv')));
    const names = ['Detected format', 'Structure of the table', 'Match columns to SCC fields', 'Review before importing'];
    for (const name of names) expect(screen.getByRole('heading', { name })).toHaveAttribute('tabindex', '-1');
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Detected format' }));
  });

  it('a panel that opens while the user is working in another panel does not steal focus', async () => {
    const r = await renderCard();
    await review(r, fileOfFixture(fixtureByName('fjord_sap_inventory.csv')));
    const select = screen.getByLabelText(/SCC field for column 1,/);
    select.focus();
    await r.user.selectOptions(select, '__ignore__');
    await settled();
    expect(document.activeElement).toBe(screen.getByLabelText(/SCC field for column 1,/));
  });

  it('gives every select a unique accessible name: blank headers read "(blank)", duplicate headers differ by position', async () => {
    const r = await renderCard();
    const text = 'shipment_id,origin,destination,carrier,status,ship_date,,Notes,Notes\nSHP-901,WH-DFW,Houston,Alder,delivered,2026-03-02,x,a,b\nSHP-902,WH-ATL,Miami,Alder,pending,2026-03-03,y,c,d\n';
    await review(r, fileOf(text, 'dups.csv'));
    if (screen.queryAllByText(/Choose whether this is inventory or shipments data\./).length > 0) {
      await r.user.click(screen.getByRole('radio', { name: /Shipments/ }));
      await settled();
    }
    const labels = within(screen.getByRole('table', { name: 'Column mapping' }))
      .getAllByRole('combobox')
      .map((s) => s.getAttribute('aria-label') as string);
    expect(labels).toHaveLength(9);
    expect(new Set(labels).size).toBe(9);
    expect(labels).toContain('SCC field for column 7, (blank)');
    expect(labels).toContain('SCC field for column 8, Notes');
    expect(labels).toContain('SCC field for column 9, Notes');
  });

  it('evidence expanders are buttons with aria-expanded and aria-controls that reveal the reasons', async () => {
    const r = await renderCard();
    await review(r, fileOfFixture(fixtureByName('alder_freight.csv')));
    const table = screen.getByRole('table', { name: 'Column mapping' });
    const why = within(table).getAllByRole('button', { name: /^Why\?/ })[0] as HTMLElement;
    expect(why.tagName).toBe('BUTTON');
    expect(why).toHaveAttribute('aria-expanded', 'false');
    const controlled = document.getElementById(why.getAttribute('aria-controls') as string) as HTMLElement;
    expect(controlled).not.toBeNull();
    expect(controlled.hidden).toBe(true);
    await r.user.click(why);
    expect(why).toHaveAttribute('aria-expanded', 'true');
    expect(controlled.hidden).toBe(false);
    expect(controlled.textContent?.length).toBeGreaterThan(10);
    await r.user.click(why);
    expect(why).toHaveAttribute('aria-expanded', 'false');
  });

  it('conveys confidence by text and an icon, never by colour alone', async () => {
    const r = await renderCard();
    await review(r, fileOfFixture(fixtureByName('alder_freight.csv')));
    const table = screen.getByRole('table', { name: 'Column mapping' });
    const badges = [...table.querySelectorAll('.badge')];
    expect(badges.length).toBeGreaterThan(5);
    for (const badge of badges) {
      expect(badge.textContent?.trim().length).toBeGreaterThan(0);
      if (/Matched|Check this|Choose a field|Checked|Chosen by you/.test(badge.textContent ?? '')) expect(badge.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    }
  });

  it('links the reason Confirm is disabled with aria-describedby, and removes the link when it is enabled', async () => {
    const r = await renderCard();
    await review(r, fileOfFixture(fixtureByName('alder_freight.csv')));
    expect(confirmButton()).toBeDisabled();
    const reason = document.getElementById(confirmButton().getAttribute('aria-describedby') as string);
    expect(reason?.textContent).toMatch(/Check that the column "State" is status/);
    await acknowledgeAll(r.user);
    expect(confirmButton()).toBeEnabled();
    expect(confirmButton().getAttribute('aria-describedby')).toBeNull();
  });

  it('keeps a live status region mounted, marks the card busy only while working, and gives every table a caption', async () => {
    const r = await renderCard();
    expect(document.querySelector('[data-ingest-card]')?.getAttribute('aria-busy')).toBe('false');
    expect(document.querySelectorAll('.ingest-status[aria-live="polite"]')).toHaveLength(1);
    expect(screen.queryByRole('status')).not.toBeInTheDocument(); // idle: no extra status role next to the legacy cards' own (pinned by the V1.5 panel tests)
    await review(r, fileOfFixture(fixtureByName('fjord_sap_inventory.csv')));
    expect(document.querySelectorAll('.ingest-status[aria-live="polite"]')).toHaveLength(1);
    const tables = [...document.querySelectorAll('[data-ingest-card] table')];
    expect(tables.length).toBeGreaterThan(2);
    for (const t of tables) expect(t.querySelector('caption')?.textContent?.length).toBeGreaterThan(0);
    // the counters of the review are announced
    expect(screen.getByText(/rows read/).closest('[role="status"]')).not.toBeNull();
  });

  it('errors are announced: a refused file shows an alert', async () => {
    const r = await renderCard();
    await review(r, fileOf(new Uint8Array(40), 'x.bin'));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/This looks like a binary file/);
  });

  it('dataset and table choices are fieldset/legend radio groups', async () => {
    const r = await renderCard();
    await review(r, fileOfFixture(fixtureByName('both_kinds_16_columns.csv')));
    const group = screen.getByRole('group', { name: /What does this file contain\?/ });
    expect(group.tagName).toBe('FIELDSET');
    expect(group.querySelector('legend')).not.toBeNull();
    expect(within(group).getAllByRole('radio')).toHaveLength(2);
  });
});

describe('the stylesheet for the new panels', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/client/styles/components.css'), 'utf8');
  const block = css.slice(css.indexOf('V2 universal import ("Import any file")'));

  it('is additive, uses only the existing tokens (light and dark follow them) and has no motion', () => {
    expect(block.length).toBeGreaterThan(1500);
    expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(block).not.toMatch(/\brgba?\(/);
    expect(block).not.toMatch(/\b(animation|transition|@keyframes)\b/);
    for (const m of block.matchAll(/var\((--[a-z0-9-]+)/g)) expect(readFileSync(resolve(process.cwd(), 'src/client/styles/tokens.css'), 'utf8')).toContain(m[1] as string);
  });
});
