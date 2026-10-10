// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BarChart } from '../../../src/client/components/charts/BarChart';
import { LineChart } from '../../../src/client/components/charts/LineChart';
import { DonutChart } from '../../../src/client/components/charts/DonutChart';
import { ChartFrame } from '../../../src/client/components/charts/ChartFrame';
import { ShareBar } from '../../../src/client/components/charts/ShareBar';
import { STATUS_MARK, STATUS_TONE } from '../../../src/client/components/charts/statusTones';
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
    const toggle = screen.getByRole('button', { name: 'Table' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await user.click(toggle);
    expect(screen.getByRole('button', { name: 'Table' })).toHaveAttribute('aria-pressed', 'true');
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

describe('ChartFrame header', () => {
  const table = { columns: ['Label', 'Value'], rows: [['Alpha', 10]] };

  it('keeps one fixed word on the toggle and flips only aria-pressed, there and back', async () => {
    const user = userEvent.setup();
    render(
      <ChartFrame title="Inventory value by warehouse" isEmpty={false} table={table}>
        <div>chart</div>
      </ChartFrame>
    );
    const toggle = screen.getByRole('button', { name: 'Table' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await user.click(toggle);
    expect(screen.getByRole('button', { name: 'Table' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Table' }));
    expect(screen.getByRole('button', { name: 'Table' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('columnheader', { name: 'Label' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /show data table|hide data table/i })).not.toBeInTheDocument();
  });

  it('puts the title (an h3) and the toggle in one header, in a card that wears chart-card', () => {
    const { container } = render(
      <ChartFrame title="On-time vs delayed by month" isEmpty={false} table={table}>
        <div>chart</div>
      </ChartFrame>
    );
    const header = container.querySelector('.card__header') as HTMLElement;
    expect(header).toContainElement(screen.getByRole('heading', { level: 3, name: 'On-time vs delayed by month' }));
    expect(header).toContainElement(screen.getByRole('button', { name: 'Table' }));
    expect(container.querySelector('.chart-card')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Table' })).toHaveClass('chart-card__toggle');
  });

  it('draws no toggle when there is nothing to chart, and says so', () => {
    render(
      <ChartFrame title="Empty" isEmpty table={table}>
        <div>chart</div>
      </ChartFrame>
    );
    expect(screen.queryByRole('button', { name: 'Table' })).not.toBeInTheDocument();
    expect(screen.getByText('No data for the selected range')).toBeInTheDocument();
  });

  it('puts a month-to-date note under the chart and leaves it out when the note is null', () => {
    const withNote = render(
      <ChartFrame title="Cost" isEmpty={false} table={table} note="Oct* is month to date (Oct 1–7).">
        <div>chart</div>
      </ChartFrame>
    );
    expect(screen.getByText('Oct* is month to date (Oct 1–7).')).toBeInTheDocument();
    withNote.unmount();
    render(
      <ChartFrame title="Cost" isEmpty={false} table={table} note={null}>
        <div>chart</div>
      </ChartFrame>
    );
    expect(screen.queryByText(/month to date/)).not.toBeInTheDocument();
  });
});

describe('ShareBar', () => {
  const asText = (n: number) => String(n);
  const STATUS = [
    { key: 'pending', label: 'Pending', value: 29, tone: 'neutral', mark: 'hatched' },
    { key: 'in_transit', label: 'In transit', value: 42, tone: 'neutral', mark: 'solid' },
    { key: 'delivered', label: 'Delivered', value: 902, tone: 'good', mark: 'solid' },
    { key: 'cancelled', label: 'Cancelled', value: 27, tone: 'neutral', mark: 'hollow' }
  ] as const;

  it('reads each share to one decimal in the legend and in the accessible summary', () => {
    const { container } = render(<ShareBar data={STATUS} valueFormat={asText} ariaLabel="Shipments by status" />);
    expect([...container.querySelectorAll('.share-bar__share')].map((s) => s.textContent)).toEqual(['2.9%', '4.2%', '90.2%', '2.7%']);
    const label = screen.getByRole('img').getAttribute('aria-label') ?? '';
    expect(label).toContain('Pending 29 (2.9%)');
    expect(label).toContain('Delivered 902 (90.2%)');
  });

  it('draws a hatched, a solid and a hollow part, each part and swatch in the form of its mark', () => {
    const { container } = render(<ShareBar data={STATUS} valueFormat={asText} ariaLabel="Shipments by status" />);
    const segments = [...container.querySelectorAll('.share-bar__track .share-bar__segment')];
    expect(segments).toHaveLength(4);
    expect(segments[0]).toHaveClass('share-bar__segment--hatched');
    expect(segments[1]).not.toHaveClass('share-bar__segment--hatched', 'share-bar__segment--hollow');
    expect(segments[3]).toHaveClass('share-bar__segment--hollow');
    const swatches = [...container.querySelectorAll('.share-bar__swatch')];
    expect(swatches[0]).toHaveClass('share-bar__segment--hatched');
    expect(swatches[3]).toHaveClass('share-bar__segment--hollow');
  });

  it('shows 0.0% for every part of an empty status bar and draws no segment', () => {
    const empty = STATUS.map((d) => ({ ...d, value: 0 }));
    const { container } = render(<ShareBar data={empty} valueFormat={asText} ariaLabel="Shipments by status" />);
    expect([...container.querySelectorAll('.share-bar__share')].map((s) => s.textContent)).toEqual(['0.0%', '0.0%', '0.0%', '0.0%']);
    expect(container.querySelectorAll('.share-bar__segment')).toHaveLength(0);
    expect(screen.getByRole('img').getAttribute('aria-label')).not.toMatch(/NaN|Infinity/);
  });

  it('hides a part of 0 from the bar but keeps it in the legend', () => {
    const data = STATUS.map((d) => (d.key === 'cancelled' ? { ...d, value: 0 } : d));
    const { container } = render(<ShareBar data={data} valueFormat={asText} ariaLabel="Shipments by status" />);
    expect(container.querySelectorAll('.share-bar__track .share-bar__segment')).toHaveLength(3);
    const items = [...container.querySelectorAll('.share-bar__item')].map((li) => li.textContent);
    expect(items).toHaveLength(4);
    expect(items[3]).toBe('Cancelled00.0%');
  });
});

describe('STATUS_MARK', () => {
  it('draws pending hatched, cancelled hollow, and in transit and delivered solid', () => {
    expect(STATUS_MARK).toEqual({ pending: 'hatched', in_transit: 'solid', delivered: 'solid', cancelled: 'hollow' });
  });

  it('gives the three neutral statuses three different forms, and delivered the good tone', () => {
    const neutral = (Object.keys(STATUS_TONE) as Array<keyof typeof STATUS_TONE>).filter((s) => STATUS_TONE[s] === 'neutral');
    expect(neutral.sort()).toEqual(['cancelled', 'in_transit', 'pending']);
    expect(new Set(neutral.map((s) => STATUS_MARK[s])).size).toBe(3);
    expect(STATUS_TONE.delivered).toBe('good');
  });
});
