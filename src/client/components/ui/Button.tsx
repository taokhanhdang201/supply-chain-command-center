// The one button (DESIGN.md §14): always a real <button>, type="button" unless told otherwise, wearing the existing
// .button classes. Navigation stays an <a> (.text-link, .dash-link, or a.button for a link that looks like a button).
import type { ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link';
export type ButtonSize = 'md' | 'sm';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** `secondary` (the default) is the plain `.button`; `link` reads as underlined text but is still a button. */
  variant?: ButtonVariant;
  /** `md` is 36px tall, `sm` 32px. */
  size?: ButtonSize;
  /** Work in progress: aria-busy, and unavailable like `disabled`. The caller changes the label (for example "Undoing…"). */
  busy?: boolean;
}

/** A button with a text label. Native props pass through; the classes name the variant and the size, then the caller's.
 *  Unavailable (`disabled`) or busy, it stays focusable and says so with aria-disabled instead of the disabled attribute: a
 *  button that is focused when it turns off keeps the focus (WCAG 2.4.3: Next on the last page, Refresh, Undo), and its
 *  clicks and key presses are ignored (a submit button does not submit). components.css fades it like a disabled control. */
export function Button({ variant = 'secondary', size = 'md', busy = false, type = 'button', disabled = false, className, children, onClick, ...rest }: ButtonProps) {
  const classes = ['button'];
  if (variant !== 'secondary') classes.push(`button--${variant}`);
  if (size === 'sm') classes.push('button--sm');
  if (className) classes.push(className);
  const off = disabled || busy;
  // aria-busy comes before the native props, so a caller's own aria-busy wins.
  return (
    <button
      aria-busy={busy || undefined}
      {...rest}
      type={type}
      className={classes.join(' ')}
      aria-disabled={off || undefined}
      onClick={off ? (e) => e.preventDefault() : onClick}
    >
      {children}
    </button>
  );
}
