// Criterion 50: dictionary validation. Plus header normalization (criterion 12) and the UTF-8 round trip of the
// Vietnamese/Spanish/German/French data (accents must survive).

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  DICTIONARY_FILES,
  LANGUAGE_ORDER,
  buildDictionary,
  defaultDict,
  flatten,
  foldedKey,
  recognizesHeader,
  validateDictionary,
  type DictionaryFile
} from '../../../src/shared/ingest/mapping/dictionary';
import { keyOf, normalizeHeader, foldText } from '../../../src/shared/ingest/mapping/normalizeHeader';
import { fieldsOf } from '../../../src/shared/ingest/canonical/schemaRegistry';
import { INVENTORY_ALIASES, INVENTORY_AMBIGUOUS, SHIPMENT_ALIASES, SHIPMENT_AMBIGUOUS } from '../../../src/shared/mapping/aliases';

describe('header normalization (4.2)', () => {
  const n = (s: string) => normalizeHeader(s);
  it('folds case, diacritics and special letters', () => {
    expect(n('Mã Vận Đơn').key).toBe('ma van don');
    expect(n('NÚMERO DE GUÍA').key).toBe('numero guia');
    expect(n('Straße').key).toBe('strasse');
    expect(n('Überlänge').key).toBe('uberlange');
    expect(n('Søren').key).toBe('soren');
    expect(n("Prix d'Achat Unitaire").key).toBe('prix achat unitaire');
    expect(foldText('ĐƠN GIÁ')).toBe('don gia');
  });
  it('splits camelCase, snake_case, punctuation and digits', () => {
    expect(n('ShipDate').key).toBe('ship date');
    expect(n('ship_date').key).toBe('ship date');
    expect(n('ship-date.').key).toBe('ship date');
    expect(n('SKUCode').key).toBe('sku code');
    expect(n('qty2').key).toBe('qty 2');
    expect(n('  Order   No.  ').key).toBe('order no');
    expect(n('Order #').key).toBe('order no');
    expect(n('Nº de Envío').key).toBe('no envio');
    expect(n('N° Article').key).toBe('no article');
  });
  it('moves bracketed and trailing units into hints', () => {
    const f = n('Freight (USD)');
    expect(f.key).toBe('freight');
    expect(f.hints).toEqual([{ kind: 'currency', text: 'usd' }]);
    expect(n('Freight Cost USD')).toMatchObject({ key: 'freight cost', hints: [{ kind: 'currency', text: 'usd' }] });
    expect(n('Weight (lbs)')).toMatchObject({ key: 'weight', hints: [{ kind: 'weight', text: 'lbs' }] });
    expect(n('Lead Time (Days)')).toMatchObject({ key: 'lead time', hints: [{ kind: 'time', text: 'days' }] });
    expect(n('Unit $').hints.some((h) => h.kind === 'currency')).toBe(true);
    expect(n('Weight (kg) (x)').key).toContain('weight');
    expect(n('Days').key).toBe('day'); // never the whole header
  });
  it('drops stop words and stems plurals lightly', () => {
    expect(n('Date of Shipment').key).toBe('date shipment');
    expect(n('Quantities').key).toBe('quantity');
    expect(n('Units').key).toBe('unit');
    expect(n('Status').key).toBe('status');
    expect(n('Address').key).toBe('address');
  });
  it('is stable for empty and symbol-only headers', () => {
    expect(n('').key).toBe('');
    expect(n('###').tokens.every((t) => t === 'no')).toBe(true);
    expect(n('---').key).toBe('');
    expect(n('(blank)').tokens).toEqual(['blank']);
  });
});

describe('dictionary validation (criterion 50)', () => {
  it('the shipped dictionaries are valid', () => {
    expect(validateDictionary(DICTIONARY_FILES)).toEqual([]);
  });

  it('every language file is present, in order, versioned and flagged "needs native review"', () => {
    expect(DICTIONARY_FILES.map((f) => f.language)).toEqual([...LANGUAGE_ORDER]);
    expect(LANGUAGE_ORDER).toEqual(['en', 'vi', 'es', 'de', 'fr']);
    for (const f of DICTIONARY_FILES) {
      expect(f.reviewStatus).toBe('needs native review');
      expect(f.version).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it('every entry has a corpus example that contains its phrase and resolves to the same field', () => {
    const dict = defaultDict();
    let checked = 0;
    for (const r of dict.records()) {
      expect(r.example.trim(), `${r.language}/${r.field}/${r.phrase}`).not.toBe('');
      expect(keyOf(r.example).includes(r.key), `${r.phrase} in example ${r.example}`).toBe(true);
      if (keyOf(r.example) === r.key) {
        const hit = dict.lookup(r.kind, r.key);
        expect(hit?.type, r.phrase).toBe('phrase');
        if (hit?.type === 'phrase') expect(hit.record.field, `${r.language}: ${r.phrase}`).toBe(r.field);
      }
      checked++;
    }
    expect(checked).toBeGreaterThan(600);
  });

  it('no phrase is STRONG for two fields, also after diacritic folding, and no key is defined twice with different meanings', () => {
    const seen = new Map<string, string>();
    for (const r of flatten(DICTIONARY_FILES).records) {
      if (r.strength !== 'strong') continue;
      const id = `${r.kind}|${foldedKey(r.phrase)}`;
      const prior = seen.get(id);
      expect(prior === undefined || prior === r.field, `${r.language}: "${r.phrase}" is strong for ${prior} and ${r.field}`).toBe(true);
      seen.set(id, r.field);
    }
  });

  it('detects the problems it is meant to catch', () => {
    const base = DICTIONARY_FILES[0] as DictionaryFile;
    const withGroup = (groups: DictionaryFile['groups'], ambiguous: DictionaryFile['ambiguous'] = []): DictionaryFile => ({ ...base, groups, ambiguous });
    expect(validateDictionary([withGroup([{ kind: 'inventory', field: 'sku', strong: [['Item Code', 'Item Code']] }])]).join()).toMatch(/not normalized/);
    expect(validateDictionary([withGroup([{ kind: 'inventory', field: 'sku', strong: [['item code', '']] }])]).join()).toMatch(/missing corpus example/);
    expect(validateDictionary([withGroup([{ kind: 'inventory', field: 'sku', strong: [['item code', 'Something Else']] }])]).join()).toMatch(/does not contain the phrase/);
    expect(validateDictionary([withGroup([{ kind: 'inventory', field: 'nonsense', strong: [['x y', 'X Y']] }])]).join()).toMatch(/unknown field/);
    const twice = withGroup([
      { kind: 'inventory', field: 'sku', strong: [['item code', 'Item Code']] },
      { kind: 'inventory', field: 'product_name', strong: [['item code', 'Item Code']] }
    ]);
    expect(validateDictionary([twice]).join()).toMatch(/already defined|STRONG for both/);
    const folded = withGroup([
      { kind: 'inventory', field: 'sku', strong: [['mã hàng', 'Mã hàng']] },
      { kind: 'inventory', field: 'category', strong: [['ma hang', 'Ma hang']] }
    ]);
    expect(validateDictionary([folded]).join()).toMatch(/already defined|STRONG for both/);
    expect(validateDictionary([{ ...base, reviewStatus: 'reviewed' as never }]).join()).toMatch(/reviewStatus/);
    expect(validateDictionary([withGroup([], [{ kind: 'inventory', phrase: 'cost', example: 'Cost', candidates: ['nonsense'] }])]).join()).toMatch(/unknown candidate/);
    const overlap = withGroup([{ kind: 'inventory', field: 'unit_cost', strong: [['cost', 'Cost']] }], [{ kind: 'inventory', phrase: 'cost', example: 'Cost', candidates: ['unit_cost'] }]);
    expect(validateDictionary([overlap]).join()).toMatch(/both ambiguous and a mapped phrase/);
  });

  it('building from shuffled entries gives the same tables (insertion order never matters)', () => {
    const reversed: DictionaryFile[] = [...DICTIONARY_FILES].reverse().map((f) => ({ ...f, groups: [...f.groups].reverse().map((g) => ({ ...g, strong: g.strong === undefined ? undefined : [...g.strong].reverse() })) as never, ambiguous: [...f.ambiguous].reverse() }));
    const a = buildDictionary(DICTIONARY_FILES);
    const b = buildDictionary(reversed);
    expect(b.version).toBe(a.version);
    expect(b.records().map((r) => `${r.language}|${r.kind}|${r.field}|${r.strength}|${r.phrase}`)).toEqual(a.records().map((r) => `${r.language}|${r.kind}|${r.field}|${r.strength}|${r.phrase}`));
  });

  it('canonical names never collide with another field\'s phrase', () => {
    const dict = defaultDict();
    for (const kind of ['inventory', 'shipments'] as const) {
      for (const f of fieldsOf(kind)) {
        const hit = dict.lookup(kind, keyOf(f.name));
        if (hit?.type === 'phrase') expect(hit.record.field).toBe(f.name);
      }
    }
  });

  it('keeps every V1.5 alias as STRONG for the same field and every V1.5 ambiguous header ambiguous with the same candidates', () => {
    const dict = defaultDict();
    for (const [kind, table] of [['inventory', INVENTORY_ALIASES], ['shipments', SHIPMENT_ALIASES]] as const) {
      for (const [field, aliases] of table) {
        for (const alias of aliases) {
          const hit = dict.lookup(kind, keyOf(alias));
          expect(hit?.type, `${kind}: ${alias}`).toBe('phrase');
          if (hit?.type === 'phrase') {
            expect(hit.record.field, `${kind}: ${alias}`).toBe(field);
            expect(hit.record.strength, `${kind}: ${alias}`).toBe('strong');
          }
        }
      }
    }
    for (const [kind, table] of [['inventory', INVENTORY_AMBIGUOUS], ['shipments', SHIPMENT_AMBIGUOUS]] as const) {
      for (const [key, candidates] of table) {
        const hit = dict.lookup(kind, keyOf(key));
        expect(hit?.type, `${kind}: ${key}`).toBe('ambiguous');
        if (hit?.type === 'ambiguous') expect([...hit.candidates], `${kind}: ${key}`).toEqual([...candidates]);
      }
    }
  });

  it('recognizes headers of any kind and language, including canonical names, weak and ambiguous phrases', () => {
    for (const h of ['sku', 'product_name', 'Consignment Reference', 'Mã vận đơn', 'Número de Guía', 'Sendungsnummer', 'Numéro d\'expédition', 'Order No.', 'Date', 'cost', 'lead_time_days']) {
      expect(recognizesHeader(h), h).toBe(true);
    }
    for (const h of ['Col7', 'Weight (kg)', 'Notes', 'Customer Reference', '']) expect(recognizesHeader(h), h).toBe(false);
  });

  it('phrases are written in UTF-8 and the accents survive (read back from disk)', () => {
    const read = (f: string) => readFileSync(resolve(process.cwd(), 'src/shared/ingest/mapping/dictionary', f), 'utf8');
    expect(read('vi.ts')).toContain('Mã vận đơn');
    expect(read('vi.ts')).toContain('Đơn vị vận chuyển');
    expect(read('es.ts')).toContain('Número de Guía');
    expect(read('es.ts')).toContain('Compañía de Transporte');
    expect(read('de.ts')).toContain('Verfügbarer Bestand');
    expect(read('de.ts')).toContain('Frachtführer');
    expect(read('fr.ts')).toContain("Numéro d'Expédition");
    expect(read('fr.ts')).toContain('Coût du Transport');
    for (const f of ['vi.ts', 'es.ts', 'de.ts', 'fr.ts']) expect(read(f)).not.toContain('�');
    expect(foldedKey('Mã vận đơn')).toBe('ma van don');
    expect(foldedKey('Frachtführer')).toBe('frachtfuhrer');
  });

  it('a phrase in one language does not silently change meaning in another (cross-language keys are unique per kind)', () => {
    const byKey = new Map<string, Set<string>>();
    for (const r of flatten(DICTIONARY_FILES).records) {
      if (r.strength === 'weak') continue;
      const id = `${r.kind}|${foldedKey(r.phrase)}`;
      const set = byKey.get(id) ?? new Set<string>();
      set.add(r.field);
      byKey.set(id, set);
    }
    for (const [id, fields] of byKey) expect(fields.size, `${id}: ${[...fields].join(', ')}`).toBe(1);
  });
});
