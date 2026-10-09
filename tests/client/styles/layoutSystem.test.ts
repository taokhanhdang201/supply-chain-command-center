// The layout rules the pages share, read from the stylesheets (tests/tester/consistency.browser.test.ts checks what they draw).
// One rule per boundary (DESIGN.md §5): a section opens with its header's rule and nothing under it draws one at its top; the
// Top alerts rows keep to the page column; a route's arrow is muted ink on every page; the pagination is one row of controls on
// one baseline; reduced motion draws each skeleton block flat (DESIGN.md §18).
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (file: string): string => fs.readFileSync(path.resolve('src/client/styles', file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
/** The bodies of every rule whose selector list is exactly `selector` (whitespace collapsed), at any depth. */
const bodies = (file: string, selector: string): string[] =>
  [...read(file).matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((m) => (m[1] as string).replace(/\s+/g, ' ').trim() === selector)
    .map((m) => (m[2] as string).replace(/\s+/g, ' ').trim());

/** The text inside every `@media (query) { … }` block of a stylesheet (nested braces balanced). */
const mediaBlocks = (file: string, query: string): string[] => {
  const css = read(file);
  const head = `@media (${query}) {`;
  const out: string[] = [];
  for (let at = css.indexOf(head); at !== -1; at = css.indexOf(head, at + 1)) {
    let depth = 1;
    let end = at + head.length;
    for (; end < css.length && depth > 0; end++) depth += css[end] === '{' ? 1 : css[end] === '}' ? -1 : 0;
    out.push(css.slice(at + head.length, end - 1));
  }
  return out;
};

describe('the shared layout rules', () => {
  it('nothing under a section header or the band draws a rule at its top; charts and formulas close with one under them', () => {
    const under: Array<readonly [string, string]> = [
      ['pages.css', '.import-floor > .card'],
      ['pages.css', '.page-section .chart-grid > .card'],
      ['components.css', '.empty-state, .error-state'],
      ['components.css', '.pagination'],
      ['components.css', '.formula-list__item']
    ];
    for (const [file, selector] of under) {
      const found = bodies(file, selector);
      expect(found.length, `${selector} in ${file}`).toBeGreaterThan(0);
      for (const b of found) expect(b, selector).not.toMatch(/border-top:\s*1px/);
    }
    expect(bodies('pages.css', '.shipments-ledger, .inventory-ledger')).toEqual([]);
    expect(bodies('pages.css', '.alerts-ledger')).toEqual([]);
    expect(bodies('pages.css', '.page-section .chart-grid > .card')[0]).toContain('border-bottom: 1px solid var(--color-line-strong)');
    expect(bodies('components.css', '.formula-list__item')[0]).toContain('border-bottom: 1px solid var(--color-border-subtle)');
  });

  it('the Top alerts rows keep to the page column: no negative margin', () => {
    for (const selector of ['.atlas-page .kind-row', '.atlas-page .queue-row']) {
      const found = bodies('atlas.css', selector);
      expect(found.length, selector).toBeGreaterThan(0);
      for (const b of found) expect(b, selector).not.toMatch(/margin[^;]*-\d/);
    }
  });

  it('a route arrow is muted ink, in one rule for every page, and each place of a route keeps its line (inline in the Dashboard cell that ends in "…")', () => {
    expect(bodies('pages.css', '.route-arrow')).toEqual(['color: var(--color-text-muted); font-weight: 400;']);
    expect(bodies('atlas.css', '.atlas-page .route-arrow')).toEqual([]);
    expect(bodies('pages.css', '.route-label__place')).toEqual(['display: inline-block;']);
    // The Dashboard's route cell ends a long label in an ellipsis: an inline-block place would be cut whole and the "…" would
    // replace the destination, so from 1280px (where the cell is a grid column) its places are inline, in a rule of their own.
    const selector = '.atlas-page .activity .route-label__place';
    expect(bodies('atlas.css', selector)).toEqual(['display: inline;']);
    const wide = mediaBlocks('atlas.css', 'min-width: 1280px').map((b) => b.replace(/\s+/g, ' '));
    expect(wide.filter((b) => b.includes(`${selector} { display: inline; }`)).length, 'the rule sits in the 1280px block').toBe(1);
    expect(read('atlas.css').split('.route-label__place').length - 1, 'no other place rule in atlas.css').toBe(1);
  });

  it('the pagination is one row of controls on one baseline, its page-size label beside the select', () => {
    expect(bodies('components.css', '.pagination')[0]).toContain('align-items: center');
    expect(bodies('components.css', '.pagination .select-field')).toEqual(['flex-direction: row; align-items: baseline; gap: var(--space-2);']);
  });

  it('reduced motion draws each skeleton block in one flat colour', () => {
    expect(read('components.css')).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.skeleton \{\s*animation: none;\s*background: var\(--color-border-subtle\);\s*\}\s*\}/
    );
  });
});
