// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { useReducedMotion, useReveal } from '../../../src/client/hooks/useAtlasHooks';

afterEach(() => {
  vi.unstubAllGlobals();
});

function Probe() {
  const reduce = useReducedMotion();
  return <p>{reduce ? 'reduce' : 'full'}</p>;
}

function RevealProbe() {
  const ref = useReveal<HTMLElement>();
  return (
    <section ref={ref} data-testid="chapter">
      <p className="reveal">content</p>
    </section>
  );
}

function stubMatchMedia(matches: boolean) {
  const listeners = new Set<() => void>();
  const query = {
    matches,
    addEventListener: (_: string, cb: () => void) => listeners.add(cb),
    removeEventListener: (_: string, cb: () => void) => listeners.delete(cb)
  };
  vi.stubGlobal('matchMedia', () => query);
  return {
    set(next: boolean) {
      query.matches = next;
      listeners.forEach((cb) => cb());
    }
  };
}

describe('useReducedMotion', () => {
  it('is false when matchMedia is unavailable (static and safe by default)', () => {
    render(<Probe />);
    expect(screen.getByText('full')).toBeInTheDocument();
  });

  it('follows the OS setting, including a change while the page is open', () => {
    const media = stubMatchMedia(true);
    render(<Probe />);
    expect(screen.getByText('reduce')).toBeInTheDocument();
    act(() => media.set(false));
    expect(screen.getByText('full')).toBeInTheDocument();
  });
});

describe('useReveal', () => {
  it('leaves content fully visible when IntersectionObserver is missing', () => {
    render(<RevealProbe />);
    expect(screen.getByTestId('chapter').dataset.reveal).toBeUndefined();
  });

  it('never arms the hidden state under reduced motion', () => {
    stubMatchMedia(true);
    const observe = vi.fn();
    vi.stubGlobal('IntersectionObserver', class { observe = observe; disconnect = vi.fn(); });
    render(<RevealProbe />);
    expect(screen.getByTestId('chapter').dataset.reveal).toBeUndefined();
    expect(observe).not.toHaveBeenCalled();
  });

  it('arms on mount and reveals once when the chapter first intersects', () => {
    let callback: IntersectionObserverCallback = () => undefined;
    const disconnect = vi.fn();
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(cb: IntersectionObserverCallback) {
          callback = cb;
        }
        observe = vi.fn();
        disconnect = disconnect;
      }
    );
    render(<RevealProbe />);
    const chapter = screen.getByTestId('chapter');
    expect(chapter.dataset.reveal).toBe('armed');
    act(() => callback([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(chapter.dataset.reveal).toBe('armed');
    act(() => callback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(chapter.dataset.reveal).toBe('in');
    expect(disconnect).toHaveBeenCalled();
  });
});
