// The one button (Phase 1 spec §6): always a real <button>, type="button" unless told otherwise, wearing the existing
// .button classes. Navigation stays an <a> (.text-link, .dash-link, or a.button for a link that looks like a button).
import type { ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link';
export type ButtonSize = 'md' | 'sm';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** `secondary` (the default) is the plain `.button`; `link` reads as underlined text but is still a button. */
  variant?: ButtonVariant;
  /** `md` is 36px tall, `sm` 32px. */
  size?: ButtonSize;
  /** Work in progress: aria-busy and disabled. The caller changes the label (for example "Undoing…"). */
  busy?: boolean;
}

/** A button with a text label. Native props pass through; the classes name the variant and the size, then the caller's. */
export function Button({ variant = 'secondary', size = 'md', busy = false, type = 'button', disabled, className, children, ...rest }: ButtonProps) {
  const classes = ['button'];
  if (variant !== 'secondary') classes.push(`button--${variant}`);
  if (size === 'sm') classes.push('button--sm');
  if (className) classes.push(className);
  return (
    <button {...rest} type={type} className={classes.join(' ')} disabled={disabled || busy} aria-busy={busy || undefined}>
      {children}
    </button>
  );
}
