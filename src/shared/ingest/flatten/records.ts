// The core flattener for nested sources (JSON-, XML- or EDI-like): records become tables. Scalar leaves become cells in
// path columns ("route.from.city"), nested objects are flattened into path columns, and arrays of objects become CHILD
// tables (one row per element). Keys are kept as ordered pairs and column lookups use a Map, so a hostile key such as
// "__proto__" is just text. The mapper reads the LAST path segment as the header when it is unique among the columns.

import type { ExtractionNote, RawCell, RawColumn, RawTable, RecordNode, RecordValue, SourceRef } from '../types';

interface Leaf {
  path: string[];
  value: string;
}

function isNode(v: RecordValue): v is RecordNode {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function collect(node: RecordNode, prefix: string[], leaves: Leaf[], children: Array<{ path: string[]; nodes: RecordNode[] }>): void {
  for (const [key, value] of node.entries) {
    const path = [...prefix, key];
    if (value === null) leaves.push({ path, value: '' });
    else if (typeof value === 'string') leaves.push({ path, value });
    else if (Array.isArray(value)) {
      if (value.length > 0) children.push({ path, nodes: value });
    } else if (isNode(value)) collect(value, path, leaves, children);
  }
}

function tableFrom(adapterId: string, name: string, index: number, nodes: readonly RecordNode[], maxRows: number, notes: ExtractionNote[]): { table: RawTable; children: Array<{ path: string[]; nodes: RecordNode[] }> } {
  const columnIndex = new Map<string, number>();
  const columns: RawColumn[] = [];
  const childBuckets = new Map<string, { path: string[]; nodes: RecordNode[] }>();
  const perRow: Leaf[][] = [];
  const truncated = nodes.length > maxRows;
  const slice = truncated ? nodes.slice(0, maxRows) : nodes;
  for (const node of slice) {
    const leaves: Leaf[] = [];
    const children: Array<{ path: string[]; nodes: RecordNode[] }> = [];
    collect(node, [], leaves, children);
    for (const leaf of leaves) {
      const key = leaf.path.join('\u0000');
      if (!columnIndex.has(key)) {
        columnIndex.set(key, columns.length);
        columns.push({ header: leaf.path.join('.'), path: leaf.path });
      }
    }
    for (const c of children) {
      const key = c.path.join('\u0000');
      const bucket = childBuckets.get(key) ?? { path: c.path, nodes: [] };
      bucket.nodes.push(...c.nodes);
      childBuckets.set(key, bucket);
    }
    perRow.push(leaves);
  }
  const rows: RawCell[][] = perRow.map((leaves) => {
    const row: RawCell[] = columns.map(() => ({ v: '', t: 'empty' as const }));
    for (const leaf of leaves) row[columnIndex.get(leaf.path.join('\u0000')) as number] = { v: leaf.value, t: 'text' };
    return row;
  });
  const table: RawTable = {
    ref: { adapterId, name, index },
    name,
    hidden: false,
    columns,
    rows,
    rowCount: rows.length,
    colCount: columns.length,
    truncated,
    origin(rowIndex: number, colIndex?: number): SourceRef {
      const node = slice[rowIndex] ?? slice[slice.length - 1];
      const base = node?.path ?? name;
      const col = colIndex === undefined ? undefined : columns[colIndex]?.path;
      return { kind: 'path', path: col === undefined ? base : `${base}.${col.join('.')}`, index: node?.index ?? rowIndex };
    },
    notes
  };
  return { table, children: [...childBuckets.values()] };
}

/** Flattens the records of one extraction into a main table plus one child table per array of objects. */
export function flattenRecords(adapterId: string, name: string, records: readonly RecordNode[], limits: { maxRows: number; maxTables: number }): RawTable[] {
  const tables: RawTable[] = [];
  const notes: ExtractionNote[] = [];
  const main = tableFrom(adapterId, name, 0, records, limits.maxRows, notes);
  tables.push(main.table);
  const queue = main.children.map((c) => ({ ...c, parent: name }));
  while (queue.length > 0 && tables.length < limits.maxTables) {
    const next = queue.shift()!;
    const childName = `${next.parent}.${next.path.join('.')}`;
    const child = tableFrom(adapterId, childName, tables.length, next.nodes, limits.maxRows, []);
    tables.push(child.table);
    for (const c of child.children) queue.push({ ...c, parent: childName });
  }
  return tables;
}
