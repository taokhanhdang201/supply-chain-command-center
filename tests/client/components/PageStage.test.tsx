// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PageStage } from '../../../src/client/components/layout/PageStage';

describe('PageStage', () => {
  it('renders exactly one level-1 heading named after the title, as a programmatic focus target', () => {
    render(<PageStage title="Dashboard" display={['Supply chain', 'at a glance.']} />);
    const headings = screen.getAllByRole('heading', { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent('Dashboard');
    expect(headings[0]).toHaveAttribute('tabindex', '-1');
  });

  it('renders the display lines inside an aria-hidden element and never as headings', () => {
    const { container } = render(<PageStage title="Dashboard" display={['Supply chain', 'at a glance.']} />);
    const display = container.querySelector('.page-stage__display');
    expect(display).not.toBeNull();
    expect(display).toHaveAttribute('aria-hidden', 'true');
    expect(display).toHaveTextContent('Supply chainat a glance.');
    expect(screen.getAllByRole('heading')).toHaveLength(1);
  });

  it('renders no display element when no display lines are given', () => {
    const { container } = render(<PageStage title="Page not found" variant="compact" />);
    expect(container.querySelector('.page-stage__display')).toBeNull();
    expect(container.querySelector('.page-stage--compact')).not.toBeNull();
  });

  it('renders children inside the stage', () => {
    const { container } = render(
      <PageStage title="Routes">
        <p>Stage content</p>
      </PageStage>
    );
    const body = container.querySelector('.page-stage__body');
    expect(body).not.toBeNull();
    expect(body).toContainElement(screen.getByText('Stage content'));
  });

  it('renders one context line after the h1, as text and never as a heading, and nothing for no or empty context', () => {
    const { container, rerender } = render(<PageStage title="Alerts" context="67 alerts · 57 need attention · 10 info" />);
    const context = container.querySelector('.page-stage__context');
    expect(context?.tagName).toBe('P');
    expect(context).toHaveTextContent('67 alerts · 57 need attention · 10 info');
    expect(screen.getAllByRole('heading')).toHaveLength(1);
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1.compareDocumentPosition(context as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    rerender(<PageStage title="Alerts" context="" />);
    expect(container.querySelector('.page-stage__context')).toBeNull();
    rerender(<PageStage title="Alerts" />);
    expect(container.querySelector('.page-stage__context')).toBeNull();
  });

  it('puts the context line between the h1 row and the display lines', () => {
    const { container } = render(<PageStage title="Alerts" context="One line" display={['Line one', 'line two.']} />);
    const head = container.querySelector('.page-stage__head') as Node;
    const context = container.querySelector('.page-stage__context') as Node;
    const display = container.querySelector('.page-stage__display') as Node;
    expect(head.compareDocumentPosition(context) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(context.compareDocumentPosition(display) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

// DESIGN.md "The page band": a flat dark band whose h1 is the title role; the slim band pads 16px at every width.
describe('the page band in pages.css', () => {
  const css = readFileSync(resolve('src/client/styles/pages.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

  it('is flat: no glow, no rhythm lines, no eyebrow dash, no unused size container', () => {
    const stage = /(?:^|\})\s*\.page-stage\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(stage).toMatch(/background:\s*var\(--stage-bg\)/);
    expect(stage).not.toMatch(/gradient|background-image|background-size/);
    expect(css).not.toMatch(/\.page-stage__title::before/);
    expect(css).not.toMatch(/container-type/);
  });

  it('sets the h1 at 24px / 600 on a 30px line (1.25, not --leading-lg) and pads the slim band 16px at every width', () => {
    expect(css).toMatch(/\.page-stage__title\s*\{[^}]*font:\s*600 var\(--text-lg\) \/ 1\.25 var\(--font-display\)/);
    expect(css).toMatch(/\.page-stage\.page-stage--slim\s*\{\s*padding:\s*var\(--space-4\) var\(--gutter\);\s*\}/);
    expect(css.match(/page-stage--slim\s*\{/g)).toHaveLength(1);
  });
});
