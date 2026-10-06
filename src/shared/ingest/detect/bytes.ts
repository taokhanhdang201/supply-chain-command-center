// Generic byte helpers. No format knowledge lives here: signatures and sniffing rules belong to the adapters.

import type { ByteSource, Signature } from '../types';

/** The number of leading bytes every adapter gets to vote on. */
export const HEAD_BYTES = 64 * 1024;

/** An in-memory byte source. */
export function byteSourceFrom(bytes: Uint8Array): ByteSource {
  return {
    size: bytes.length,
    read(start: number, end: number): Uint8Array {
      const s = Math.max(0, Math.min(bytes.length, Math.floor(start)));
      const e = Math.max(s, Math.min(bytes.length, Math.floor(end)));
      return bytes.subarray(s, e);
    }
  };
}

/** Reads the whole source (callers enforce the source limit first). */
export function readAll(src: ByteSource): Uint8Array {
  return src.read(0, src.size);
}

export function headOf(src: ByteSource, n: number = HEAD_BYTES): Uint8Array {
  return src.read(0, Math.min(n, src.size));
}

/** True when `bytes` contains `sig` at `sig.offset` (respecting an optional mask). Never throws. */
export function matchesSignature(bytes: Uint8Array, sig: Signature): boolean {
  if (sig.bytes.length === 0 || sig.offset < 0) return false;
  if (sig.offset + sig.bytes.length > bytes.length) return false;
  for (let i = 0; i < sig.bytes.length; i++) {
    const mask = sig.mask?.[i] ?? 0xff;
    if (((bytes[sig.offset + i] ?? 0) & mask) !== ((sig.bytes[i] ?? 0) & mask)) return false;
  }
  return true;
}

export function startsWithBytes(bytes: Uint8Array, prefix: readonly number[], offset = 0): boolean {
  return matchesSignature(bytes, { offset, bytes: prefix });
}

/** The ASCII bytes of a string (code points above 0x7f are not supported; intended for magic strings). */
export function asciiBytes(text: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) out.push(text.charCodeAt(i) & 0xff);
  return out;
}

/** Index of the first occurrence of `needle` in `bytes` at or after `from`, or -1. */
export function indexOfBytes(bytes: Uint8Array, needle: readonly number[], from = 0): number {
  if (needle.length === 0) return -1;
  const last = bytes.length - needle.length;
  outer: for (let i = Math.max(0, from); i <= last; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (bytes[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

export function countByte(bytes: Uint8Array, value: number): number {
  let n = 0;
  for (let i = 0; i < bytes.length; i++) if (bytes[i] === value) n++;
  return n;
}

/** Normalizes a file name to a lowercase extension with its dot ('data.CSV' -> '.csv'), or null. */
export function extensionOf(fileName: string | null | undefined): string | null {
  if (fileName === null || fileName === undefined) return null;
  const base = fileName.split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return null;
  const ext = base.slice(dot).toLowerCase();
  return /^\.[a-z0-9]{1,12}$/.test(ext) ? ext : null;
}
