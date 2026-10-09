// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { render } from '@testing-library/react';
import { ResultCount } from '../../../src/client/components/ui/ResultCount';
import { EmptyState } from '../../../src/client/components/ui/EmptyState';

// The polite region a screen reader hears the filtered count from. Always mounted, so only its words change.
describe('ResultCount', () => {
  const region = (c: HTMLElement) => c.querySelector('.visually-hidden[aria-live="polite"]') as HTMLElement;

  it.each([
    [0, 'No items match these filters'],
    [1, '1 item matches'],
    [2, '2 items match'],
    [360, '360 items match']
  ])('reads %i as "%s"', (count, words) => {
    const { container } = render(<ResultCount count={count} />);
    expect(region(container).textContent).toBe(words);
    expect(region(container).tagName).toBe('P');
  });

  it('keeps one node, changing only its words, while the count goes to zero and back', () => {
    const { container, rerender } = render(<ResultCount count={5} />);
    const node = region(container);
    rerender(<ResultCount count={0} />);
    expect(region(container)).toBe(node);
    expect(node.textContent).toBe('No items match these filters');
    rerender(<ResultCount count={1} />);
    expect(region(container)).toBe(node);
    expect(node.textContent).toBe('1 item matches');
  });

  it('is hidden from sight and is no status role, so it does not double an empty state', () => {
    const { container } = render(<ResultCount count={3} />);
    expect(region(container)).not.toHaveAttribute('role');
    expect(region(container)).toHaveClass('visually-hidden');
  });
});

// The EmptyState no longer claims its text is announced (a status region inserted with its words is not read by every reader).
describe('EmptyState: no promise of an announcement', () => {
  it('keeps role="status", and its comment no longer promises an announcement', () => {
    const { container } = render(<EmptyState title="Nothing here" />);
    expect(container.querySelector('.empty-state')).toHaveAttribute('role', 'status');
    const source = fs.readFileSync('src/client/components/ui/EmptyState.tsx', 'utf8');
    expect(source).not.toContain('so the change is announced');
    expect(source).toContain('ResultCount');
  });
});
