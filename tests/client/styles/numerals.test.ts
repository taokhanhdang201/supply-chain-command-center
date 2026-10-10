// DESIGN.md §9: tabular figures only where numbers line up or change in place; running text keeps
// proportional ones. The floor tables' scroll covers are the paper. jsdom cannot lay out a page, so the
// rules are read as text; v16.ui.browser.test.ts measures them in Chrome.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (file: string): string => readFileSync(resolve('src/client/styles', file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
/** The body of the first `selector { body }` with exactly this selector (whitespace collapsed), at any nesting depth. */
function bodyOf(file: string, selector: string): string {
  for (const m of read(file).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if ((m[1] as string).trim().replace(/\s+/g, ' ') === selector) return m[2] as string;
  }
  return '';
}

describe('numerals', () => {
  it('sets no page-wide tabular figures: base.css leaves numerals to each component', () => {
    expect(read('base.css')).not.toMatch(/font-variant-numeric/);
  });

  it.each([
    ['components.css', '.data-table th.data-table__header--right, .data-table td.data-table__cell--right'],
    ['components.css', '.pagination__page'],
    ['components.css', '.risk-summary__value'],
    ['components.css', '.meter-list__value'],
    ['components.css', '.chart svg text'],
    ['components.css', '.chart__legend-value'],
    ['pages.css', '.stage-figure__value'],
    ['pages.css', '.analytics-figure__value'],
    ['pages.css', '.share-bar__item'],
    ['pages.css', '.ingest-headline'],
    ['pages.css', '.routes__summary'],
    ['atlas.css', '.atlas-page .figure__value'],
    ['atlas.css', '.atlas-page .hero__value'],
    ['atlas.css', '.atlas-page .status-list__count'],
    ['atlas.css', '.atlas-page .rack__pct'],
    ['atlas.css', '.atlas-page .rack__value'],
    ['atlas.css', '.atlas-page .kind-row__count'],
    ['atlas.css', '.atlas-page .queue-row__damage'],
    ['atlas.css', '.atlas-page .activity__cost']
  ])('%s %s keeps tabular figures', (file, selector) => {
    expect(bodyOf(file, selector)).toMatch(/font-variant-numeric:\s*tabular-nums/);
  });

  it('reads a date as text: the Dashboard activity date has proportional figures, as the dates of every table', () => {
    const body = bodyOf('atlas.css', '.atlas-page .activity__date');
    expect(body).toMatch(/font-variant-numeric:\s*lining-nums/);
    expect(body).not.toMatch(/tabular-nums/);
  });

  it('reads an ID as text: the Dashboard activity ID has proportional figures', () => {
    const body = bodyOf('atlas.css', '.atlas-page .activity__id');
    expect(body).toMatch(/font-weight:\s*500/);
    expect(body).not.toMatch(/font-variant-numeric/);
  });

  it('covers the scroll edges of a floor table with the paper it sits on', () => {
    const body = bodyOf('pages.css', '.page-floor .table-scroll');
    expect(body.match(/var\(--color-bg\) 30%/g)).toHaveLength(2);
    expect(body.match(/var\(--color-scroll-shadow\)/g)).toHaveLength(2);
    expect(body).not.toMatch(/--color-surface/);
  });
});
