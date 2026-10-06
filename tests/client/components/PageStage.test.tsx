// @vitest-environment jsdom
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
});
