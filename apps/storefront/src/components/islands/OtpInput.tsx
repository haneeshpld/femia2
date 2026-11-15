import { useEffect, useRef, type ClipboardEvent, type KeyboardEvent } from 'react';

/** Six digit boxes: auto-advance, backspace goes back, paste fills all, phones offer the SMS/email code. */
export function OtpInput({ value, onChange, onComplete, disabled, invalid }: { value: string; onChange: (v: string) => void; onComplete?: (v: string) => void; disabled?: boolean; invalid?: boolean }) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length: 6 }, (_, i) => value[i] ?? '');
  useEffect(() => { refs.current[Math.min(value.length, 5)]?.focus(); }, []);
  const set = (raw: string) => {
    const v = raw.replace(/\D/g, '').slice(0, 6);
    onChange(v);
    refs.current[Math.min(v.length, 5)]?.focus();
    if (v.length === 6) onComplete?.(v);
  };
  const key = (i: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      e.preventDefault();
      const a = digits.slice();
      if (a[i]) a[i] = ''; else if (i > 0) { a[i - 1] = ''; refs.current[i - 1]?.focus(); }
      onChange(a.join(''));
    } else if (e.key === 'ArrowLeft' && i > 0) refs.current[i - 1]?.focus();
    else if (e.key === 'ArrowRight' && i < 5) refs.current[i + 1]?.focus();
  };
  return (
    <div className={`otp${invalid ? ' is-invalid' : ''}`} role="group" aria-label="6-digit code">
      {digits.map((d, i) => (
        <input key={i} ref={(el) => { refs.current[i] = el; }} className="otp__box" value={d} disabled={disabled} inputMode="numeric" pattern="[0-9]*" maxLength={1}
          autoComplete={i === 0 ? 'one-time-code' : 'off'} aria-label={`Digit ${i + 1} of 6`} aria-invalid={invalid || undefined}
          onChange={(e) => { const ch = e.target.value.replace(/\D/g, ''); if (ch.length > 1) return set(ch); const a = digits.slice(); a[i] = ch; set(a.join('')); }}
          onKeyDown={(e) => key(i, e)} onPaste={(e: ClipboardEvent<HTMLInputElement>) => { e.preventDefault(); set(e.clipboardData.getData('text')); }} onFocus={(e) => e.target.select()} />
      ))}
    </div>
  );
}
