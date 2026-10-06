// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { RouteLabel } from '../../../src/client/components/ui/RouteLabel';

describe('RouteLabel', () => {
  it('keeps the text identical and marks the arrow when the label has exactly one arrow', () => {
    const label = 'Newark DC → Miami, FL';
    const { container } = render(<RouteLabel label={label} />);
    expect(container.textContent).toBe(label);
    expect(container.querySelector('.route-arrow')).not.toBeNull();
  });

  it('renders labels without an arrow, or with more than one, as raw text', () => {
    const none = render(<RouteLabel label="Unmapped" />);
    expect(none.container.textContent).toBe('Unmapped');
    expect(none.container.querySelector('.route-arrow')).toBeNull();

    const two = render(<RouteLabel label="A → B → C" />);
    expect(two.container.textContent).toBe('A → B → C');
    expect(two.container.querySelector('.route-arrow')).toBeNull();
  });
});
