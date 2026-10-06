// Text encodings for the delimited-text adapter: UTF-8 (with or without BOM), UTF-16 LE/BE with BOM, and Windows-1252
// which is only ever a SUGGESTION that needs the user's confirmation (never applied silently). UTF-32, UTF-16 without a
// BOM and binary content are not readable here: the refusal adapters claim them. Decoding is hand-written and strict
// (lone surrogates, odd UTF-16 byte counts and undefined Windows-1252 bytes are errors), independent of ICU.

export type TextEncodingId = 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1252';

export const ENCODING_LABELS: Record<TextEncodingId, string> = {
  'utf-8': 'UTF-8',
  'utf-16le': 'UTF-16 (little-endian)',
  'utf-16be': 'UTF-16 (big-endian)',
  'windows-1252': 'Windows-1252 (Western European)'
};

export type EncodingRefusal = 'utf-32' | 'binary' | 'undefined-bytes';

export interface EncodingDetection {
  /** null when the bytes are not readable text (see `refusal`). */
  encoding: TextEncodingId | null;
  bom: boolean;
  needsConfirmation: boolean;
  evidence: string[];
  refusal?: EncodingRefusal;
}

// Windows-1252 bytes 0x80-0x9F. The five undefined positions are 0 here and treated as errors.
const CP1252_HIGH: readonly number[] = [
  0x20ac, 0, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0, 0x017d, 0,
  0, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0, 0x017e, 0x0178
];

export function isUndefinedCp1252Byte(b: number): boolean {
  return b >= 0x80 && b <= 0x9f && CP1252_HIGH[b - 0x80] === 0;
}

/**
 * Strict UTF-8 validation: no overlong forms, no surrogates, nothing above U+10FFFF. With `allowTruncatedTail` an
 * incomplete sequence at the very end is tolerated (used on a head that was cut in the middle of a character).
 */
export function isValidUtf8(bytes: Uint8Array, allowTruncatedTail = false): boolean {
  const n = bytes.length;
  let i = 0;
  while (i < n) {
    const b = bytes[i] as number;
    if (b < 0x80) {
      i += 1;
      continue;
    }
    let need: number;
    let min: number;
    let cp: number;
    if (b >= 0xc2 && b <= 0xdf) {
      need = 1;
      min = 0x80;
      cp = b & 0x1f;
    } else if (b >= 0xe0 && b <= 0xef) {
      need = 2;
      min = 0x800;
      cp = b & 0x0f;
    } else if (b >= 0xf0 && b <= 0xf4) {
      need = 3;
      min = 0x10000;
      cp = b & 0x07;
    } else {
      return false;
    }
    if (n - i - 1 < need) {
      // fewer than `need` continuation bytes remain: only acceptable as a cut at the end of a head
      if (!allowTruncatedTail) return false;
      for (let k = i + 1; k < n; k++) if (((bytes[k] as number) & 0xc0) !== 0x80) return false;
      return true;
    }
    for (let k = 1; k <= need; k++) {
      const c = bytes[i + k];
      if (c === undefined || (c & 0xc0) !== 0x80) return false;
      cp = (cp << 6) | (c & 0x3f);
    }
    if (cp < min || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return false;
    i += need + 1;
  }
  return true;
}

/** True when the bytes carry so many control characters that they are binary content, not text with a stray one. */
function looksBinary(bytes: Uint8Array): boolean {
  let controls = 0;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i] as number;
    if ((b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d && b !== 0x0c) || b === 0x7f) controls++;
  }
  // A handful of stray control characters is a row-level data problem (the validators report it), not a binary file.
  return controls > 8 && controls / bytes.length > 0.01;
}

/**
 * Detects the encoding of `bytes`. `complete` is false when `bytes` is only the head of the file (a cut multi-byte
 * character at the end is then tolerated). Deterministic and total.
 */
export function detectEncoding(bytes: Uint8Array, complete = true): EncodingDetection {
  const b0 = bytes[0];
  const b1 = bytes[1];
  const b2 = bytes[2];
  const b3 = bytes[3];
  if (b0 === 0xef && b1 === 0xbb && b2 === 0xbf) {
    return { encoding: 'utf-8', bom: true, needsConfirmation: false, evidence: ['UTF-8 byte order mark'] };
  }
  if (b0 === 0xff && b1 === 0xfe) {
    if (b2 === 0x00 && b3 === 0x00) return { encoding: null, bom: true, needsConfirmation: false, evidence: ['UTF-32 byte order mark'], refusal: 'utf-32' };
    return { encoding: 'utf-16le', bom: true, needsConfirmation: false, evidence: ['UTF-16 little-endian byte order mark'] };
  }
  if (b0 === 0xfe && b1 === 0xff) {
    return { encoding: 'utf-16be', bom: true, needsConfirmation: false, evidence: ['UTF-16 big-endian byte order mark'] };
  }
  if (b0 === 0x00 && b1 === 0x00 && b2 === 0xfe && b3 === 0xff) {
    return { encoding: null, bom: true, needsConfirmation: false, evidence: ['UTF-32 byte order mark'], refusal: 'utf-32' };
  }
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0x00) return { encoding: null, bom: false, needsConfirmation: false, evidence: ['NUL bytes: binary content'], refusal: 'binary' };
  }
  if (looksBinary(bytes)) {
    return { encoding: null, bom: false, needsConfirmation: false, evidence: ['many control characters: binary content'], refusal: 'binary' };
  }
  if (isValidUtf8(bytes, !complete)) {
    return { encoding: 'utf-8', bom: false, needsConfirmation: false, evidence: ['valid UTF-8'] };
  }
  for (let i = 0; i < bytes.length; i++) {
    if (isUndefinedCp1252Byte(bytes[i] as number)) {
      return { encoding: null, bom: false, needsConfirmation: false, evidence: ['bytes that are undefined in every supported encoding'], refusal: 'undefined-bytes' };
    }
  }
  return {
    encoding: 'windows-1252',
    bom: false,
    needsConfirmation: true,
    evidence: ['not valid UTF-8; bytes are consistent with Windows-1252 (needs confirmation)']
  };
}

export type DecodeResult = { ok: true; text: string } | { ok: false; reason: 'odd-length' | 'invalid-surrogate' | 'invalid-utf8' | 'undefined-byte' };

const CHUNK = 8192;

function fromCodeUnits(units: number[]): string {
  return String.fromCharCode.apply(null, units);
}

function decodeUtf16(bytes: Uint8Array, littleEndian: boolean, start: number): DecodeResult {
  if ((bytes.length - start) % 2 !== 0) return { ok: false, reason: 'odd-length' };
  const parts: string[] = [];
  let units: number[] = [];
  let pendingHigh = false;
  for (let i = start; i < bytes.length; i += 2) {
    const a = bytes[i] as number;
    const b = bytes[i + 1] as number;
    const unit = littleEndian ? a | (b << 8) : (a << 8) | b;
    const isHigh = unit >= 0xd800 && unit <= 0xdbff;
    const isLow = unit >= 0xdc00 && unit <= 0xdfff;
    if (pendingHigh) {
      if (!isLow) return { ok: false, reason: 'invalid-surrogate' };
      pendingHigh = false;
    } else if (isLow) {
      return { ok: false, reason: 'invalid-surrogate' };
    } else if (isHigh) {
      pendingHigh = true;
    }
    units.push(unit);
    if (units.length >= CHUNK) {
      parts.push(fromCodeUnits(units));
      units = [];
    }
  }
  if (pendingHigh) return { ok: false, reason: 'invalid-surrogate' };
  if (units.length > 0) parts.push(fromCodeUnits(units));
  return { ok: true, text: parts.join('') };
}

function decodeCp1252(bytes: Uint8Array): DecodeResult {
  const parts: string[] = [];
  let units: number[] = [];
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i] as number;
    if (b >= 0x80 && b <= 0x9f) {
      const mapped = CP1252_HIGH[b - 0x80] as number;
      if (mapped === 0) return { ok: false, reason: 'undefined-byte' };
      units.push(mapped);
    } else {
      units.push(b);
    }
    if (units.length >= CHUNK) {
      parts.push(fromCodeUnits(units));
      units = [];
    }
  }
  if (units.length > 0) parts.push(fromCodeUnits(units));
  return { ok: true, text: parts.join('') };
}

/** Decodes the whole source as `encoding`, dropping a leading byte order mark. Never throws. */
export function decodeText(bytes: Uint8Array, encoding: TextEncodingId): DecodeResult {
  switch (encoding) {
    case 'utf-8': {
      const start = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
      try {
        return { ok: true, text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes.subarray(start)) };
      } catch {
        return { ok: false, reason: 'invalid-utf8' };
      }
    }
    case 'utf-16le':
      return decodeUtf16(bytes, true, bytes[0] === 0xff && bytes[1] === 0xfe ? 2 : 0);
    case 'utf-16be':
      return decodeUtf16(bytes, false, bytes[0] === 0xfe && bytes[1] === 0xff ? 2 : 0);
    case 'windows-1252':
      return decodeCp1252(bytes);
  }
}

export function isEncodingId(value: string): value is TextEncodingId {
  return value === 'utf-8' || value === 'utf-16le' || value === 'utf-16be' || value === 'windows-1252';
}
