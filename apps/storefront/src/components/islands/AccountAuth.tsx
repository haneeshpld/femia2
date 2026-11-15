import { useEffect, useState, type FormEvent } from 'react';
import { acct, AccountError, safeNext, setSignedIn } from '../../lib/account.ts';
import { navigate } from 'astro:transitions/client';
import { Icon } from './Icon.tsx';
import { OtpInput } from './OtpInput.tsx';

type Sent = { devCode?: string; resendIn: number; delivery?: 'email' | 'fixed' };
type Step = { s: 'email' } | ({ s: 'code'; email: string } & Sent) | { s: 'details'; email: string; token: string } | { s: 'done'; name: string; isNew: boolean };

/** One door for signing in and creating an account: email → 6-digit code → (first time) name and mobile. */
export default function AccountAuth() {
  const [step, setStep] = useState<Step>({ s: 'email' });
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [marketing, setMarketing] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<AccountError | null>(null);
  const [left, setLeft] = useState(0);
  const next = safeNext(new URLSearchParams(location.search).get('next'));

  useEffect(() => { if (left <= 0) return; const t = setTimeout(() => setLeft((l) => l - 1), 1000); return () => clearTimeout(t); }, [left]);
  useEffect(() => { // already signed in? go straight on
    acct('/account/me').then((r) => { setSignedIn(r.customer); void navigate(next); }).catch(() => {});
  }, []);

  async function run<T>(fn: () => Promise<T>, done: (r: T) => void) {
    setBusy(true); setErr(null);
    try { done(await fn()); } catch (e) { setErr(e as AccountError); setCode(''); } finally { setBusy(false); }
  }
  const send = (e?: FormEvent) => {
    e?.preventDefault();
    run(() => acct<Sent>('/auth/customer/start', { body: { email } }), (r) => { setStep({ s: 'code', email: email.trim().toLowerCase(), devCode: r.devCode, resendIn: r.resendIn, delivery: r.delivery }); setLeft(r.resendIn); });
  };
  const verify = (c: string) => step.s === 'code' && run(
    () => acct<{ status: 'signed-in' | 'new'; customer?: { name: string }; signupToken?: string }>('/auth/customer/verify', { body: { email: step.email, code: c } }),
    (r) => {
      if (r.status === 'signed-in' && r.customer) { setSignedIn(r.customer); setStep({ s: 'done', name: r.customer.name, isNew: false }); setTimeout(() => navigate(next), 900); }
      else setStep({ s: 'details', email: step.email, token: r.signupToken! });
    },
  );
  const register = (e: FormEvent) => {
    e.preventDefault();
    if (step.s !== 'details') return;
    run(() => acct<{ customer: { name: string } }>('/auth/customer/register', { body: { signupToken: step.token, name, phone, marketing } }), (r) => {
      setSignedIn(r.customer); setStep({ s: 'done', name: r.customer.name, isNew: true }); setTimeout(() => navigate(next), 1300);
    });
  };
  const f = err?.fields ?? {};
  const error = err && !Object.keys(f).length && <p className="ac-error" role="alert"><Icon name="info" size={18} /> {err.message}</p>;

  return (
    <div className="ac-card">
      <ol className="ac-steps" aria-label="Steps">
        {['Email', 'Code', 'You'].map((l, i) => {
          const at = step.s === 'email' ? 0 : step.s === 'code' ? 1 : 2;
          return <li key={l} className={i < at ? 'is-done' : i === at ? 'is-now' : ''} aria-current={i === at ? 'step' : undefined}><span>{i < at ? <Icon name="check" size={14} /> : i + 1}</span>{l}</li>;
        })}
      </ol>

      {step.s === 'email' && (
        <form onSubmit={send} noValidate>
          <h1 className="ac-title">Sign in or create an account</h1>
          <p className="ac-sub">Enter your email and we'll send you a 6-digit code. No password to remember.</p>
          {error}
          <div className="field">
            <label htmlFor="ac-email">Email</label>
            <input id="ac-email" className="input" type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoFocus
              aria-invalid={!!f.email || undefined} aria-describedby={f.email ? 'ac-email-err' : undefined} />
            {f.email && <p id="ac-email-err" className="field-error">{f.email}</p>}
          </div>
          <button className="btn btn--block ac-cta" disabled={busy || !email.trim()}>{busy ? 'Sending…' : 'Send my code'} <Icon name="arrowRight" size={20} className="arrow" /></button>
          <p className="ac-fine">By continuing you agree to our <a href="/policies/terms">terms</a> and <a href="/policies/privacy">privacy policy</a>.</p>
        </form>
      )}

      {step.s === 'code' && (
        <div>
          <button type="button" className="ac-back" onClick={() => { setErr(null); setStep({ s: 'email' }); }}><Icon name="chevronLeft" size={18} /> Change email</button>
          <h1 className="ac-title">{step.delivery === 'fixed' && !step.devCode ? 'Enter the test code' : 'Check your inbox'}</h1>
          <p className="ac-sub">{step.delivery === 'fixed' && !step.devCode
            ? <>This is a test version of the shop and doesn't send emails yet. Enter the 6-digit test code you were given.</>
            : <>We sent a code to <strong>{step.email}</strong>. It expires in 10 minutes.</>}</p>
          {error}
          <OtpInput value={code} onChange={setCode} onComplete={verify} disabled={busy} invalid={!!err} />
          {step.devCode && (
            <p className="ac-dev"><span><strong>Test mode:</strong> emails aren't connected yet, so the code is <code>{step.devCode}</code>.</span>
              <button type="button" className="ac-link" onClick={() => { setCode(step.devCode!); verify(step.devCode!); }}>Fill it in</button></p>
          )}
          <button type="button" className="btn btn--block ac-cta" disabled={busy || code.length !== 6} onClick={() => verify(code)}>{busy ? 'Checking…' : 'Continue'}</button>
          <p className="ac-resend">{left > 0 ? `Didn't get it? Ask again in ${left}s.` : <>Didn't get it? Check spam, or <button type="button" className="ac-link" onClick={() => send()} disabled={busy}>send a new code</button></>}</p>
        </div>
      )}

      {step.s === 'details' && (
        <form onSubmit={register} noValidate>
          <h1 className="ac-title">Welcome to Femia</h1>
          <p className="ac-sub"><Icon name="check" size={16} /> <strong>{step.email}</strong> is verified. Just two more things.</p>
          {error}
          <div className="ac-fields">
            <div className="field">
              <label htmlFor="ac-name">Your name</label>
              <input id="ac-name" className="input" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} autoFocus aria-invalid={!!f.name || undefined} />
              {f.name && <p className="field-error">{f.name}</p>}
            </div>
            <div className="field">
              <label htmlFor="ac-phone">Mobile number</label>
              <input id="ac-phone" className="input" type="tel" inputMode="numeric" autoComplete="tel-national" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="98470 12345" aria-invalid={!!f.phone || undefined} aria-describedby="ac-phone-hint" />
              {f.phone ? <p className="field-error">{f.phone}</p> : <p id="ac-phone-hint" className="ac-hint">For delivery updates. We never share it.</p>}
            </div>
            <label className="ac-check"><input type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} /> Tell me about new arrivals and offers by email</label>
          </div>
          <button className="btn btn--block ac-cta" disabled={busy || !name.trim() || !phone.trim()}>{busy ? 'Creating your account…' : 'Create my account'}</button>
        </form>
      )}

      {step.s === 'done' && (
        <div className="ac-done" role="status">
          <span className="ac-done__seal" aria-hidden="true"><Icon name="check" size={30} /></span>
          <h1 className="ac-title">{step.isNew ? `Welcome, ${step.name.split(' ')[0]}` : `Welcome back, ${step.name.split(' ')[0]}`}</h1>
          <p className="ac-sub">{step.isNew ? 'Your account is ready. Any earlier orders with this email are in it too.' : 'Taking you on…'}</p>
        </div>
      )}
    </div>
  );
}
