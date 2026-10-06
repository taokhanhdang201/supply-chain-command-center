// Shared harness for the mapping accuracy tests: builds a mapping proposal for a generated case and scores it against
// the ground truth (criterion 46).

import { profileColumn } from '../../src/shared/ingest/structure/profile';
import { proposeMapping, type MappingProposal } from '../../src/shared/ingest/mapping/report';
import type { Dictionary } from '../../src/shared/ingest/mapping/dictionary';
import type { BuiltCase } from '../fixtures/ingest/gen';

export function cellsOf(rows: string[][], index: number) {
  return rows.map((r) => ({ v: r[index] ?? '', t: 'text' as const }));
}

export function proposeCase(c: BuiltCase, dict?: Dictionary): MappingProposal {
  const profiles = c.headers.map((h, i) => profileColumn(h, cellsOf(c.rows, i)));
  return proposeMapping(c.kind, c.headers, profiles, dict);
}

export interface Metrics {
  columns: number;
  truthColumns: number;
  matched: number;
  check: number;
  wrongMatched: string[];
  junkMatched: string[];
  wrongCheck: string[];
  recallCount: number;
  recall: number;
  missed: string[];
}

export function evaluate(cases: BuiltCase[], dict?: Dictionary): Metrics {
  return scoreProposals(cases.map((c) => ({ id: c.id, proposal: proposeCase(c, dict), truth: c.truth })));
}

export interface Scored {
  id: string;
  proposal: MappingProposal;
  truth: Array<string | null>;
}

export function scoreProposals(items: Scored[]): Metrics {
  const m: Metrics = { columns: 0, truthColumns: 0, matched: 0, check: 0, wrongMatched: [], junkMatched: [], wrongCheck: [], recallCount: 0, recall: 0, missed: [] };
  for (const c of items) {
    const p = c.proposal;
    p.columns.forEach((col, i) => {
      const truth = c.truth[i] ?? null;
      m.columns++;
      if (truth !== null) m.truthColumns++;
      const label = `${c.id}: "${col.header}" -> ${col.field ?? col.state} (truth ${truth ?? 'junk'})`;
      if (col.state === 'matched') {
        m.matched++;
        if (truth === null) m.junkMatched.push(label);
        else if (truth !== col.field) m.wrongMatched.push(label);
      } else if (col.state === 'check') {
        m.check++;
        if (truth !== col.field) m.wrongCheck.push(label);
      }
      const mapped = col.state === 'matched' || col.state === 'check';
      if (truth !== null) {
        if (mapped && col.field === truth) m.recallCount++;
        else m.missed.push(`${c.id}: "${col.header}" (truth ${truth}) -> ${col.state}${col.field === null ? '' : ` ${col.field}`}`);
      }
    });
  }
  m.recall = m.truthColumns === 0 ? 1 : m.recallCount / m.truthColumns;
  return m;
}

import { build, type CorpusColumn } from '../fixtures/ingest/gen';

/** Proposal for a quick ad-hoc set of columns (30 generated rows). */
export function quick(kind: 'inventory' | 'shipments', columns: CorpusColumn[], dict?: Dictionary): MappingProposal {
  return proposeCase(build({ id: 'quick', language: 'en', kind, columns }), dict);
}

export function byHeader(p: MappingProposal, header: string) {
  const c = p.columns.find((x) => x.header === header);
  if (c === undefined) throw new Error(`no column ${header}`);
  return c;
}
