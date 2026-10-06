// Tester (adversarial) suite: function-level CSV import stress tests beyond the coder's own self-verification
// tests. Focused on malformed/hostile input: BOM/CRLF variants, quote edge cases, invalid numbers/dates,
// duplicate/case-variant IDs, formula-injection-style cells, HTML/script text, NUL bytes, invalid UTF-8 (at the
// decode boundary used by the server), oversize row/column counts.

import { describe, it, expect } from 'vitest';
import { parseCsv } from '../../src/shared/csv/parseCsv';
import { importInventoryCsv } from '../../src/shared/csv/importInventory';
import { importShipmentsCsv as importShipments } from '../../src/shared/csv/importShipments';
import { decodeUtf8Strict } from '../../src/server/http';

const INV_HEADER = 'sku,product_name,category,warehouse,quantity,reorder_point,unit_cost,avg_daily_usage,lead_time_days';
const SHP_HEADER = 'shipment_id,origin,destination,carrier,status,ship_date,estimated_delivery,actual_delivery,shipping_cost';

function invCsv(rows: string[]): string {
  return [INV_HEADER, ...rows].join('\n');
}
function shpCsv(rows: string[]): string {
  return [SHP_HEADER, ...rows].join('\n');
}

describe('tester: CSV adversarial - parser level', () => {
  it('BOM + CRLF line endings parse cleanly', () => {
    const text = '﻿' + INV_HEADER + '\r\n' + 'ELC-0001,Widget,Electronics,WH-DFW,10,5,9.99,,\r\n';
    const result = parseCsv(text, { maxRows: 20000, maxColumns: 50 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.records[0]!.fields[0]).toBe('sku'); // BOM stripped
    }
  });

  it('quoted field with embedded comma, newline and escaped quote parses as one field', () => {
    const text = `sku,product_name\nELC-0001,"Box, ""Big"" size\nline2"`;
    const result = parseCsv(text, { maxRows: 20000, maxColumns: 50 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.records[1]!.fields[1]).toBe('Box, "Big" size\nline2');
    }
  });

  it('unterminated quote is rejected with the exact line number', () => {
    const text = `sku,product_name\nELC-0001,"unterminated`;
    const result = parseCsv(text, { maxRows: 20000, maxColumns: 50 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toMatch(/Unterminated quoted field starting on line 2/);
    }
  });

  it('stray quote inside an unquoted field is rejected', () => {
    const text = `sku,product_name\nELC-0001,un"quoted`;
    const result = parseCsv(text, { maxRows: 20000, maxColumns: 50 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/Unexpected quote character/);
  });

  it('character immediately after a closing quote is rejected', () => {
    const text = `sku,product_name\nELC-0001,"quoted"extra`;
    const result = parseCsv(text, { maxRows: 20000, maxColumns: 50 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/Unexpected character after a closing quote/);
  });

  it('empty file and whitespace-only file both parse to zero records (no crash)', () => {
    expect(parseCsv('', { maxRows: 20000, maxColumns: 50 }).ok).toBe(true);
    expect(parseCsv('   \n  \t \n', { maxRows: 20000, maxColumns: 50 }).ok).toBe(true);
  });

  it('too many columns in a record is rejected', () => {
    const text = 'a,b\n' + Array.from({ length: 60 }, (_, i) => `v${i}`).join(',');
    const result = parseCsv(text, { maxRows: 20000, maxColumns: 50 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/more than 50 columns/);
  });

  it('too many data rows is rejected and stops parsing (does not hang on a huge file)', () => {
    const rows = Array.from({ length: 25 }, () => 'a,b').join('\n');
    const result = parseCsv('h1,h2\n' + rows, { maxRows: 20, maxColumns: 50 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/more than 20 data rows/);
  });
});

describe('tester: CSV adversarial - inventory import', () => {
  it('missing required columns lists them all by name', () => {
    const result = importInventoryCsv('sku,product_name\nELC-0001,Widget');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]!.code).toBe('MISSING_COLUMNS');
      expect(result.errors[0]!.message).toMatch(/category/);
      expect(result.errors[0]!.message).toMatch(/warehouse/);
    }
  });

  it('duplicate header (case/spacing variant) is rejected', () => {
    const text = 'SKU,Sku,product_name,category,warehouse,quantity,reorder_point,unit_cost\nA,B,C,D,WH-DFW,1,1,1';
    const result = importInventoryCsv(text);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.code === 'DUPLICATE_COLUMNS')).toBe(true);
  });

  it('formula-injection-style cell values (=cmd|, +, -, @) are stored/rejected as plain text, never executed', () => {
    // product_name is free text; these must either pass through as literal text or fail text-length/control-char
    // rules -- there is no code path that could interpret them as formulas since there's no CSV export/spreadsheet
    // engine involved. This test locks in that the importer treats them as inert strings.
    const rows = [
      'ELC-0001,=cmd|\'/C calc\'!A1,Electronics,WH-DFW,10,5,9.99,,',
      'ELC-0002,+1+1,Electronics,WH-DFW,10,5,9.99,,',
      'ELC-0003,-2+3,Electronics,WH-DFW,10,5,9.99,,',
      'ELC-0004,@SUM(A1:A2),Electronics,WH-DFW,10,5,9.99,,'
    ];
    const result = importInventoryCsv(invCsv(rows));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rows.map((r) => r.productName)).toEqual(['=cmd|\'/C calc\'!A1', '+1+1', '-2+3', '@SUM(A1:A2)']);
    }
  });

  it('HTML/script content in text fields is stored as literal text (never parsed as markup)', () => {
    const rows = ['ELC-0001,<script>alert(1)</script>,Electronics,WH-DFW,10,5,9.99,,'];
    const result = importInventoryCsv(invCsv(rows));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rows[0]!.productName).toBe('<script>alert(1)</script>');
    }
  });

  it('NUL byte in the raw text is rejected as MALFORMED_CSV, not silently truncated', () => {
    const text = invCsv(['ELC-0001,Wid\u0000get,Electronics,WH-DFW,10,5,9.99,,']);
    const result = importInventoryCsv(text);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]!.code).toBe('MALFORMED_CSV');
  });

  it('empty (whitespace-only) text is EMPTY_FILE', () => {
    const result = importInventoryCsv('   \n\t  ');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]!.code).toBe('EMPTY_FILE');
  });

  it('header-only file is NO_DATA_ROWS', () => {
    const result = importInventoryCsv(INV_HEADER + '\n');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]!.code).toBe('NO_DATA_ROWS');
  });

  it.each(['1e3', '12abc', 'NaN', 'Infinity', '0x10', '+5', '12.', '.5', '--1'])(
    'rejects invalid numeric quantity "%s"',
    (bad) => {
      const result = importInventoryCsv(invCsv([`ELC-0001,Widget,Electronics,WH-DFW,${bad},5,9.99,,`]));
      expect(result.ok).toBe(false);
    }
  );

  it('rejects a quoted thousands-separated quantity "1,000" (comma is not a valid digit separator)', () => {
    const result = importInventoryCsv(invCsv(['ELC-0001,Widget,Electronics,WH-DFW,"1,000",5,9.99,,']));
    expect(result.ok).toBe(false);
  });

  // BUG-2 (minor): "-0" is accepted as a valid non-negative integer (correct - it is not < 0), but the parsed
  // value is stored as negative zero (Object.is(-0, 0) === false) instead of being normalized to +0. This is
  // cosmetically harmless in most paths (JSON.stringify(-0) === "0", arithmetic sums normalize it away) but is
  // a genuine sign-preservation bug in the integer field parser worth a one-line fix (e.g. `value + 0` or
  // `Object.is(value, -0) ? 0 : value`). Left failing per BUG-2 in ket-qua-test.md.
  it('BUG-2: "-0" quantity should normalize to +0, not stored as negative zero', () => {
    const result = importInventoryCsv(invCsv(['ELC-0001,Widget,Electronics,WH-DFW,-0,5,9.99,,']));
    expect(result.ok).toBe(true);
    if (result.ok) expect(Object.is(result.rows[0]!.quantity, 0)).toBe(true);
  });

  it('rejects a huge quantity value beyond the documented max (10,000,000)', () => {
    const result = importInventoryCsv(invCsv(['ELC-0001,Widget,Electronics,WH-DFW,99999999,5,9.99,,']));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]!.code).toBe('OUT_OF_RANGE');
  });

  it('rejects negative quantity', () => {
    const result = importInventoryCsv(invCsv(['ELC-0001,Widget,Electronics,WH-DFW,-5,5,9.99,,']));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]!.code).toBe('NEGATIVE');
  });

  it('duplicate SKU+warehouse, case and whitespace variant, is flagged as DUPLICATE_ID', () => {
    const rows = [
      'ELC-0001,Widget,Electronics,WH-DFW,10,5,9.99,,',
      'elc-0001,Widget Two,Electronics,wh-dfw,20,5,9.99,,'
    ];
    const result = importInventoryCsv(invCsv(rows));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.code === 'DUPLICATE_ID')).toBe(true);
  });

  it('same SKU in different warehouses is allowed (not a duplicate)', () => {
    const rows = ['ELC-0001,Widget,Electronics,WH-DFW,10,5,9.99,,', 'ELC-0001,Widget,Electronics,WH-ATL,10,5,9.99,,'];
    const result = importInventoryCsv(invCsv(rows));
    expect(result.ok).toBe(true);
  });

  it('unterminated quote in a data row surfaces MALFORMED_CSV via the import function too', () => {
    const text = invCsv(['ELC-0001,"unterminated,Electronics,WH-DFW,10,5,9.99,,']);
    const result = importInventoryCsv(text);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]!.code).toBe('MALFORMED_CSV');
  });

  it('more than 500 row errors are truncated to 500 but totalErrors reports the true count', () => {
    const rows = Array.from({ length: 600 }, (_, i) => `ELC-${String(i).padStart(4, '0')},Widget,Electronics,WH-DFW,-1,5,9.99,,`);
    const result = importInventoryCsv(invCsv(rows));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeLessThanOrEqual(500);
      expect(result.totalErrors).toBe(600);
    }
  });

  it('20,001 data rows triggers TOO_MANY_ROWS', () => {
    const rows = Array.from({ length: 20001 }, (_, i) => `ELC-${String(i).padStart(5, '0')},Widget,Electronics,WH-DFW,1,1,1.00,,`);
    const result = importInventoryCsv(invCsv(rows));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]!.code).toBe('TOO_MANY_ROWS');
  }, 20000);

  it('a valid import followed by a rejected one must not be conflated: rejects entirely on any single bad row', () => {
    const rows = [
      'ELC-0001,Widget,Electronics,WH-DFW,10,5,9.99,,',
      'ELC-0002,Widget2,Electronics,WH-DFW,-5,5,9.99,,' // bad row
    ];
    const result = importInventoryCsv(invCsv(rows));
    expect(result.ok).toBe(false); // all-or-nothing per plan §5.7
  });
});

describe('tester: CSV adversarial - shipments import', () => {
  it.each(['2026-13-01', '2026-02-30', '03/15/2026', '2026-3-5', '', '1999-12-31'])(
    'rejects invalid ship_date "%s"',
    (bad) => {
      const result = importShipments(shpCsv([`SHP-100001,WH-DFW,HOU,Acme,pending,${bad},,,10.00`]));
      expect(result.ok).toBe(false);
    }
  );

  it('accepts leap day 2028-02-29 and rejects non-leap 2026-02-29', () => {
    const ok = importShipments(shpCsv(['SHP-100001,WH-DFW,HOU,Acme,pending,2028-02-29,,,10.00']));
    expect(ok.ok).toBe(true);
    const bad = importShipments(shpCsv(['SHP-100001,WH-DFW,HOU,Acme,pending,2026-02-29,,,10.00']));
    expect(bad.ok).toBe(false);
  });

  it('duplicate shipment_id, case-insensitive, is flagged', () => {
    const rows = [
      'SHP-100001,WH-DFW,HOU,Acme,pending,2026-06-01,,,10.00',
      'shp-100001,WH-ATL,MIA,Acme,pending,2026-06-01,,,10.00'
    ];
    const result = importShipments(shpCsv(rows));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.code === 'DUPLICATE_ID')).toBe(true);
  });

  it('status variants are normalized: "In Transit", "in-transit", "DELIVERED" accepted; "shipped" rejected', () => {
    for (const s of ['In Transit', 'in-transit', 'DELIVERED']) {
      const result = importShipments(shpCsv([`SHP-100001,WH-DFW,HOU,Acme,${s},2026-06-01,,,10.00`]));
      expect(result.ok, `status "${s}" should be accepted`).toBe(true);
    }
    const rejected = importShipments(shpCsv(['SHP-100001,WH-DFW,HOU,Acme,shipped,2026-06-01,,,10.00']));
    expect(rejected.ok).toBe(false);
  });

  it('lowercase warehouse code in origin/destination is accepted (normalized to uppercase)', () => {
    const result = importShipments(shpCsv(['SHP-100001,wh-dfw,HOU,Acme,pending,2026-06-01,,,10.00']));
    expect(result.ok).toBe(true);
  });

  it('actual delivery before ship date is accepted at import time (logical inconsistency, not a parse error)', () => {
    // Plan §4.4: this is surfaced as an invalid_data alert downstream, not rejected on import.
    const result = importShipments(
      shpCsv(['SHP-100001,WH-DFW,HOU,Acme,delivered,2026-06-10,2026-06-15,2026-06-01,10.00'])
    );
    expect(result.ok).toBe(true);
  });

  it('extra empty trailing field is tolerated; extra non-empty trailing field is FIELD_COUNT', () => {
    const tolerated = importShipments(shpCsv(['SHP-100001,WH-DFW,HOU,Acme,pending,2026-06-01,,,10.00,']));
    expect(tolerated.ok).toBe(true);
    const rejected = importShipments(shpCsv(['SHP-100001,WH-DFW,HOU,Acme,pending,2026-06-01,,,10.00,extra']));
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.errors[0]!.code).toBe('FIELD_COUNT');
  });

  it('too-few fields is FIELD_COUNT, not a crash', () => {
    const result = importShipments(shpCsv(['SHP-100001,WH-DFW,HOU']));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]!.code).toBe('FIELD_COUNT');
  });

  it('control characters (tab/newline) inside a quoted field are rejected', () => {
    const text = shpCsv(['SHP-100001,WH-DFW,HOU,"Acme\tExpress",pending,2026-06-01,,,10.00']);
    const result = importShipments(text);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.code === 'CONTROL_CHARS')).toBe(true);
  });

  it('3-decimal shipping cost is rejected (TOO_MANY_DECIMALS)', () => {
    const result = importShipments(shpCsv(['SHP-100001,WH-DFW,HOU,Acme,pending,2026-06-01,,,10.999']));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]!.code).toBe('TOO_MANY_DECIMALS');
  });

  it('cost above the documented max (1,000,000.00) is OUT_OF_RANGE', () => {
    const result = importShipments(shpCsv(['SHP-100001,WH-DFW,HOU,Acme,pending,2026-06-01,,,1000000.01']));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]!.code).toBe('OUT_OF_RANGE');
  });
});

describe('tester: server-side UTF-8 decode boundary (invalid encoding path)', () => {
  it('valid UTF-8 with BOM decodes and strips the BOM', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x61, 0x62, 0x63]); // BOM + "abc"
    expect(decodeUtf8Strict(bytes)).toBe('abc');
  });

  it('an invalid UTF-8 byte sequence (lone continuation byte) fails strict decode -> null', () => {
    const bytes = new Uint8Array([0x61, 0x80, 0x62]); // 'a', invalid continuation byte, 'b'
    expect(decodeUtf8Strict(bytes)).toBeNull();
  });

  it('Windows-1252 byte 0xE9 (not valid UTF-8 on its own) fails strict decode -> null', () => {
    const bytes = new Uint8Array([0x53, 0x61, 0x6c, 0xe9]); // "Sal" + 0xE9 (Windows-1252 "é")
    expect(decodeUtf8Strict(bytes)).toBeNull();
  });
});
