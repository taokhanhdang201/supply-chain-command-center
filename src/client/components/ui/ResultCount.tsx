import type { JSX } from 'react';

/** How many rows the filters leave, read politely by a screen reader. Mounted for as long as the list is, outside the branch
 *  that swaps the table for an empty state: a live region inserted with new content is not read by every screen reader, so
 *  this one is always there and only its words change. */
export function ResultCount({ count }: { count: number }): JSX.Element {
  const words = count === 0 ? 'No items match these filters' : count === 1 ? '1 item matches' : `${count} items match`;
  return (
    <p className="visually-hidden" aria-live="polite">
      {words}
    </p>
  );
}
