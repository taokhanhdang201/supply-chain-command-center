// Semantic mapper behaviour (criteria 12, 13, 16): evidence, composition, MATCHED / CHECK / CHOOSE, competing columns,
// ambiguous headers, profile-only suggestions, typos, units, and the missing-field policy.

import { describe, expect, it } from 'vitest';
import { G, col } from '../../fixtures/ingest/gen';
import { byHeader, quick } from '../../ingest-kit/mapperHarness';
import {
  CHECK_MIN_CONFIDENCE,
  CHOOSE_FLOOR,
  COMPETING_WINDOW,
  MATCH_MIN_CONFIDENCE,
  MATCH_MIN_MARGIN,
  MISMATCH_FACTOR,
  PROFILE_ONLY_CAP,
  PROFILE_ONLY_FACTOR,
  SIMILARITY_CAP,
  SPELLING_CAP,
  STRENGTH_EXACT,
  STRENGTH_MEDIUM,
  STRENGTH_STRONG,
  STRENGTH_WEAK,
  WEIGHT_HEADER,
  WEIGHT_PROFILE,
  editDistance,
  headerEvidence,
  sameWordsSpelledAlike
} from '../../../src/shared/ingest/mapping/score';
import { fieldsOf } from '../../../src/shared/ingest/canonical/schemaRegistry';
import { normalizeHeader } from '../../../src/shared/ingest/mapping/normalizeHeader';

const ship = (name: string) => fieldsOf('shipments').find((f) => f.name === name)!;

describe('named constants (criterion 12: thresholds are named and pinned)', () => {
  it('have the specified values', () => {
    expect([STRENGTH_EXACT, STRENGTH_STRONG, STRENGTH_MEDIUM, STRENGTH_WEAK]).toEqual([1.0, 0.92, 0.75, 0.55]);
    expect([SIMILARITY_CAP, SPELLING_CAP]).toEqual([0.6, 0.55]);
    expect([WEIGHT_HEADER, WEIGHT_PROFILE, MISMATCH_FACTOR]).toEqual([0.6, 0.4, 0.75]);
    expect([MATCH_MIN_CONFIDENCE, MATCH_MIN_MARGIN, CHECK_MIN_CONFIDENCE, COMPETING_WINDOW]).toEqual([0.85, 0.25, 0.55, 0.15]);
    expect([PROFILE_ONLY_CAP, PROFILE_ONLY_FACTOR, CHOOSE_FLOOR]).toEqual([0.7, 0.75, 0.35]);
  });
});

describe('header evidence E1-E4', () => {
  const h = (header: string, field = 'shipment_id') => headerEvidence('shipments', normalizeHeader(header), ship(field));
  it('E1 exact canonical name, E2 dictionary strengths with their notes', () => {
    expect(h('shipment_id')).toMatchObject({ kind: 'exact', strength: 1 });
    expect(h('Shipment ID')).toMatchObject({ kind: 'exact', strength: 1 });
    expect(h('Consignment Reference')).toMatchObject({ kind: 'strong', strength: 0.92 });
    expect(h('Tracking Number')).toMatchObject({ kind: 'medium', strength: 0.75 });
    const weak = h('Order No.');
    expect(weak).toMatchObject({ kind: 'weak', strength: 0.55 });
    expect(weak.warnings.join(' ')).toContain('may identify an order rather than a shipment');
    expect(h('Nº de Guía')).toMatchObject({ kind: 'strong' });
    expect(h('Mã vận đơn')).toMatchObject({ kind: 'strong' });
  });
  it('E3 similar wording is capped at 0.60 and needs a shared non-generic word', () => {
    const e = h('Consignment Code');
    expect(e.kind).toBe('similar');
    expect(e.strength).toBeLessThanOrEqual(0.6);
    expect(h('Customer Reference').kind).toBe('none'); // only the generic word "reference" is shared
    expect(h('Invoice Number').kind).toBe('none');
  });
  it('E4 typo tolerance works word by word, is capped at 0.55 and flagged "spelling"', () => {
    const e = h('Shipmnt Number');
    expect(e).toMatchObject({ kind: 'spelling' });
    expect(e.strength).toBeLessThanOrEqual(0.55);
    expect(e.warnings.join(' ')).toContain('spelling');
    expect(h('Consignmnet Reference').kind).toBe('spelling');
    expect(h('PO Number').kind).toBe('none'); // short words must match exactly: "po" is not a typo of "pro"
    expect(sameWordsSpelledAlike(['shipment', 'date'], ['shippment', 'date'])).toBe(true);
    expect(sameWordsSpelledAlike(['po', 'number'], ['pro', 'number'])).toBe(false);
    expect(sameWordsSpelledAlike(['date'], ['data'])).toBe(false);
    expect(editDistance('abcdef', 'abcdfe')).toBe(1); // transposition
    expect(editDistance('abcdef', 'abc')).toBe(3);
    expect(editDistance('abcdefgh', 'abc')).toBe(4); // beyond the limit: limit + 1
  });
  it('E7 a weight unit keeps a column away from cost and quantity fields', () => {
    const cost = headerEvidence('shipments', normalizeHeader('Freight Weight (kg)'), ship('shipping_cost'));
    expect(cost.strength).toBe(0);
    expect(cost.line).toContain('weight');
  });
});

describe('criterion 13: concrete behaviours', () => {
  it('Consignment Reference -> shipment_id MATCHED, with evidence', () => {
    const p = quick('shipments', [col('Consignment Reference', 'shipment_id', G.shipmentId())]);
    const c = byHeader(p, 'Consignment Reference');
    expect(c).toMatchObject({ state: 'matched', field: 'shipment_id' });
    expect(c.confidence).toBeGreaterThanOrEqual(0.85);
    expect(c.evidence.join(' | ')).toContain('strong synonym of shipment_id');
    expect(c.evidence.join(' | ')).toContain('look like IDs');
    expect(c.evidence.join(' | ')).toContain('confidence C =');
  });

  it('Tracking Number alone is at most CHECK (plausible synonym), with evidence', () => {
    const c = byHeader(quick('shipments', [col('Tracking Number', 'shipment_id', G.shipmentId())]), 'Tracking Number');
    expect(c.state).toBe('check');
    expect(c.field).toBe('shipment_id');
    expect(c.warnings.join(' ')).toContain('plausible synonym');
  });

  it('Order No. alone is CHECK with the "may identify an order" warning, never MATCHED', () => {
    const c = byHeader(quick('shipments', [col('Order No.', 'shipment_id', G.shipmentId())]), 'Order No.');
    expect(c.state).toBe('check');
    expect(c.field).toBe('shipment_id');
    expect(c.warnings.join(' ')).toContain('may identify an order rather than a shipment');
  });

  it('Order No. together with Tracking Number: both CHOOSE ("competing")', () => {
    const p = quick('shipments', [col('Order No.', null, G.po()), col('Tracking Number', 'shipment_id', G.shipmentId())]);
    const order = byHeader(p, 'Order No.');
    const tracking = byHeader(p, 'Tracking Number');
    for (const c of [order, tracking]) {
      expect(c.state).toBe('choose');
      expect(c.reason).toBe('competing');
      expect(c.field).toBeNull();
      expect(c.candidates.map((x) => x.field)).toEqual(['shipment_id']);
      expect(c.evidence[0]).toMatch(/^Competing for shipment_id: /);
    }
    expect(order.competingWith).toEqual([tracking.index]);
    expect(tracking.competingWith).toEqual([order.index]);
    expect(p.fields.find((f) => f.field === 'shipment_id')).toMatchObject({ state: 'pending', columnIndex: null });
  });

  it('Date, Cost, Location and Avg Usage stay CHOOSE with the V1.5 candidate lists', () => {
    const ships = quick('shipments', [col('Date', null, G.date()), col('Cost', null, G.money()), col('Location', null, G.city())]);
    expect(byHeader(ships, 'Date')).toMatchObject({ state: 'choose', reason: 'ambiguous-header' });
    expect(byHeader(ships, 'Date').candidates.map((c) => c.field)).toEqual(['ship_date', 'estimated_delivery', 'actual_delivery']);
    expect(byHeader(ships, 'Cost').candidates.map((c) => c.field)).toEqual(['shipping_cost']);
    expect(byHeader(ships, 'Location').candidates.map((c) => c.field)).toEqual(['origin', 'destination']);
    const inv = quick('inventory', [col('Cost', null, G.money()), col('Avg Usage', null, G.decimal())]);
    expect(byHeader(inv, 'Cost')).toMatchObject({ state: 'choose' });
    expect(byHeader(inv, 'Cost').candidates.map((c) => c.field)).toEqual(['unit_cost']);
    expect(byHeader(inv, 'Avg Usage').candidates.map((c) => c.field)).toEqual(['avg_daily_usage']);
    for (const c of [...ships.columns, ...inv.columns]) expect(c.state).not.toBe('matched');
  });

  it('an ambiguous header never offers a field that an exactly-named column already claims (V1.5)', () => {
    const p = quick('shipments', [col('ship_date', 'ship_date', G.date()), col('Date', null, G.date('iso', 3))]);
    expect(byHeader(p, 'ship_date').state).toBe('matched');
    expect(byHeader(p, 'Date').candidates.map((c) => c.field)).toEqual(['estimated_delivery', 'actual_delivery']);
    const all = quick('shipments', [col('ship_date', 'ship_date', G.date()), col('estimated_delivery', 'estimated_delivery', G.date()), col('actual_delivery', 'actual_delivery', G.date()), col('Date', null, G.date())]);
    expect(byHeader(all, 'Date')).toMatchObject({ state: 'ignored' });
  });

  it('a column of status words with a meaningless header gets a profile-only CHECK at most', () => {
    const c = byHeader(quick('shipments', [col('Col7', 'status', G.status('en'))]), 'Col7');
    expect(c).toMatchObject({ state: 'check', field: 'status' });
    expect(c.confidence).toBeLessThanOrEqual(0.7);
    expect(c.warnings.join(' ')).toContain('values only');
    expect(c.evidence.join(' ')).toContain('no header evidence');
    expect(byHeader(quick('shipments', [col('Col7', 'status', G.status('vi'))]), 'Col7')).toMatchObject({ state: 'check', field: 'status' });
  });

  it('a meaningless header over other generic values is never mapped (profile-only is a hint, not a mapping)', () => {
    const p = quick('inventory', [col('Col1', null, G.int(0, 900)), col('Col2', null, G.sku()), col('Col3', null, G.money()), col('Col4', null, G.productName())]);
    for (const c of p.columns) expect(c.state).toBe('ignored');
  });

  it('junk columns are "Not imported" and never matched', () => {
    const p = quick('shipments', [
      col('Consignment Reference', 'shipment_id', G.shipmentId()),
      col('Notes', null, G.text('Note')),
      col('Weight (lbs)', null, G.weight()),
      col('Customer Reference', null, G.po()),
      col('Invoice Number', null, G.invoice()),
      col('Tracking URL', null, G.url()),
      col('Pallets', null, G.pieces())
    ]);
    expect(p.notImported).toEqual([1, 2, 3, 4, 5, 6]);
    for (const i of p.notImported) expect(p.columns[i]?.state).toBe('ignored');
  });

  it('a header that is right but whose values are wrong is distrusted (C x 0.75) and flagged', () => {
    const c = byHeader(quick('inventory', [col('Quantity', 'quantity', G.productName())]), 'Quantity');
    expect(c.state).not.toBe('matched');
    expect(c.warnings.join(' ')).toContain('do not look like quantity');
  });

  it('two columns for one field both become CHOOSE (duplicate), a column fitting two fields equally is CHOOSE', () => {
    const dup = quick('inventory', [col('Qty', 'quantity', G.int(0, 900)), col('Quantity', 'quantity', G.int(0, 900))]);
    expect(dup.columns.map((c) => c.state)).toEqual(['choose', 'choose']);
    const two = quick('shipments', [col('Delivery', null, G.date())]);
    expect(two.columns[0]?.state === 'ignored' || two.columns[0]?.state === 'choose').toBe(true);
  });

  it('ties never resolve by column order', () => {
    const a = quick('inventory', [col('Qty', 'quantity', G.int(0, 900)), col('Quantity', 'quantity', G.int(0, 900))]);
    const b = quick('inventory', [col('Quantity', 'quantity', G.int(0, 900)), col('Qty', 'quantity', G.int(0, 900))]);
    expect(a.columns.map((c) => c.state)).toEqual(['choose', 'choose']);
    expect(b.columns.map((c) => c.state)).toEqual(['choose', 'choose']);
  });

  it('every mapping entry carries non-empty human-readable evidence (MATCHED, CHECK, CHOOSE and ignored)', () => {
    const p = quick('shipments', [
      col('Consignment Reference', 'shipment_id', G.shipmentId()),
      col('Tracking Number', 'shipment_id', G.shipmentId('TRK')),
      col('Date', null, G.date()),
      col('State', 'status', G.status('en')),
      col('Notes', null, G.text('n')),
      col('Haulier', 'carrier', G.carrier())
    ]);
    for (const c of p.columns) {
      expect(c.evidence.length, c.header).toBeGreaterThan(0);
      expect(c.evidence.every((e) => e.trim().length > 10), c.header).toBe(true);
    }
  });

  it('a column without values is matched from its header alone (no evidence against it)', () => {
    const c = byHeader(quick('inventory', [{ header: 'Item Code', truth: 'sku', gen: () => '' }]), 'Item Code');
    expect(c.state).toBe('matched');
    expect(c.evidence.join(' ')).toContain('no values to check');
  });

  it('mapping a header-only table (no data rows) works', () => {
    const p = quick('inventory', [col('Item Code', 'sku', G.sku())].map((c) => ({ ...c, gen: () => '' })));
    expect(p.columns[0]?.state).toBe('matched');
  });
});

describe('criterion 16: missing fields (never derived)', () => {
  const inventoryBase = [
    col('sku', 'sku', G.sku()), col('product_name', 'product_name', G.productName()), col('category', 'category', G.category()), col('warehouse', 'warehouse', G.warehouse()),
    col('quantity', 'quantity', G.int(0, 900)), col('reorder_point', 'reorder_point', G.int(1, 99)), col('unit_cost', 'unit_cost', G.money())
  ];
  it('unknown is allowed only for the optional fields, emitted as a present empty column', () => {
    const p = quick('inventory', inventoryBase);
    const get = (f: string) => p.fields.find((x) => x.field === f)!;
    expect(get('avg_daily_usage')).toMatchObject({ state: 'missing', options: ['unknown'], blocksImport: false });
    expect(get('lead_time_days')).toMatchObject({ state: 'missing', options: ['unknown', 'constant'], blocksImport: false });
    expect(get('sku')).toMatchObject({ state: 'mapped', columnIndex: 0 });
  });
  it('a missing required field with no option rejects; a low-risk descriptor may take ONE constant', () => {
    const ships = [col('shipment_id', 'shipment_id', G.shipmentId()), col('origin', 'origin', G.city()), col('destination', 'destination', G.city(2)), col('status', 'status', G.status('canonical')), col('ship_date', 'ship_date', G.date()), col('shipping_cost', 'shipping_cost', G.money())];
    const p = quick('shipments', ships);
    const get = (f: string) => p.fields.find((x) => x.field === f)!;
    expect(get('carrier')).toMatchObject({ state: 'missing', options: ['constant'], blocksImport: false });
    expect(get('estimated_delivery')).toMatchObject({ state: 'missing', options: ['unknown'], blocksImport: false });
    expect(get('actual_delivery')).toMatchObject({ state: 'missing', options: ['unknown'], blocksImport: false });
    const noId = quick('shipments', ships.slice(1));
    expect(noId.fields.find((x) => x.field === 'shipment_id')).toMatchObject({ state: 'missing', options: [], blocksImport: true });
    const noDate = quick('shipments', ships.filter((c) => c.header !== 'ship_date'));
    expect(noDate.fields.find((x) => x.field === 'ship_date')).toMatchObject({ blocksImport: true });
    const noCost = quick('shipments', ships.filter((c) => c.header !== 'shipping_cost'));
    expect(noCost.fields.find((x) => x.field === 'shipping_cost')).toMatchObject({ blocksImport: true, options: [] });
  });
  it('constants are only ever offered for carrier, warehouse, origin, destination, category, status and lead_time_days', () => {
    const empty = quick('shipments', [col('Notes', null, G.text('x'))]);
    const inv = quick('inventory', [col('Notes', null, G.text('x'))]);
    const constants = [...empty.fields, ...inv.fields].filter((f) => f.options.includes('constant')).map((f) => f.field).sort();
    expect(constants).toEqual(['carrier', 'category', 'destination', 'lead_time_days', 'origin', 'status', 'warehouse']);
    const unknowns = [...empty.fields, ...inv.fields].filter((f) => f.options.includes('unknown')).map((f) => f.field).sort();
    expect(unknowns).toEqual(['actual_delivery', 'avg_daily_usage', 'estimated_delivery', 'lead_time_days']);
    for (const f of [...empty.fields, ...inv.fields]) expect(f.options.every((o) => o === 'unknown' || o === 'constant')).toBe(true); // nothing derived
  });
});
