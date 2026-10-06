import { useId } from 'react';

export interface SearchInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

/** A labelled search input with a clear button, shown once there is text to clear. */
export function SearchInput({ label, value, onChange, placeholder }: SearchInputProps) {
  const id = useId();
  return (
    <div className="search-input">
      <label className="search-input__label" htmlFor={id}>
        {label}
      </label>
      <div className="search-input__control">
        <input
          id={id}
          type="search"
          className="search-input__field"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
        {value !== '' && (
          <button type="button" className="search-input__clear" onClick={() => onChange('')}>
            Clear search
          </button>
        )}
      </div>
    </div>
  );
}
