// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
});
