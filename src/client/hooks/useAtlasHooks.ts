// Small presentation hooks for the V2 Dashboard: reduced-motion preference, an element's rendered size, and a
// one-time scroll reveal. All three degrade to "static and fully visible" when the browser API is missing (jsdom).

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

const REDUCE_QUERY = '(prefers-reduced-motion: reduce)';

/** True when the user asked for reduced motion. Live: follows the OS setting while the page is open. */
export function useReducedMotion(): boolean {
  const [reduce, setReduce] = useState<boolean>(() => (typeof window.matchMedia === 'function' ? window.matchMedia(REDUCE_QUERY).matches : false));
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia(REDUCE_QUERY);
    const onChange = (): void => setReduce(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return reduce;
}

export interface ElementSize {
  width: number;
  height: number;
}

/** The element's rendered content size, kept current with a ResizeObserver (falls back to `initial`). */
export function useElementSize<T extends Element>(ref: RefObject<T | null>, initial: ElementSize): ElementSize {
  const [size, setSize] = useState<ElementSize>(initial);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = (): void => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) setSize((prev) => (prev.width === rect.width && prev.height === rect.height ? prev : { width: rect.width, height: rect.height }));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

/** One-time reveal for a chapter: its drawings (bars, line, rack fills) draw in when a quarter of the chapter first
 * enters the viewport; text never moves. The hidden starting state (`data-reveal="armed"`) is only applied after mount
 * and only when motion is allowed, so content is never invisible without JavaScript, without IntersectionObserver, or
 * with reduced motion. */
export function useReveal<T extends HTMLElement>(): RefObject<T | null> {
  const ref = useRef<T | null>(null);
  const reduce = useReducedMotion();
  // A layout effect, so a chapter that is already on screen is armed before the first paint and never flashes fully drawn.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || reduce || typeof IntersectionObserver === 'undefined') return undefined;
    el.dataset.reveal = 'armed';
    const observer = new IntersectionObserver(
      (entries) => {
        // A chapter taller than four viewports can never show a quarter of itself: half a viewport of it counts too.
        const seen = (e: IntersectionObserverEntry): boolean =>
          e.isIntersecting && (e.intersectionRatio === undefined || e.intersectionRatio >= 0.25 || (e.rootBounds != null && e.intersectionRect.height >= e.rootBounds.height / 2));
        if (entries.some(seen)) {
          el.dataset.reveal = 'in';
          observer.disconnect();
        }
      },
      { threshold: [0, 0.05, 0.1, 0.15, 0.2, 0.25] }
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      delete el.dataset.reveal;
    };
  }, [reduce]);
  return ref;
}
