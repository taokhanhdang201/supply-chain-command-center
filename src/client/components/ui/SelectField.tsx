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
  /** Turns the control off (one disabled opacity for every control, components.css). */
  disabled?: boolean;
  /** Hides the label from sight only: it stays the select's accessible name. */
  hideLabel?: boolean;
}

/** A labelled `<select>` filter control. */
export function SelectField({ label, value, options, onChange, disabled = false, hideLabel = false }: SelectFieldProps) {
  const id = useId();
  return (
    <div className="select-field">
      <label className={hideLabel ? 'select-field__label visually-hidden' : 'select-field__label'} htmlFor={id}>
        {label}
      </label>
      <select id={id} className="select-field__control" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}
