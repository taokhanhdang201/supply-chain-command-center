// Deterministic value generators for the invented ingestion corpora (no randomness, no clock). A generator maps a row
// index to a cell text; the same index always gives the same text. All names, companies and ids are invented.

export type Gen = (i: number) => string;

const PRODUCTS = ['Wireless Barcode Scanner', 'Label Printer', 'Pallet Wrap Film', 'Corrugated Box 12x12x12', 'Safety Gloves', 'Thermal Labels', 'Packing Tape', 'Forklift Battery', 'Shelf Bracket', 'Hand Truck'];
const CATEGORIES = ['Electronics', 'Packaging', 'Safety', 'Hardware', 'Labels', 'Equipment'];
const CARRIERS = ['Northstar Freight', 'BlueLine Logistics', 'Cascade Carriers', 'Summit Express', 'Redwood Transport'];
const CITIES = ['Houston, TX', 'San Antonio, TX', 'Phoenix, AZ', 'Denver, CO', 'Kansas City, MO', 'Nashville, TN', 'Miami, FL', 'Charlotte, NC'];
const WH_CODES = ['WH-DFW', 'WH-ATL', 'WH-ORD', 'WH-LAX', 'WH-EWR'];
const WH_NAMES = ['Dallas-Fort Worth DC', 'Atlanta DC', 'Chicago DC', 'Los Angeles DC', 'Newark DC'];

export const STATUS_WORDS: Record<string, readonly string[]> = {
  en: ['Delivered', 'In Transit', 'Pending', 'Cancelled'],
  es: ['Entregado', 'En tránsito', 'Pendiente', 'Cancelado'],
  de: ['Geliefert', 'Unterwegs', 'Offen', 'Storniert'],
  fr: ['Livré', 'En transit', 'En attente', 'Annulé'],
  vi: ['Đã giao', 'Đang vận chuyển', 'Chờ xử lý', 'Đã hủy'],
  canonical: ['delivered', 'in_transit', 'pending', 'cancelled']
};

export type NumberStyle = 'plain' | 'us' | 'eu' | 'fr';
export type DateStyle = 'iso' | 'mdy' | 'dmy' | 'dot' | 'ymd';

function group(intPart: string, sep: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
}

/** Formats an amount given in hundredths ("cents") with the number style. */
export function formatCents(cents: number, style: NumberStyle, decimals = 2): string {
  const whole = Math.floor(cents / 100);
  const frac = String(cents % 100).padStart(2, '0');
  const fraction = decimals === 0 ? '' : frac.slice(0, decimals);
  const sep = { plain: '', us: ',', eu: '.', fr: ' ' }[style];
  const point = style === 'eu' || style === 'fr' ? ',' : '.';
  return `${group(String(whole), sep)}${fraction === '' ? '' : point + fraction}`;
}

export function formatDate(year: number, month: number, day: number, style: DateStyle): string {
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  switch (style) {
    case 'iso':
      return `${year}-${mm}-${dd}`;
    case 'ymd':
      return `${year}/${mm}/${dd}`;
    case 'mdy':
      return `${month}/${day}/${year}`;
    case 'dmy':
      return `${day}/${month}/${year}`;
    case 'dot':
      return `${day}.${month}.${year}`;
  }
}

/** Day d (0-based) of March-May 2026, as year/month/day with days 1-28 only (valid in every month). */
function calendar(i: number): [number, number, number] {
  const month = 3 + (Math.floor(i / 28) % 3);
  return [2026, month, (i % 28) + 1];
}

export const G = {
  shipmentId: (prefix = 'SHP-'): Gen => (i) => `${prefix}${900001 + i * 3}`,
  sku: (prefix = 'ELC-'): Gen => (i) => `${prefix}${9001 + i * 2}`,
  productName: (): Gen => (i) => `${PRODUCTS[i % PRODUCTS.length]}${i >= PRODUCTS.length ? ` ${Math.floor(i / PRODUCTS.length) + 1}` : ''}`,
  category: (): Gen => (i) => CATEGORIES[i % CATEGORIES.length] as string,
  carrier: (): Gen => (i) => CARRIERS[i % CARRIERS.length] as string,
  city: (shift = 0): Gen => (i) => CITIES[(i + shift) % CITIES.length] as string,
  /** Known warehouse: code, name, or bare three-letter code. */
  warehouse: (style: 'code' | 'name' | 'short' = 'code'): Gen => (i) => {
    const k = i % WH_CODES.length;
    return style === 'code' ? (WH_CODES[k] as string) : style === 'name' ? (WH_NAMES[k] as string) : (WH_CODES[k] as string).slice(3);
  },
  /** Company sites that are not SCC warehouses. */
  plant: (): Gen => (i) => ['1000', '1010', '2000', '3000'][i % 4] as string,
  int: (min: number, max: number, style: NumberStyle = 'plain'): Gen => (i) => {
    const v = min + ((i * 37 + 11) % (max - min + 1));
    return formatCents(v * 100, style, 0);
  },
  money: (style: NumberStyle = 'plain', marker: '' | '$' = ''): Gen => (i) => `${marker}${formatCents(850 + ((i * 1373 + 251) % 150000), style)}`,
  decimal: (style: NumberStyle = 'plain'): Gen => (i) => formatCents(50 + ((i * 97) % 2000), style),
  status: (lang: keyof typeof STATUS_WORDS = 'en'): Gen => (i) => (STATUS_WORDS[lang] as readonly string[])[i % 4] as string,
  date: (style: DateStyle = 'iso', shift = 0): Gen => (i) => {
    const [y, m, d] = calendar(i + shift);
    return formatDate(y, m, d, style);
  },
  /** Free-text distractors. */
  text: (label: string): Gen => (i) => `${label} ${i + 1}`,
  po: (): Gen => (i) => `PO-${10023 + i * 11}`,
  invoice: (): Gen => (i) => `INV-${550000 + i * 5}`,
  weight: (): Gen => (i) => formatCents(1000 + ((i * 731) % 90000), 'plain'),
  pieces: (): Gen => (i) => String(1 + ((i * 5) % 40)),
  yesNo: (): Gen => (i) => (i % 3 === 0 ? 'Y' : 'N'),
  unit: (): Gen => (i) => ['EA', 'PC', 'BX'][i % 3] as string,
  url: (): Gen => (i) => `https://track.example.test/${100000 + i}`,
  bin: (): Gen => (i) => `A-${String((i * 7) % 40).padStart(2, '0')}-${(i % 4) + 1}`,
  customer: (): Gen => (i) => ['Alder Stores', 'Brightwater Retail', 'Casa Verde', 'Dai Phat'][i % 4] as string
};

export interface CorpusColumn {
  header: string;
  /** The canonical field a person would choose, or null for a column that has no SCC field. */
  truth: string | null;
  gen: Gen;
}

export interface CorpusCase {
  id: string;
  language: 'en' | 'vi' | 'es' | 'de' | 'fr';
  kind: 'inventory' | 'shipments';
  columns: CorpusColumn[];
  rows?: number;
}

export function col(header: string, truth: string | null, gen: Gen): CorpusColumn {
  return { header, truth, gen };
}

export interface BuiltCase {
  id: string;
  language: CorpusCase['language'];
  kind: CorpusCase['kind'];
  headers: string[];
  rows: string[][];
  truth: Array<string | null>;
}

export function build(c: CorpusCase): BuiltCase {
  const n = c.rows ?? 30;
  return {
    id: c.id,
    language: c.language,
    kind: c.kind,
    headers: c.columns.map((x) => x.header),
    rows: Array.from({ length: n }, (_, i) => c.columns.map((x) => x.gen(i))),
    truth: c.columns.map((x) => x.truth)
  };
}
