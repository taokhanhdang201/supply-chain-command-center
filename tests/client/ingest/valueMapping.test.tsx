// @vitest-environment jsdom
// Criteria 15, 16, 18 and 51: the value-mapping panel (status and warehouse words with counts, nothing preselected when
// unresolved), the locations summary, file-wide constants for the allowed fields only, the "fields the file does not have"
// notices, and the "Not imported" list.

import { describe, expect, it, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { renderCard, review, settled, acknowledgeAll, fileOf, fileOfFixture, fixtureByName, confirmButton } from './uiHarness';

beforeEach(() => {
  window.location.hash = '';
});

const SHIP_HEAD = 'shipment_id,origin,destination,carrier,status,ship_date,estimated_delivery,actual_delivery,shipping_cost';
const ship = (rows: string[], head = SHIP_HEAD): string => `${head}\n${rows.join('\n')}\n`;
const select = (label: RegExp): HTMLSelectElement => screen.getByLabelText(label) as HTMLSelectElement;
const todo = (): string[] => [...document.querySelectorAll('.ingest-todo li')].map((li) => li.textContent ?? '');

describe('value mapping panel', () => {
  it('shows each distinct status word with its count and proposed status; an ambiguous word has nothing preselected', async () => {
    const r = await renderCard();
    const text = ship([
      'SHP-901,WH-DFW,Houston TX,Alder,Shipped,2026-03-02,2026-03-05,,10.00',
      'SHP-902,WH-ATL,Miami FL,Alder,Shipped,2026-03-03,2026-03-06,,11.00',
      'SHP-903,WH-ORD,Denver CO,Alder,Arrived,2026-03-04,2026-03-07,,12.00',
      'SHP-904,WH-LAX,Boston MA,Alder,Delivered,2026-03-01,2026-03-03,2026-03-03,13.00'
    ]);
    await review(r, fileOf(text, 'status.csv'));
    const table = screen.getByRole('table', { name: 'Status value mapping' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(3);
    expect(within(rows[0] as HTMLElement).getByText('Shipped')).toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).getByText('2')).toBeInTheDocument(); // two rows say "Shipped"
    expect(select(/SCC status for value "Shipped"/).value).toBe('in_transit');
    expect(select(/SCC status for value "Arrived"/).value).toBe('');
    expect(within(table).getByText('Choose')).toBeInTheDocument();
    expect(confirmButton()).toBeDisabled();
    expect(screen.getAllByText(/1 status value need an SCC status: "Arrived"\./).length).toBeGreaterThan(0);
    await r.user.selectOptions(select(/SCC status for value "Arrived"/), 'in_transit');
    await settled();
    expect(select(/SCC status for value "Arrived"/).value).toBe('in_transit');
    expect(within(screen.getByRole('table', { name: 'Status value mapping' })).getByText('Chosen by you')).toBeInTheDocument();
  });

  it('warehouse values that are not SCC warehouses need an explicit choice among the five known codes', async () => {
    const r = await renderCard();
    await review(r, fileOfFixture(fixtureByName('fjord_sap_inventory.csv')));
    await acknowledgeAll(r.user);
    const table = screen.getByRole('table', { name: 'Warehouse value mapping' });
    const pickers = within(table).getAllByRole('combobox') as HTMLSelectElement[];
    expect(pickers.length).toBeGreaterThan(0);
    expect(pickers.every((p) => p.value === '')).toBe(true);
    expect(within(pickers[0] as HTMLElement).getAllByRole('option').map((o) => o.textContent)).toEqual(['Choose a warehouse…', 'WH-ATL', 'WH-DFW', 'WH-EWR', 'WH-LAX', 'WH-ORD']);
    expect(screen.getByText(/SCC knows five warehouses/)).toBeInTheDocument();
    expect(confirmButton()).toBeDisabled();
    expect(screen.getAllByText(/are not SCC warehouses/).length).toBeGreaterThan(0);
    for (let guard = 0; guard < 10; guard += 1) {
      const open = (within(screen.getByRole('table', { name: 'Warehouse value mapping' })).getAllByRole('combobox') as HTMLSelectElement[]).find((p) => p.value === '');
      if (open === undefined) break;
      await r.user.selectOptions(open, 'WH-DFW');
      await settled();
    }
    await acknowledgeAll(r.user);
    await waitFor(() => expect(confirmButton()).toBeEnabled());
  });

  it('summarizes recognized versus unmapped routes and lists the unmapped values (nothing is hidden)', async () => {
    const r = await renderCard();
    const text = ship(['SHP-901,WH-DFW,Houston TX,Alder,delivered,2026-03-02,2026-03-05,2026-03-05,10.00', 'SHP-902,Dallas,Smalltown,Alder,pending,2026-03-03,2026-03-06,,11.00']);
    await review(r, fileOf(text, 'routes.csv'));
    const status = screen.getByText(/Locations recognized: \d+ of \d+ rows; \d+ will appear as unmapped routes\./);
    expect(status).toBeInTheDocument();
    expect(screen.getByText(/These values are imported as written:/)).toBeInTheDocument();
    expect(screen.getAllByText(/Smalltown/).length).toBeGreaterThan(0);
  });

  it('offers one constant for the whole file only for the allowed fields, labelled "Constant you entered"', async () => {
    const r = await renderCard();
    const head = 'shipment_id,origin,destination,status,ship_date,estimated_delivery,actual_delivery,shipping_cost';
    await review(r, fileOf(ship(['SHP-901,WH-DFW,Houston TX,delivered,2026-03-02,2026-03-05,2026-03-05,10.00', 'SHP-902,WH-ATL,Miami FL,pending,2026-03-03,2026-03-06,,11.00'], head), 'nocarrier.csv'));
    expect(screen.getAllByText(/No column provides carrier\. Enter one value for the whole file, or map a column to it\./).length).toBeGreaterThan(0);
    expect(confirmButton()).toBeDisabled();
    const input = screen.getByLabelText('carrier: one value for the whole file') as HTMLInputElement;
    await r.user.type(input, 'Alder Freight');
    await r.user.click(screen.getByRole('button', { name: 'Use for the whole file' }));
    await settled();
    expect(screen.getByText('Constant you entered')).toBeInTheDocument();
    expect(screen.queryByText(/No column provides carrier/)).not.toBeInTheDocument();
    await acknowledgeAll(r.user);
    expect(todo()).toEqual([]);
    await waitFor(() => expect(confirmButton()).toBeEnabled());
    // the constant can be removed again, and focus stays on the field (never on <body>)
    await r.user.click(screen.getByRole('button', { name: 'Remove carrier constant' }));
    await settled();
    expect(document.activeElement).toBe(screen.getByLabelText('carrier: one value for the whole file'));
    expect(screen.getAllByText(/No column provides carrier/).length).toBeGreaterThan(0);
  });

  it('never offers a constant for ids, dates, quantities or costs: a missing required field just blocks', async () => {
    const r = await renderCard();
    await review(r, fileOf('sku,product_name,category,warehouse\nA1,Bolt,Hardware,WH-DFW\nA2,Nut,Hardware,WH-ATL\n', 'noqty.csv'));
    await settled();
    if (screen.queryAllByText(/Choose whether this is inventory or shipments data./).length > 0) {
      await r.user.click(screen.getByRole('radio', { name: /Inventory/ }));
      await settled();
    }
    expect(screen.queryByLabelText(/quantity: one value for the whole file/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/unit_cost: one value for the whole file/)).not.toBeInTheDocument();
    expect(screen.getAllByText(/Required field quantity has no column\./).length).toBeGreaterThan(0);
    expect(confirmButton()).toBeDisabled();
  });

  it('says what a missing optional field means instead of inventing it', async () => {
    const r = await renderCard();
    const head = 'shipment_id,origin,destination,carrier,status,ship_date,shipping_cost';
    await review(r, fileOf(ship(['SHP-901,WH-DFW,Houston TX,Alder,delivered,2026-03-02,10.00', 'SHP-902,WH-ATL,Miami FL,Alder,pending,2026-03-03,11.00'], head), 'noeta.csv'));
    expect(screen.getByText('No estimated delivery column: on-time analytics will be limited.')).toBeInTheDocument();
    expect(screen.getByText(/No actual delivery column: delivery dates stay unknown\./)).toBeInTheDocument();
  });

  it('lists the columns that are not imported with the reason, inside the review', async () => {
    const r = await renderCard();
    await review(r, fileOfFixture(fixtureByName('fjord_sap_inventory.csv')));
    const summary = screen.getByText(/Not imported \(1 column\)/);
    expect(summary).toBeInTheDocument();
    expect(summary.closest('details')?.textContent).toMatch(/Base Unit of Measure/);
  });
});
