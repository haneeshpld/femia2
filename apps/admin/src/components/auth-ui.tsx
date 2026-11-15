import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent, type ReactNode } from 'react';
import { passwordProblem, passwordScore } from '@femia/contracts/password';
import { Icon } from './Icon.tsx';

/** Six single-digit boxes: auto-advance, backspace to go back, paste a whole code, phone keyboards show digits. */
export function OtpInput({ value, onChange, onComplete, disabled, invalid, autoFocus = true }: {
  value: string; onChange: (v: string) => void; onComplete?: (v: string) => void; disabled?: boolean; invalid?: boolean; autoFocus?: boolean;
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length: 6 }, (_, i) => value[i] ?? '');
  useEffect(() => { if (autoFocus) refs.current[Math.min(value.length, 5)]?.focus(); }, [autoFocus]);
  const set = (next: string) => {
    const v = next.replace(/\D/g, '').slice(0, 6);
    onChange(v);
    if (v.length === 6) onComplete?.(v);
    refs.current[Math.min(v.length, 5)]?.focus();
  };
  const onKey = (i: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') { e.preventDefault(); const arr = digits.slice(); if (arr[i]) arr[i] = ''; else if (i > 0) { arr[i - 1] = ''; refs.current[i - 1]?.focus(); } onChange(arr.join('').replace(/\s/g, '')); }
    if (e.key === 'ArrowLeft' && i > 0) refs.current[i - 1]?.focus();
    if (e.key === 'ArrowRight' && i < 5) refs.current[i + 1]?.focus();
  };
  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => { e.preventDefault(); set(e.clipboardData.getData('text')); };
  return (
    <div className={`otp${invalid ? ' is-invalid' : ''}`} role="group" aria-label="6-digit code">
      {digits.map((d, i) => (
        <input key={i} ref={(el) => { refs.current[i] = el; }} className="otp__box" value={d} disabled={disabled} inputMode="numeric" pattern="[0-9]*" maxLength={1}
          autoComplete={i === 0 ? 'one-time-code' : 'off'} aria-label={`Digit ${i + 1}`} aria-invalid={invalid || undefined}
          onChange={(e) => { const ch = e.target.value.replace(/\D/g, ''); if (ch.length > 1) { set(ch); return; } const arr = digits.slice(); arr[i] = ch; set(arr.join('')); }}
          onKeyDown={(e) => onKey(i, e)} onPaste={onPaste} onFocus={(e) => e.target.select()} />
      ))}
    </div>
  );
}

export function PasswordInput({ id, value, onChange, autoComplete, invalid, placeholder, describedBy }: {
  id: string; value: string; onChange: (v: string) => void; autoComplete: string; invalid?: boolean; placeholder?: string; describedBy?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="pw">
      <input id={id} className="input" type={show ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete}
        aria-invalid={invalid || undefined} placeholder={placeholder} aria-describedby={describedBy} spellCheck={false} />
      <button type="button" className="pw__toggle" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}>
        <Icon name="eye" size={20} />
      </button>
    </div>
  );
}

const LEVELS = ['Too short', 'Weak', 'Fair', 'Strong', 'Very strong'];
/** Live strength meter with the same rules the server enforces. */
export function PasswordStrength({ value, email, name }: { value: string; email?: string; name?: string }) {
  if (!value) return <p className="pw-hint">At least 10 characters. A short phrase you'll remember works well.</p>;
  const problem = passwordProblem(value, { email, name });
  const score = problem ? Math.min(passwordScore(value), 1) : Math.max(2, passwordScore(value));
  return (
    <div className="pw-meter" aria-live="polite">
      <div className={`pw-meter__bar s${score}`} aria-hidden="true"><i /><i /><i /><i /></div>
      <p className={problem ? 'pw-meter__msg is-bad' : 'pw-meter__msg'}>{problem ?? LEVELS[score]}</p>
    </div>
  );
}

/** Resend link with a countdown. */
export function Resend({ seconds, onResend, busy }: { seconds: number; onResend: () => void; busy?: boolean }) {
  const [left, setLeft] = useState(seconds);
  useEffect(() => { setLeft(seconds); }, [seconds]);
  useEffect(() => { if (left <= 0) return; const t = setTimeout(() => setLeft((l) => l - 1), 1000); return () => clearTimeout(t); }, [left]);
  return left > 0
    ? <p className="auth-resend">Didn't get it? You can ask for a new code in {left}s.</p>
    : <p className="auth-resend">Didn't get it? <button type="button" className="link-btn" onClick={() => { onResend(); }} disabled={busy}>Send a new code</button></p>;
}

export function DevCode({ code, onUse }: { code?: string; onUse: (c: string) => void }) {
  if (!code) return null;
  return (
    <div className="dev-code">
      <span><strong>Test mode</strong> · emails aren't set up yet, so the code is always <code>{code}</code></span>
      <button type="button" className="link-btn" onClick={() => onUse(code)}>Fill it in</button>
    </div>
  );
}

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="auth">
      <aside className="auth__brand" aria-hidden="true">
        <svg className="auth__arch" viewBox="0 0 400 560" preserveAspectRatio="xMidYMax meet">
          <path d="M40 560 V230 A160 160 0 0 1 360 230 V560" />
          <path d="M60 560 V232 A140 140 0 0 1 340 232 V560" />
        </svg>
        <div className="auth__mark">
          <img src="/emblem.webp" alt="" width="88" height="88" />
          <img src="/wordmark.webp" alt="" className="auth__word" />
          <p>Studio for the Femia team</p>
        </div>
        <p className="auth__foot">Femia Boutique · Elegance, made for her</p>
      </aside>
      <main className="auth__main">
        <div className="auth__card">{children}</div>
        <p className="auth__secure"><Icon name="shield" size={16} /> Secured with your password and a one-time code.</p>
      </main>
    </div>
  );
}
