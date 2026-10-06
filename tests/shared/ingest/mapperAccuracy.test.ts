// Criterion 46: mapping accuracy on the tuning corpus (the named fixtures of criterion 45 plus generated cases) and on
// the HELD-OUT corpus (written before the dictionaries and never used to tune them). A failing threshold fails the build.
//   wrong MATCHED = 0 on both; known-ambiguous headers ever MATCHED = 0; junk/distractor columns MATCHED = 0;
//   recall (MATCHED + CHECK) >= 95% tuning and >= 80% held-out; CHECK suggestions whose top suggestion is wrong <= 10%.
// Honest note recorded in thay-doi.md: the held-out corpus and the dictionaries were written by the same author, in that
// order; the Tester is asked to write an independent corpus.

import { describe, expect, it } from 'vitest';
import { AMBIGUITY_FIXTURES, FIXTURES } from '../../fixtures/ingest/corpus45';
import { HELD_OUT } from '../../fixtures/ingest/heldoutCorpus';
import { build, col, G, type CorpusCase } from '../../fixtures/ingest/gen';
import { evaluate, quick, scoreProposals, type Metrics, type Scored } from '../../ingest-kit/mapperHarness';
import { runStages } from '../../ingest-kit/stagesHarness';
import { DICTIONARY_FILES } from '../../../src/shared/ingest/mapping/dictionary';

function report(name: string, m: Metrics): string {
  return `${name}: ${m.matched} matched, ${m.check} check, recall ${(m.recall * 100).toFixed(1)}%, wrong MATCHED ${m.wrongMatched.length}, junk MATCHED ${m.junkMatched.length}, wrong CHECK ${m.wrongCheck.length}/${m.check}\nmissed: ${m.missed.join('; ')}\nwrong matched: ${m.wrongMatched.join('; ')}\nwrong check: ${m.wrongCheck.join('; ')}`;
}

async function tuningMetrics(): Promise<Metrics> {
  const items: Scored[] = [];
  for (const f of [...FIXTURES, ...AMBIGUITY_FIXTURES.filter((x) => x.name === 'mystery_columns.csv')]) {
    const run = await runStages(f);
    items.push({ id: f.name, proposal: run.proposal, truth: f.truth });
  }
  const generated = TUNING_GENERATED.map(build);
  const base = evaluate(generated);
  const fx = scoreProposals(items);
  return {
    columns: base.columns + fx.columns,
    truthColumns: base.truthColumns + fx.truthColumns,
    matched: base.matched + fx.matched,
    check: base.check + fx.check,
    wrongMatched: [...base.wrongMatched, ...fx.wrongMatched],
    junkMatched: [...base.junkMatched, ...fx.junkMatched],
    wrongCheck: [...base.wrongCheck, ...fx.wrongCheck],
    recallCount: base.recallCount + fx.recallCount,
    recall: (base.recallCount + fx.recallCount) / Math.max(1, base.truthColumns + fx.truthColumns),
    missed: [...base.missed, ...fx.missed]
  };
}

/** Generated tuning cases (the dictionary may be tuned against these): distractors and mixed-language variety. */
const TUNING_GENERATED: CorpusCase[] = [
  {
    id: 't-ship-distractors',
    language: 'en',
    kind: 'shipments',
    columns: [
      col('Shipment Number', 'shipment_id', G.shipmentId()),
      col('Ship From', 'origin', G.city()),
      col('Ship To', 'destination', G.city(3)),
      col('Carrier', 'carrier', G.carrier()),
      col('Status', 'status', G.status('en')),
      col('Ship Date', 'ship_date', G.date('iso')),
      col('Expected Delivery', 'estimated_delivery', G.date('iso', 3)),
      col('Delivery Date', 'actual_delivery', G.date('iso', 4)),
      col('Freight Cost', 'shipping_cost', G.money()),
      col('Customer', null, G.customer()),
      col('PO Number', null, G.po()),
      col('Comments', null, G.text('comment')),
      col('Pieces', null, G.pieces()),
      col('Tracking URL', null, G.url())
    ]
  },
  {
    id: 't-inv-alias-set',
    language: 'en',
    kind: 'inventory',
    columns: [
      col('Item Code', 'sku', G.sku()),
      col('Product Description', 'product_name', G.productName()),
      col('Product Category', 'category', G.category()),
      col('Plant', 'warehouse', G.warehouse('code')),
      col('On Hand Qty', 'quantity', G.int(0, 900)),
      col('ROP', 'reorder_point', G.int(1, 99)),
      col('Standard Cost', 'unit_cost', G.money()),
      col('Daily Usage', 'avg_daily_usage', G.decimal()),
      col('Supplier Lead Time', 'lead_time_days', G.int(2, 40)),
      col('Bin', null, G.bin()),
      col('Created On', null, G.date('iso')),
      col('Unit', null, G.unit())
    ]
  },
  {
    id: 't-ship-es-eu-dates',
    language: 'es',
    kind: 'shipments',
    columns: [
      col('Nº de Guía', 'shipment_id', G.shipmentId()),
      col('Origen', 'origin', G.city()),
      col('Destino', 'destination', G.city(2)),
      col('Transportista', 'carrier', G.carrier()),
      col('Estado', 'status', G.status('es')),
      col('Fecha de Salida', 'ship_date', G.date('dmy')),
      col('Fecha Estimada de Entrega', 'estimated_delivery', G.date('dmy', 3)),
      col('Fecha de Entrega', 'actual_delivery', G.date('dmy', 4)),
      col('Coste de Envío', 'shipping_cost', G.money('eu')),
      col('Bultos', null, G.pieces())
    ]
  }
];

describe('criterion 46: tuning corpus', () => {
  it('wrong MATCHED = 0, junk MATCHED = 0, recall >= 95%, wrong CHECK <= 10%', async () => {
    const m = await tuningMetrics();
    const text = report('tuning', m);
    expect(m.wrongMatched, text).toEqual([]);
    expect(m.junkMatched, text).toEqual([]);
    expect(m.recall, text).toBeGreaterThanOrEqual(0.95);
    expect(m.check === 0 || m.wrongCheck.length / m.check <= 0.1, text).toBe(true);
    expect(m.columns).toBeGreaterThan(120);
  });
});

describe('criterion 46: held-out corpus (written before the dictionaries)', () => {
  const cases = HELD_OUT.map(build);
  it('has 14 cases over five languages, both datasets, and junk/distractor columns', () => {
    expect(cases).toHaveLength(14);
    expect([...new Set(cases.map((c) => c.language))].sort()).toEqual(['de', 'en', 'es', 'fr', 'vi']);
    expect(new Set(cases.map((c) => c.kind))).toEqual(new Set(['inventory', 'shipments']));
    expect(cases.flatMap((c) => c.truth).filter((t) => t === null).length).toBeGreaterThan(15);
  });
  it('wrong MATCHED = 0, junk MATCHED = 0, recall >= 80%, wrong CHECK <= 10%', () => {
    const m = evaluate(cases);
    const text = report('held-out', m);
    expect(m.wrongMatched, text).toEqual([]);
    expect(m.junkMatched, text).toEqual([]);
    expect(m.recall, text).toBeGreaterThanOrEqual(0.8);
    expect(m.check === 0 || m.wrongCheck.length / m.check <= 0.1, text).toBe(true);
  });
});

describe('criterion 46: known-ambiguous headers are never MATCHED', () => {
  it('every ambiguous phrase of every language stays CHOOSE (or is left out), in both datasets', () => {
    let checked = 0;
    for (const file of DICTIONARY_FILES) {
      for (const a of file.ambiguous) {
        const values = a.kind === 'inventory' ? G.money() : G.date();
        const p = quick(a.kind, [col(a.example, null, values)]);
        expect(p.columns[0]?.state, `${file.language}: ${a.example}`).not.toBe('matched');
        expect(p.columns[0]?.state, `${file.language}: ${a.example}`).not.toBe('check');
        checked++;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(20);
    for (const header of ['Date', 'Cost', 'Location', 'Avg Usage', 'DATE', 'cost', ' location ', 'avg_usage']) {
      for (const kind of ['inventory', 'shipments'] as const) {
        const p = quick(kind, [col(header, null, G.city())]);
        expect(p.columns[0]?.state, `${kind}: ${header}`).not.toBe('matched');
      }
    }
  });
});

describe('criterion 46: junk and distractor columns are never MATCHED', () => {
  const junk = ['Notes', 'Comments', 'Remarks', 'Customer', 'Customer Reference', 'Invoice Number', 'Tracking URL', 'Weight (kg)', 'Weight (lbs)', 'Pallets', 'Pieces', 'Created On', 'Last Counted', 'Bin', 'Supplier', 'Base Unit of Measure', 'Net Weight', 'Phone', 'Email', 'Observaciones', 'Bemerkung', 'Commentaires', 'Ghi chú', 'Gewicht', 'Poids', 'Số kiện', 'Col1', 'Column 2', 'Field_3', 'Unnamed: 4', '', '  '];
  const values = [G.text('junk'), G.po(), G.weight(), G.pieces(), G.date(), G.customer(), G.int(0, 900), G.money(), G.status('en'), G.carrier(), G.yesNo(), G.url()];
  it('no junk header over any kind of values is MATCHED, in either dataset', () => {
    const bad: string[] = [];
    for (const kind of ['inventory', 'shipments'] as const) {
      for (const header of junk) {
        for (const [i, gen] of values.entries()) {
          const p = quick(kind, [col(header, null, gen)]);
          const c = p.columns[0]!;
          if (c.state === 'matched') bad.push(`${kind}: "${header}" value set ${i} -> ${c.field}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});
