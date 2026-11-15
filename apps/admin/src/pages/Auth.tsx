import { useState, type FormEvent } from 'react';
import { ApiError, post } from '../lib/api.ts';
import { Icon } from '../components/Icon.tsx';
import { AuthShell, DevCode, OtpInput, PasswordInput, PasswordStrength, Resend } from '../components/auth-ui.tsx';

type Sent = { devCode?: string; resendIn: number; delivery?: 'email' | 'fixed' };
type Step =
  | { s: 'sign-in' }
  | { s: 'sign-in-code'; email: string; challenge: string } & Sent
  | { s: 'sign-up' }
  | { s: 'sign-up-code'; email: string; name: string; password: string; signupToken: string } & Sent
  | { s: 'pending'; email: string }
  | { s: 'forgot' }
  | { s: 'forgot-code'; email: string } & Sent
  | { s: 'reset-done' };

const initial = (): Step => {
  const p = location.pathname;
  return p.startsWith('/sign-up') ? { s: 'sign-up' } : p.startsWith('/forgot') ? { s: 'forgot' } : { s: 'sign-in' };
};
const go = (path: string) => history.replaceState(null, '', path);

/** Sign in (password, then emailed code), create an account (approved by an admin), reset a password. */
export default function Auth({ onSignedIn }: { onSignedIn: () => void }) {
  const [step, setStep] = useState<Step>(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const prefill = new URLSearchParams(location.search).get('email') ?? '';
  const [email, setEmail] = useState(prefill);
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');

  const move = (next: Step, path?: string) => { setErr(null); setFields({}); setCode(''); setStep(next); if (path) go(path); };
  async function run<T>(fn: () => Promise<T>, done: (r: T) => void) {
    setBusy(true); setErr(null); setFields({});
    try { done(await fn()); }
    catch (e) {
      if (e instanceof ApiError) { setErr(e.message); setFields(e.fields); if (e.code === 'pending_approval') setStep({ s: 'pending', email }); }
      else setErr('We couldn’t reach Femia. Check your connection and try again.');
      setCode('');
    } finally { setBusy(false); }
  }

  const signIn = (e: FormEvent) => { e.preventDefault(); run(() => post<{ challenge: string } & Sent>('/auth/admin/login', { email, password }), (r) => { setPassword(''); move({ s: 'sign-in-code', email: email.trim().toLowerCase(), challenge: r.challenge, devCode: r.devCode, resendIn: r.resendIn, delivery: r.delivery }); }); };
  const finishSignIn = (c: string) => step.s === 'sign-in-code' && run(() => post('/auth/admin/login/verify', { challenge: step.challenge, code: c }), () => onSignedIn());
  const signUp = (e: FormEvent) => { e.preventDefault(); run(() => post<Sent & { signupToken: string }>('/auth/admin/signup', { name, email, password }), (r) => move({ s: 'sign-up-code', email: email.trim().toLowerCase(), name, password, signupToken: r.signupToken, devCode: r.devCode, resendIn: r.resendIn, delivery: r.delivery })); };
  const finishSignUp = (c: string) => step.s === 'sign-up-code' && run(() => post<{ status: 'active' | 'pending' }>('/auth/admin/signup/verify', { email: step.email, code: c, signupToken: step.signupToken }), (r) => {
    setPassword('');
    if (r.status === 'active') onSignedIn(); else move({ s: 'pending', email: step.email }, '/sign-in');
  });
  const forgot = (e: FormEvent) => { e.preventDefault(); run(() => post<Sent>('/auth/admin/forgot', { email }), (r) => move({ s: 'forgot-code', email: email.trim().toLowerCase(), devCode: r.devCode, resendIn: r.resendIn, delivery: r.delivery })); };
  const reset = (e: FormEvent) => { e.preventDefault(); if (step.s === 'forgot-code') run(() => post('/auth/admin/reset', { email: step.email, code, password }), () => { setPassword(''); move({ s: 'reset-done' }, '/sign-in'); }); };

  const error = err && <p className="auth-error" role="alert"><Icon name="info" size={18} /> {err}</p>;
  const back = (to: Step, path: string, label = 'Back') => <button type="button" className="auth-back" onClick={() => move(to, path)}><Icon name="arrowLeft" size={18} /> {label}</button>;

  return (
    <AuthShell>
      {step.s === 'sign-in' && (
        <form onSubmit={signIn} noValidate>
          <h1 className="auth-title">Welcome back</h1>
          <p className="auth-sub">Sign in to Femia Studio.</p>
          {error}
          <div className="auth-fields">
            <label className="field"><span>Email</span>
              <input className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus={!prefill} required /></label>
            <div className="field">
              <span className="row" style={{ justifyContent: 'space-between' }}><label htmlFor="pw">Password</label><button type="button" className="link-btn small" onClick={() => move({ s: 'forgot' }, '/forgot')}>Forgot password?</button></span>
              <PasswordInput id="pw" value={password} onChange={setPassword} autoComplete="current-password" />
            </div>
          </div>
          <button className="btn btn--block btn--lg" disabled={busy || !email || !password}>{busy ? 'Checking…' : 'Continue'}</button>
          <p className="auth-switch">New to the team? <button type="button" className="link-btn" onClick={() => move({ s: 'sign-up' }, '/sign-up')}>Create an account</button></p>
        </form>
      )}

      {(step.s === 'sign-in-code' || step.s === 'sign-up-code') && (
        <div>
          {back(step.s === 'sign-in-code' ? { s: 'sign-in' } : { s: 'sign-up' }, step.s === 'sign-in-code' ? '/sign-in' : '/sign-up')}
          <span className="auth-seal" aria-hidden="true"><Icon name="mail" size={26} /></span>
          <h1 className="auth-title">{step.delivery === 'fixed' && !step.devCode ? 'Enter the test code' : 'Check your email'}</h1>
          <p className="auth-sub">{step.delivery === 'fixed' && !step.devCode
            ? <>This test site doesn't send emails yet. Enter the site's 6-digit test code (<code>FIXED_OTP_CODE</code> in its secrets file).</>
            : <>We sent a 6-digit code to <strong>{step.email}</strong>. It expires in 10 minutes.</>}</p>
          {error}
          <OtpInput value={code} onChange={setCode} onComplete={(c) => (step.s === 'sign-in-code' ? finishSignIn(c) : finishSignUp(c))} disabled={busy} invalid={!!err} />
          <DevCode code={step.devCode} onUse={(c) => { setCode(c); step.s === 'sign-in-code' ? finishSignIn(c) : finishSignUp(c); }} />
          <button type="button" className="btn btn--block btn--lg" disabled={busy || code.length !== 6} onClick={() => (step.s === 'sign-in-code' ? finishSignIn(code) : finishSignUp(code))}>
            {busy ? 'Verifying…' : step.s === 'sign-in-code' ? 'Sign in' : 'Verify email'}
          </button>
          <Resend seconds={step.resendIn} busy={busy} onResend={() => run(
            () => (step.s === 'sign-in-code' ? post<Sent>('/auth/admin/login/resend', { challenge: step.challenge }) : post<Sent & { signupToken?: string }>('/auth/admin/signup', { name: step.name, email: step.email, password: step.password })),
            // a fresh sign-up gets a fresh token, which the new code is tied to
            (r: Sent & { signupToken?: string }) => setStep({ ...step, ...(r.signupToken && step.s === 'sign-up-code' ? { signupToken: r.signupToken } : {}), devCode: r.devCode, resendIn: r.resendIn + Math.random() * 0.001 }),
          )} />
        </div>
      )}

      {step.s === 'sign-up' && (
        <form onSubmit={signUp} noValidate>
          {back({ s: 'sign-in' }, '/sign-in', 'Sign in instead')}
          <h1 className="auth-title">Join Femia Studio</h1>
          <p className="auth-sub">After you verify your email, an admin approves your account. If you were invited, you're in straight away.</p>
          {err && !Object.keys(fields).length && error}
          <div className="auth-fields">
            <label className="field"><span>Your name</span>
              <input className="input" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!!fields.name || undefined} autoFocus />
              {fields.name && <span className="err">{fields.name}</span>}</label>
            <label className="field"><span>Work email</span>
              <input className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!fields.email || undefined} />
              {fields.email && <span className="err">{fields.email}</span>}</label>
            <div className="field"><label htmlFor="npw">Create a password</label>
              <PasswordInput id="npw" value={password} onChange={setPassword} autoComplete="new-password" invalid={!!fields.password} describedBy="npw-meter" />
              {/* the live meter shows the same rules the server checks, so its message isn't repeated */}
              <div id="npw-meter"><PasswordStrength value={password} email={email} name={name} /></div></div>
          </div>
          <button className="btn btn--block btn--lg" disabled={busy || !name || !email || !password}>{busy ? 'Sending code…' : 'Create account'}</button>
        </form>
      )}

      {step.s === 'pending' && (
        <div className="auth-centre">
          <span className="auth-seal auth-seal--gold" aria-hidden="true"><Icon name="clock" size={26} /></span>
          <h1 className="auth-title">Waiting for approval</h1>
          <p className="auth-sub">Your email <strong>{step.email}</strong> is verified. An admin has been told about your request; once they approve it, sign in with your password.</p>
          <button type="button" className="btn btn--quiet btn--block" onClick={() => move({ s: 'sign-in' }, '/sign-in')}>Back to sign in</button>
        </div>
      )}

      {step.s === 'forgot' && (
        <form onSubmit={forgot} noValidate>
          {back({ s: 'sign-in' }, '/sign-in')}
          <h1 className="auth-title">Reset your password</h1>
          <p className="auth-sub">Enter your email. If it has a Femia Studio account, we'll send a code to set a new password.</p>
          {error}
          <div className="auth-fields"><label className="field"><span>Email</span>
            <input className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus /></label></div>
          <button className="btn btn--block btn--lg" disabled={busy || !email}>{busy ? 'Sending…' : 'Send code'}</button>
        </form>
      )}

      {step.s === 'forgot-code' && (
        <form onSubmit={reset} noValidate>
          {back({ s: 'forgot' }, '/forgot')}
          <h1 className="auth-title">Choose a new password</h1>
          <p className="auth-sub">{step.delivery === 'fixed' && !step.devCode ? <>This test site doesn't send emails yet: use its 6-digit test code (<code>FIXED_OTP_CODE</code>).</> : <>Enter the code we sent to <strong>{step.email}</strong>.</>} You'll be signed out on every other device.</p>
          {error}
          <OtpInput value={code} onChange={setCode} invalid={!!fields.code} />
          <DevCode code={step.devCode} onUse={setCode} />
          <div className="auth-fields"><div className="field"><label htmlFor="rpw">New password</label>
            <PasswordInput id="rpw" value={password} onChange={setPassword} autoComplete="new-password" invalid={!!fields.password} />
            <PasswordStrength value={password} email={step.email} /></div></div>
          <button className="btn btn--block btn--lg" disabled={busy || code.length !== 6 || !password}>{busy ? 'Saving…' : 'Save new password'}</button>
          <Resend seconds={step.resendIn} busy={busy} onResend={() => run(() => post<Sent>('/auth/admin/forgot', { email: step.email }), (r) => setStep({ ...step, devCode: r.devCode, resendIn: r.resendIn + Math.random() * 0.001 }))} />
        </form>
      )}

      {step.s === 'reset-done' && (
        <div className="auth-centre">
          <span className="auth-seal" aria-hidden="true"><Icon name="check" size={26} /></span>
          <h1 className="auth-title">Password changed</h1>
          <p className="auth-sub">Sign in with your new password.</p>
          <button type="button" className="btn btn--block btn--lg" onClick={() => move({ s: 'sign-in' }, '/sign-in')}>Sign in</button>
        </div>
      )}
    </AuthShell>
  );
}
