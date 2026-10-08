import { useId, useRef } from 'react';
import { Button } from './Button';

export interface SearchInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

/** A labelled search input with a clear button, shown once there is text to clear. */
export function SearchInput({ label, value, onChange, placeholder }: SearchInputProps) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  /** Clearing removes the button itself, so focus goes back to the field instead of falling to <body>. */
  function clear(): void {
    onChange('');
    inputRef.current?.focus();
  }

  return (
    <div className="search-input">
      <label className="search-input__label" htmlFor={id}>
        {label}
      </label>
      <div className="search-input__control">
        <input
          ref={inputRef}
          id={id}
          type="search"
          className="search-input__field"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
        {value !== '' && (
          <Button variant="ghost" size="sm" onClick={clear}>
            Clear search
          </Button>
        )}
      </div>
    </div>
  );
}
