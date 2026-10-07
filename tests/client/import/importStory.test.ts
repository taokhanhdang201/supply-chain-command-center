// G1: the words of the import card, from real analyses: the waiting line from the registry, one question per blocker with
// its answers as decisions, what SCC fixed on its own, the effect on the Dashboard, the problems as a CSV and the
// "has errors" sentence.

import { describe, expect, it } from 'vitest';
import { analyzeFile, type Decisions } from '../../../src/shared/ingest/pipeline';
import { createDefaultRegistry } from '../../../src/shared/ingest/adapters';
import { buildSampleFile } from '../../../src/client/import/sampleFiles';
import { cannotLine, countOf, dayLabel, errorsText, fieldWords, fixesOf, impactLine, problemsCsv, questionFor, waitingLine } from '../../../src/client/ingest/importStory';
import { makeShipmentRecord, makeSnapshot, TODAY } from '../../helpers/fixtures';

const registry = createDefaultRegistry();
const HEAD = 'shipment_id,origin,destination,carrier,status,ship_date,estimated_delivery,actual_delivery,shipping_cost';
const row = (id: string, status: string, ship: string, cost = '812.40'): string => `${id},WH-DFW,HOU,Northstar Freight,${status},${ship},2026-04-08,2026-04-07,${cost}`;

async function preview(text: string | Uint8Array, decisions?: Decisions) {
  const bytes = typeof text === 'string' ? new TextEncoder().encode(text) : text;
  const r = await analyzeFile({ bytes, fileName: 'f.csv', decisions }, { registry });
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}
const firstBlocker = (p: Awaited<ReturnType<typeof preview>>['preview'], code: string) => {
  const b = p.blockers.find((x) => x.code === code);
  if (b === undefined) throw new Error(`no ${code} blocker: ${p.blockers.map((x) => x.code).join(', ')}`);
  return b;
};

describe('the small words', () => {
  it('the waiting line lists what the registry reads and the size limit', () => {
    expect(waitingLine(registry, 2_097_152)).toBe('CSV, TSV, TXT or GZ file. Up to 2 MB.');
    expect(waitingLine(registry, 10 * 1_048_576)).toBe('CSV, TSV, TXT or GZ file. Up to 10 MB.');
    expect(waitingLine(registry, 1_572_864)).toBe('CSV, TSV, TXT or GZ file. Up to 1.5 MB.');
  });

  it('the "cannot import" line keeps the hint and drops the repeat and the list of formats (it sits behind the link)', () => {
    const pdf = 'SCC cannot import that type. SCC cannot read tables from PDF files yet. Export the data as CSV from the source system. You can import: Delimited text (.csv, .tsv, .txt), Gzip-compressed file (.gz). Export the data in one of those formats.';
    expect(cannotLine(pdf)).toBe('SCC cannot read tables from PDF files yet. Export the data as CSV from the source system.');
    expect(cannotLine('SCC cannot import that type. You can import: Delimited text (.csv). Export the data in one of those formats.')).toBe('Save it as CSV and choose that file.');
    expect(cannotLine('Split the file, remove columns you do not need, or choose fewer rows.')).toBe('Split the file, remove columns you do not need, or choose fewer rows.');
  });

  it('counts, days and field names read as plain words', () => {
    expect(countOf('shipments', 1)).toBe('1 shipment');
    expect(countOf('inventory', 1200)).toBe('1,200 inventory items');
    expect(dayLabel('2026-04-03')).toBe('April 3');
    expect(fieldWords('shipment_id')).toBe('shipment ID');
    expect(fieldWords('sku')).toBe('SKU');
  });
});

describe('one question per blocker, the answers are the decisions', () => {
  it('an all-ambiguous date column: "Is 04/03/2026 April 3 or March 4?", each answer sets that column', async () => {
    const a = await preview(`${HEAD}\n${row('SHP-1', 'delivered', '04/03/2026')}\n${row('SHP-2', 'delivered', '05/06/2026')}\n`);
    const q = questionFor(a.preview, firstBlocker(a.preview, 'choose-date-format'));
    expect(q.sentence).toBe('Is 04/03/2026 April 3 or March 4?');
    expect(q.answers).toEqual([
      { label: 'April 3', answer: { kind: 'date', field: 'ship_date', preset: 'mdy_slash' } },
      { label: 'March 4', answer: { kind: 'date', field: 'ship_date', preset: 'dmy_slash' } }
    ]);
  });

  it('an ambiguous status: "What does “Arrived” mean?", the four statuses as answers, nothing guessed', async () => {
    const a = await preview(`${HEAD}\n${row('SHP-1', 'Arrived', '2026-04-03')}\n${row('SHP-2', 'delivered', '2026-04-04')}\n`);
    const q = questionFor(a.preview, firstBlocker(a.preview, 'choose-status'));
    expect(q.sentence).toBe('What does “Arrived” mean?');
    expect(q.line).toBe('1 shipment has this status. SCC does not guess.');
    expect(q.answers.map((x) => x.label)).toEqual(['In transit', 'Delivered', 'Pending', 'Cancelled']);
    expect(q.answers[0]?.answer).toEqual({ kind: 'status', source: 'Arrived', target: 'in_transit' });
  });

  it('a blocker without its own question falls back to its message and leaves the answer to the details', async () => {
    const a = await preview(`${HEAD}\n${row('SHP-1', 'delivered', '2026-04-03')}\n`);
    const q = questionFor(a.preview, { code: 'confirm-header', message: 'Confirm the header row.' } as Parameters<typeof questionFor>[1]);
    expect(q).toEqual({ sentence: 'Confirm the header row.', line: 'Answer it in the details below.', answers: [] });
  });
});

describe('what SCC fixed, the effect, the problems', () => {
  it('the carrier export: renamed columns in one line, each date column with its proof, the $ sign, the answered status', async () => {
    const file = buildSampleFile('carrier-export', TODAY);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const a = await preview(bytes, { statusChoices: new Map([['Arrived', 'in_transit']]) });
    expect(a.preview.blockers).toEqual([]);
    const fixes = fixesOf(a.preview);
    expect(fixes).toContain('Read the status “Arrived” as in transit (your answer).');
    expect(fixes[0]).toBe('Matched 9 columns by their names, for example “Load ID” as the shipment ID and “From” as the origin.');
    expect(fixes.find((f) => f.startsWith('Read “ETA”'))).toMatch(/^Read “ETA” as day\.month\.year: \d{2}\.\d{2}\.\d{4} can only be [A-Z][a-z]+ \d{1,2}\.$/);
    expect(fixes.find((f) => f.startsWith('Read “Delivered Date”'))).toMatch(/^Read “Delivered Date” as month\/day\/year: \d{1,2}\/\d{1,2}\/\d{4} can only be [A-Z][a-z]+ \d{1,2}\.$/);
    expect(fixes.some((f) => f.startsWith('Read “Dispatch Date”'))).toBe(false); // ISO needs no word
    expect(fixes).toContain('Read numbers with comma thousands, like 1,234.56.');
    expect(fixes.some((f) => /^Removed the \$ sign from [\d,]+ amounts\.$/.test(f))).toBe(true);
  });

  it('the impact line says how the on-time rate moves and what is replaced', async () => {
    const snapshot = makeSnapshot([], [makeShipmentRecord()], { today: TODAY });
    const a = await preview(`${HEAD}\n${row('SHP-1', 'delivered', '2026-04-03')}\n`);
    const text = impactLine('shipments', a.canonical?.csv ?? '', snapshot);
    expect(text).toMatch(/^On-time rate (moves from [\d.]+% to [\d.]+%|stays at [\d.]+%)\. Replaces the 1 sample shipments\.$/);
  });

  it('the problems CSV and the "has errors" sentence name the rows, sorted, and say nothing was imported', async () => {
    const a = await preview(`${HEAD}\n${row('SHP-1', 'delivered', '2026-04-03', '')}\n${row('SHP-2', 'delivered', '2026-04-04', '')}\n`);
    const csv = problemsCsv(a.preview).trim().split('\n');
    expect(csv[0]).toBe('row,column,problem');
    expect(csv).toHaveLength(3);
    expect(csv[1]).toMatch(/^line 2,shipping_cost,/);
    expect(errorsText(a.preview)).toEqual({ sentence: '2 rows have problems in the shipping cost.', line: 'Rows 2 and 3. Nothing was imported.' }); // "Rows" (was "Lines"): a line number is the spreadsheet row
  });
});
