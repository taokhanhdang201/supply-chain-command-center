// @vitest-environment jsdom
// V1.5 tester: mapping panel behaviour in jsdom (adversarial header text, confirm gating, wording, a11y hooks).
// The real-browser pass is done separately in Playwright; this file pins the DOM-level contracts.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ImportPage } from '../../src/client/pages/ImportPage';
import { renderWithData } from '../helpers/renderWithData';
import { makeSnapshot, TODAY } from '../helpers/fixtures';
import { COMPANY_B, INV_ALT, SHP_ALT, INV_FIELDS, SHP_FIELDS } from './v15.helpers';

beforeEach(() => { window.location.hash = ''; });

const success = { ok: true, kind: 'inventory', rowCount: 1, warnings: [], dataSource: { kind: 'import', label: 'x.csv', loadedAt: '2026-06-15T00:00:00.000Z', rowCount: 1 } };

async function setup(text: string, opts: { kind?: 'inventory' | 'shipments'; name?: string } = {}) {
  const kind = opts.kind ?? 'inventory';
  const importCsv = vi.fn().mockResolvedValue(success);
  const user = userEvent.setup();
  await renderWithData(<ImportPage />, { snapshot: makeSnapshot([], [], { today: TODAY }), api: { importCsv } });
  const file = new File([text], opts.name ?? 'upload.csv', { type: 'text/csv' });
  await user.upload(screen.getByLabelText(`Choose ${kind} CSV file`), file);
  const card = screen.getByLabelText(`Choose ${kind} CSV file`).closest('section, article, div.card, div') as HTMLElement;
  await user.click(screen.getAllByRole('button', { name: 'Import' })[kind === 'inventory' ? 0 : 1] as HTMLElement);
  return { user, importCsv, file, card };
}
const confirmBtn = () => screen.getByRole('button', { name: 'Confirm and import' }) as HTMLButtonElement;
const sel = (col: string) => screen.getByLabelText(`SCC field for column ${col}`) as HTMLSelectElement;

describe('hostile header text renders as inert text (§17 formula/HTML injection)', () => {
  const evil = [
    '=cmd|\'/c calc\'!A1',
    '<img src=x onerror=alert(1)>',
    '<script>window.__pwned=1</script>',
    '"><svg onload=alert(1)>',
    '@SUM(1+1)',
    '+1+1',
    '-2+3',
    '‮gnp.exe',
    'javascript:alert(1)',
    '{{constructor.constructor("alert(1)")()}}',
    'x'.repeat(500)
  ];

  it('each evil header is shown as text in the file-column cell and in the select label; no element is created from it; the page executes nothing', async () => {
    const quoted = evil.map((h) => `"${h.replace(/"/g, '""')}"`);
    const csv = ['Material Number', ...quoted].join(',') + '\n' + ['MAT-1', ...evil.map((_, i) => `v${i}`)].join(',') + '\n';
    const { card } = await setup(csv);
    await screen.findByRole('heading', { name: /Map columns for/ });
    expect((window as any).__pwned).toBeUndefined();
    const panel = document.querySelector('.mapping-panel') as HTMLElement;
    expect(panel).not.toBeNull();
    expect(panel.querySelector('img, script, svg, iframe, a[href^="javascript"]')).toBeNull();
    const text = panel.textContent ?? '';
    expect(text).toContain('=cmd|\'/c calc\'!A1');
    expect(text).toContain('<img src=x onerror=alert(1)>');
    expect(text).toContain('<script>window.__pwned=1</script>');
    // long header is truncated for display
    expect(text).not.toContain('x'.repeat(500));
    // only known tags exist inside the panel, and no element carries an event-handler attribute
    const allowed = new Set(['H3', 'P', 'DIV', 'TABLE', 'CAPTION', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'SELECT', 'OPTION', 'SPAN', 'UL', 'LI', 'H4', 'BUTTON']);
    for (const el of Array.from(panel.querySelectorAll('*'))) {
      expect(allowed.has(el.tagName), el.tagName).toBe(true);
      expect(el.getAttributeNames().filter((n) => n.startsWith('on'))).toEqual([]);
    }
    void card;
    // none of these headers matches an alias: every one is "Not imported" and the file cannot be confirmed (columns missing)
    expect(confirmBtn()).toBeDisabled();
  });

  it('a hostile header in the example-value column and preview table is text too', async () => {
    const csv = 'Material Number,Item Description,Category,Plant,On Hand Qty,Reorder Level,Unit Price\n' +
      '"<img src=x onerror=alert(2)>","=HYPERLINK(""http://evil"")",C,WH-DFW,1,1,1.00\n';
    await setup(csv);
    await screen.findByRole('heading', { name: /Map columns for/ });
    const panel = document.querySelector('.mapping-panel') as HTMLElement;
    expect(panel.querySelector('img')).toBeNull();
    expect(panel.textContent).toContain('<img src=x onerror=alert(2)>');
    expect(panel.textContent).toContain('=HYPERLINK("http://evil")');
  });
});

describe('§15.6/7/18/19/20 Confirm gating in the panel', () => {
  it('Company B: Cost and Avg Usage are Ambiguous, Confirm is disabled, and the API is never called', async () => {
    const { importCsv, user } = await setup(COMPANY_B);
    await screen.findByRole('heading', { name: /Map columns for/ });
    expect(confirmBtn()).toBeDisabled();
    expect(screen.getAllByText('Ambiguous')).toHaveLength(2);
    await user.click(confirmBtn()).catch(() => undefined);
    expect(importCsv).not.toHaveBeenCalled();
    // resolving only one of the two is still blocked
    await user.selectOptions(sel('Cost'), 'unit_cost');
    expect(confirmBtn()).toBeDisabled();
    await user.selectOptions(sel('Avg Usage'), 'avg_daily_usage');
    expect(confirmBtn()).toBeEnabled();
    await user.click(confirmBtn());
    expect(importCsv).toHaveBeenCalledTimes(1);
    expect(importCsv.mock.calls[0]![2]).toEqual(INV_FIELDS);
  });

  it('choosing "Do not import" for an ambiguous column resolves it (explicit user decision) but leaves the required field missing when it was needed', async () => {
    const { user } = await setup(COMPANY_B);
    await screen.findByRole('heading', { name: /Map columns for/ });
    await user.selectOptions(sel('Cost'), '__ignore__');
    await user.selectOptions(sel('Avg Usage'), '__ignore__');
    expect(screen.getByText('Required field missing')).toBeInTheDocument();
    const missing = screen.getByText('Required SCC fields not mapped:').nextElementSibling as HTMLElement;
    expect(within(missing).getByText(/unit_cost/)).toBeInTheDocument();
    expect(confirmBtn()).toBeDisabled();
  });

  it('two columns mapped onto one field: both rows say Duplicate, Confirm disabled; fixing one re-enables', async () => {
    const { user, importCsv } = await setup(INV_ALT);
    await screen.findByRole('heading', { name: /Map columns for/ });
    await user.selectOptions(sel('Item Description'), 'sku');
    expect(screen.getAllByText('Duplicate')).toHaveLength(2);
    expect(confirmBtn()).toBeDisabled();
    // product_name is now unmapped and required
    expect(screen.getByText('Required field missing')).toBeInTheDocument();
    await user.selectOptions(sel('Item Description'), 'product_name');
    expect(confirmBtn()).toBeEnabled();
    expect(importCsv).not.toHaveBeenCalled();
  });

  it('a canonical file plus an extra column: mapping the extra column onto the already-present canonical field is Duplicate and blocks', async () => {
    const csv = INV_FIELDS.join(',') + ',Item Code\nAAA-1,P,C,WH-DFW,1,1,1.00,1,1,BBB-2\nAAA-2,P,C,WH-DFW,1,1,1.00,1,1,BBB-3\n';
    // the extra alias column is claimed by the exact `sku`, so it starts as "Not imported" and needs the panel
    const { user, importCsv } = await setup(csv);
    // canonical + alias extra -> V1 would have imported directly with an ignored-column warning
    const heading = screen.queryByRole('heading', { name: /Map columns for/ });
    if (heading === null) {
      await vi.waitFor(() => expect(importCsv).toHaveBeenCalledTimes(1));
      expect(importCsv.mock.calls[0]).toHaveLength(2);
      return;
    }
    await user.selectOptions(sel('Item Code'), 'sku');
    expect(screen.getAllByText('Duplicate')).toHaveLength(2);
    expect(confirmBtn()).toBeDisabled();
  });

  it('the shipments panel: "Date" is ambiguous with all three date candidates listed, and Confirm is blocked until resolved', async () => {
    const csv = 'Shipment ID,Origin,Destination,Carrier,Status,Ship Date,Date,Delivered Date,Freight Cost\nLD-1,WH-DFW,HOU,X Co,Pending,2026-06-01,2026-06-05,,10.00\n';
    const { user, importCsv } = await setup(csv, { kind: 'shipments' });
    await screen.findByRole('heading', { name: /Map columns for/ });
    expect(confirmBtn()).toBeDisabled();
    expect(screen.getByText(/Could match: estimated_delivery, actual_delivery/)).toBeInTheDocument();
    await user.selectOptions(sel('Date'), 'estimated_delivery');
    expect(confirmBtn()).toBeEnabled();
    await user.click(confirmBtn());
    expect(importCsv).toHaveBeenCalledWith('shipments', expect.any(File), ['shipment_id', 'origin', 'destination', 'carrier', 'status', 'ship_date', 'estimated_delivery', 'actual_delivery', 'shipping_cost']);
  });

  it('shipments alt file: all 9 columns suggested and Mapped; confirm sends the canonical-order map', async () => {
    const { user, importCsv } = await setup(SHP_ALT, { kind: 'shipments' });
    await screen.findByRole('heading', { name: /Map columns for/ });
    expect(screen.getAllByText('Mapped')).toHaveLength(9);
    await user.click(confirmBtn());
    expect(importCsv.mock.calls[0]![2]).toEqual(SHP_FIELDS);
  });
});

describe('§15.10 / §15.9 preview surfaces the existing validation and the Excel message', () => {
  it('an Excel M/D/YYYY date in a mapped shipments file shows the helpful message in the preview and blocks Confirm', async () => {
    const csv = SHP_ALT.split('\n')[0] + '\nLD-60001,WH-DFW,HOU,Northstar Freight,Delivered,8/15/2026,2026-08-18,2026-08-17,812.40\n';
    await setup(csv, { kind: 'shipments' });
    await screen.findByRole('heading', { name: /Map columns for/ });
    expect(await screen.findByText(/looks like Excel changed this date to M\/D\/YYYY/)).toBeInTheDocument();
    expect(screen.getByText(/"8\/15\/2026" looks like Excel changed this date to M\/D\/YYYY\. Dates must be YYYY-MM-DD, e\.g\. 2026-08-15\. Re-download the file and upload it without opening it in Excel\./)).toBeInTheDocument();
    expect(confirmBtn()).toBeDisabled();
  });

  it('the preview error table names the CANONICAL field (documented UX: it is not the source header)', async () => {
    const csv = INV_ALT.replace('MAT-10001,Hydraulic Pump Seal Kit,Maintenance,WH-DFW,12', 'MAT-10001,Hydraulic Pump Seal Kit,Maintenance,WH-DFW,twelve');
    await setup(csv);
    await screen.findByRole('heading', { name: /Map columns for/ });
    const table = await screen.findByRole('table', { name: 'Preview errors' });
    const cells = within(table).getAllByRole('cell').map((c) => c.textContent);
    expect(cells).toContain('quantity');
    expect(cells).not.toContain('On Hand Qty');
  });
});

describe('accessibility hooks', () => {
  it('every select has a unique accessible name, the heading receives focus, status is a live region, and Confirm names why it is blocked', async () => {
    await setup(COMPANY_B);
    const heading = await screen.findByRole('heading', { name: /Map columns for/ });
    expect(document.activeElement).toBe(heading);
    const selects = screen.getAllByRole('combobox');
    const names = selects.map((s) => s.getAttribute('aria-label'));
    expect(new Set(names).size).toBe(selects.length);
    expect(names.every((n) => n !== null && n.startsWith('SCC field for column '))).toBe(true);
    expect(screen.getByRole('status')).toHaveTextContent(/columns mapped/);
    const btn = confirmBtn();
    const describedBy = btn.getAttribute('aria-describedby');
    expect(describedBy).not.toBeNull();
    expect(document.getElementById(describedBy!)?.textContent).toMatch(/Resolve the highlighted columns/);
  });

  it('blank header cell gets a readable label rather than an empty accessible name', async () => {
    const csv = 'Material Number,,Item Description,Category,Plant,On Hand Qty,Reorder Level,Unit Price\nM-1,z,P,C,WH-DFW,1,1,1.00\n';
    await setup(csv);
    await screen.findByRole('heading', { name: /Map columns for/ });
    expect(sel('(blank)')).toBeInTheDocument();
  });

  it('two columns with the same header text get the same accessible name (ambiguity for AT users)', async () => {
    const csv = 'Qty,Qty,Item Code,Product,Category,Warehouse,ROP,Price\nA,B,C-1,P,C,WH-DFW,1,1.00\n';
    await setup(csv);
    await screen.findByRole('heading', { name: /Map columns for/ });
    const same = screen.getAllByLabelText('SCC field for column Qty');
    // Two selects share one accessible name: the user cannot tell them apart by name alone (position is only in DOM order).
    expect(same).toHaveLength(2);
  });
});

describe('focus management after the flow (V15-BUG-2)', () => {
  it('after Confirm succeeds and the panel unmounts, keyboard focus is not dropped to <body> (it should land on a meaningful element such as the result banner or the file picker)', async () => {
    const { user, importCsv } = await setup(INV_ALT);
    await screen.findByRole('heading', { name: /Map columns for/ });
    confirmBtn().focus();
    await user.keyboard('{Enter}');
    await screen.findByText(/Imported 1 inventory rows/);
    expect(importCsv).toHaveBeenCalledTimes(1);
    expect(document.activeElement).not.toBe(document.body);
  });

  it('after Cancel the panel unmounts and focus is not dropped to <body>', async () => {
    const { user } = await setup(INV_ALT);
    await screen.findByRole('heading', { name: /Map columns for/ });
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(document.querySelector('.mapping-panel')).toBeNull();
    expect(document.activeElement).not.toBe(document.body);
  });
});
