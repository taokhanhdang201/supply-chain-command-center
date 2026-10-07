// Clipboard paste: a disclosure that reveals a text area. Pasted TSV or CSV text enters the same pipeline as a file
// (it becomes bytes with the name "Pasted data"), so it produces the same result as the equivalent file.

import { useId, useState } from 'react';
import { Icon } from '../ui/Icon';

export interface PasteBoxProps {
  busy: boolean;
  onSubmit: (text: string) => void;
  /** The toggle's text (default "Paste data instead"). */
  label?: string;
}

export function PasteBox({ busy, onSubmit, label = 'Paste data instead' }: PasteBoxProps) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const regionId = useId();
  const fieldId = useId();
  return (
    <div className="ingest-paste">
      <button type="button" className="button" aria-expanded={open} aria-controls={regionId} onClick={() => setOpen((o) => !o)}>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={14} /> {label}
      </button>
      <div id={regionId} hidden={!open}>
        {open && (
          <>
            <label htmlFor={fieldId} className="ingest-field__label">
              Pasted data (copied from a spreadsheet or a text file)
            </label>
            <textarea id={fieldId} className="ingest-textarea" rows={8} spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} />
            <button type="button" className="button button--primary" disabled={busy || text.trim() === ''} onClick={() => onSubmit(text)}>
              Review pasted data
            </button>
          </>
        )}
      </div>
    </div>
  );
}
