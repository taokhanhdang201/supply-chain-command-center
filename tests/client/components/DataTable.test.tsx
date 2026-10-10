// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ReactElement } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FlowFigure } from '../../../src/client/components/atlas/FlowCharts';
import { ChartFrame } from '../../../src/client/components/charts/ChartFrame';
import { ImportIssueTable } from '../../../src/client/components/import/ImportIssueTable';
import { DataTable, type Column } from '../../../src/client/components/ui/DataTable';

interface Row {
  id: string;
  name: string;
  qty: number;
}

const columns: Column<Row>[] = [
  { key: 'name', header: 'Name', render: (r) => r.name, sortable: true },
  { key: 'qty', header: 'Qty', render: (r) => String(r.qty), sortable: true, align: 'right' }
];

const rows: Row[] = [
  { id: 'a', name: 'Alpha', qty: 3 },
  { id: 'b', name: 'Beta', qty: 1 }
];

describe('DataTable', () => {
  it('renders the caption (visually hidden) and column headers', () => {
    render(<DataTable caption="Items" columns={columns} rows={rows} rowKey={(r) => r.id} />);
    expect(screen.getByText('Items')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /name/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /qty/i })).toBeInTheDocument();
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
  });

  it('sets aria-sort and toggles direction on repeated clicks', async () => {
    const user = userEvent.setup();
    const onSortChange = vi.fn();
    const { rerender } = render(
      <DataTable caption="Items" columns={columns} rows={rows} rowKey={(r) => r.id} onSortChange={onSortChange} />
    );

    const nameHeader = screen.getByRole('columnheader', { name: /name/i });
    expect(nameHeader).toHaveAttribute('aria-sort', 'none');

    await user.click(screen.getByRole('button', { name: /name/i }));
    expect(onSortChange).toHaveBeenCalledWith({ key: 'name', direction: 'asc' });

    rerender(
      <DataTable
        caption="Items"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        sort={{ key: 'name', direction: 'asc' }}
        onSortChange={onSortChange}
      />
    );
    expect(screen.getByRole('columnheader', { name: /name/i })).toHaveAttribute('aria-sort', 'ascending');

    await user.click(screen.getByRole('button', { name: /name/i }));
    expect(onSortChange).toHaveBeenLastCalledWith({ key: 'name', direction: 'desc' });
  });

  it('sorts a newly-clicked column ascending regardless of the previous column\'s direction', async () => {
    const user = userEvent.setup();
    const onSortChange = vi.fn();
    render(
      <DataTable
        caption="Items"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        sort={{ key: 'name', direction: 'desc' }}
        onSortChange={onSortChange}
      />
    );
    await user.click(screen.getByRole('button', { name: /qty/i }));
    expect(onSortChange).toHaveBeenCalledWith({ key: 'qty', direction: 'asc' });
  });

  it('renders the empty state when there are no rows', () => {
    render(
      <DataTable caption="Items" columns={columns} rows={[]} rowKey={(r) => r.id} emptyState={<span>No results match your filters</span>} />
    );
    expect(screen.getByText('No results match your filters')).toBeInTheDocument();
  });

  // WCAG 2.4.7: a stacking table hides its header row below 1100px (to 1279px on the three ledgers) and its sort
  // buttons leave the Tab order there (CSS), so each sortable header also carries its name as plain text, shown only then.
  it('a stacking table gives each sortable header its name as plain text too; a plain table does not', () => {
    const stacked = render(<DataTable caption="Items" columns={columns} rows={rows} rowKey={(r) => r.id} stackOnPhone />);
    expect([...document.querySelectorAll('th .data-table__sort-label')].map((s) => s.textContent)).toEqual(['Name', 'Qty']);
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Name', 'Qty']);
    stacked.unmount();
    render(<DataTable caption="Items" columns={columns} rows={rows} rowKey={(r) => r.id} />);
    expect(document.querySelector('.data-table__sort-label')).toBeNull();
  });
});

// DESIGN.md §12: a number column is right-aligned with tabular figures. jsdom applies the real components.css but skips its
// @media blocks, so this is the wide layout; the stacked layouts are measured in v16.ui.browser.test.ts.
describe('number columns', () => {
  const componentsCss = readFileSync(resolve('src/client/styles/components.css'), 'utf8');
  const TABLE = { columns: ['Month', 'Total cost', 'Shipments'], rows: [['Sep 2026', '$1,285.04', 12]] };
  const RIGHT = {
    headers: ['', 'data-table__header--right', 'data-table__header--right'],
    cells: ['', 'data-table__cell--right', 'data-table__cell--right']
  };

  /** The class names of the data table's header cells and cells, once its toggle is pressed ("Table" on a chart card,
   *  "Show data table" on the Dashboard's Flow figures). */
  async function dataTableClasses(ui: ReactElement, toggle = 'Table') {
    const user = userEvent.setup();
    render(ui);
    await user.click(screen.getByRole('button', { name: toggle }));
    return {
      headers: screen.getAllByRole('columnheader').map((h) => h.className),
      cells: screen.getAllByRole('cell').map((c) => c.className)
    };
  }

  it('right-aligns a column declared align right, header included, and keeps tabular figures; other columns stay left (real components.css)', () => {
    const style = document.createElement('style');
    style.textContent = componentsCss;
    document.head.appendChild(style);
    try {
      render(<DataTable caption="Items" columns={columns} rows={rows} rowKey={(r) => r.id} />);
      const header = getComputedStyle(screen.getByRole('columnheader', { name: /qty/i }));
      const cell = getComputedStyle(screen.getByText('3').closest('td') as HTMLElement);
      expect(header.textAlign).toBe('right');
      expect(header.fontVariantNumeric).toBe('tabular-nums');
      expect(cell.textAlign).toBe('right');
      expect(cell.fontVariantNumeric).toBe('tabular-nums');
      const name = getComputedStyle(screen.getByText('Alpha').closest('td') as HTMLElement);
      expect(name.textAlign).toBe('left');
      expect(getComputedStyle(screen.getByRole('columnheader', { name: /name/i })).textAlign).toBe('left');
    } finally {
      style.remove();
    }
  });

  it('keeps a stacked record\'s numbers at the left, under their labels, with a rule that beats the number column rule', () => {
    const css = componentsCss.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).toMatch(/\.data-table--stack tbody td\.data-table__cell--right\s*\{\s*text-align:\s*left;\s*\}/);
  });

  it('puts the stacked-record rule inside the max-width 1099px block, after the number column rule it undoes', () => {
    const css = componentsCss.replace(/\/\*[\s\S]*?\*\//g, '');
    const numberRule = css.indexOf('.data-table td.data-table__cell--right');
    const stackRule = css.indexOf('.data-table--stack tbody td.data-table__cell--right');
    const media = css.lastIndexOf('@media (max-width: 1099px)', stackRule);
    expect(numberRule).toBeGreaterThanOrEqual(0);
    expect(media).toBeGreaterThan(numberRule);
    expect(stackRule).toBeGreaterThan(media);
  });

  it('the chart data table right-aligns every column after the first, the first column names the row', async () => {
    const classes = await dataTableClasses(
      <ChartFrame title="Shipping cost" isEmpty={false} table={TABLE}>
        <div>chart</div>
      </ChartFrame>
    );
    expect(classes.headers).toEqual(RIGHT.headers);
    expect(classes.cells).toEqual(RIGHT.cells);
  });

  it('the Flow data table right-aligns every column after the first, the first column names the row', async () => {
    const classes = await dataTableClasses(
      <FlowFigure title="Shipping cost" isEmpty={false} table={TABLE}>
        <div>chart</div>
      </FlowFigure>,
      'Show data table'
    );
    expect(classes.headers).toEqual(RIGHT.headers);
    expect(classes.cells).toEqual(RIGHT.cells);
  });

  it('a chart data table of one column has only its row-naming column, left', async () => {
    const classes = await dataTableClasses(
      <ChartFrame title="Months" isEmpty={false} table={{ columns: ['Month'], rows: [['Sep 2026']] }}>
        <div>chart</div>
      </ChartFrame>
    );
    expect(classes.headers).toEqual(['']);
    expect(classes.cells).toEqual(['']);
  });

  it('the import problem table right-aligns the Line column ("File" too) and leaves Column and Problem at the left', () => {
    render(
      <ImportIssueTable
        caption="Import errors"
        issues={[
          { line: 12, column: 'quantity', code: 'INVALID_NUMBER', message: 'Not a number.' },
          { line: null, column: null, code: 'EMPTY_FILE', message: 'The file is empty.' }
        ]}
      />
    );
    expect(screen.getByRole('columnheader', { name: 'Line' })).toHaveClass('data-table__header--right');
    expect(screen.getByRole('columnheader', { name: 'Column' })).not.toHaveClass('data-table__header--right');
    expect(screen.getByRole('columnheader', { name: 'Problem' })).not.toHaveClass('data-table__header--right');
    expect(screen.getByText('12')).toHaveClass('data-table__cell--right');
    expect(screen.getByText('File')).toHaveClass('data-table__cell--right');
    expect(screen.getByText('quantity')).not.toHaveClass('data-table__cell--right');
    expect(screen.getByText('Not a number.')).toHaveClass('data-table__cell--wrap');
    expect(screen.getByText('Not a number.')).not.toHaveClass('data-table__cell--right');
  });
});

describe('table variants', () => {
  it('renders no sort button in a static table even for a sortable column, and a click on the header does nothing', async () => {
    const user = userEvent.setup();
    const onSortChange = vi.fn();
    const { container } = render(
      <DataTable caption="Recent" columns={columns} rows={rows} rowKey={(r) => r.id} variant="static" sort={{ key: 'name', direction: 'asc' }} onSortChange={onSortChange} />
    );
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(container.querySelector('.data-table__sort-button')).toBeNull();
    expect(container.querySelector('table')).toHaveClass('data-table--static');
    // A header that cannot be sorted does not claim a sort order either.
    for (const th of container.querySelectorAll('th')) expect(th).not.toHaveAttribute('aria-sort');
    await user.click(screen.getByRole('columnheader', { name: 'Name' }));
    expect(onSortChange).not.toHaveBeenCalled();
    expect(screen.getByText('Alpha')).toBeInTheDocument();
  });

  it('keeps the plain table as it was: no variant class, sort buttons on sortable columns', () => {
    const { container } = render(<DataTable caption="Items" columns={columns} rows={rows} rowKey={(r) => r.id} />);
    expect(container.querySelector('table')?.className).toBe('data-table');
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Name', 'Qty']);
  });

  it('marks a compact table and only a compact one', () => {
    const compact = render(<DataTable caption="Items" columns={columns} rows={rows} rowKey={(r) => r.id} density="compact" />);
    expect(compact.container.querySelector('table')).toHaveClass('data-table--compact');
    compact.unmount();
    const regular = render(<DataTable caption="Items" columns={columns} rows={rows} rowKey={(r) => r.id} density="regular" />);
    expect(regular.container.querySelector('table')).not.toHaveClass('data-table--compact');
  });

  it('combines the static and compact variants without losing either class', () => {
    const { container } = render(<DataTable caption="Items" columns={columns} rows={rows} rowKey={(r) => r.id} variant="static" density="compact" />);
    const cls = container.querySelector('table')?.className.split(' ');
    expect(cls).toEqual(expect.arrayContaining(['data-table', 'data-table--static', 'data-table--compact']));
  });
});

describe('stacked rows', () => {
  interface Cell {
    id: string;
    token: string;
    value: string | null;
  }
  const cols: Column<Cell>[] = [
    { key: 'token', header: 'Token', render: (r) => r.token },
    { key: 'value', header: 'Value', render: (r) => r.value }
  ];
  const cells: Cell[] = [
    { id: 'a', token: '--text-lg', value: '20px' },
    { id: 'b', token: '--text-sm', value: null },
    { id: 'c', token: '--text-xs', value: '' }
  ];

  it('gives the table, rows and cells explicit roles and puts the column header on each cell as its label', () => {
    render(<DataTable caption="Type roles" columns={cols} rows={cells} rowKey={(r) => r.id} stackedRows />);
    expect(screen.getByRole('table', { name: 'Type roles' })).toHaveClass('data-table--stacked');
    expect(screen.getAllByRole('row')).toHaveLength(4);
    const first = screen.getAllByRole('row')[1] as HTMLElement;
    const [token, value] = within(first).getAllByRole('cell');
    expect(token).toHaveAttribute('data-label', 'Token');
    expect(value).toHaveAttribute('data-label', 'Value');
  });

  it('keeps the visible label out of the cell text, so a screen reader hears the column header once', () => {
    render(<DataTable caption="Type roles" columns={cols} rows={cells} rowKey={(r) => r.id} stackedRows />);
    const first = screen.getAllByRole('row')[1] as HTMLElement;
    expect(first).toHaveTextContent('--text-lg20px');
    expect(first.textContent).not.toContain('Token');
    expect(first.textContent).not.toContain('Value');
  });

  it('shows a dash for an empty cell and says "No value" to a screen reader', () => {
    render(<DataTable caption="Type roles" columns={cols} rows={cells} rowKey={(r) => r.id} stackedRows />);
    const rowsAll = screen.getAllByRole('row');
    for (const row of [rowsAll[2], rowsAll[3]] as HTMLElement[]) {
      const empty = within(row).getAllByRole('cell')[1] as HTMLElement;
      const dash = empty.querySelector('[aria-hidden="true"]');
      expect(dash?.textContent).toBe('—');
      expect(empty.querySelector('.visually-hidden')?.textContent).toBe('No value');
    }
    // A cell with a value shows neither.
    const full = within(rowsAll[1] as HTMLElement).getAllByRole('cell')[1] as HTMLElement;
    expect(full.textContent).toBe('20px');
    expect(full.querySelector('.visually-hidden')).toBeNull();
  });

  it('draws the empty state across all columns when there are no rows', () => {
    render(<DataTable caption="Type roles" columns={cols} rows={[]} rowKey={(r) => r.id} stackedRows emptyState={<span>Nothing here</span>} />);
    expect(screen.getByText('Nothing here').closest('td')).toHaveAttribute('colspan', '2');
  });

  it('adds no labels, roles or dashes to a table that is not stacked', () => {
    const { container } = render(<DataTable caption="Type roles" columns={cols} rows={cells} rowKey={(r) => r.id} />);
    expect(container.querySelector('[data-label]')).toBeNull();
    expect(container.querySelector('table')).not.toHaveAttribute('role');
    expect(container.querySelector('.data-table__no-value')).toBeNull();
  });
});
