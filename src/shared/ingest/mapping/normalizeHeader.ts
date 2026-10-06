// Header normalization for the semantic mapper (ke-hoach 4.2): NFKC, lowercase, diacritics folded (plus explicit
// d-stroke, sharp s, o-slash, ae/oe ligatures), camelCase and snake_case split, punctuation and digits separated,
// whitespace collapsed, unit/currency markers moved into a separate hint, stop words dropped, light plural stemming.
// Dictionary phrases and canonical field names go through the SAME function, so both sides always agree.
// Pure: no clock, no randomness, no locale-dependent calls.

export type HintKind = 'currency' | 'weight' | 'time' | 'count' | 'percent';

export interface HeaderHint {
  kind: HintKind;
  text: string;
}

export interface NormalizedHeader {
  raw: string;
  /** Content tokens joined by one space (the lookup key). */
  key: string;
  tokens: string[];
  hints: HeaderHint[];
}

const STOP_WORDS: ReadonlySet<string> = new Set([
  'of', 'the', 'a', 'an', 'de', 'del', 'der', 'die', 'das', 'des', 'du', 'la', 'le', 'les', 'el', 'los', 'las',
  'd', 'l', 'y', 'et', 'und', 'and', 'or', 'para', 'por', 'par', 'en', 'cua', 'va'
]);

const UNIT_TOKENS: ReadonlyMap<string, HintKind> = new Map<string, HintKind>([
  ['usd', 'currency'], ['eur', 'currency'], ['gbp', 'currency'], ['vnd', 'currency'], ['jpy', 'currency'], ['cad', 'currency'], ['aud', 'currency'],
  ['mxn', 'currency'], ['chf', 'currency'], ['cny', 'currency'], ['inr', 'currency'], ['dollar', 'currency'], ['dollars', 'currency'], ['euro', 'currency'], ['euros', 'currency'],
  ['kg', 'weight'], ['kgs', 'weight'], ['lb', 'weight'], ['lbs', 'weight'], ['g', 'weight'], ['oz', 'weight'], ['tonnes', 'weight'], ['tons', 'weight'],
  ['days', 'time'], ['day', 'time'], ['dias', 'time'], ['dia', 'time'], ['jours', 'time'], ['jour', 'time'], ['tage', 'time'], ['tagen', 'time'], ['ngay', 'time'],
  ['hrs', 'time'], ['hours', 'time'], ['hr', 'time'],
  ['pcs', 'count'], ['pc', 'count'], ['units', 'count'], ['ea', 'count'],
  ['pct', 'percent']
]);

const FOLD_EXTRA: ReadonlyArray<readonly [RegExp, string]> = [
  [/đ/g, 'd'],
  [/ß/g, 'ss'],
  [/ø/g, 'o'],
  [/æ/g, 'ae'],
  [/œ/g, 'oe'],
  [/ł/g, 'l']
];

/** NFKC, lowercase, diacritics folded. Used for header keys, value vocabularies and warehouse/location names. */
export function foldText(text: string): string {
  let s = text.normalize('NFKC').toLowerCase();
  s = s.normalize('NFD').replace(/\p{M}+/gu, '');
  for (const [re, to] of FOLD_EXTRA) s = s.replace(re, to);
  return s.normalize('NFC');
}

function stem(token: string): string {
  if (token.length > 4 && token.endsWith('ies')) return `${token.slice(0, -3)}y`;
  if (token.length > 3 && token.endsWith('s') && !/(ss|us|is)$/.test(token)) return token.slice(0, -1);
  return token;
}

function hintKindOf(inner: string): HintKind | null {
  const words = inner.split(/[^\p{L}\p{N}$€£%]+/u).filter((w) => w !== '');
  if (words.length === 0) return null;
  let kind: HintKind | null = null;
  for (const w of words) {
    const k = w === '$' || w === '€' || w === '£' ? 'currency' : w === '%' ? 'percent' : (UNIT_TOKENS.get(w) ?? null);
    if (k === null) return null;
    kind = kind ?? k;
  }
  return kind;
}

export function normalizeHeader(raw: string): NormalizedHeader {
  const hints: HeaderHint[] = [];
  let s = raw.normalize('NFKC');

  // Bracketed units: "Freight (USD)" -> hint USD. Brackets with other content keep their words.
  s = s.replace(/[([]([^)\]]*)[)\]]/g, (whole, inner: string) => {
    const folded = foldText(inner);
    const kind = hintKindOf(folded);
    if (kind === null) return ` ${inner} `;
    hints.push({ kind, text: folded.trim() });
    return ' ';
  });

  if (/[$€£]/.test(s)) hints.push({ kind: 'currency', text: '$' });
  s = s.replace(/\bn\s*[°º]/gi, ' no ').replace(/№/g, ' no ').replace(/#/g, ' no ');
  s = s.replace(/&/g, ' and ');
  // camelCase and digit boundaries, before lowercasing
  s = s.replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2').replace(/(\p{Lu}+)(\p{Lu}\p{Ll})/gu, '$1 $2');
  s = s.replace(/(\p{L})(\p{N})/gu, '$1 $2').replace(/(\p{N})(\p{L})/gu, '$1 $2');
  s = foldText(s);
  const words = s.split(/[^\p{L}\p{N}]+/u).filter((w) => w !== '');

  let tokens = words.filter((w) => !STOP_WORDS.has(w)).map(stem);
  // Leading/trailing standalone unit words become hints, but never the whole header.
  const takeUnit = (from: 'start' | 'end'): void => {
    for (;;) {
      if (tokens.length <= 1) return;
      const t = from === 'start' ? (tokens[0] as string) : (tokens[tokens.length - 1] as string);
      const kind = UNIT_TOKENS.get(t) ?? null;
      if (kind === null) return;
      hints.push({ kind, text: t });
      tokens = from === 'start' ? tokens.slice(1) : tokens.slice(0, -1);
    }
  };
  takeUnit('end');
  takeUnit('start');
  return { raw, key: tokens.join(' '), tokens, hints };
}

/** The lookup key of a phrase or a canonical field name ("product_name" -> "product name"). */
export function keyOf(text: string): string {
  return normalizeHeader(text).key;
}
