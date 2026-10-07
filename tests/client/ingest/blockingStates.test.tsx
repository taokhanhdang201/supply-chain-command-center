// @vitest-environment jsdom
// Criteria 15, 16, 18 and 51: Confirm stays disabled, with its reason linked, for every class of open question, and each
// panel offers the way out: ambiguous separator (nothing preselected), CHECK and CHOOSE columns, ambiguous and mixed
// number and date formats, unresolved status and warehouse values, missing required fields, constants for the allowed
// fields only, header confirmation, structural rows, currency refusal, tables to choose.

import { describe, expect, it, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { renderCard, review, settled, acknowledgeAll, fileOf, fileOfFixture, fixtureByName, confirmButton } from './uiHarness';
import { AMBIGUITY_FIXTURES } from '../../fixtures/ingest/corpus45';

beforeEach(() => {
  window.location.hash = '';
});

const ambiguity = (name: string): File => {
  const f = AMBIGUITY_FIXTURES.find((x) => x.name === name);
  if (f === undefined) throw new Error(name);
  return fileOfFixture(f);
};
const reason = (): string => document.getElementById(confirmButton().getAttribute('aria-describedby') as string)?.textContent ?? '';
const field = (label: RegExp): HTMLSelectElement => screen.getByLabelText(label) as HTMLSelectElement;

// Whole-card UI flows: in jsdom there is no Worker, so the ingest pipeline runs inline on the test's own thread.
// Measured: 0.2-0.5 s per test alone, up to ~1.6 s in the parallel full suite, and past the 5 s default only when the
// machine is also busy (a preview server, build and Playwright). 15 s as in pipelineLimits.test.ts; no assertion
// depends on time.
describe('blocking states', { timeout: 15_000 }, () => {
  it('an ambiguous separator is a choice with nothing preselected and the file is not read until it is made', async () => {
    const r = await renderCard();
    await review(r, fileOf('sku,product_name,category,warehouse;quantity;reorder_point;unit_cost\nA1,Bolt,Hardware,WH-DFW;5;2;1.5\nA2,Nut,Hardware,WH-ATL;9;3;0.5\n', 'tied.csv'));
    const separator = screen.getByLabelText('Separator') as HTMLSelectElement;
    expect(separator.value).toBe('');
    expect(within(separator).getAllByRole('option').map((o) => o.textContent)).toEqual(['Choose…', 'Comma ( , )', 'Semicolon ( ; )']);
    expect(screen.getAllByText('Choose').length).toBeGreaterThan(0);
    expect(screen.queryByRole('heading', { name: 'Match columns to SCC fields' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirm and import' })).not.toBeInTheDocument(); // no review yet
    expect(r.importCsv).not.toHaveBeenCalled();
    await r.user.selectOptions(separator, 'semicolon');
    await settled();
    expect(await screen.findByRole('heading', { name: 'Match columns to SCC fields' })).toBeInTheDocument();
  });

  it('CHECK columns need "Looks right" (or a choice); CHOOSE columns have nothing preselected', async () => {
    const r = await renderCard();
    await review(r, fileOfFixture(fixtureByName('alder_freight.csv')));
    expect(confirmButton()).toBeDisabled();
    expect(reason()).toMatch(/Check that the column "State" is status, then confirm it\./);
    expect(screen.getAllByText(/Check this/).length).toBeGreaterThan(0);
    const looksRight = screen.getAllByRole('button', { name: /^Looks right/ });
    expect(looksRight).toHaveLength(1);
    expect(looksRight[0]?.getAttribute('aria-label')).toBe('Looks right: column 5, State is status');
    await r.user.click(looksRight[0] as HTMLElement);
    await settled();
    expect(screen.queryByRole('button', { name: /^Looks right/ })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(field(/SCC field for column 5, State/)); // focus never drops to <body>
    await waitFor(() => expect(confirmButton()).toBeEnabled());
  });

  it('a column with no evidence is "Not imported", a mystery column with status-like values is only a CHECK, and the dataset must be chosen when the headers do not say', async () => {
    const r = await renderCard();
    await review(r, ambiguity('mystery_columns.csv'));
    expect(confirmButton()).toBeDisabled();
    expect(screen.getAllByText(/Choose whether this is inventory or shipments data\./).length).toBeGreaterThan(0);
    await r.user.click(screen.getByRole('radio', { name: /Shipments/ }));
    await settled();
    expect(field(/SCC field for column 1, Col1/).value).toBe('__ignore__');
    expect(screen.getAllByText('Not imported').length).toBeGreaterThan(0);
    expect(field(/SCC field for column 3, Col3/).value).toBe('status');
    expect(screen.getAllByText(/Check this/).length).toBeGreaterThan(0);
    expect(within(screen.getByRole('table', { name: 'Column mapping' })).queryByText(/Matched/)).not.toBeInTheDocument();
  });

  it('an ambiguous header (Cost, as in V1.5) is CHOOSE with nothing preselected; "Do not import" and a field are both valid answers', async () => {
    const r = await renderCard();
    const text = 'shipment_id,origin,destination,carrier,status,ship_date,estimated_delivery,Cost\nS1,WH-DFW,Houston,Alder,delivered,2026-03-02,2026-03-05,12.50\nS2,WH-ATL,Miami,Alder,pending,2026-03-03,2026-03-06,9.00\n';
    await review(r, fileOf(text, 'cost.csv'));
    const cost = field(/SCC field for column 8, Cost/);
    expect(cost.value).toBe('');
    expect(screen.getAllByText('Choose a field').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Choose an SCC field for the column "Cost"/).length).toBeGreaterThan(0);
    expect(confirmButton()).toBeDisabled();
    await r.user.selectOptions(cost, 'shipping_cost');
    await settled();
    expect(field(/SCC field for column 8, Cost/).value).toBe('shipping_cost');
    expect(screen.getByText('Chosen by you')).toBeInTheDocument();
  });

  it('ambiguous dates: radio choices, none selected, Confirm disabled with the reason, resolved by a choice', async () => {
    const r = await renderCard();
    await review(r, ambiguity('slash_dates_ambiguous.csv'));
    const group = screen.getByRole('group', { name: /Date format/ });
    const radios = within(group).getAllByRole('radio') as HTMLInputElement[];
    expect(radios.length).toBeGreaterThanOrEqual(2);
    expect(radios.every((x) => !x.checked)).toBe(true);
    expect(confirmButton()).toBeDisabled();
    // G1: dates are settled per column, so the reason names the column and a real value from it (it used to say "Choose
    // the date format of this file"); the file-wide choice below still answers every open column at once.
    expect(screen.getAllByText(/The column "ship_date" has dates that read two ways \(for example 03\/04\/2026/).length).toBeGreaterThan(0);
    await r.user.click(within(group).getByRole('radio', { name: /15\/8\/2026 \(day\/month\/year\)/ }));
    await settled();
    expect(screen.queryByRole('group', { name: /Date format/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Date format')).toBeInTheDocument(); // now an ordinary select showing the chosen format
    expect(screen.getByText('Chosen by you')).toBeInTheDocument();
  });

  it('ambiguous numbers (1,250): choice with no preselection', async () => {
    const r = await renderCard();
    await review(r, ambiguity('numbers_1_250_ambiguous.csv'));
    const group = screen.getByRole('group', { name: /Number format/ });
    expect((within(group).getAllByRole('radio') as HTMLInputElement[]).every((x) => !x.checked)).toBe(true);
    expect(screen.getAllByText(/Choose the number format of this file/).length).toBeGreaterThan(0);
    await r.user.click(within(group).getByRole('radio', { name: /Comma thousands/ }));
    await settled();
    expect(screen.queryByRole('group', { name: /Number format/ })).not.toBeInTheDocument();
  });

  it('mixed date formats block until a format is chosen; mixed number formats too', async () => {
    const r = await renderCard();
    await review(r, ambiguity('dates_mixed.csv'));
    const dates = screen.getByRole('group', { name: /Date format/ });
    expect(within(dates).getByText(/use different formats/)).toBeInTheDocument();
    expect((within(dates).getAllByRole('radio') as HTMLInputElement[]).every((x) => !x.checked)).toBe(true);
    expect(confirmButton()).toBeDisabled();
  });

  it('mixed number formats block with a choice', async () => {
    const r = await renderCard();
    await review(r, ambiguity('numbers_mixed.csv'));
    const numbers = screen.getByRole('group', { name: /Number format/ });
    expect(within(numbers).getByText(/use different formats/)).toBeInTheDocument();
    expect(confirmButton()).toBeDisabled();
  });

  it('refuses a foreign currency in a money column with the registry text and no way to confirm', async () => {
    const r = await renderCard();
    const text = 'sku,product_name,category,warehouse,quantity,reorder_point,unit_cost\nA1,Bolt,Hardware,WH-DFW,5,2,"€ 1.50"\nA2,Nut,Hardware,WH-ATL,9,3,"€ 0.50"\n';
    await review(r, fileOf(text, 'euro.csv'));
    expect(await screen.findAllByText(/SCC only supports US dollars/)).not.toHaveLength(0);
    expect(confirmButton()).toBeDisabled();
  });

  it('a file with only the header row says so instead of reaching the review', async () => {
    const r = await renderCard();
    await review(r, fileOf('sku,product_name,category,warehouse,quantity,reorder_point,unit_cost\n', 'header.csv'));
    expect(await screen.findByText('The file has a header but no data rows.')).toBeInTheDocument();
  });

  it('required inventory columns that are missing block the import and list what was found', async () => {
    const r = await renderCard();
    await review(r, fileOf('sku,product_name,category\nA1,Bolt,Hardware\nA2,Nut,Hardware\n', 'thin.csv'));
    await settled();
    if (screen.queryAllByText(/Choose whether this is inventory or shipments data\./).length > 0) {
      await r.user.click(screen.getByRole('radio', { name: /Inventory/ }));
      await settled();
    }
    expect(confirmButton()).toBeDisabled();
    expect(screen.getAllByText(/Required field quantity has no column\. Found columns: sku, product_name, category\./).length).toBeGreaterThan(0);
  });

  it('acknowledging every CHECK enables Confirm only when nothing else is open', async () => {
    const r = await renderCard();
    await review(r, fileOfFixture(fixtureByName('alder_freight.csv')));
    await acknowledgeAll(r.user);
    await waitFor(() => expect(confirmButton()).toBeEnabled());
    expect(confirmButton().getAttribute('aria-describedby')).toBeNull();
  });
});
