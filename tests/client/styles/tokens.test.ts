// Shared design tokens (Phase 1 spec section 1): the six type sizes, the gutter / grid-gap / content-width steps, the spacing
// scale and the drawing duration are declared once, in tokens.css. The Dashboard's own names (--dash-*, --fs-*, --t-*) are
// aliases of them, the older --font-size-* names are gone, and the map has no red of its own. The design ratchet does not follow
// var(), so these values and aliases are pinned here.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = path.resolve('src/client/styles');
const strip = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');
const tokens = strip(fs.readFileSync(path.join(dir, 'tokens.css'), 'utf8'));
const atlas = strip(fs.readFileSync(path.join(dir, 'atlas.css'), 'utf8'));
const all = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith('.css'))
  .sort()
  .map((f) => strip(fs.readFileSync(path.join(dir, f), 'utf8')))
  .join('\n');

/** Every value a custom property is given, in source order. A name that is never declared gives []. */
function values(css: string, name: string): string[] {
  return [...css.matchAll(new RegExp(`(?:^|[;{\\s])${name}:\\s*([^;]+);`, 'g'))].map((m) => (m[1] as string).trim());
}

describe('tokens.css', () => {
  it('six type sizes, the same six the design ratchet allows', () => {
    expect(values(tokens, '--text-xs')).toEqual(['0.75rem']);
    expect(values(tokens, '--text-sm')).toEqual(['0.875rem']);
    expect(values(tokens, '--text-md')).toEqual(['1rem']);
    expect(values(tokens, '--text-lg')).toEqual(['1.5rem']);
    expect(values(tokens, '--text-xl')).toEqual(['2.25rem']);
    expect(values(tokens, '--text-display')).toEqual(['clamp(3.5rem, 2.4vw + 3.2rem, 5.5rem)']);
  });

  it('the gutter is 16, 32 and 48px, stepping at 768 and 1100px; the grid gap is 16 and 24px', () => {
    expect(values(tokens, '--gutter')).toEqual(['16px', '32px', '48px']);
    expect(values(tokens, '--grid-gap')).toEqual(['16px', '24px']);
    expect(tokens).toMatch(/@media \(min-width: 768px\)\s*\{\s*:root\s*\{\s*--gutter:\s*32px;\s*\}\s*\}/);
    expect(tokens).toMatch(/@media \(min-width: 1100px\)\s*\{\s*:root\s*\{\s*--gutter:\s*48px;\s*--grid-gap:\s*24px;\s*\}\s*\}/);
    // Declared nowhere else: no other stylesheet can override the steps.
    expect(values(all, '--gutter')).toEqual(['16px', '32px', '48px']);
    expect(values(all, '--grid-gap')).toEqual(['16px', '24px']);
  });

  it('the spacing scale reaches 96 and 128px and the drawing duration is 800ms', () => {
    expect(values(all, '--space-24')).toEqual(['96px']); // atlas.css no longer keeps a copy
    expect(values(all, '--space-32')).toEqual(['128px']);
    expect(values(all, '--dur-draw')).toEqual(['800ms']);
  });

  it('one content width, 1280px, on every page', () => {
    expect(values(all, '--content-max')).toEqual(['1280px']);
    expect(all).not.toContain('1360px');
  });

  it('the Dashboard reads the shared tokens and never overrides them in a media query', () => {
    expect(values(atlas, '--dash-margin')).toEqual(['var(--gutter)']);
    expect(values(atlas, '--dash-gap')).toEqual(['var(--grid-gap)']);
    expect(values(atlas, '--dash-max')).toEqual(['var(--content-max)']);
    expect(values(atlas, '--fs-small')).toEqual(['var(--text-sm)']);
    expect(values(atlas, '--fs-lead')).toEqual(['var(--text-md)']);
    expect(values(atlas, '--fs-h2')).toEqual(['var(--text-lg)']);
    expect(values(atlas, '--fs-figure')).toEqual(['var(--text-xl)']);
    expect(values(atlas, '--fs-display')).toEqual(['var(--text-display)']);
  });

  it('the older size names are gone and the stage figure size is declared once', () => {
    for (const step of ['xs', 'sm', 'md', 'lg', 'xl']) expect(values(all, `--font-size-${step}`), step).toEqual([]);
    expect(all).not.toContain('var(--font-size-');
    expect(values(all, '--stage-figure-size')).toEqual(['var(--text-xl)']);
  });

  it('the Dashboard map and rack inks are declared once, in tokens.css, and atlas.css reads each of them', () => {
    const inks: Record<string, string> = {
      '--atlas-land-line': 'rgba(237, 233, 224, 0.18)',
      '--atlas-lane': 'rgba(237, 233, 224, 0.32)',
      '--atlas-lane-warning': 'rgba(237, 233, 224, 0.55)',
      '--atlas-city': 'rgba(237, 233, 224, 0.4)',
      '--rack-fill': 'rgba(237, 233, 224, 0.22)',
      '--rack-fill-over': 'rgba(242, 100, 90, 0.28)'
    };
    for (const [name, value] of Object.entries(inks)) {
      expect(values(all, name), name).toEqual([value]);
      expect(values(tokens, name), name).toEqual([value]);
      expect(atlas, name).toContain(`var(${name})`);
    }
  });

  it('the Dashboard durations are aliases of the shared ones, and the unread travel duration is gone', () => {
    expect(values(atlas, '--t-hover')).toEqual(['var(--dur-1)']);
    expect(values(atlas, '--t-fade')).toEqual(['var(--dur-2)']);
    expect(values(atlas, '--t-draw')).toEqual(['var(--dur-draw)']);
    expect(values(all, '--t-travel')).toEqual([]);
  });

  it('there is one red per surface: the route map has none of its own and the old map red is gone', () => {
    // Declared twice and only in tokens.css: the paper red, and the stage red the Routes map reads (Phase 1 spec section 2).
    expect(values(all, '--critical')).toEqual(values(tokens, '--critical'));
    expect(values(tokens, '--critical')).toHaveLength(2);
    expect(values(tokens, '--critical').at(-1)).toBe('#f2645a');
    expect(all.toLowerCase()).not.toContain('#ef5b4e');
    // `.route-map` keeps only its halo; its lane grey is the one --route of tokens.css.
    const routeMap = /(?:^|\n)\.route-map\s*\{([^}]*)\}/.exec(all);
    expect(routeMap, 'the .route-map rule').not.toBeNull();
    expect([...(routeMap![1] as string).matchAll(/(--[a-z-]+)\s*:/g)].map((m) => m[1])).toEqual(['--route-halo']);
    expect(values(all, '--route')).toEqual(['#5b6b80']);
  });

  // A role token (font: var(--type-*)) would reset font-variant-numeric and drop tabular figures, so there are none: a rule
  // sets its size step and, beside it, its line height in rem or unitless (DESIGN.md "Type roles").
  it('sets type by property: no role tokens, here or in DESIGN.md, and six line heights in rem or unitless', () => {
    expect(all).not.toMatch(/--type-[a-z]/);
    expect(fs.readFileSync(path.resolve('DESIGN.md'), 'utf8')).not.toContain('--type-');
    expect(['xs', 'sm', 'md', 'lg', 'xl', 'display'].map((step) => values(tokens, `--leading-${step}`))).toEqual([
      ['1rem'],
      ['1.25rem'],
      ['1.5rem'],
      ['2rem'],
      ['2.5rem'],
      ['0.9']
    ]);
  });
});

// The reader above is what makes those tests mean something, so it is checked on a sample: a name nobody declares reads as
// nothing, a media-query override is seen (in source order), and neither a longer name nor a var() call is taken for it.
describe('the custom-property reader', () => {
  const sample = `
    :root { --gutter: 16px; --my-gutter: 3px; }
    .page { padding: var(--gutter); }
    @media (min-width: 768px) { :root { --gutter: 32px; } }`;

  it('reads a name that is never declared as no value, and a stale value as absent', () => {
    expect(values(tokens, '--no-such-token')).toEqual([]);
    expect(values(all, '--content-max')).not.toContain('1360px');
    expect(values(sample, '--grid-gap')).toEqual([]);
  });

  it('sees an override inside a media query, in source order', () => {
    expect(values(sample, '--gutter')).toEqual(['16px', '32px']);
  });

  it('does not mistake a longer name or a var() call for the declaration', () => {
    expect(values(sample, '--my-gutter')).toEqual(['3px']);
    expect(values('.a { padding: var(--gutter); }', '--gutter')).toEqual([]);
    expect(values('.a { --x-gutter: 9px; }', '--gutter')).toEqual([]);
  });
});
