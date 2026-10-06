// One formatter per SourceRef kind: how a position in the user's OWN file is shown ("line 57", "Sheet 'Loads', D57",
// "$.shipments[56].id", "page 3"). Every validation issue, excluded row and problem row is displayed through this, so a
// new source kind only adds a case here. File-derived text (sheet names, paths) is truncated; callers render it as text.

import type { SourceRef } from '../types';

/** 1 -> A, 26 -> Z, 27 -> AA (spreadsheet column letters). */
export function columnLetters(col: number): string {
  let n = Math.max(1, Math.floor(col));
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function clip(text: string, max = 60): string {
  const flat = text.replace(/[\u0000-\u001f\u007f]/g, ' ');
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export function formatSourceRef(ref: SourceRef): string {
  switch (ref.kind) {
    case 'line':
      return ref.column === undefined ? `line ${ref.line}` : `line ${ref.line}, column ${ref.column}`;
    case 'cell':
      return `Sheet '${clip(ref.sheet)}', ${columnLetters(ref.col)}${ref.row}`;
    case 'path':
      return ref.index === undefined ? clip(ref.path, 120) : `${clip(ref.path, 120)} (record ${ref.index + 1})`;
    case 'page': {
      if (ref.bbox === undefined) return `page ${ref.page}`;
      const [x0, y0] = ref.bbox;
      return `page ${ref.page}, near (${Math.round(x0)}, ${Math.round(y0)})`;
    }
    case 'segment':
      return ref.element === undefined ? `segment ${ref.index}` : `segment ${ref.index}, element ${ref.element}`;
    case 'record':
      return `record ${ref.index + 1}`;
  }
}

/** The same reference without the column part, used when only the row matters ("row 57"). */
export function formatRowRef(ref: SourceRef): string {
  if (ref.kind === 'line') return `line ${ref.line}`;
  if (ref.kind === 'cell') return `Sheet '${clip(ref.sheet)}', row ${ref.row}`;
  return formatSourceRef(ref);
}
