// @vitest-environment jsdom
// G1: the import card's states, one test each: waiting, reading, a question (one at a time, the answers are the buttons;
// an all-ambiguous date column and a column with conflicting evidence), has errors, cannot import, ready, done with Undo,
// undone. Each state shows one sentence, one line, its main action and at most one small link; red only for what stops
// the import, amber for a question.

import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UniversalImportCard } from '../../../src/client/components/import/UniversalImportCard';
import type { IngestRunner } from '../../../src/client/ingest/runner';
import { buildSampleFile } from '../../../src/client/import/sampleFiles';
import { renderWithData } from '../../helpers/renderWithData';
import { makeSnapshot, TODAY } from '../../helpers/fixtures';
import { DROPZONE_LABEL, SUCCESS, fileOf, renderCard, review, settled } from '../ingest/uiHarness';

beforeEach(() => {
  window.location.hash = '';
});
afterEach(() => {
  vi.restoreAllMocks();
});

const HEAD = 'shipment_id,origin,destination,carrier,status,ship_date,estimated_delivery,actual_delivery,shipping_cost';
const shipments = (dates: [string, string]): string =>
  `${HEAD}\nSHP-900001,WH-DFW,HOU,Northstar Freight,delivered,${dates[0]},2026-04-08,2026-04-07,812.40\nSHP-900002,WH-LAX,"Seattle, WA",Summit Express,delivered,${dates[1]},2026-05-12,2026-05-11,2410.00\n`;
const TEMPLATE = shipments(['2026-04-03', '2026-05-06']);

const heading = (): HTMLElement => document.getElementById('ingest-state-heading') as HTMLElement;
const section = (): HTMLElement => heading().closest('section') as HTMLElement;
const line = (): string => (section().querySelector('.ingest-state__line') as HTMLElement).textContent ?? '';

describe('the seven states of the import card', { timeout: 20_000 }, () => {
  it('1 waiting: one drop area (its input is the tab stop), one line from the registry, Choose a file, No file? Try one.', async () => {
    const r = await renderCard();
    expect(r.picker()).toHaveAttribute('tabindex', '0');
    const drop = screen.getByText('Drop your file').closest('label') as HTMLElement;
    expect(drop).toHaveAttribute('for', r.picker().id);
    expect(within(drop).getByText('CSV, TSV, TXT or GZ file. Up to 2 MB.')).toBeInTheDocument();
    expect(within(drop).getByText('Choose a file')).toHaveClass('button--primary');
    expect(screen.getByRole('button', { name: 'No file? Try one.' })).toHaveClass('ingest-link');
    expect(document.getElementById('ingest-state-heading')).toBeNull();
    expect(document.getElementById('ingest-details')).toBeNull();
  });

  it('2 reading: names the file and the stage; Cancel is the one link', async () => {
    const pending: IngestRunner = { run: () => ({ promise: new Promise(() => undefined), cancel: () => undefined }) };
    const user = userEvent.setup({ applyAccept: false });
    await renderWithData(<UniversalImportCard runner={pending} />, { snapshot: makeSnapshot([], [], { today: TODAY }) });
    await user.upload(screen.getByLabelText(DROPZONE_LABEL), fileOf(TEMPLATE, 'carrier-export.csv'));
    expect(await screen.findByRole('heading', { name: 'Reading carrier-export.csv' })).toBeInTheDocument();
    expect(line()).toBe('Identifying the file type (0%)…');
    expect(within(section()).getAllByRole('button').map((b) => b.textContent)).toEqual(['Cancel']);
    expect(document.getElementById('ingest-details')).toBeNull();
    expect(screen.getByLabelText(DROPZONE_LABEL)).toHaveAttribute('tabindex', '-1');
  });

  it('3 a question: a date column whose every value reads two ways asks, in amber, with the two dates as the answers', async () => {
    const r = await renderCard();
    await review(r, fileOf(shipments(['04/03/2026', '05/06/2026']), 'dates.csv'));
    expect(heading()).toHaveTextContent('Is 04/03/2026 April 3 or March 4?');
    expect(line()).toBe('Column “ship_date”. No other date in this column tells us which.');
    expect(section()).toHaveClass('ingest-state--warning');
    const answers = within(screen.getByRole('group', { name: 'Answers' })).getAllByRole('button');
    expect(answers.map((b) => b.textContent)).toEqual(['April 3', 'March 4']);
    expect(document.activeElement).toBe(heading());
    // the answer is the decision: the file is read day first and nothing else is asked
    await r.user.click(answers[1] as HTMLElement);
    await settled();
    expect(heading()).toHaveTextContent('2 shipments. Ready.');
    const fixes = within(document.getElementById('ingest-details') as HTMLElement).getAllByRole('listitem').map((li) => li.textContent);
    expect(fixes).toContain('Read “ship_date” as day/month/year (your answer).');
  });

  it('3 a question: a date column with conflicting evidence stops and asks which format, it never picks', async () => {
    const r = await renderCard();
    await review(r, fileOf(shipments(['13/04/2026', '04/14/2026']), 'mixed.csv'));
    expect(heading()).toHaveTextContent('Which date format does “ship_date” use?');
    expect(line()).toMatch(/^It holds (13\/04\/2026 and 04\/14\/2026|04\/14\/2026 and 13\/04\/2026)\. Dates in the other format will show as problems\.$/);
    const answers = within(screen.getByRole('group', { name: 'Answers' })).getAllByRole('button').map((b) => b.textContent);
    expect([...answers].sort()).toEqual(['Like 04/14/2026', 'Like 13/04/2026']);
    expect(screen.queryByRole('button', { name: 'Use this data' })).not.toBeInTheDocument();
    expect(r.importCsv).not.toHaveBeenCalled();
  });

  it('5 has errors: the rows named, in red, a download of the rows to fix, nothing imported', async () => {
    const saved: Array<{ name: string; href: string }> = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      saved.push({ name: this.download, href: this.href });
    });
    const r = await renderCard();
    await review(r, buildSampleFile('errors', TODAY));
    expect(heading()).toHaveTextContent('7 rows need fixing.');
    expect(line()).toBe('Rows 5, 7, 10 and 4 more. Nothing was imported.');
    expect(section()).toHaveClass('ingest-state--critical');
    expect(screen.getByText('See every problem')).toBeInTheDocument();
    await r.user.click(screen.getByRole('button', { name: 'Download the 7 rows to fix' }));
    expect(saved).toHaveLength(1);
    expect(saved[0]?.name).toBe('rows-to-fix.csv');
    const prefix = 'data:text/csv;charset=utf-8,';
    expect(saved[0]?.href.startsWith(prefix)).toBe(true);
    const csv = decodeURIComponent((saved[0]?.href ?? '').slice(prefix.length)).trim().split('\n');
    expect(csv[0]).toBe('row,column,problem');
    expect(csv).toHaveLength(8);
    expect(r.importCsv).not.toHaveBeenCalled();
  });

  it('6 cannot import: an alert in red, the reason in two parts, Choose another file, "What SCC can read"', async () => {
    const r = await renderCard();
    const click = vi.spyOn(r.picker(), 'click').mockImplementation(() => undefined);
    await review(r, fileOf(new Uint8Array(64), 'scan.pdf'));
    expect(screen.getByRole('alert')).toBe(section());
    expect(section()).toHaveClass('ingest-state--critical');
    expect(heading()).toHaveTextContent(/^This looks like/);
    expect(screen.getByText('What SCC can read')).toBeInTheDocument();
    await r.user.click(screen.getByRole('button', { name: 'Choose another file' }));
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('3 ready: the count, the effect on the Dashboard, Use this data; with nothing fixed the link is "Show the details"', async () => {
    const r = await renderCard();
    await review(r, fileOf(TEMPLATE, 'shipments.csv'));
    expect(heading()).toHaveTextContent('2 shipments. Ready.');
    expect(line()).toMatch(/^On-time rate (moves from|stays at) .+\. Replaces the 0 sample shipments\.$/);
    expect(section().className).toBe('ingest-state ingest-state--ready');
    expect(within(section()).getByRole('button', { name: 'Use this data' })).toHaveClass('button--primary');
    expect(screen.getByText('Show the details')).toBeInTheDocument();
    expect(r.importCsv).not.toHaveBeenCalled();
  });

  it('3 a question: every answer button has the same class and none is the main button, for a date and for a status', async () => {
    const r = await renderCard();
    const classesOfAnswers = (): string[] => within(screen.getByRole('group', { name: 'Answers' })).getAllByRole('button').map((b) => b.className);
    await review(r, fileOf(shipments(['04/03/2026', '05/06/2026']), 'dates.csv'));
    expect(heading()).toHaveTextContent(/^Is 04\/03\/2026 /);
    expect(new Set(classesOfAnswers())).toEqual(new Set(['button']));
    await review(r, fileOf(shipments(['2026-04-03', '2026-05-06']).replace(',delivered,2026-04-03', ',Arrived,2026-04-03'), 'status.csv'));
    expect(heading()).toHaveTextContent('What does “Arrived” mean?');
    const classes = classesOfAnswers();
    expect(classes).toHaveLength(4);
    expect(new Set(classes)).toEqual(new Set(['button']));
    expect(section().querySelector('.button--primary')).toBeNull();
  });

  it('7 done, then Undo: "Done. Dashboard updated." with Open Dashboard as the main action and Undo as the link; Undo brings the data back', async () => {
    const importCsv = vi.fn().mockResolvedValue({ ...SUCCESS, undo: { version: 9 } });
    const undoImport = vi.fn().mockResolvedValue(undefined);
    const r = await renderCard({ api: { importCsv, undoImport } });
    await review(r, fileOf(TEMPLATE, 'shipments.csv'));
    await r.user.click(screen.getByRole('button', { name: 'Use this data' }));
    expect(await screen.findByRole('heading', { name: 'Done. Dashboard updated.' })).toBe(heading());
    expect(line()).toBe('12 shipments from alder_freight.csv.');
    await waitFor(() => expect(document.activeElement).toBe(heading()));
    // Open Dashboard is the main action and Undo the small link (Undo used to be the main button)
    expect(within(section()).getByRole('link', { name: 'Open Dashboard' })).toHaveClass('button', 'button--primary');
    expect(within(section()).getByRole('link', { name: 'Open Dashboard' })).toHaveAttribute('href', '#/');
    expect(within(section()).getByRole('button', { name: 'Undo' })).toHaveClass('ingest-link');
    expect(section().querySelectorAll('.button--primary')).toHaveLength(1);
    expect(document.getElementById('ingest-details')).toBeNull();
    await r.user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(await screen.findByRole('heading', { name: 'Undone. The data is back as it was.' })).toBe(heading());
    expect(undoImport).toHaveBeenCalledWith(9);
    expect(line()).toBe('Nothing from alder_freight.csv was kept.');
    expect(within(section()).getByRole('button', { name: 'Choose a file' })).toBeInTheDocument();
  });
});
