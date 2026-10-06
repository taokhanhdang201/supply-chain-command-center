// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { IdText } from '../../../src/client/components/ui/IdText';

describe('IdText', () => {
  it('wraps each shipment id, SKU and warehouse code in a no-wrap span and leaves the text unchanged', () => {
    const text = 'Unusual shipping cost: SHP-100138 · APP-0005 @ WH-ORD';
    const { container } = render(<IdText text={text} />);
    expect([...container.querySelectorAll('.id-code')].map((s) => s.textContent)).toEqual(['SHP-100138', 'APP-0005', 'WH-ORD']);
    expect(container.textContent).toBe(text);
  });

  it('renders text without an id as plain text', () => {
    const { container } = render(<IdText text="Dallas-Fort Worth DC → Houston, TX" />);
    expect(container.querySelectorAll('.id-code')).toHaveLength(0);
    expect(container.textContent).toBe('Dallas-Fort Worth DC → Houston, TX');
  });
});
