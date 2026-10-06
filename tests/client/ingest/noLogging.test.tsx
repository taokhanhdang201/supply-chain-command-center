// @vitest-environment jsdom
// Criterion 36: nothing file-derived (content or names) is logged, in any flow of the universal card: a normal import, a
// refused file, a file over the limit, hostile text, a cancelled run, a rejected upload. Every console method and the
// error events of the window are watched; the run must produce no call at all.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { ApiError } from '../../../src/client/api/apiClient';
import { concat, cp1252, gzip, utf8 } from '../../ingest-kit/corpus';
import { acknowledgeAll, confirmButton, fileOf, fileOfFixture, fixtureByName, renderCard, review, settled } from './uiHarness';

const SECRET_NAME = 'secret-customer-NAME-4711.csv';
const SECRET_TEXT = 'secret-token-8842';
const calls: unknown[][] = [];
const windowErrors: unknown[] = [];
let restore: Array<() => void> = [];
const onError = (e: ErrorEvent): void => void windowErrors.push(e.message);

beforeEach(() => {
  calls.length = 0;
  windowErrors.length = 0;
  restore = (['log', 'info', 'warn', 'error', 'debug', 'trace'] as const).map((m) => {
    const spy = vi.spyOn(console, m).mockImplementation((...args: unknown[]) => void calls.push([m, ...args]));
    return () => spy.mockRestore();
  });
  window.addEventListener('error', onError);
});
afterEach(() => {
  window.removeEventListener('error', onError);
  for (const r of restore) r();
});

const HEAD = 'sku,product_name,category,warehouse,quantity,reorder_point,unit_cost\n';

describe('nothing file-derived is logged', () => {
  it('a full import (review, answers, confirm, result)', async () => {
    const r = await renderCard();
    await review(r, fileOf(`${HEAD}A-1,${SECRET_TEXT},Hardware,WH-DFW,3,1,9.5\n`, SECRET_NAME));
    await acknowledgeAll(r.user);
    await waitFor(() => expect(confirmButton()).toBeEnabled());
    await r.user.click(confirmButton());
    await screen.findByText(/All views are updated\./);
    expect(calls).toEqual([]);
    expect(windowErrors).toEqual([]);
  });

  it('refusals: binary, unknown, empty, over the limit, UTF-32, gzip bomb, damaged gzip', async () => {
    const r = await renderCard({ maxUploadBytes: 4096 });
    for (const file of [
      fileOf(new Uint8Array(80), SECRET_NAME),
      fileOf(concat(utf8('%PDF-1.4 '), utf8(SECRET_TEXT)), SECRET_NAME),
      fileOf('', SECRET_NAME),
      fileOf(HEAD + `A-1,${SECRET_TEXT},x,WH-DFW,1,1,1\n` + 'z'.repeat(9000), SECRET_NAME),
      fileOf(concat(Uint8Array.of(0xff, 0xfe, 0, 0), utf8(SECRET_TEXT)), SECRET_NAME),
      fileOf(gzip(new Uint8Array(3 * 1024 * 1024)), `${SECRET_NAME}.gz`),
      fileOf(gzip(utf8(HEAD + SECRET_TEXT)).slice(0, 14), `${SECRET_NAME}.gz`)
    ]) {
      await review(r, file);
      expect(screen.queryAllByText(new RegExp(SECRET_TEXT)).length).toBe(0);
    }
    expect(calls).toEqual([]);
  });

  it('hostile text, a Windows-1252 confirmation, a cancelled review and a rejected upload', async () => {
    const importCsv = vi.fn().mockRejectedValue(new ApiError(422, 'VALIDATION_FAILED', 'The file was rejected: 1 problem(s) found. No data was changed.', [{ line: 2, column: 'sku', code: 'REQUIRED', message: 'Bad.' }], 1));
    const r = await renderCard({ api: { importCsv } });
    await review(r, fileOf(`${HEAD}=cmd|'/C calc'!A0,<img src=x onerror=${SECRET_TEXT}>,x,WH-DFW,abc,1,-1\n`, SECRET_NAME));
    await review(r, fileOf(cp1252(`${HEAD}A-1,Café ${SECRET_TEXT},Home,WH-DFW,3,1,9.5\n`), SECRET_NAME));
    await r.user.click(screen.getByRole('button', { name: 'Start over' }));
    await review(r, fileOfFixture(fixtureByName('alder_freight.csv')));
    await acknowledgeAll(r.user);
    await waitFor(() => expect(confirmButton()).toBeEnabled());
    await r.user.click(confirmButton());
    await screen.findByText('The file was rejected: 1 problem(s) found. No data was changed.');
    await settled();
    expect(calls).toEqual([]);
    expect(windowErrors).toEqual([]);
  });

  it('the spy is live: a console call made by the test itself is recorded (so an empty list means something)', () => {
    console.warn(SECRET_NAME);
    expect(calls).toEqual([['warn', SECRET_NAME]]);
  });
});
