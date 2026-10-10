// A term with its meaning (DESIGN.md "Explanation line and terms"): the abbreviation as an <abbr> under a dotted 1px
// underline, in the Tab order, and a tooltip that opens on hover and on keyboard focus. The tooltip is the abbreviation's
// description, so a screen reader hears it without opening it. WCAG 1.4.13: the pointer can move onto the tooltip without
// closing it, and Escape closes it without moving the focus.
import { useId, useState } from 'react';
import type { JSX, KeyboardEvent } from 'react';

export interface TermProps {
  /** The short form shown in the text ("DIO"). */
  abbr: string;
  /** What it means, under 120 characters, without repeating the short form's words. */
  children: string;
}

/** An abbreviation that explains itself on hover and focus. */
export function Term({ abbr, children }: TermProps): JSX.Element {
  const id = useId();
  const [open, setOpen] = useState(false);
  function onKeyDown(e: KeyboardEvent<HTMLElement>): void {
    if (e.key === 'Escape') setOpen(false);
  }
  return (
    <span className="term" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <abbr className="term__abbr" tabIndex={0} aria-describedby={id} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onKeyDown={onKeyDown}>
        {abbr}
      </abbr>
      <span className="term__tip" role="tooltip" id={id} hidden={!open}>
        {children}
      </span>
    </span>
  );
}
