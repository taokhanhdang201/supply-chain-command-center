// Design ratchet (Phase 1 spec section 0d): eight counts of how far the stylesheets are from the design system (type scale,
// weights, spacing scale, tokens, breakpoints, durations). Each `limit` is today's count and may only go DOWN: the commit that
// removes violations lowers its limit in the same commit; a commit that adds one fails here. `target` is where Phase 1 ends.
// The counters are pure functions of the sources, so a sample stylesheet below proves they see a violation.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

type Sheet = { file: string; text: string };
type Decl = { where: string; prop: string; value: string };
type Model = { decls: Decl[]; custom: Map<string, string[]>; widths: Array<{ where: string; px: number }>; ts: Record<string, string> };
type Counted = { scanned: number; offenders: string[] };

const SIZE_SCALE = new Set(['.75rem', '.875rem', '1rem', '1.5rem', '2.25rem', 'clamp(3.5rem, 2.4vw + 3.2rem, 5.5rem)', 'inherit']);
const SPACE_SCALE = new Set([0, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96, 128]);
const BREAKPOINTS = new Set([767, 768, 1023, 1024, 1099, 1100, 1279, 1280, 1439, 1440]);
const DURATIONS_MS = new Set([120, 200, 800]);
const SVG_TEXT_PX = new Set([12, 14]);
const SVG_CONSTANTS = [
  { file: 'src/client/components/charts/chartMetrics.ts', name: 'AXIS_FONT_SIZE' },
  { file: 'src/client/components/atlas/AtlasScene.tsx', name: 'LABEL_PX' },
  { file: 'src/client/components/routes/RouteMap.tsx', name: 'MIN_LABEL_PX' }
];
const WEIGHTS = new Set(['400', '500', '600', 'normal', 'inherit']);
const SIZE_SHORTHAND_SKIP = /^(normal|italic|oblique|small-caps|bold|bolder|lighter|\d+|(ultra-|extra-|semi-)?(condensed|expanded))$/;
const SPACING_PROP = /^(margin|padding)(-[a-z-]+)?$|^(row-|column-)?gap$/;
// `%23` is a `#` inside a data-URI (the select chevrons), so a colour hidden there is as raw as a hex written in the open.
const RAW_COLOUR = /(?:#|%23)[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(/g;
const VAR_CALL = /^var\(\s*(--[\w-]+)\s*(?:,\s*(.+))?\)$/;
const TIME = /^(-?\d*\.?\d+)(ms|s)$/;

const norm = (v: string): string => v.replace(/\s+/g, ' ').replace(/\b0\./g, '.').trim();
const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');
const offender = (d: Decl): string => `${d.where} { ${d.prop}: ${d.value} }`;

/** Split on `,` or on whitespace, but only outside parentheses. */
function splitTop(s: string, sep: ',' | ' '): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (depth === 0 && (sep === ',' ? ch === ',' : /\s/.test(ch))) {
      parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** `14px/1.4` -> `14px`: cut at the first `/` outside parentheses. */
function beforeSlash(token: string): string {
  let depth = 0;
  for (let i = 0; i < token.length; i++) {
    const ch = token[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === '/' && depth === 0) return token.slice(0, i);
  }
  return token;
}

/** A lone `var(--x)` becomes every value `--x` is given anywhere (its fallback if it is never given); anything else stays. */
function resolve(expr: string, custom: Map<string, string[]>, depth = 0): string[] {
  const e = expr.trim();
  const m = VAR_CALL.exec(e);
  if (!m) return [e];
  const given = custom.get(m[1] as string);
  if (given && depth < 10) return given.flatMap((v) => resolve(v, custom, depth + 1));
  if (!given && m[2]) return resolve(m[2], custom, depth + 1);
  return [e];
}

function build(sheets: Sheet[], ts: Record<string, string>): Model {
  const decls: Decl[] = [];
  const custom = new Map<string, string[]>();
  const widths: Model['widths'] = [];
  for (const { file, text } of sheets) {
    const css = stripComments(text);
    const blocks = /([^{}]+)\{([^{}]*)\}/g;
    let m: RegExpExecArray | null;
    while ((m = blocks.exec(css)) !== null) {
      const selector = (m[1] as string).replace(/\s+/g, ' ').trim();
      if (selector.startsWith('@')) continue;
      for (const part of (m[2] as string).split(';')) {
        const colon = part.indexOf(':');
        if (colon < 0) continue;
        const prop = part.slice(0, colon).trim();
        const value = part.slice(colon + 1).replace(/!important/gi, '').replace(/\s+/g, ' ').trim();
        if (prop.startsWith('--')) custom.set(prop, [...(custom.get(prop) ?? []), value]);
        else decls.push({ where: `${file} ${selector}`, prop, value });
      }
    }
    const media = /@media([^{]*)\{/g;
    while ((m = media.exec(css)) !== null) {
      for (const w of (m[1] as string).matchAll(/(?:min-|max-)?width\s*:\s*(\d+(?:\.\d+)?)px/g)) widths.push({ where: `${file} @media${m[1] as string}`.replace(/\s+/g, ' '), px: Number(w[1]) });
    }
  }
  return { decls, custom, widths, ts };
}

/** Every declaration that sets a font size, with the sizes it can resolve to (a `font` shorthand counts by its size token). */
function fontSizes(model: Model): Array<{ decl: Decl; sizes: string[] }> {
  const out: Array<{ decl: Decl; sizes: string[] }> = [];
  for (const decl of model.decls) {
    if (decl.prop === 'font-size') out.push({ decl, sizes: resolve(decl.value, model.custom) });
    else if (decl.prop === 'font' && !/^(inherit|initial|unset|revert)$/.test(decl.value)) {
      const sizes: string[] = [];
      for (const s of resolve(decl.value, model.custom)) {
        const size = splitTop(s, ' ').find((t) => !SIZE_SHORTHAND_SKIP.test(t));
        if (size !== undefined) sizes.push(...resolve(beforeSlash(size), model.custom));
      }
      out.push({ decl, sizes });
    }
  }
  return out;
}

/** Every declaration that sets a font weight, with the weights it can resolve to. In a `font` shorthand the weight comes
 *  before the size, so only the tokens before the size count (a unitless line height after the slash is not a weight). */
function fontWeights(model: Model): Array<{ decl: Decl; weights: string[] }> {
  const out: Array<{ decl: Decl; weights: string[] }> = [];
  for (const decl of model.decls) {
    if (decl.prop === 'font-weight') out.push({ decl, weights: resolve(decl.value, model.custom).map(norm) });
    else if (decl.prop === 'font' && !/^(inherit|initial|unset|revert)$/.test(decl.value)) {
      const weights = resolve(decl.value, model.custom).flatMap((s) => {
        const tokens = splitTop(s, ' ');
        const size = tokens.findIndex((t) => !SIZE_SHORTHAND_SKIP.test(t));
        return (size < 0 ? tokens : tokens.slice(0, size)).filter((t) => /^(\d+|bold|bolder|lighter)$/.test(t));
      });
      out.push({ decl, weights });
    }
  }
  return out;
}

/** Durations in ms. `*-duration` is a list of times; in a shorthand the duration is the FIRST time token (the second is a delay). */
function durations(model: Model): Array<{ decl: Decl; ms: number[] }> {
  const toMs = (v: string): number => {
    const t = TIME.exec(v);
    return t ? Number(t[1]) * (t[2] === 's' ? 1000 : 1) : NaN;
  };
  const out: Array<{ decl: Decl; ms: number[] }> = [];
  for (const decl of model.decls) {
    const isList = decl.prop === 'transition-duration' || decl.prop === 'animation-duration';
    if (!isList && decl.prop !== 'transition' && decl.prop !== 'animation') continue;
    for (const segment of splitTop(decl.value, ',')) {
      const times = isList
        ? resolve(segment, model.custom)
        : splitTop(segment, ' ').map((t) => resolve(t, model.custom)).find((r) => r.some((v) => TIME.test(v)))?.filter((v) => TIME.test(v));
      if (times) out.push({ decl, ms: times.map(toMs) });
    }
  }
  return out;
}

const GROUPS: Array<{ name: string; limit: number; target: number; count: (m: Model) => Counted }> = [
  {
    name: 'font sizes off the six-step scale',
    limit: 0,
    target: 0,
    count: (m) => {
      const sized = fontSizes(m);
      return { scanned: sized.length, offenders: sized.filter((s) => s.sizes.some((v) => !SIZE_SCALE.has(norm(v)))).map((s) => offender(s.decl)) };
    }
  },
  {
    name: 'distinct font sizes',
    limit: 6,
    target: 6,
    count: (m) => {
      const sized = fontSizes(m);
      const distinct = new Set(sized.flatMap((s) => s.sizes.map(norm)).filter((v) => v !== 'inherit'));
      return { scanned: sized.length, offenders: [...distinct].sort() };
    }
  },
  {
    name: 'SVG text sizes not 12 or 14',
    limit: 0,
    target: 0,
    count: (m) => {
      const found = SVG_CONSTANTS.map(({ file, name }) => ({ label: `${file} ${name}`, px: Number(new RegExp(`\\b${name} = ([\\d.]+)`).exec(m.ts[file] ?? '')?.[1]) }));
      return { scanned: found.length, offenders: found.filter((f) => !SVG_TEXT_PX.has(f.px)).map((f) => `${f.label} = ${f.px}`) };
    }
  },
  {
    name: 'margin/padding/gap off the 4/8 scale',
    limit: 2,
    target: 2,
    count: (m) => {
      // var() is not followed, so a spacing held in a custom property is NOT checked here: tokens.test.ts pins those
      // (the gutter and grid-gap steps, the 96/128 steps and the Dashboard's aliases).
      const spacing = m.decls.filter((d) => SPACING_PROP.test(d.prop) && !(d.prop === 'margin' && d.value === '-1px'));
      const off = (d: Decl): boolean => [...d.value.replace(/var\([^()]*\)/g, ' ').matchAll(/(-?\d*\.?\d+)px\b/g)].some((n) => !SPACE_SCALE.has(Math.abs(Number(n[1]))));
      return { scanned: spacing.length, offenders: spacing.filter(off).map(offender) };
    }
  },
  {
    name: 'raw colours outside custom properties',
    limit: 0,
    target: 0,
    count: (m) => ({ scanned: m.decls.length, offenders: m.decls.flatMap((d) => (d.value.match(RAW_COLOUR) ?? []).map((c) => `${offender(d)} -> ${c}`)) })
  },
  {
    name: '@media widths off the breakpoint list',
    limit: 0,
    target: 0,
    count: (m) => ({ scanned: m.widths.length, offenders: m.widths.filter((w) => !BREAKPOINTS.has(w.px)).map((w) => `${w.where} -> ${w.px}px`) })
  },
  {
    name: 'durations other than 120/200/800ms',
    limit: 1,
    target: 1,
    count: (m) => {
      // Under 1ms is "off" (reduced motion); skeleton loops and delays are not transitions and are not counted as delays.
      const timed = durations(m);
      return { scanned: timed.length, offenders: timed.filter((t) => t.ms.some((v) => !(v < 1 || DURATIONS_MS.has(v)))).map((t) => offender(t.decl)) };
    }
  },
  {
    name: 'font weights other than 400/500/600',
    limit: 0,
    target: 0,
    count: (m) => {
      const weighted = fontWeights(m);
      return { scanned: weighted.length, offenders: weighted.filter((w) => w.weights.some((v) => !WEIGHTS.has(v))).map((w) => offender(w.decl)) };
    }
  }
];

const dir = path.resolve('src/client/styles');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.css')).sort();
const real = build(
  files.map((file) => ({ file, text: fs.readFileSync(path.join(dir, file), 'utf8') })),
  Object.fromEntries(SVG_CONSTANTS.map(({ file }) => [file, fs.readFileSync(path.resolve(file), 'utf8')]))
);

describe('design ratchet', () => {
  it('finds the stylesheets', () => {
    expect(files).toEqual(expect.arrayContaining(['atlas.css', 'base.css', 'components.css', 'layout.css', 'pages.css', 'tokens.css']));
  });

  it.each(GROUPS)('$name: at most $limit (Phase 1 target $target)', ({ limit, count }) => {
    const { scanned, offenders } = count(real);
    expect(scanned).toBeGreaterThan(0); // a broken parser must not pass by finding nothing
    expect(offenders.length, offenders.join('\n')).toBeLessThanOrEqual(limit);
  });

  it('counts the violations in a sample stylesheet and none in a clean one', () => {
    const svg = (axis: string, atlas: string, route: string): Record<string, string> => ({
      [SVG_CONSTANTS[0]!.file]: axis,
      [SVG_CONSTANTS[1]!.file]: atlas,
      [SVG_CONSTANTS[2]!.file]: route
    });
    const dirty = build(
      [
        {
          file: 'dirty.css',
          text: `
            :root { --fs-odd: 1.0625rem; --dur-odd: 400ms; }
            .size-px { font-size: 13px; }
            .size-token { font: 500 var(--fs-odd)/1.4 sans-serif; }
            .size-ok { font-size: 0.875rem; }
            .size-inherit { font: inherit; }
            .space-odd { margin: 6px 0; padding: 8px; gap: 1px; }
            .space-ok { margin: -1px; padding: var(--space-2) 16px; }
            .paint { color: #fff; background: rgba(0, 0, 0, 0.5); border-color: var(--line); }
            .chevron { background-image: url("data:image/svg+xml,%3Cpath stroke='%23123456'/%3E"); }
            @media (max-width: 640px) and (min-width: 1024px) { .narrow { margin: 0; } }
            .motion { transition: opacity var(--dur-odd) ease; animation: spin 1.8s linear 300ms; transition-delay: 3s; }
            .heavy { font-weight: 700; } .heavier { font-weight: bold; } .heavy-short { font: 700 0.875rem/1 sans-serif; } .light-short { font: 400 0.875rem/1 sans-serif; }
            .still { transition: color 120ms ease, opacity 200ms ease; animation-duration: 0s; }`
        }
      ],
      svg('const AXIS_FONT_SIZE = 13;', 'no constant here', 'const MIN_LABEL_PX = 11.5;')
    );
    const clean = build(
      [
        {
          file: 'clean.css',
          text: `
            :root { --fs-body: 1rem; --dur-fast: 120ms; }
            .a { font: 500 var(--fs-body)/1.4 sans-serif; font-size: 0.875rem; margin: 8px 16px; gap: var(--space-2); }
            .b { color: var(--ink); transition: opacity var(--dur-fast) ease; }
            .w { font-weight: 600; } .w2 { font: 400 1rem/1 sans-serif; }
            @media (max-width: 767px) { .a { margin: 0; } }`
        }
      ],
      svg('const AXIS_FONT_SIZE = 12;', 'const LABEL_PX = 14;', 'const MIN_LABEL_PX = 12;')
    );
    // Order of GROUPS: sizes off scale, distinct sizes (13px, 1.0625rem, .875rem), SVG, spacing, colours, @media, durations,
    // weights (700, bold, a 700 shorthand; a unitless line height after the size is not a weight).
    expect(GROUPS.map((g) => g.count(dirty).offenders.length)).toEqual([2, 3, 3, 2, 3, 1, 2, 3]);
    expect(GROUPS.map((g) => g.count(clean).offenders.length)).toEqual([0, 2, 0, 0, 0, 0, 0, 0]);
  });
});
