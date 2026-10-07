// Static rules of the V2 Dashboard stylesheet (atlas.css): one system of five type sizes, three weights and two families,
// no uppercase, no decoration (shadows, radii, glow, gradients other than the two measuring ones), no perpetual motion,
// no remote or raster resource, and nothing that can leak out of `.atlas-page` into another page.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const raw = fs.readFileSync(path.resolve('src/client/styles/atlas.css'), 'utf8');
const css = raw.replace(/\/\*[\s\S]*?\*\//g, '');

/** Every `selector { body }` pair, at any nesting depth, without at-rule preludes. */
function rules(): Array<{ selector: string; body: string }> {
  const out: Array<{ selector: string; body: string }> = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) out.push({ selector: (m[1] as string).trim(), body: m[2] as string });
  return out.filter((r) => !r.selector.startsWith('@'));
}

describe('atlas.css', () => {
  it('has no uppercase text, shadow, radius, glow or infinite animation', () => {
    expect(css).not.toMatch(/text-transform:\s*uppercase/);
    expect(css).not.toMatch(/box-shadow|text-shadow|border-radius|filter:\s*blur|drop-shadow/);
    expect(css).not.toMatch(/infinite/);
    expect(css).not.toMatch(/radial-gradient|conic-gradient/);
  });

  it('loads nothing remote and ships no raster image', () => {
    expect(css).not.toMatch(/url\(/);
    expect(css).not.toMatch(/https?:\/\//);
    expect(raw).not.toMatch(/\.(png|jpe?g|gif|webp|avif|bmp)\b/i);
  });

  it('uses linear gradients only for the hero gauge and the rack tiers', () => {
    const gradients = rules().filter((r) => /gradient\(/.test(r.body));
    expect(gradients.length).toBeGreaterThan(0);
    for (const g of gradients) expect(g.selector, g.body).toMatch(/hero__gauge|rack__frame/);
  });

  it('defines exactly five type sizes and every text size uses one of them', () => {
    // V2 wave 2: the on-time figure moved inside the lane map at display size, so the separate hero size is gone.
    const tokens = [...new Set([...css.matchAll(/^\s*--fs-([a-z0-9]+):/gm)].map((m) => m[1]))];
    expect(tokens.sort()).toEqual(['display', 'figure', 'h2', 'lead', 'small'].sort());
    const sizes: string[] = [];
    for (const { selector, body } of rules()) {
      for (const m of body.matchAll(/font-size:\s*([^;]+)/g)) sizes.push(`${selector} { font-size: ${(m[1] as string).trim()} }`);
      for (const m of body.matchAll(/(?:^|;)\s*font:\s*[a-z0-9]+\s+([^\s/;]+)/g)) sizes.push(`${selector} { font: ${(m[1] as string).trim()} }`);
    }
    expect(sizes.length).toBeGreaterThan(20);
    for (const s of sizes) expect(s, s).toMatch(/var\(--fs-(display|figure|h2|lead|small)\)|^[^{]*\{ font-size: inherit/);
  });

  it('uses only weights 400, 500 and 600 and only the two font families', () => {
    for (const m of css.matchAll(/font-weight:\s*(\d+)/g)) expect(['400', '500', '600']).toContain(m[1]);
    for (const m of css.matchAll(/(?:^|;)\s*font:\s*(\d+)\s/gm)) expect(['400', '500', '600']).toContain(m[1]);
    for (const m of css.matchAll(/font-family:\s*([^;]+)/g)) expect(m[1]).toMatch(/^var\(--font-(sans|display)\)$/);
    for (const m of css.matchAll(/var\(--font-(?!sans\)|display\))[a-z]+\)/g)) throw new Error(`unexpected font family ${m[0]}`);
  });

  it('scopes every rule to .atlas-page so no other page can change', () => {
    for (const { selector } of rules()) {
      if (/^(from|to|\d+%)$/.test(selector)) continue; // keyframe steps
      // Split on top-level commas only (`:is(a, b)` keeps its commas).
      for (const part of selector.split(/,(?![^(]*\))/)) expect(part.trim(), selector).toMatch(/^\.atlas-page\b/);
    }
  });

  it('reveals the bar stack as a unit: no separate delay for the red segment', () => {
    expect(css).toMatch(/\.flow-stack\s*\{[^}]*transform-origin/);
    expect(css).not.toMatch(/flow-bar--delayed\s*\{[^}]*transition-delay/);
    expect(css).not.toMatch(/\.flow-bar\s*\{[^}]*transform/);
  });

  it('keeps the ledger header colour the same for every column (dates are only quietened in the body)', () => {
    for (const { selector, body } of rules()) {
      if (/activity__date/.test(selector) && /color:/.test(body)) expect(selector, selector).toMatch(/tbody/);
    }
  });

  it('gives phones 44px touch targets to links, toggles and status rows without changing layout', () => {
    expect(css).toMatch(/\.dash-link::after\s*\{[^}]*inset:\s*-12px 0/);
    expect(css).toMatch(/\.flow-figure__toggle::after\s*\{[^}]*inset:\s*-12px 0/);
    expect(css).toMatch(/\.status-list__link\s*\{[^}]*min-height:\s*44px/);
  });

  it('draws the status block after the figures at every width: a label, one inline row from 1100px, a 2 x 2 block below', () => {
    expect(css).toMatch(/\.status-label\s*\{[^}]*margin-top:\s*24px/);
    // Tablet: label on its own row, list on the row after it.
    expect(css).toMatch(/\.status-label\s*\{\s*grid-column:\s*1 \/ -1;\s*grid-row:\s*2/);
    expect(css).toMatch(/\.status-list\s*\{\s*grid-column:\s*1 \/ span 6;\s*grid-row:\s*3/);
    // Desktop: label and list share one row, the list on columns 4-11 in four equal cells.
    expect(css).toMatch(/\.status-label\s*\{[^}]*grid-column:\s*1 \/ span 3;[^}]*grid-row:\s*2/);
    expect(css).toMatch(/\.status-list\s*\{\s*grid-column:\s*4 \/ span 8;\s*grid-row:\s*2;\s*grid-template-columns:\s*repeat\(4/);
    // No leftover placement under the first figure.
    expect(css).not.toMatch(/\.status-list\s*\{[^}]*grid-column:\s*1 \/ span 3/);
  });

  // Top alerts moved from the dark stage to paper (docs/DASHBOARD-ALERTS.md §9): its rules read only paper inks (the dark
  // --stage-* inks would be unreadable there), its separators use muted ink (AA on the hover tint), and one rule separates
  // it from Flow, the paper scene after it.
  it('draws Top alerts with paper inks only and rules it off from Flow', () => {
    const block = rules().filter((r) => /\.attention|\.queue|\.alert-glyph/.test(r.selector));
    expect(block.length).toBeGreaterThan(10);
    for (const r of block) expect(r.body, r.selector).not.toMatch(/--stage-/);
    expect(css).toMatch(/\.attention \+ \.flow\s*\{\s*border-top:\s*1px solid var\(--color-line-strong\)/);
    expect(css).toMatch(/\.queue-row__sep\s*\{\s*color:\s*var\(--color-text-muted\)/);
  });

  it('gives the two bar segments a lightness difference, not only a hue difference', () => {
    expect(css).toMatch(/--bar-slate:\s*#2e3743/);
    expect(css).toMatch(/\.flow-bar--ontime\s*\{[^}]*fill:\s*var\(--bar-slate\)/);
  });

  it('hides the h1 on phones with the visually-hidden technique, never display:none', () => {
    expect(css).toMatch(/max-width:\s*767px\)\s*\{\s*\.atlas-page \.situation__title\s*\{[^}]*clip:\s*rect\(0, 0, 0, 0\)/);
    expect(css).not.toMatch(/situation__title[^}]*display:\s*none/);
  });

  it('shows the ledger as one row per shipment from 1280px and on a 24-track grid from 1440px', () => {
    expect(css).toMatch(/@media \(min-width: 1280px\)\s*\{\s*\.atlas-page \.activity thead/);
    expect(css).toMatch(/@media \(min-width: 1440px\)\s*\{\s*\.atlas-page \.activity tr,[^}]*repeat\(24, minmax\(0, 1fr\)\)/);
  });

  it('animates only transform, opacity, clip-path and stroke-dashoffset, and keeps reduced motion in view', () => {
    expect(css).toMatch(/prefers-reduced-motion:\s*no-preference/);
    for (const m of css.matchAll(/transition:\s*([^;]+);/g)) {
      const props = (m[1] as string).split(',').map((p) => p.trim().split(/\s+/)[0]);
      for (const p of props) expect(['transform', 'opacity', 'clip-path', 'stroke-dashoffset', 'color', 'text-decoration-color', 'border-color', 'fill']).toContain(p);
    }
    // Everything that moves is behind the no-preference query: no keyframe use outside of it.
    const outside = css.replace(/@media \(prefers-reduced-motion: no-preference\)\s*\{[\s\S]*?\n\}\n/g, '').replace(/@media \(max-width: 767px\) and \(prefers-reduced-motion: no-preference\)\s*\{[\s\S]*?\n\}\n/g, '');
    expect(outside).not.toMatch(/animation:/);
  });

  it('colours the hero gauge remainder by tone: amber for warning, red only for critical, grey otherwise', () => {
    const gauge = (tone: string) => rules().filter((r) => r.selector === `.atlas-page .hero__gauge--${tone}`);
    const warning = gauge('warning');
    const critical = gauge('critical');
    expect(warning).toHaveLength(1);
    expect(critical).toHaveLength(1);
    expect(warning[0]!.body).toMatch(/var\(--warning\)/);
    expect(warning[0]!.body).not.toMatch(/--signal|--critical/);
    expect(critical[0]!.body).toMatch(/var\(--signal\)|var\(--critical\)/);
    // the base gauge (good and neutral) uses no semantic colour at all (its other rule only animates it)
    const base = rules().filter((r) => r.selector === '.atlas-page .hero__gauge' && /background/.test(r.body));
    expect(base).toHaveLength(1);
    expect(base[0]!.body).not.toMatch(/--signal|--critical|--warning/);
    // and no other rule ever gives a gauge the red
    for (const r of rules().filter((x) => /hero__gauge/.test(x.selector) && x.selector !== '.atlas-page .hero__gauge--critical')) {
      expect(r.body, r.selector).not.toMatch(/--signal|--critical/);
    }
  });

  it('late lanes fade in instead of drawing, because they are dashed and the draw is dash-based', () => {
    const critical = rules().filter((r) => /\.atlas--animate \.atlas__lane--critical$/.test(r.selector));
    expect(critical).toHaveLength(1);
    expect(critical[0]!.body).toMatch(/animation:\s*atlas-fade\b/);
    expect(critical[0]!.body).not.toMatch(/atlas-draw/);
    // the other lanes still draw in
    const lanes = rules().find((r) => /\.atlas--animate \.atlas__lane$/.test(r.selector));
    expect(lanes?.body).toMatch(/animation:\s*atlas-draw\b/);
  });
});
