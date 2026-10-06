import { useId } from 'react';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectFieldProps {
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
}

/** A labelled `<select>` filter control. */
export function SelectField({ label, value, options, onChange }: SelectFieldProps) {
  const id = useId();
  return (
    <div className="select-field">
      <label className="select-field__label" htmlFor={id}>
        {label}
      </label>
      <select id={id} className="select-field__control" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}
