// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BarChart } from '../../../src/client/components/charts/BarChart';
import { LineChart } from '../../../src/client/components/charts/LineChart';
import { DonutChart } from '../../../src/client/components/charts/DonutChart';
import { ChartFrame } from '../../../src/client/components/charts/ChartFrame';
import { Card } from '../../../src/client/components/ui/Card';
import { formatNumber } from '../../../src/shared/format';

const barData = [
  { key: 'a', label: 'Alpha', value: 10 },
  { key: 'b', label: 'Beta', value: 20 }
];

describe('BarChart', () => {
  it('renders one listitem per datum with an aria-label', () => {
    render(<BarChart data={barData} orientation="vertical" valueFormat={formatNumber} ariaLabel="Test bar chart" />);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveAttribute('aria-label', 'Alpha: 10');
    expect(items[1]).toHaveAttribute('aria-label', 'Beta: 20');
  });

  it('shows a tooltip on focus and hides it on blur', async () => {
    const user = userEvent.setup();
    render(<BarChart data={barData} orientation="vertical" valueFormat={formatNumber} ariaLabel="Test bar chart" />);
    const [first] = screen.getAllByRole('listitem');
    await user.tab(); // focuses the first focusable element, the first mark
    expect(screen.getByRole('tooltip')).toHaveTextContent('Alpha: 10');
    fireEvent.blur(first as Element);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('calls onSelect on click and on Enter', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<BarChart data={barData} orientation="vertical" valueFormat={formatNumber} ariaLabel="Test bar chart" onSelect={onSelect} />);
    const items = screen.getAllByRole('listitem');
    await user.click(items[0] as Element);
    expect(onSelect).toHaveBeenCalledWith('a');

    (items[1] as HTMLElement).focus();
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith('b');
  });

  it('shows "No data for the selected range" via ChartFrame when empty', () => {
    render(
      <ChartFrame title="Empty chart" isEmpty table={{ columns: [], rows: [] }}>
        <BarChart data={[]} orientation="vertical" valueFormat={formatNumber} ariaLabel="Empty" />
      </ChartFrame>
    );
    expect(screen.getByText('No data for the selected range')).toBeInTheDocument();
  });

  it('the table toggle shows the accessible data table with rows', async () => {
    const user = userEvent.setup();
    render(
      <ChartFrame
        title="Bar chart"
        isEmpty={false}
        table={{ columns: ['Label', 'Value'], rows: [['Alpha', 10], ['Beta', 20]] }}
      >
        <BarChart data={barData} orientation="vertical" valueFormat={formatNumber} ariaLabel="Test" />
      </ChartFrame>
    );
    const toggle = screen.getByRole('button', { name: 'Show data table' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await user.click(toggle);
    expect(screen.getByRole('button', { name: 'Hide data table' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('columnheader', { name: 'Label' })).toBeInTheDocument();
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('20')).toBeInTheDocument();
  });

  // WCAG 1.3.1: a chart sits under its section's h2 ("Charts" on Analytics), so its card's title is an h3; a Card on its
  // own keeps an h2.
  it('titles a chart one level under its section (h3); a Card is an h2 unless told otherwise', () => {
    render(
      <ChartFrame title="Bar chart" isEmpty={false} table={{ columns: [], rows: [] }}>
        <span />
      </ChartFrame>
    );
    expect(screen.getByRole('heading', { level: 3, name: 'Bar chart' })).toHaveClass('card__title');
    render(<Card title="Restore sample data">x</Card>);
    expect(screen.getByRole('heading', { level: 2, name: 'Restore sample data' })).toHaveClass('card__title');
    render(<Card title="Inner" titleLevel={3}>x</Card>);
    expect(screen.getByRole('heading', { level: 3, name: 'Inner' })).toBeInTheDocument();
  });
});

describe('LineChart', () => {
  it('keeps every mark within the plot area, including a value that overflowed the old tick scale (R-2/R-3)', () => {
    // 12098558 is the reviewer's reproduction case (the real Sep 2026 total shipping cost) which, before the
    // niceTicks fix, produced a top tick of 1e7 — 21% below this value, drawing the mark above the chart's
    // viewBox. Also asserts an axis tick label is actually rendered (R-3: ticks were computed but never shown).
    const { container } = render(
      <LineChart
        points={[
          { label: 'Aug 2026', value: 9_000_000 },
          { label: 'Sep 2026', value: 12_098_558 }
        ]}
        valueFormat={formatNumber}
        ariaLabel="Line"
      />
    );
    const svg = container.querySelector('svg') as SVGSVGElement;
    const [, , viewWidth, viewHeight] = (svg.getAttribute('viewBox') as string).split(' ').map(Number);
    const circles = Array.from(container.querySelectorAll('circle'));
    expect(circles.length).toBe(2);
    for (const circle of circles) {
      const cy = Number(circle.getAttribute('cy'));
      const cx = Number(circle.getAttribute('cx'));
      expect(cy).toBeGreaterThanOrEqual(0);
      expect(cy).toBeLessThanOrEqual(viewHeight as number);
      expect(cx).toBeGreaterThanOrEqual(0);
      expect(cx).toBeLessThanOrEqual(viewWidth as number);
    }
    // At least one Y-axis tick label with a formatted value is rendered (not just computed and discarded).
    expect(container.querySelectorAll('svg text').length).toBeGreaterThan(circles.length);
  });

  it('renders a single point as a dot with no connecting path', () => {
    const { container } = render(<LineChart points={[{ label: 'Jan', value: 5 }]} valueFormat={formatNumber} ariaLabel="Line" />);
    expect(container.querySelector('path')).toBeNull();
    expect(container.querySelector('circle')).not.toBeNull();
  });

  it('renders all-zero values without any NaN in the markup', () => {
    const { container } = render(
      <LineChart points={[{ label: 'Jan', value: 0 }, { label: 'Feb', value: 0 }]} valueFormat={formatNumber} ariaLabel="Line" />
    );
    expect(container.innerHTML).not.toContain('NaN');
  });

  it('renders a path connecting multiple points without NaN', () => {
    const { container } = render(
      <LineChart points={[{ label: 'Jan', value: 5 }, { label: 'Feb', value: 15 }]} valueFormat={formatNumber} ariaLabel="Line" />
    );
    expect(container.querySelector('path')).not.toBeNull();
    expect(container.innerHTML).not.toContain('NaN');
  });
});

describe('DonutChart', () => {
  it('renders a legend with label, value and percentage', () => {
    render(
      <DonutChart
        data={[
          { key: 'a', label: 'Delivered', value: 3 },
          { key: 'b', label: 'Pending', value: 1 }
        ]}
        valueFormat={formatNumber}
        ariaLabel="Status"
      />
    );
    expect(screen.getByText(/Delivered/)).toBeInTheDocument();
    expect(screen.getByText(/75\.0%/)).toBeInTheDocument();
    expect(screen.getByText(/25\.0%/)).toBeInTheDocument();
  });

  it('handles a zero total with an empty message and no legend', () => {
    render(
      <DonutChart
        data={[
          { key: 'a', label: 'Delivered', value: 0 },
          { key: 'b', label: 'Pending', value: 0 }
        ]}
        valueFormat={formatNumber}
        ariaLabel="Status"
      />
    );
    expect(screen.getByText('No data')).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });
});
