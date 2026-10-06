// Golden tests N01-N36, NP01-NP13, D01-D27, DP01-DP14 of Addendum AD-5 (criteria 9, 10, 47 at normalizer level).

import { describe, expect, it } from 'vitest';
import { compatibleNumberPresets, normalizeNumber, type NumberCtx, type NumberPreset } from '../../../src/shared/ingest/normalize/numbers';
import { compatibleDatePresets, normalizeDate, type DatePreset } from '../../../src/shared/ingest/normalize/dates';
import { detectDatePreset, detectNumberPreset } from '../../../src/shared/ingest/normalize/detectPreset';
import { blankKind, isPlaceholder } from '../../../src/shared/ingest/normalize/text';
import { DEFAULT_NUMBER_PRESET } from '../../../src/shared/ingest/normalize/numbers';
import { DEFAULT_DATE_PRESET } from '../../../src/shared/ingest/normalize/dates';

const NBSP = ' ';
const NNBSP = ' ';
const CTX: NumberCtx = { money: false, optional: false };
const MONEY: NumberCtx = { money: true, optional: false };
const OPTIONAL: NumberCtx = { money: false, optional: true };

/** The normalized string, or 'R' (rejected; syntax) or 'R:currency:<marker>'. */
function num(raw: string, preset: NumberPreset, ctx: NumberCtx = CTX): string {
  const r = normalizeNumber(raw, preset, ctx);
  if (r.ok) return r.value;
  return r.reason === 'currency' ? `R:currency:${r.marker}` : 'R';
}

describe('normalizeNumber: golden cases N01-N36 (AD-2, AD-5)', () => {
  const rows: Array<[string, string, NumberPreset, string, NumberCtx?]> = [
    ['N01', '1250.50', 'plain', '1250.50'],
    ['N02', '1250.50', 'us', '1250.50'],
    ['N03', '1,250.50', 'us', '1250.50'],
    ['N04', '1,250.50', 'plain', 'R'],
    ['N05', '1.250,50', 'eu', '1250.50'],
    ['N06', '1.250,50', 'us', 'R'],
    ['N07', '1 250,50', 'fr', '1250.50'],
    ['N08', `1${NBSP}250,50`, 'fr', '1250.50'],
    ['N09', `1${NNBSP}250,50`, 'fr', '1250.50'],
    ['N10', `1${NBSP}250${NBSP}000,5`, 'fr', '1250000.5'],
    ['N11', `1 250${NBSP}000`, 'fr', 'R'],
    ['N12', '1 250,50', 'plain', 'R'],
    ['N13', '89,50', 'eu', '89.50'],
    ['N13', '89,50', 'fr', '89.50'],
    ['N13', '89,50', 'us', 'R'],
    ['N14', '0,125', 'eu', '0.125'],
    ['N14', '0,125', 'us', 'R'],
    ['N15', '1,250', 'us', '1250'],
    ['N15', '1,250', 'eu', '1.250'],
    ['N15', '1,250', 'fr', '1.250'],
    ['N15', '1,250', 'plain', 'R'],
    ['N16', '1.250', 'plain', '1.250'],
    ['N16', '1.250', 'us', '1.250'],
    ['N16', '1.250', 'eu', '1250'],
    ['N16', '1.250', 'fr', 'R'],
    ['N17', '1.250.000', 'eu', '1250000'],
    ['N17', '1.250.000', 'plain', 'R'],
    ['N18', '12,34,567', 'us', 'R'],
    ['N19', '1,2345', 'us', 'R'],
    ['N19', '1,2345', 'eu', '1.2345'],
    ['N20', '-1.250,00', 'eu', '-1250.00'],
    ['N21', '-0,00', 'eu', '-0.00'],
    ['N25', '$1,250.50', 'us', '1250.50', MONEY],
    ['N25', '$1,250.50', 'us', 'R', CTX],
    ['N26', '-$5.00', 'plain', '-5.00', MONEY],
    ['N26', '$-5.00', 'plain', 'R', MONEY],
    ['N27', '1.250,50 USD', 'eu', '1250.50', MONEY],
    ['N28', '€ 89,50', 'eu', 'R:currency:€', MONEY],
    ['N28', '89,50 EUR', 'eu', 'R:currency:EUR', MONEY],
    ['N31', '007', 'plain', '007'],
    ['N31', '007', 'us', '007'],
    ['N32', '  12  ', 'plain', '12'],
    ['N35', '12 345,6', 'fr', '12345.6'],
    ['N35', '1 2345,6', 'fr', 'R'],
    ['N36', '12 pcs', 'plain', 'R']
  ];
  for (const [id, input, preset, expected, ctx] of rows) {
    it(`${id}: ${JSON.stringify(input)} (${preset}${ctx?.money ? ', money' : ''}) -> ${expected}`, () => {
      expect(num(input, preset, ctx ?? CTX)).toBe(expected);
    });
  }

  it('N22: +5 is rejected under every preset', () => {
    for (const p of ['plain', 'us', 'eu', 'fr'] as const) expect(num('+5', p)).toBe('R');
  });
  it('N23: (5) is rejected under every preset', () => {
    for (const p of ['plain', 'us', 'eu', 'fr'] as const) expect(num('(5)', p)).toBe('R');
  });
  it('N24: 5- and U+2212 minus are rejected under every preset', () => {
    for (const p of ['plain', 'us', 'eu', 'fr'] as const) {
      expect(num('5-', p)).toBe('R');
      expect(num('−5', p)).toBe('R');
      expect(num('−5', p, MONEY)).toBe('R');
    }
  });
  it('N29: .5, 5., 1e3, NaN, Infinity, 0x10 are rejected', () => {
    for (const v of ['.5', '5.', '1e3', 'NaN', 'Infinity', '0x10']) for (const p of ['plain', 'us', 'eu', 'fr'] as const) expect(num(v, p), v).toBe('R');
  });
  it('N30: full-width and Arabic-Indic digits are rejected', () => {
    for (const v of ['１２３', '٣']) expect(num(v, 'plain')).toBe('R');
  });
  it('N33: blank is blank and carries no evidence', () => {
    expect(normalizeNumber('', 'plain', CTX)).toEqual({ ok: true, value: '', blank: 'blank' });
    expect(normalizeNumber('   ', 'eu', CTX)).toEqual({ ok: true, value: '', blank: 'blank' });
  });
  it('N34: a placeholder is blank in an optional field and a syntax failure (raw to V1) elsewhere', () => {
    for (const p of ['n/a', 'NA', 'N.A.', '#N/A', 'null', 'None', '-', '--', '–', '—']) {
      expect(normalizeNumber(p, 'plain', OPTIONAL), p).toEqual({ ok: true, value: '', blank: 'placeholder' });
      expect(normalizeNumber(p, 'plain', CTX), p).toEqual({ ok: false, reason: 'syntax' });
    }
  });
  it('the USD marker is reported; typed-number exemption is the caller\'s job (only text cells reach the normalizer)', () => {
    expect(normalizeNumber('$12.50', 'plain', MONEY)).toEqual({ ok: true, value: '12.50', marker: 'USD' });
    expect(normalizeNumber('usd 12.50', 'plain', MONEY)).toEqual({ ok: true, value: '12.50', marker: 'USD' });
    expect(normalizeNumber('12.50 usd', 'plain', MONEY)).toEqual({ ok: true, value: '12.50', marker: 'USD' });
  });
  it('a currency marker needs digits and at most one edge token', () => {
    expect(num('$', 'plain', MONEY)).toBe('R');
    expect(num('$12$', 'plain', MONEY)).toBe('R');
    expect(num('USD', 'plain', MONEY)).toBe('R');
    expect(num('12  USD', 'plain', MONEY)).toBe('R'); // more than one space between digits and marker
    expect(num('kr 12', 'plain', MONEY)).toBe('R'); // unknown marker
  });
  it('every documented currency symbol and ISO code is refused in a money column, case-insensitively', () => {
    for (const t of ['€', '£', '¥', '₫', '₹', '₩', '₽', '฿', '₺', '₪', '₱', 'EUR', 'gbp', 'JPY', 'VND', 'inr', 'CNY', 'KRW', 'CAD', 'AUD', 'CHF', 'MXN', 'BRL', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'TRY', 'AED', 'SGD', 'HKD', 'NZD', 'ZAR', 'THB', 'IDR', 'MYR', 'PHP']) {
      const r = normalizeNumber(`${t}12`, 'plain', MONEY);
      expect(r.ok, t).toBe(false);
      if (!r.ok) expect(r.reason, t).toBe('currency');
      expect(num(`${t}12`, 'plain', CTX), t).toBe('R'); // in a non-money column it is an ordinary syntax error
    }
  });
  it('compat lists the presets under which a value fits (AD-2 consequences)', () => {
    const compat = (v: string) => compatibleNumberPresets(v, CTX);
    expect(compat('12')).toEqual(['plain', 'us', 'eu', 'fr']);
    expect(compat('1250.5')).toEqual(['plain', 'us']);
    expect(compat('1250,5')).toEqual(['eu', 'fr']);
    expect(compat('1,250')).toEqual(['us', 'eu', 'fr']);
    expect(compat('1.250')).toEqual(['plain', 'us', 'eu']);
    expect(compat('1,250.50')).toEqual(['us']);
    expect(compat('1.250,50')).toEqual(['eu']);
    expect(compat('1 250,50')).toEqual(['fr']);
    expect(compat('.5')).toEqual([]);
  });
  it('the output always matches the V1 grammar', () => {
    for (const [raw, preset] of [['1,250.50', 'us'], ['1.250,50', 'eu'], ['1 250,50', 'fr'], ['-0,00', 'eu'], ['007', 'plain']] as const) {
      const r = normalizeNumber(raw, preset, CTX);
      expect(r.ok && /^-?\d+(\.\d+)?$/.test(r.value)).toBe(true);
    }
  });
});

describe('detectPreset for numbers: NP01-NP13', () => {
  const d = (values: string[]) => detectNumberPreset(values);
  it('NP01: 89.50, 12.00, 5 -> equivalent {plain, us} -> plain, no UI row', () => {
    const r = d(['89.50', '12.00', '5']);
    expect(r).toMatchObject({ kind: 'equivalent', preset: 'plain', among: ['plain', 'us'], needsNormalization: false });
  });
  it('NP02: 1,250.50, 89.50 -> unique us', () => expect(d(['1,250.50', '89.50'])).toMatchObject({ kind: 'unique', preset: 'us', needsNormalization: true }));
  it('NP03: 1.250,50, 89,50 -> unique eu', () => expect(d(['1.250,50', '89,50'])).toMatchObject({ kind: 'unique', preset: 'eu' }));
  it('NP04: 89,50, 12,00 -> equivalent {eu, fr} -> eu', () => expect(d(['89,50', '12,00'])).toMatchObject({ kind: 'equivalent', preset: 'eu', among: ['eu', 'fr'] }));
  it('NP05: 1,250 -> ambiguous {us, eu, fr}', () => expect(d(['1,250'])).toMatchObject({ kind: 'ambiguous', candidates: ['us', 'eu', 'fr'] }));
  it('NP06: 1.250 -> ambiguous {plain, us, eu}', () => expect(d(['1.250'])).toMatchObject({ kind: 'ambiguous', candidates: ['plain', 'us', 'eu'] }));
  it('NP07: 89,50, 12.5 -> mixed (eu/fr vs plain/us)', () => {
    const r = d(['89,50', '12.5']);
    expect(r.kind).toBe('mixed');
    if (r.kind === 'mixed') {
      expect(r.groups.map((g) => g.preset)).toEqual(['plain', 'us', 'eu', 'fr']);
      expect(r.groups.find((g) => g.preset === 'eu')?.examples).toEqual(['89,50']);
      expect(r.groups.find((g) => g.preset === 'plain')?.examples).toEqual(['12.5']);
    }
  });
  it('NP08: abc, def -> none', () => expect(d(['abc', 'def']).kind).toBe('none'));
  it('NP09: 12, 14, n/a, blank -> equivalent -> plain, no UI row', () => expect(d(['12', '14', 'n/a', '']).kind === 'equivalent' && d(['12', '14', 'n/a', ''])).toMatchObject({ preset: 'plain', needsNormalization: false }));
  it('NP10: 1 250,50 (NBSP), 89,5 -> unique fr', () => expect(d([`1${NBSP}250,50`, '89,5'])).toMatchObject({ kind: 'unique', preset: 'fr' }));
  it('NP11: 1,250.50, abc (unfit share exactly 0.5) -> unique us', () => expect(d(['1,250.50', 'abc'])).toMatchObject({ kind: 'unique', preset: 'us' }));
  it('NP12: 1,250.50, abc, def (share 0.67) -> none', () => expect(d(['1,250.50', 'abc', 'def']).kind).toBe('none'));
  it('NP13: quantity 1,250.00 pooled with unit_cost 12,50 -> mixed (us vs eu/fr)', () => {
    const r = d(['1,250.00', '12,50']);
    expect(r.kind).toBe('mixed');
    if (r.kind === 'mixed') expect(r.groups.map((g) => g.preset)).toEqual(['us', 'eu', 'fr']);
  });
  it('counts repeated values, reports stats and keeps first-occurrence order', () => {
    const r = d(['1,250.50', '1,250.50', '$5.00', 'x']);
    expect(r.stats).toMatchObject({ examined: 4, unfit: 1, distinct: 3, markersStripped: 1 });
  });
  it('the defaults are plain and iso', () => {
    expect(DEFAULT_NUMBER_PRESET).toBe('plain');
    expect(DEFAULT_DATE_PRESET).toBe('iso');
  });
});

/** The normalized date, or 'R'; ' ts' is appended when a time of day was stripped. */
function date(raw: string, preset: DatePreset, optional = false): string {
  const r = normalizeDate(raw, preset, { optional });
  return r.ok ? `${r.value}${r.timeStripped ? ' ts' : ''}` : 'R';
}

describe('normalizeDate: golden cases D01-D27 (AD-3, AD-5)', () => {
  const rows: Array<[string, string, DatePreset, string]> = [
    ['D01', '2026-03-02', 'iso', '2026-03-02'],
    ['D02', '2026-3-2', 'iso', 'R'],
    ['D03', '2026-03-02T14:30:00Z', 'iso', '2026-03-02 ts'],
    ['D04', '2026-03-02T23:30:00-06:00', 'iso', '2026-03-02 ts'],
    ['D05', '2026-03-02 14:30', 'iso', '2026-03-02 ts'],
    ['D06', '2026-03-02T24:00:00', 'iso', 'R'],
    ['D06', '2026-03-02T10:61', 'iso', 'R'],
    ['D07', '2026-03-02T10:00:00+0530', 'iso', '2026-03-02 ts'],
    ['D07', '2026-03-02T10:00:00+25:00', 'iso', 'R'],
    ['D08', '8/15/2026', 'mdy_slash', '2026-08-15'],
    ['D09', '08/15/2026', 'mdy_slash', '2026-08-15'],
    ['D10', '8/15/2026', 'dmy_slash', 'R'],
    ['D11', '15/08/2026', 'dmy_slash', '2026-08-15'],
    ['D12', '8/5/2026', 'mdy_slash', '2026-08-05'],
    ['D12', '8/5/2026', 'dmy_slash', '2026-05-08'],
    ['D13', '15.08.2026', 'dmy_dot', '2026-08-15'],
    ['D13', '5.8.2026', 'dmy_dot', '2026-08-05'],
    ['D14', '2026/08/15', 'ymd_slash', '2026-08-15'],
    ['D14', '2026/8/5', 'ymd_slash', '2026-08-05'],
    ['D15', '2026/08/15', 'mdy_slash', 'R'],
    ['D16', '8/15/26', 'mdy_slash', 'R'],
    ['D16', '15.8.26', 'dmy_dot', 'R'],
    ['D17', '02/30/2026', 'mdy_slash', 'R'],
    ['D17', '31/02/2026', 'dmy_slash', 'R'],
    ['D18', '29/02/2028', 'dmy_slash', '2028-02-29'],
    ['D18', '29/02/2026', 'dmy_slash', 'R'],
    ['D19', '8/15/2026 2:30 PM', 'mdy_slash', '2026-08-15 ts'],
    ['D20', '8/15/2026 13:30 PM', 'mdy_slash', 'R'],
    ['D20', '8/15/2026 12:00 AM', 'mdy_slash', '2026-08-15 ts'],
    ['D21', '1999-12-31', 'iso', '1999-12-31'],
    ['D23', '2026-03-02', 'mdy_slash', 'R'],
    ['D24', '  2026-03-02  ', 'iso', '2026-03-02'],
    ['D27', '0/5/2026', 'mdy_slash', 'R'],
    ['D27', '13/13/2026', 'mdy_slash', 'R']
  ];
  for (const [id, input, preset, expected] of rows) {
    it(`${id}: ${JSON.stringify(input)} (${preset}) -> ${expected}`, () => expect(date(input, preset)).toBe(expected));
  }
  it('D22: month names, compact and dashed forms fit no preset', () => {
    for (const v of ['March 2, 2026', '2-Mar-2026', '20260302', '8-15-2026']) {
      for (const p of ['iso', 'ymd_slash', 'mdy_slash', 'dmy_slash', 'dmy_dot'] as const) expect(date(v, p), `${v} ${p}`).toBe('R');
      expect(compatibleDatePresets(v)).toEqual([]);
    }
  });
  it('D25: blank, placeholder in an optional field, placeholder in ship_date', () => {
    expect(normalizeDate('', 'iso', { optional: false })).toEqual({ ok: true, value: '', timeStripped: false, blank: 'blank' });
    expect(normalizeDate('n/a', 'iso', { optional: true })).toEqual({ ok: true, value: '', timeStripped: false, blank: 'placeholder' });
    expect(normalizeDate('n/a', 'iso', { optional: false })).toEqual({ ok: false });
  });
  it('D26: typed date cells are exempt (the pipeline never passes t:"date" cells to the normalizer)', () => {
    // The exemption is structural: only text cells are pooled and normalized. A typed ISO value would be rejected
    // by a non-ISO preset if it were passed, which is why it must never be.
    expect(date('2026-08-15', 'mdy_slash')).toBe('R');
  });
  it('a stripped timestamp is reported for every preset, leap years are honoured, the year range is V1\'s', () => {
    expect(date('15/08/2026 14:30:15,123', 'dmy_slash')).toBe('2026-08-15 ts');
    expect(date('15.08.2026 14:30', 'dmy_dot')).toBe('2026-08-15 ts');
    expect(date('2026/08/15 14:30', 'ymd_slash')).toBe('2026-08-15 ts');
    expect(date('29/02/2100', 'dmy_slash')).toBe('R'); // 2100 is not a leap year
    expect(date('29/02/2000', 'dmy_slash')).toBe('2000-02-29');
    expect(date('2026-03-02x', 'iso')).toBe('R');
    expect(date('2026-03-022', 'iso')).toBe('R');
    expect(date('2026-03-02T', 'iso')).toBe('R');
    expect(date('8/15/2026T10:00', 'mdy_slash')).toBe('R'); // T separator is ISO only
  });
  it('compat lists presets by syntax and calendar validity', () => {
    expect(compatibleDatePresets('2026-03-02')).toEqual(['iso']);
    expect(compatibleDatePresets('05/05/2026')).toEqual(['mdy_slash', 'dmy_slash']);
    expect(compatibleDatePresets('13/04/2026')).toEqual(['dmy_slash']);
    expect(compatibleDatePresets('04/13/2026')).toEqual(['mdy_slash']);
    expect(compatibleDatePresets('15.08.2026')).toEqual(['dmy_dot']);
    expect(compatibleDatePresets('2026/08/15')).toEqual(['ymd_slash']);
  });
});

describe('detectPreset for dates: DP01-DP14', () => {
  const d = (values: string[]) => detectDatePreset(values);
  it('DP01', () => expect(d(['2026-03-02', '2026-04-15'])).toMatchObject({ kind: 'unique', preset: 'iso', needsNormalization: false }));
  it('DP02 the Excel re-saved fixture', () => expect(d(['8/15/2026', '8/17/2026'])).toMatchObject({ kind: 'unique', preset: 'mdy_slash', needsNormalization: true }));
  it('DP03 one value disambiguates', () => expect(d(['03/04/2026', '13/04/2026'])).toMatchObject({ kind: 'unique', preset: 'dmy_slash' }));
  it('DP04', () => expect(d(['03/04/2026', '04/13/2026'])).toMatchObject({ kind: 'unique', preset: 'mdy_slash' }));
  it('DP05 opposite disambiguation is mixed', () => expect(d(['13/04/2026', '04/13/2026']).kind).toBe('mixed'));
  it('DP06 ambiguous', () => expect(d(['03/04/2026', '05/06/2026'])).toMatchObject({ kind: 'ambiguous', candidates: ['mdy_slash', 'dmy_slash'] }));
  it('DP07 equivalent -> mdy_slash', () => expect(d(['05/05/2026', '11/11/2026'])).toMatchObject({ kind: 'equivalent', preset: 'mdy_slash', among: ['mdy_slash', 'dmy_slash'] }));
  it('DP08 ISO with slash dates is mixed', () => {
    const r = d(['2026-03-02', '8/15/2026']);
    expect(r.kind).toBe('mixed');
    if (r.kind === 'mixed') expect(r.groups.map((g) => g.preset)).toEqual(['iso', 'mdy_slash']);
  });
  it('DP09', () => expect(d(['15.08.2026', '5.8.2026'])).toMatchObject({ kind: 'unique', preset: 'dmy_dot' }));
  it('DP10', () => expect(d(['2026/08/15'])).toMatchObject({ kind: 'unique', preset: 'ymd_slash' }));
  it('DP11 timestamps are stripped and counted', () => {
    const r = d(['2026-03-02T10:00:00Z', '2026-03-03 09:00']);
    expect(r).toMatchObject({ kind: 'unique', preset: 'iso', needsNormalization: true });
    expect(r.stats.timestampsStripped).toBe(2);
  });
  it('DP12 two columns pooled into one decision', () => expect(d(['03/04/2026', '13/04/2026'])).toMatchObject({ kind: 'unique', preset: 'dmy_slash' }));
  it('DP13 nothing usable -> none (default iso)', () => expect(d(['32/13/2026', 'abc']).kind).toBe('none'));
  it('DP14 only blanks and placeholders -> none', () => expect(d(['n/a', '-', '', '  ']).kind).toBe('none'));
  it('never takes the first preset by default when outputs differ', () => {
    expect(d(['1/2/2026']).kind).toBe('ambiguous');
  });
});

describe('text helpers', () => {
  it('classifies blanks and placeholders like V1 trims', () => {
    expect(blankKind('   ')).toBe('blank');
    expect(blankKind('N/A')).toBe('placeholder');
    expect(blankKind('0')).toBeNull();
    expect(isPlaceholder(' — ')).toBe(true);
    expect(isPlaceholder('none of them')).toBe(false);
  });
});

import { decideCurrency, scanCurrency } from '../../../src/shared/ingest/normalize/numbers';
import { ingestError } from '../../../src/shared/ingest/messages';
import { normalizeHeader } from '../../../src/shared/ingest/mapping/normalizeHeader';

describe('column-level currency decision (criterion 10, 7.4)', () => {
  it('USD, $ and no marker proceed', () => {
    expect(decideCurrency(scanCurrency(['12.50', '$13.00', 'USD 14.00', '15.25 usd']))).toEqual({ kind: 'ok' });
    expect(decideCurrency(scanCurrency([]))).toEqual({ kind: 'ok' });
    expect(scanCurrency(['$1,250.50', '12.50'])).toEqual({ usd: 1, foreign: [] });
  });

  it('any other known currency refuses the column, naming the markers', () => {
    const eu = scanCurrency(['1.250,50 EUR', '89,50 EUR', '12,00']);
    expect(eu.foreign).toEqual([['EUR', 2]]);
    expect(decideCurrency(eu)).toEqual({ kind: 'foreign', markers: ['EUR'] });
    expect(decideCurrency(scanCurrency(['\u20ac 89,50']))).toEqual({ kind: 'foreign', markers: ['\u20ac'] });
    expect(decideCurrency(scanCurrency(['1 250,50 EUR']))).toMatchObject({ kind: 'foreign' });
    expect(decideCurrency(scanCurrency(['5 VND', '7 vnd']))).toEqual({ kind: 'foreign', markers: ['VND'] });
  });

  it('several currencies, or a foreign one next to USD, is a mixed column', () => {
    expect(decideCurrency(scanCurrency(['5 EUR', '6 GBP']))).toEqual({ kind: 'mixed', markers: ['EUR', 'GBP'] });
    expect(decideCurrency(scanCurrency(['$5.00', '6,00 EUR']))).toEqual({ kind: 'mixed', markers: ['EUR'] });
  });

  it('a currency in the header ("Freight (EUR)") refuses the column even when the values are bare numbers', () => {
    const hints = normalizeHeader('Freight (EUR)').hints.map((h) => h.text);
    expect(hints).toEqual(['eur']);
    expect(decideCurrency(scanCurrency(['12,50', '7,00']), hints)).toEqual({ kind: 'foreign', markers: ['EUR'] });
    expect(decideCurrency(scanCurrency(['12.50']), normalizeHeader('Freight (USD)').hints.map((h) => h.text))).toEqual({ kind: 'ok' });
    expect(decideCurrency(scanCurrency(['12.50']), normalizeHeader('Unit $').hints.map((h) => h.text))).toEqual({ kind: 'ok' });
  });

  it('the refusal texts say what to do and never mention an exchange rate being applied', () => {
    const one = ingestError('CURRENCY_UNSUPPORTED', 'normalize', { markers: 'EUR' });
    expect(one.message).toBe("This file's amounts are in EUR. SCC only supports US dollars, so the file cannot be imported. Convert the amounts to USD and upload again.");
    expect(ingestError('CURRENCY_MIXED', 'normalize', { markers: 'EUR, GBP' }).message).toContain('mixes currencies (EUR, GBP)');
  });

  it('a marker in a non-money numeric column is an ordinary row error (syntax), never a column refusal', () => {
    expect(normalizeNumber('5 EUR', 'plain', { money: false, optional: false })).toEqual({ ok: false, reason: 'syntax' });
    expect(normalizeNumber('$5', 'plain', { money: false, optional: false })).toEqual({ ok: false, reason: 'syntax' });
    expect(normalizeNumber('12 pcs', 'plain', { money: false, optional: false })).toEqual({ ok: false, reason: 'syntax' });
  });
});
