// DESIGN.md section 10: labels are sentence case, never uppercase. atlasCss.test.ts already checks the Dashboard sheet;
// this checks every stylesheet, so a shared component (badge, table header, select label, page stage) cannot bring
// capitals back to any page.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = path.resolve('src/client/styles');
const sheets = fs.readdirSync(dir).filter((f) => f.endsWith('.css'));

describe('no stylesheet turns text into capitals', () => {
  it('finds the stylesheets', () => {
    expect(sheets).toEqual(expect.arrayContaining(['atlas.css', 'base.css', 'components.css', 'layout.css', 'pages.css', 'tokens.css']));
  });

  it.each(sheets)('%s has no text-transform: uppercase or capitals font variant', (sheet) => {
    const css = fs.readFileSync(path.join(dir, sheet), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).not.toMatch(/text-transform:\s*(uppercase|capitalize)/);
    expect(css).not.toMatch(/font-variant(-caps)?:\s*[^;]*(small-caps|all-small-caps|all-petite-caps|titling-caps)/);
  });
});
