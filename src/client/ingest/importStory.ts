// The words of the import card: one question at a time with its answers as buttons, what SCC fixed on its own, the
// effect on the Dashboard, and the list of problems to download. Pure functions of the preview and the snapshot; the card
// turns an `Answer` into a flow decision. Every value quoted from the file is clipped.

import type { ImportKind, Snapshot } from '../../shared/types';
import { SHIPMENT_STATUSES } from '../../shared/types';
import { WAREHOUSE_CODES } from '../../shared/reference/locations';
import type { Blocker, PreviewModel } from '../../shared/ingest/preview/model';
import { normalizeDate, type DatePreset } from '../../shared/ingest/normalize/dates';
import { normalizeNumber, type NumberPreset } from '../../shared/ingest/normalize/numbers';
import { clip, supportedDescriptors } from '../../shared/ingest/messages';
import type { AdapterLookup } from '../../shared/ingest/types';
import { importShipmentsCsv } from '../../shared/csv/importShipments';
import { importInventoryCsv } from '../../shared/csv/importInventory';
import { enrichShipments } from '../../shared/domain/shipments';
import { enrichInventory } from '../../shared/domain/inventory';
import { computeKpis } from '../../shared/domain/metrics';

/** A decision a button stands for. */
export type Answer =
  | { kind: 'date'; field: string; preset: DatePreset }
  | { kind: 'number'; preset: NumberPreset }
  | { kind: 'status'; source: string; target: string }
  | { kind: 'warehouse'; source: string; target: string }
  | { kind: 'dataset'; dataset: ImportKind }
  | { kind: 'acknowledge-column'; index: number }
  | { kind: 'assign'; index: number; field: string | null }
  | { kind: 'option'; key: string; value: string }
  | { kind: 'acknowledge-choice'; key: string }
  | { kind: 'table'; index: number };

export interface Question {
  sentence: string;
  line: string;
  /** The answers are the buttons; none means the question is answered in the details. */
  answers: Array<{ label: string; answer: Answer }>;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const STATUS_WORDS: Record<string, string> = { pending: 'Pending', in_transit: 'In transit', delivered: 'Delivered', cancelled: 'Cancelled' };
const STATUS_ORDER = ['in_transit', 'delivered', 'pending', 'cancelled'].filter((s) => (SHIPMENT_STATUSES as readonly string[]).includes(s));
const DATE_ORDER_WORDS: Record<DatePreset, string> = {
  iso: 'year-month-day',
  ymd_slash: 'year/month/day',
  mdy_slash: 'month/day/year',
  dmy_slash: 'day/month/year',
  dmy_dot: 'day.month.year'
};

const quote = (text: string, max = 40): string => `“${clip(text.trim(), max)}”`;

/** The waiting line, from the registry and the size limit: "CSV, TSV, TXT or GZ file. Up to 2 MB." */
export function waitingLine(registry: AdapterLookup, limitBytes: number): string {
  const names = [...new Set(supportedDescriptors(registry).flatMap((d) => d.hints.extensions.map((e) => e.replace(/^\./, '').toUpperCase())))];
  const list = names.length <= 1 ? (names[0] ?? 'No') : `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
  return `${list} file. Up to ${Number((limitBytes / 1_048_576).toFixed(1))} MB.`;
}

/** The "cannot import" line: the refusal's own hint, without what the first sentence already says and without the list
 *  of formats (that list sits behind "What SCC can read"). */
export function cannotLine(rest: string): string {
  const hint = rest
    .replace(/\s*You can import:.*$/s, '')
    .replace(/^SCC cannot import that type\.\s*/, '')
    .trim();
  return hint === '' ? 'Save it as CSV and choose that file.' : hint;
}

/** "April 3" for 2026-04-03. */
export function dayLabel(iso: string): string {
  const m = /^\d{4}-(\d{2})-(\d{2})/.exec(iso);
  return m === null ? iso : `${MONTHS[Number(m[1]) - 1] ?? m[1]} ${Number(m[2])}`;
}

/** "shipment_id" reads "shipment ID". */
export function fieldWords(field: string): string {
  return field
    .split('_')
    .map((w) => (w === 'id' ? 'ID' : w === 'sku' ? 'SKU' : w))
    .join(' ');
}

const KIND_NOUN: Record<ImportKind, [string, string]> = { shipments: ['shipment', 'shipments'], inventory: ['inventory item', 'inventory items'] };

/** "480 shipments", "1 inventory item". */
export function countOf(kind: ImportKind, n: number): string {
  const [one, many] = KIND_NOUN[kind];
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
}

const capitalized = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);
const plural = (n: number, one: string, many = `${one}s`): string => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
const sameName = (header: string, field: string): boolean => header.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') === field;

function dateQuestion(preview: PreviewModel, field: string | undefined): Question | null {
  const column = preview.presets.dateColumns.find((c) => c.field === field);
  if (column === undefined) return null;
  const view = column.view;
  if (view.kind === 'ambiguous') {
    const answers = view.candidates.map((preset) => {
      const read = normalizeDate(column.example, preset, { optional: false });
      return { label: read.ok ? dayLabel(read.value) : DATE_ORDER_WORDS[preset], answer: { kind: 'date', field: column.field, preset } as Answer };
    });
    return {
      sentence: `Is ${column.example} ${answers.map((a) => a.label).join(' or ')}?`,
      line: `Column ${quote(column.header)}. No other date in this column tells us which.`,
      answers
    };
  }
  if (view.kind === 'mixed') {
    const groups = view.groups.slice(0, 3);
    return {
      sentence: `Which date format does ${quote(column.header)} use?`,
      line: `It holds ${groups.map((g) => g.examples[0]).filter(Boolean).join(' and ')}. Dates in the other format will show as problems.`,
      answers: groups.map((g) => ({ label: `Like ${clip(g.examples[0] ?? DATE_ORDER_WORDS[g.preset], 20)}`, answer: { kind: 'date', field: column.field, preset: g.preset } }))
    };
  }
  return null;
}

/** The first number in the sample that the candidate formats read differently. */
function numberExample(preview: PreviewModel, candidates: readonly NumberPreset[]): { raw: string; readings: Array<{ preset: NumberPreset; value: string }> } | null {
  for (const row of preview.sample.rows) {
    for (const raw of row.raw) {
      if (raw.trim() === '') continue;
      const readings: Array<{ preset: NumberPreset; value: string }> = [];
      for (const preset of candidates) {
        const r = normalizeNumber(raw, preset, { money: true, optional: true });
        if (r.ok && r.value !== '' && !readings.some((x) => x.value === r.value)) readings.push({ preset, value: r.value });
      }
      if (readings.length >= 2) return { raw, readings };
    }
  }
  return null;
}

function numberQuestion(preview: PreviewModel): Question | null {
  const view = preview.presets.number;
  if (view === null) return null;
  if (view.kind === 'ambiguous') {
    const example = numberExample(preview, view.candidates);
    if (example === null) return null;
    const answers = example.readings.map((r) => ({ label: Number(r.value).toLocaleString('en-US', { maximumFractionDigits: 6 }), answer: { kind: 'number', preset: r.preset } as Answer }));
    return { sentence: `Is ${clip(example.raw, 20)} ${answers.map((a) => a.label).join(' or ')}?`, line: 'The numbers in this file can be read two ways.', answers };
  }
  if (view.kind === 'mixed') {
    const groups = view.groups.slice(0, 3);
    return {
      sentence: 'Which number format does this file use?',
      line: `It holds ${groups.map((g) => g.examples[0]).filter(Boolean).join(' and ')}. Numbers in the other format will show as problems.`,
      answers: groups.map((g) => ({ label: `Like ${clip(g.examples[0] ?? g.preset, 20)}`, answer: { kind: 'number', preset: g.preset } }))
    };
  }
  return null;
}

/** One plain question for a blocker, with its answers as buttons. */
export function questionFor(preview: PreviewModel, blocker: Blocker): Question {
  const fallback: Question = { sentence: blocker.message, line: 'Answer it in the details below.', answers: [] };
  switch (blocker.code) {
    case 'choose-date-format':
      return dateQuestion(preview, blocker.field) ?? fallback;
    case 'choose-number-format':
      return numberQuestion(preview) ?? fallback;
    case 'choose-status': {
      const entry = preview.valueMaps.status?.find((e) => e.state === 'choose');
      if (entry === undefined) return fallback;
      return {
        sentence: `What does ${quote(entry.source, 30)} mean?`,
        line: `${plural(entry.count, 'shipment')} ${entry.count === 1 ? 'has' : 'have'} this status. SCC does not guess.`,
        answers: STATUS_ORDER.map((s) => ({ label: STATUS_WORDS[s] ?? s, answer: { kind: 'status', source: entry.source, target: s } }))
      };
    }
    case 'choose-warehouse': {
      const entry = preview.valueMaps.warehouse?.find((e) => e.state === 'choose');
      if (entry === undefined) return fallback;
      return {
        sentence: `Which SCC warehouse is ${quote(entry.source, 30)}?`,
        line: `${plural(entry.count, 'row')} ${entry.count === 1 ? 'uses' : 'use'} it.`,
        answers: WAREHOUSE_CODES.map((code) => ({ label: code, answer: { kind: 'warehouse', source: entry.source, target: code } }))
      };
    }
    case 'choose-dataset':
      return {
        sentence: 'Is this a shipments file or an inventory file?',
        line: 'Its columns could be either.',
        answers: [
          { label: 'Shipments', answer: { kind: 'dataset', dataset: 'shipments' } },
          { label: 'Inventory', answer: { kind: 'dataset', dataset: 'inventory' } }
        ]
      };
    case 'check-column': {
      const column = preview.columns.find((c) => c.index === blocker.columnIndex);
      if (column === undefined || column.field === null) return fallback;
      return {
        sentence: `Is ${quote(column.header)} the ${fieldWords(column.field)}?`,
        line: column.example === '' ? 'The column has no values to show.' : `For example ${quote(column.example)}.`,
        answers: [
          { label: 'Yes', answer: { kind: 'acknowledge-column', index: column.index } },
          { label: 'No, skip it', answer: { kind: 'assign', index: column.index, field: null } }
        ]
      };
    }
    case 'choose-column': {
      const column = preview.columns.find((c) => c.index === blocker.columnIndex);
      if (column === undefined) return fallback;
      return {
        sentence: `Which SCC field is ${quote(column.header)}?`,
        line: column.example === '' ? 'The column has no values to show.' : `For example ${quote(column.example)}.`,
        answers: [
          ...column.candidates.slice(0, 3).map((c) => ({ label: capitalized(fieldWords(c.field)), answer: { kind: 'assign', index: column.index, field: c.field } as Answer })),
          { label: 'Do not import it', answer: { kind: 'assign', index: column.index, field: null } }
        ]
      };
    }
    case 'choose-choice':
    case 'confirm-choice': {
      const choice = preview.choices.find((c) => (blocker.code === 'choose-choice' ? c.status === 'choose' : c.status === 'needs-confirmation'));
      if (choice === undefined) return fallback;
      const options = choice.options.slice(0, 4);
      if (blocker.code === 'choose-choice') {
        return { sentence: `Which ${choice.label.toLowerCase()} does this file use?`, line: choice.evidence[0] ?? 'SCC could not tell on its own.', answers: options.map((o) => ({ label: clip(o.label, 40), answer: { kind: 'option', key: choice.key, value: o.value } })) };
      }
      const current = choice.options.find((o) => o.value === choice.value);
      return {
        sentence: `Is the ${choice.label.toLowerCase()} ${clip(current?.label ?? choice.value ?? '', 40)}?`,
        line: choice.evidence[0] ?? 'SCC needs you to confirm it.',
        answers: [
          { label: 'Yes', answer: { kind: 'acknowledge-choice', key: choice.key } },
          ...options.filter((o) => o.value !== choice.value).slice(0, 2).map((o) => ({ label: clip(o.label, 40), answer: { kind: 'option', key: choice.key, value: o.value } as Answer }))
        ]
      };
    }
    case 'choose-table': {
      const tables = preview.tables.map((t, index) => ({ t, index })).filter((x) => !x.t.hidden).slice(0, 4);
      return {
        sentence: 'Which table holds the data?',
        line: `The file has ${plural(preview.tables.filter((t) => !t.hidden).length, 'table')}.`,
        answers: tables.map(({ t, index }) => ({ label: t.name === '' ? '(unnamed table)' : clip(t.name, 40), answer: { kind: 'table', index } }))
      };
    }
    default:
      return fallback;
  }
}

/** Blockers the file itself must fix: no question can resolve them. */
export const FATAL_CODES: ReadonlySet<string> = new Set(['currency', 'too-large', 'no-rows']);

/** What SCC did on its own, one short sentence each ("What I fixed (n)"). */
export function fixesOf(preview: PreviewModel): string[] {
  const out: string[] = [];
  const renamed = preview.columns.filter((c): c is typeof c & { field: string } => c.field !== null && !sameName(c.header, c.field));
  if (renamed.length === 1) {
    const c = renamed[0] as (typeof renamed)[number];
    out.push(`Read ${quote(c.header)} as the ${fieldWords(c.field)}.`);
  } else if (renamed.length > 1) {
    const [a, b] = renamed as [(typeof renamed)[number], (typeof renamed)[number]];
    out.push(`Matched ${renamed.length} columns by their names, for example ${quote(a.header)} as the ${fieldWords(a.field)} and ${quote(b.header)} as the ${fieldWords(b.field)}.`);
  }
  for (const d of preview.presets.dateColumns) {
    const v = d.view;
    if ((v.kind !== 'unique' && v.kind !== 'equivalent') || v.preset === 'iso') continue;
    if (v.chosenByUser) out.push(`Read ${quote(d.header)} as ${DATE_ORDER_WORDS[v.preset]} (your answer).`);
    else if (d.proof !== null) {
      const read = normalizeDate(d.proof, v.preset, { optional: false });
      out.push(`Read ${quote(d.header)} as ${DATE_ORDER_WORDS[v.preset]}: ${d.proof} can only be ${read.ok ? dayLabel(read.value) : 'read that way'}.`);
    } else out.push(`Read ${quote(d.header)} as ${DATE_ORDER_WORDS[v.preset]}.`);
  }
  const number = preview.presets.number;
  if (number !== null && (number.kind === 'unique' || number.kind === 'equivalent') && number.preset !== 'plain') {
    out.push(`Read numbers with ${number.preset === 'us' ? 'comma thousands, like 1,234.56' : 'a decimal comma, like 1.234,56'}${number.chosenByUser ? ' (your answer)' : ''}.`);
  }
  if (preview.presets.markersStripped > 0) out.push(`Removed the $ sign from ${plural(preview.presets.markersStripped, 'amount')}.`);
  if (preview.presets.timestampsStripped > 0) out.push(`Dropped the time of day from ${plural(preview.presets.timestampsStripped, 'date')}.`);
  if (preview.presets.placeholders > 0) out.push(`Read ${plural(preview.presets.placeholders, 'placeholder')} such as N/A as blank.`);
  for (const e of preview.valueMaps.status ?? []) {
    if (e.state === 'mapped' && e.target !== null && !sameName(e.source, e.target)) out.push(`Read the status ${quote(e.source, 30)} as ${(STATUS_WORDS[e.target] ?? e.target).toLowerCase()}${e.chosenByUser ? ' (your answer)' : ''}.`);
  }
  for (const e of preview.valueMaps.warehouse ?? []) {
    if (e.state === 'mapped' && e.target !== null && e.source.trim() !== e.target) out.push(`Read the warehouse ${quote(e.source, 30)} as ${e.target}${e.chosenByUser ? ' (your answer)' : ''}.`);
  }
  for (const x of preview.counts.excluded) if (x.count > 0) out.push(`Left out ${plural(x.count, 'row')}: ${x.reason.replace(/\.$/, '')}.`);
  for (const k of preview.constants) out.push(`Used ${quote(k.value, 30)} as the ${fieldWords(k.field)} of every row.`);
  for (const n of preview.notImported) out.push(`Did not import ${quote(n.header)}: ${n.reason.charAt(0).toLowerCase()}${n.reason.slice(1)}`);
  return out;
}

const percent = (rate: number | null): string => (rate === null ? 'none' : `${(rate * 100).toFixed(1)}%`);

/** The effect on the Dashboard, in one line: "On-time rate moves from 85.6% to 91.0%. Replaces the 480 sample shipments." */
export function impactLine(kind: ImportKind, csv: string, snapshot: Snapshot): string {
  const source = snapshot.dataSources[kind];
  const replaces = `Replaces the ${source.rowCount.toLocaleString('en-US')} ${source.kind === 'sample' ? 'sample' : 'current'} ${kind === 'shipments' ? 'shipments' : 'inventory rows'}.`;
  if (kind === 'shipments') {
    const parsed = importShipmentsCsv(csv);
    if (!parsed.ok) return replaces;
    const after = computeKpis(snapshot.inventory, enrichShipments(parsed.rows, snapshot.today, snapshot.locations)).onTimeRate;
    const before = snapshot.kpis.onTimeRate;
    const move = percent(before) === percent(after) ? `On-time rate stays at ${percent(after)}.` : `On-time rate moves from ${percent(before)} to ${percent(after)}.`;
    return `${move} ${replaces}`;
  }
  const parsed = importInventoryCsv(csv);
  if (!parsed.ok) return replaces;
  const after = computeKpis(enrichInventory(parsed.rows), snapshot.shipments).lowStockCount;
  const before = snapshot.kpis.lowStockCount;
  const move = before === after ? `Low-stock items stay at ${after}.` : `Low-stock items go from ${before} to ${after}.`;
  return `${move} ${replaces}`;
}

/** The problems as a CSV the user can open next to the file: where, which column, what is wrong. */
export function problemsCsv(preview: PreviewModel): string {
  const cell = (v: string): string => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = preview.validation.issues.map((i) => [i.where, i.issue.column ?? '', i.message].map(cell).join(','));
  return ['row,column,problem', ...lines].join('\n') + '\n';
}

/** The "has errors" sentence and line, with the rows named. */
export function errorsText(preview: PreviewModel): { sentence: string; line: string } {
  const rows = preview.counts.rowsWithProblems;
  const columns = [...new Set(preview.validation.issues.map((i) => i.issue.column).filter((c): c is string => c !== null))];
  const sentence =
    rows === 0
      ? 'The file has a problem.'
      : columns.length === 1
        ? `${plural(rows, 'row')} ${rows === 1 ? 'has a problem' : 'have problems'} in the ${fieldWords(columns[0] as string)}.`
        : `${plural(rows, 'row')} ${rows === 1 ? 'needs' : 'need'} fixing.`;
  const wheres = [...new Set(preview.validation.issues.map((i) => i.where))];
  const lineNumbers = wheres.map((w) => /^line (\d+)$/.exec(w)?.[1]).filter((n): n is string => n !== undefined).sort((a, b) => Number(a) - Number(b));
  const byLine = lineNumbers.length === wheres.length && lineNumbers.length > 0;
  const shown = byLine ? lineNumbers : wheres;
  // "5, 7 and 10" or, past three, "5, 7, 10 and 4 more"
  const list = shown.length <= 1 ? (shown[0] ?? '') : shown.length <= 3 ? `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}` : `${shown.slice(0, 3).join(', ')} and ${shown.length - 3} more`;
  // A file's line number is its row number in a spreadsheet (the header is row 1), so the user reads "Rows".
  const named = byLine ? `${lineNumbers.length === 1 ? 'Row' : 'Rows'} ${list}` : capitalized(list);
  return { sentence, line: `${named}. Nothing was imported.` };
}
