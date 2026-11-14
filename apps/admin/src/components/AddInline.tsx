import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiError } from '../lib/api.ts';
import { Icon } from './Icon.tsx';

/**
 * "+ New …" control that opens an inline row right where the owner is choosing, adds the value and selects it.
 * No modal: the choice they were making stays on screen.
 */
export function AddInline({ label, placeholder, onAdd, extra, maxLength = 40, compact = false }: {
  label: string; placeholder?: string; onAdd: (value: string) => Promise<unknown> | unknown; extra?: ReactNode; maxLength?: number; compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) input.current?.focus(); }, [open]);

  const submit = async () => {
    const v = value.trim();
    if (!v) { setErr('Type a name first'); return; }
    setBusy(true); setErr('');
    try { await onAdd(v); setValue(''); setOpen(false); }
    catch (e) { setErr(e instanceof ApiError || e instanceof Error ? e.message : 'Could not add. Try again.'); }
    finally { setBusy(false); }
  };

  if (!open) {
    return (
      <button type="button" className={compact ? 'add-chip add-chip--compact' : 'add-chip'} onClick={() => setOpen(true)}>
        <Icon name="plus" size={16} /> {label}
      </button>
    );
  }
  return (
    <div className="add-row" role="group" aria-label={label}>
      <input ref={input} className="input" value={value} maxLength={maxLength} placeholder={placeholder}
        onChange={(e) => { setValue(e.target.value); setErr(''); }}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void submit(); } if (e.key === 'Escape') setOpen(false); }} aria-label={placeholder ?? label} />
      {extra}
      <button type="button" className="btn" onClick={submit} disabled={busy}>{busy ? 'Adding…' : 'Add'}</button>
      <button type="button" className="btn btn--quiet" onClick={() => { setOpen(false); setErr(''); }}>Cancel</button>
      {err && <p className="err" role="alert" style={{ flexBasis: '100%' }}>{err}</p>}
    </div>
  );
}

/** Custom colour: a name and a colour picker, previewed as the swatch shoppers will see. */
export function AddColour({ onAdd }: { onAdd: (c: { label: string; hex: string }) => Promise<unknown> | unknown }) {
  const [hex, setHex] = useState('#8E2236');
  return (
    <AddInline label="Custom colour" placeholder="Colour name, e.g. Bottle Green" maxLength={30}
      onAdd={(label) => onAdd({ label, hex: hex.toUpperCase() })}
      extra={
        <label className="colour-pick" title="Pick the colour">
          <span className="sr-only">Colour</span>
          <input type="color" value={hex} onChange={(e) => setHex(e.target.value)} />
          <span className="colour-pick__swatch" style={{ background: hex }} aria-hidden="true" />
        </label>
      } />
  );
}
