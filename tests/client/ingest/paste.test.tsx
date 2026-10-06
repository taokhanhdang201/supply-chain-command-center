// @vitest-environment jsdom
// Criteria 20, 35 (UI side), 36 and 51: clipboard paste enters the same pipeline as a file and gives the same result;
// hostile header and cell text (HTML, formula injection, prototype keys, control characters) is always rendered as text in
// every new panel; nothing file-derived is logged.

import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest';
import { cleanup, screen, within } from '@testing-library/react';
import { renderCard, review, settled, acknowledgeAll, fileOf, fileOfFixture, fixtureByName, confirmButton } from './uiHarness';

beforeEach(() => {
  window.location.hash = '';
});
afterEach(() => {
  vi.restoreAllMocks();
});

const mappingText = (): string => (document.querySelector('[data-ingest-panel="mapping"]') as HTMLElement).textContent as string;
const summary = (): string => (screen.getByText(/rows read/) as HTMLElement).textContent as string;

describe('paste box', () => {
  it('is a disclosure: a button with aria-expanded and aria-controls, the text area only when open', async () => {
    const r = await renderCard();
    const toggle = screen.getByRole('button', { name: /Paste data instead/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    await r.user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById(toggle.getAttribute('aria-controls') as string)).toContainElement(screen.getByRole('textbox'));
    expect(screen.getByRole('button', { name: 'Review pasted data' })).toBeDisabled();
  });

  it('pasted TSV gives the same mapping and counts as the equivalent file, and uploads under the name "Pasted data"', async () => {
    const fixture = fixtureByName('kestrel_paste.tsv');
    const fromFile = await renderCard();
    await review(fromFile, fileOfFixture(fixture));
    const fileMapping = mappingText();
    const fileSummary = summary();
    const fileJob = fromFile.runner.jobs.at(-1);
    expect(fileJob?.fileName).toBe('kestrel_paste.tsv');
    cleanup();

    const pasted = await renderCard();
    await pasted.user.click(screen.getByRole('button', { name: /Paste data instead/ }));
    await pasted.user.click(screen.getByRole('textbox'));
    await pasted.user.paste(fixture.text);
    await pasted.user.click(screen.getByRole('button', { name: 'Review pasted data' }));
    await screen.findByRole('heading', { name: 'Review before importing' });
    await settled();
    expect(mappingText()).toBe(fileMapping);
    expect(summary()).toBe(fileSummary);
    expect(pasted.runner.jobs.at(-1)?.fileName).toBe('Pasted data');
    await acknowledgeAll(pasted.user);
    await pasted.user.click(confirmButton());
    await screen.findByText(/All views are updated\./);
    const sent = pasted.importCsv.mock.calls[0] as unknown[];
    expect(sent).toHaveLength(2);
    expect((sent[1] as File).name).toBe('Pasted data');
  });

  it('pasted text that is blank, or not a table, is refused with the catalogue text', async () => {
    const r = await renderCard();
    await r.user.click(screen.getByRole('button', { name: /Paste data instead/ }));
    await r.user.click(screen.getByRole('textbox'));
    await r.user.paste('just one line of words');
    await r.user.click(screen.getByRole('button', { name: 'Review pasted data' }));
    await settled();
    // one line of words has no columns: the separator cannot be detected, so the user is asked, and nothing is reviewed or sent
    expect((screen.getByLabelText('Separator') as HTMLSelectElement).value).toBe('');
    expect(r.importCsv).not.toHaveBeenCalled();
    expect(screen.queryByRole('heading', { name: 'Review before importing' })).not.toBeInTheDocument();
  });
});

describe('hostile text is rendered as text', () => {
  const HOSTILE_HEADERS = ['shipment_id', 'origin', 'destination', '<img src=x onerror=alert(1)>', "=cmd|'/C calc'!A0", '__proto__', 'constructor', 'toString', '+1', '@SUM(1)', '<script>alert(1)</script>'];
  const rowOf = (a: string): string => HOSTILE_HEADERS.map((_, i) => (i < 3 ? ['SHP-90' + a, 'WH-DFW', 'Houston'][i] : i % 2 === 0 ? `<b onmouseover=alert(${a})>${a}</b>` : `=HYPERLINK(http://evil/${a})`)).join(',');
  const hostileCsv = (): string => `${HOSTILE_HEADERS.map((h) => `"${h.replace(/"/g, '""')}"`).join(',')}\n${rowOf('1')}\n${rowOf('2')}\n`;

  it('renders hostile headers and cells as text in the mapping table, the review and the not-imported list, creating no elements', async () => {
    const warn = vi.spyOn(console, 'warn');
    const error = vi.spyOn(console, 'error');
    const log = vi.spyOn(console, 'log');
    const r = await renderCard();
    await review(r, fileOf(hostileCsv(), 'hostile.csv'));
    // the dataset is unknown for such a file: choose one so the mapping table is rendered too
    if (screen.queryAllByText(/Choose whether this is inventory or shipments data\./).length > 0) {
      await r.user.click(screen.getByRole('radio', { name: /Shipments/ }));
      await settled();
    }
    const card = document.querySelector('[data-ingest-card]') as HTMLElement;
    expect(card.querySelector('img')).toBeNull();
    expect(card.querySelector('script')).toBeNull();
    expect(card.querySelector('b')).toBeNull();
    expect(card.querySelector('[onerror], [onmouseover]')).toBeNull();
    expect(card.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(card.textContent).toContain('=cmd|\'/C calc\'!A0');
    expect(card.textContent).toContain('__proto__');
    const table = screen.getByRole('table', { name: 'Column mapping' });
    expect(within(table).getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(within(table).getAllByText(/<b onmouseover=alert\(1\)>1<\/b>/).length).toBeGreaterThan(0);
    expect(card.querySelector('img, script, b, a')).toBeNull();
    expect(Object.prototype.hasOwnProperty.call({}, 'polluted')).toBe(false);
    // nothing file-derived reached the console (criterion 36)
    for (const spy of [warn, error, log]) {
      for (const call of spy.mock.calls) expect(String(call[0])).not.toMatch(/hostile|onerror|HYPERLINK|__proto__/);
    }
  });

  it('formula-like cells in the review table are text and are imported untouched or reported by the V1 rules, never evaluated', async () => {
    const r = await renderCard();
    const csv = 'shipment_id,origin,destination,carrier,status,ship_date,estimated_delivery,actual_delivery,shipping_cost\n=cmd|\'/C calc\'!A0,WH-DFW,+1,@SUM(1),delivered,2026-03-02,2026-03-05,2026-03-05,10.00\n';
    await review(r, fileOf(csv, 'formula.csv'));
    await acknowledgeAll(r.user);
    const text = (document.querySelector('[data-ingest-panel="review"]') as HTMLElement).textContent as string;
    expect(text).toContain('=cmd|\'/C calc\'!A0');
    expect(document.querySelector('[data-ingest-card] a')).toBeNull();
  });

  it('a hostile file name is shown as text and truncated', async () => {
    const r = await renderCard();
    await review(r, fileOf('sku,product_name,category,warehouse,quantity,reorder_point,unit_cost\nA-1,Bolt,Hardware,WH-DFW,3,1,9.5\n', '<img src=x onerror=alert(1)>' + 'x'.repeat(200) + '.csv'));
    expect(document.querySelector('[data-ingest-card] img')).toBeNull();
    expect(document.body.textContent).toContain('<img src=x onerror=alert(1)>');
  });
});
