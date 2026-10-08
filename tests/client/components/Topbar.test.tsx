// @vitest-environment jsdom
// DESIGN.md "The page band": the top bar does not repeat the page title (the h1 is the page's only visible title).
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Topbar } from '../../../src/client/components/layout/Topbar';
import { makeSnapshot, TODAY } from '../../helpers/fixtures';

describe('Topbar', () => {
  it('shows the data date, the two source chips and Refresh, and no page title', () => {
    const snapshot = makeSnapshot([], [], { today: TODAY });
    const { container } = render(
      <Topbar today={TODAY} dataSources={snapshot.dataSources} refreshing={false} onRefresh={vi.fn()} drawerOpen={false} onMenuClick={vi.fn()} menuButtonRef={{ current: null }} />
    );
    expect(container.querySelector('.topbar__page-title')).toBeNull();
    expect(screen.queryByRole('heading')).toBeNull();
    expect(container.querySelector('.topbar__date')).toHaveTextContent(/^Data as of /);
    expect(container.querySelectorAll('.topbar__chip')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
  });

  it('keeps the title frame (it pushes the chips and Refresh right) before any data has loaded', () => {
    const { container } = render(
      <Topbar today={null} dataSources={null} refreshing={false} onRefresh={vi.fn()} drawerOpen={false} onMenuClick={vi.fn()} menuButtonRef={{ current: null }} />
    );
    expect(container.querySelector('.topbar__title')).not.toBeNull();
    expect(container.querySelector('.topbar__date')).toBeNull();
    expect(container.querySelector('.topbar__sources')).toBeNull();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
  });
});
