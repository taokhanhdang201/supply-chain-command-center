// Round-2 R-16/R-8: a real-browser check (this session's Playwright pass against the built app) found that the
// `.data-table__cell--wrap` class IS applied to the right cells (Import page's "Problem" column, Alerts page's
// "Message" column) but has NO EFFECT: `getComputedStyle(cell).whiteSpace` is still "nowrap" in a real Chromium
// browser. This test reproduces that with jsdom's own CSS cascade engine (loading the actual stylesheet, not
// mocking it) so it runs in the normal `npm test` suite without a browser. Root cause: CSS specificity.
// `.data-table th, .data-table td { white-space: nowrap }` has specificity (0,1,1) (one class + one element),
// which beats `.data-table__cell--wrap { white-space: normal }` at (0,1,0) (one class only) -- regardless of
// which rule appears later in the stylesheet. So R-8's fix never actually takes effect for a long message: it
// widens the table column (and, at narrow viewports or with a very long message, can still get clipped by the
// column/table width) instead of wrapping onto multiple lines as the reviewer asked for.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
// @ts-expect-error -- jsdom has no bundled type declarations in this project; used here only to load a real
// stylesheet and read a real computed cascade result, not for typed API surface.
import { JSDOM } from 'jsdom';

describe('BUG-5 marker (round 2): .data-table__cell--wrap has no effect due to CSS specificity (R-8 fix does not work)', () => {
  it('a <td class="data-table__cell--wrap"> inside a real .data-table does not actually get white-space: normal', () => {
    const css = fs.readFileSync('src/client/styles/components.css', 'utf-8');
    const dom = new JSDOM(
      `<!doctype html><html><head><style>${css}</style></head><body>
        <table class="data-table"><tbody><tr><td class="data-table__cell--wrap">A very long wrapped message that should break onto multiple lines instead of staying on one.</td></tr></tbody></table>
      </body></html>`,
      { pretendToBeVisual: true }
    );
    const td = dom.window.document.querySelector('td.data-table__cell--wrap') as Element;
    const computed = dom.window.getComputedStyle(td);
    // This is the bug: it SHOULD be 'normal' (per the R-8 intent and the CSS comment right above the rule), but
    // the `.data-table td { white-space: nowrap }` rule's higher specificity (class+element vs. class-only)
    // wins regardless of source order, so it stays 'nowrap'. Left failing per tester process -- not a fix.
    expect(computed.whiteSpace).toBe('normal');
  });
});
