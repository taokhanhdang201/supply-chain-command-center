// G1: one date format per column, inferred from that column's own unambiguous values. A column whose every value reads two
// ways asks; a column whose values prove two different orders stops and asks, SCC never picks; columns in different formats
// are each read in their own.

import { describe, expect, it } from 'vitest';
import { analyzeFile, type Decisions } from '../../../src/shared/ingest/pipeline';
import { createDefaultRegistry } from '../../../src/shared/ingest/adapters';
import type { DatePreset } from '../../../src/shared/ingest/normalize/dates';

const HEAD = 'shipment_id,origin,destination,carrier,status,ship_date,estimated_delivery,actual_delivery,shipping_cost';

async function analyze(rows: string[], decisions?: Decisions) {
  const bytes = new TextEncoder().encode([HEAD, ...rows].join('\n') + '\n');
  const r = await analyzeFile({ bytes, fileName: 'dates.csv', decisions }, { registry: createDefaultRegistry() });
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}

const dateBlockers = (a: Awaited<ReturnType<typeof analyze>>) => a.preview.blockers.filter((b) => b.code === 'choose-date-format');
const columnView = (a: Awaited<ReturnType<typeof analyze>>, field: string) => a.preview.presets.dateColumns.find((c) => c.field === field)?.view;
const csvRows = (a: Awaited<ReturnType<typeof analyze>>) => (a.canonical?.csv ?? '').trim().split('\n').slice(1).map((l) => l.split(','));

describe('dates: one format per column', () => {
  it('several columns in different formats are each read in their own, with no question', async () => {
    const a = await analyze(
      [
        'SHP-900001,WH-DFW,Houston TX,Northstar,delivered,2026-03-10,16.03.2026,3/15/2026,812.40',
        'SHP-900002,WH-ATL,Miami FL,BlueLine,delivered,2026-03-30,04.04.2026,04/03/2026,640.00'
      ],
      { acknowledgedColumns: [2] } // the free-text destination column asks "Looks right?"; unrelated to dates
    );
    expect(dateBlockers(a)).toEqual([]);
    expect(columnView(a, 'ship_date')).toMatchObject({ kind: 'unique', preset: 'iso' });
    expect(columnView(a, 'estimated_delivery')).toMatchObject({ kind: 'unique', preset: 'dmy_dot' });
    expect(columnView(a, 'actual_delivery')).toMatchObject({ kind: 'unique', preset: 'mdy_slash' });
    expect(a.preview.presets.date?.note).toMatch(/Each date column has its own format/);
    // 04/03/2026 is settled by 3/15/2026 in its own column: April 3
    expect(csvRows(a).map((r) => r.slice(5, 8))).toEqual([
      ['2026-03-10', '2026-03-16', '2026-03-15'],
      ['2026-03-30', '2026-04-04', '2026-04-03']
    ]);
    expect(a.preview.canConfirm).toBe(true);
  });

  it('a column whose values all read two ways asks about that column only, and its answer settles it', async () => {
    const rows = [
      'SHP-900001,WH-DFW,Houston TX,Northstar,delivered,2026-03-01,03/04/2026,3/15/2026,812.40',
      'SHP-900002,WH-ATL,Miami FL,BlueLine,delivered,2026-05-01,05/06/2026,5/20/2026,640.00'
    ];
    const open = await analyze(rows);
    expect(dateBlockers(open).map((b) => b.field)).toEqual(['estimated_delivery']);
    expect(dateBlockers(open)[0]?.message).toBe('The column "estimated_delivery" has dates that read two ways (for example 03/04/2026: month first or day first). Choose which.');
    expect(columnView(open, 'estimated_delivery')).toMatchObject({ kind: 'ambiguous', preset: null, candidates: ['mdy_slash', 'dmy_slash'] });
    expect(columnView(open, 'actual_delivery')).toMatchObject({ kind: 'unique', preset: 'mdy_slash' });
    expect(open.preview.canConfirm).toBe(false);

    const answered = await analyze(rows, { datePresets: new Map<string, DatePreset>([['estimated_delivery', 'dmy_slash']]) });
    expect(dateBlockers(answered)).toEqual([]);
    expect(csvRows(answered).map((r) => r[6])).toEqual(['2026-04-03', '2026-06-05']);
    expect(csvRows(answered).map((r) => r[7])).toEqual(['2026-03-15', '2026-05-20']); // the other column keeps its own format
  });

  it('a column whose values prove two different orders stops and asks; nothing is picked', async () => {
    const a = await analyze([
      'SHP-900001,WH-DFW,Houston TX,Northstar,delivered,13/04/2026,2026-04-20,2026-04-19,812.40',
      'SHP-900002,WH-ATL,Miami FL,BlueLine,delivered,04/13/2026,2026-04-20,2026-04-19,640.00'
    ]);
    expect(dateBlockers(a).map((b) => b.field)).toEqual(['ship_date']);
    expect(dateBlockers(a)[0]?.message).toBe('The column "ship_date" has dates in more than one format (for example 04/13/2026 and 13/04/2026). Fix the file, or choose the format most of them use.');
    const view = columnView(a, 'ship_date');
    expect(view).toMatchObject({ kind: 'mixed', preset: null, chosenByUser: false });
    expect(a.preview.canConfirm).toBe(false);
    expect(columnView(a, 'estimated_delivery')).toMatchObject({ kind: 'unique', preset: 'iso' });
  });

  it('an answer for one column wins over an answer for the whole file; an unknown format is ignored', async () => {
    const rows = ['SHP-900001,WH-DFW,Houston TX,Northstar,delivered,03/04/2026,03/05/2026,03/06/2026,812.40'];
    const a = await analyze(rows, { datePreset: 'dmy_slash', datePresets: new Map<string, DatePreset>([['ship_date', 'mdy_slash']]) });
    expect(dateBlockers(a)).toEqual([]);
    expect(csvRows(a)[0]?.slice(5, 8)).toEqual(['2026-03-04', '2026-05-03', '2026-06-03']);
    const bogus = await analyze(rows, { datePresets: new Map([['ship_date', 'bogus' as DatePreset]]) });
    expect(dateBlockers(bogus).map((b) => b.field)).toEqual(['ship_date', 'estimated_delivery', 'actual_delivery']);
  });
});
