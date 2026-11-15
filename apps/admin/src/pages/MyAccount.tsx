import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { del, get, patch, post } from '../lib/api.ts';
import { ago } from '../lib/format.ts';
import { useMe } from '../lib/me.ts';
import { Icon } from '../components/Icon.tsx';
import { ErrorBox, Field, Skeleton, useToast } from '../components/ui.tsx';
import { PasswordInput, PasswordStrength } from '../components/auth-ui.tsx';

interface Session { id: string; device: string; ip: string; createdAt: string; lastSeenAt: string; current: boolean }

/** Your name, your password, and where you're signed in. */
export default function MyAccount() {
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(me.name);
  const [pw, setPw] = useState({ current: '', next: '' });
  const [err, setErr] = useState<Record<string, string>>({});
  const sessions = useQuery({ queryKey: ['my-sessions'], queryFn: () => get<Session[]>('/admin/account/sessions') });

  const saveName = useMutation({ mutationFn: () => patch('/admin/account', { name }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['me'] }); toast({ text: 'Name saved' }); }, onError: (e) => toast({ text: (e as Error).message, bad: true }) });
  const change = useMutation({
    mutationFn: () => post('/admin/account/password', pw),
    onSuccess: () => { setPw({ current: '', next: '' }); setErr({}); qc.invalidateQueries({ queryKey: ['my-sessions'] }); toast({ text: 'Password changed. Other devices were signed out.' }); },
    onError: (e: any) => setErr(e.fields ?? { _: e.message }),
  });
  const end = useMutation({ mutationFn: (id: string) => del(`/admin/account/sessions/${id}`), onSuccess: () => { qc.invalidateQueries({ queryKey: ['my-sessions'] }); toast({ text: 'Signed out of that device' }); } });

  return (
    <>
      <div className="page-head"><div><h1>My account</h1><p className="muted">{me.email} · {me.role === 'owner' ? 'Owner' : 'Staff'}</p></div></div>
      <div className="grid2 account-grid">
        <section className="card stack" aria-labelledby="pf">
          <h2 id="pf">Profile</h2>
          <Field label="Your name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></Field>
          <div className="row"><span className="spacer" /><button className="btn" disabled={saveName.isPending || name.trim() === me.name || name.trim().length < 2} onClick={() => saveName.mutate()}>Save</button></div>
        </section>

        <section className="card stack" aria-labelledby="pwh">
          <h2 id="pwh">Password</h2>
          <div className="field"><label htmlFor="cur">Current password</label><PasswordInput id="cur" value={pw.current} onChange={(v) => setPw({ ...pw, current: v })} autoComplete="current-password" invalid={!!err.current} />{err.current && <span className="err">{err.current}</span>}</div>
          <div className="field"><label htmlFor="nxt">New password</label><PasswordInput id="nxt" value={pw.next} onChange={(v) => setPw({ ...pw, next: v })} autoComplete="new-password" invalid={!!err.next} />
            <PasswordStrength value={pw.next} email={me.email} name={me.name} />{err.next && <span className="err">{err.next}</span>}</div>
          {err._ && <p className="err">{err._}</p>}
          <div className="row"><span className="muted small">Changing it signs you out everywhere else.</span><span className="spacer" /><button className="btn" disabled={change.isPending || !pw.current || !pw.next} onClick={() => change.mutate()}>Change password</button></div>
        </section>
      </div>

      <section className="card" aria-labelledby="dev" style={{ marginTop: 'var(--sp-4)' }}>
        <div className="card__head"><div><h2 id="dev">Where you're signed in</h2><p className="muted small">Sessions end after 12 hours without use, and after 7 days at most.</p></div></div>
        {sessions.isPending ? <Skeleton n={2} h={56} /> : sessions.error ? <ErrorBox error={sessions.error} /> : (
          <ul className="devices" role="list">
            {sessions.data.map((s) => (
              <li key={s.id} className="device">
                <span className="device__icon" aria-hidden="true"><Icon name={/iPhone|Android/.test(s.device) ? 'phone' : 'layers'} /></span>
                <span className="device__who"><strong>{s.device}{s.current && <span className="badge badge--ok" style={{ marginLeft: 8 }}>This device</span>}</strong>
                  <span className="muted small">Signed in {ago(s.createdAt)} · last active {ago(s.lastSeenAt)}{s.ip && s.ip !== 'local' ? ` · ${s.ip}` : ''}</span></span>
                {!s.current && <button className="btn btn--quiet btn--sm" onClick={() => end.mutate(s.id)}>Sign out</button>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
