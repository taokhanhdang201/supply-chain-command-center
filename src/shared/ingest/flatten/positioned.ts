// Positioned text (pages of text runs with coordinates) becomes tables through a REGISTERED table-inference step. The core
// ships no inference (the reference implementation arrives with the first adapter that needs one); without it, a
// positioned-text source yields no table and the pipeline says so. The hook is passed in, never discovered at runtime.

import type { RawTable, TextRun } from '../types';

export interface TableInferenceInput {
  adapterId: string;
  name: string;
  pages: readonly TextRun[][];
}

/** Turns pages of text runs into tables (rows of cells with `page` source references), or an empty list when none is found. */
export type TableInference = (input: TableInferenceInput) => RawTable[];

export function inferTables(input: TableInferenceInput, inference: TableInference | undefined): RawTable[] {
  if (inference === undefined) return [];
  try {
    return inference(input);
  } catch {
    return []; // an inference step must never break the pipeline
  }
}
