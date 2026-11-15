import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { get, patch, post } from '../lib/api.ts';
import { ago, dateTime } from '../lib/format.ts';
import { useMe } from '../lib/me.ts';
import { Icon } from '../components/Icon.tsx';
import { Empty, ErrorBox, Field, Sheet, Skeleton, useToast } from '../components/ui.tsx';

interface User {
  id: string; email: string; name: string; roleId: string; status: 'invited' | 'pending' | 'active' | 'disabled' | 'rejected';
  lastSeenAt: string | null; lastLoginAt: string | null; createdAt: string; approvedAt: string | null; approvedBy: string | null; hasPassword: number; sessions: number;
}
const ROLE: Record<string, { label: string; blurb: string }> = {
  owner: { label: 'Owner', blurb: 'Everything, including money settings, payment keys and the team.' },
  staff: { label: 'Staff', blurb: 'Products, stock, orders, customers and homepage drafts. No money settings.' },
};
const STATUS: Record<User['status'], { label: string; cls: string }> = {
  active: { label: 'Active', cls: 'badge--ok' }, invited: { label: 'Invited', cls: 'badge--warn' }, pending: { label: 'Waiting', cls: 'badge--maroon' },
  disabled: { label: 'No access', cls: 'badge--bad' }, rejected: { label: 'Declined', cls: '' },
};
const initials = (u: Pick<User, 'name' | 'email'>) => (u.name || u.email).split(/[^A-Za-z]+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('');

/** The Admin team: approve sign-ups, invite people, change roles, remove access, sign people out. */
export default function People() {
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const users = useQuery({ queryKey: ['users'], queryFn: () => get<User[]>('/admin/users') });
  const audit = useQuery({ queryKey: ['audit'], queryFn: () => get<{ id: number; actor: string; action: string; summary: string; at: string }[]>('/admin/audit?limit=40') });
  const [inviting, setInviting] = useState(false);
  const [approving, setApproving] = useState<User | null>(null);

  const done = (text: string) => { qc.invalidateQueries({ queryKey: ['users'] }); qc.invalidateQueries({ queryKey: ['audit'] }); toast({ text }); };
  const fail = (e: unknown) => toast({ text: (e as Error).message, bad: true });
  const act = useMutation({
    mutationFn: ({ path, body, method = 'post' }: { path: string; body?: object; method?: 'post' | 'patch' }) => (method === 'patch' ? patch(path, body) : post(path, body)),
    onError: fail,
  });
  const run = (path: string, body: object | undefined, text: string, method?: 'post' | 'patch') => act.mutate({ path, body, method }, { onSuccess: () => done(text) });

  if (users.isPending) return <Skeleton n={4} />;
  if (users.error) return <ErrorBox error={users.error} retry={() => users.refetch()} />;
  const list = users.data;
  const pending = list.filter((u) => u.status === 'pending');
  const team = list.filter((u) => u.status !== 'pending' && u.status !== 'rejected');

  return (
    <>
      <div className="page-head">
        <div><h1>Team</h1><p className="muted">Who can use Femia Studio. New sign-ups need an approval from an admin; people you invite are approved already.</p></div>
        <button className="btn" onClick={() => setInviting(true)}><Icon name="plus" /> Invite someone</button>
      </div>

      {pending.length > 0 && (
        <section className="card approvals" aria-labelledby="ap-title">
          <div className="card__head"><div><h2 id="ap-title">Waiting for your approval</h2><p className="muted small">They verified their email. Only approve people you know.</p></div><span className="badge badge--maroon">{pending.length}</span></div>
          <ul className="approvals__list" role="list">
            {pending.map((u) => (
              <li key={u.id} className="approval">
                <span className="avatar avatar--warm" aria-hidden="true">{initials(u)}</span>
                <span className="approval__who"><strong>{u.name || u.email}</strong><span className="muted small">{u.email} · asked {ago(u.createdAt)}</span></span>
                <button className="btn btn--quiet btn--sm" onClick={() => { if (confirm(`Decline ${u.name || u.email}? They won't be able to sign in.`)) run(`/admin/users/${u.id}/reject`, undefined, 'Request declined'); }}>Decline</button>
                <button className="btn btn--sm" onClick={() => setApproving(u)}><Icon name="check" size={18} /> Approve</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card" aria-labelledby="team-title">
        <div className="card__head"><h2 id="team-title">Team</h2><span className="muted small">{team.filter((u) => u.status === 'active').length} active</span></div>
        {team.length === 0 ? <Empty icon="users" title="No one yet" /> : (
          <ul className="team" role="list">
            {team.map((u) => {
              const self = u.id === me.id;
              return (
                <li key={u.id} className={`member${u.status === 'disabled' ? ' is-off' : ''}`}>
                  <span className="avatar" aria-hidden="true">{initials(u)}</span>
                  <span className="member__who">
                    <strong>{u.name || u.email}{self && <span className="muted"> (you)</span>}</strong>
                    <span className="muted small">{u.email}</span>
                    <span className="muted small">
                      {u.status === 'invited' ? `Invited ${ago(u.createdAt)}, hasn't signed up yet` : u.lastSeenAt ? `Active ${ago(u.lastSeenAt)}` : 'Never signed in'}
                      {u.sessions > 0 && u.status === 'active' && ` · signed in on ${u.sessions} device${u.sessions > 1 ? 's' : ''}`}
                    </span>
                  </span>
                  <span className={`badge ${STATUS[u.status].cls}`}>{STATUS[u.status].label}</span>
                  <select className="select member__role" value={u.roleId} disabled={self || act.isPending} aria-label={`Role for ${u.name || u.email}`}
                    onChange={(e) => run(`/admin/users/${u.id}`, { roleId: e.target.value }, `${u.name || u.email} is now ${ROLE[e.target.value]?.label ?? e.target.value}`, 'patch')}>
                    {Object.entries(ROLE).map(([id, r]) => <option key={id} value={id}>{r.label}</option>)}
                  </select>
                  <span className="member__actions">
                    {u.status === 'invited' && <button className="btn btn--quiet btn--sm" onClick={() => run(`/admin/users/${u.id}/reject`, undefined, 'Invite cancelled')}>Cancel invite</button>}
                    {!self && u.status === 'active' && u.sessions > 0 && <button className="btn btn--quiet btn--sm" onClick={() => run(`/admin/users/${u.id}/sign-out`, undefined, `${u.name || u.email} is signed out everywhere`)}>Sign out</button>}
                    {!self && u.status === 'active' && <button className="btn btn--quiet btn--sm" onClick={() => { if (confirm(`Remove ${u.name || u.email}'s access? They'll be signed out straight away.`)) run(`/admin/users/${u.id}`, { status: 'disabled' }, 'Access removed', 'patch'); }}>Remove access</button>}
                    {!self && u.status === 'disabled' && <button className="btn btn--quiet btn--sm" onClick={() => run(`/admin/users/${u.id}`, { status: 'active' }, 'Access restored', 'patch')}>Restore access</button>}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        <div className="roles-key">
          {Object.entries(ROLE).map(([id, r]) => <p key={id} className="small"><strong>{r.label}:</strong> <span className="muted">{r.blurb}</span></p>)}
        </div>
      </section>

      {audit.data && (
        <section className="card" aria-labelledby="audit-title">
          <div className="card__head"><h2 id="audit-title">Recent activity</h2></div>
          <ul className="audit" role="list">
            {audit.data.map((a) => <li key={a.id}><span className="muted small">{dateTime(a.at)}</span><span><strong>{a.actor}</strong> {a.summary}</span></li>)}
          </ul>
        </section>
      )}

      {inviting && <InviteSheet onClose={() => setInviting(false)} onDone={(msg) => { setInviting(false); done(msg); }} />}
      {approving && (
        <ApproveSheet user={approving} onClose={() => setApproving(null)}
          onApprove={(roleId) => act.mutate({ path: `/admin/users/${approving.id}/approve`, body: { roleId } }, { onSuccess: () => { done(`${approving.name || approving.email} can now sign in`); setApproving(null); } })} busy={act.isPending} />
      )}
    </>
  );
}

function RolePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="role-pick" role="radiogroup" aria-label="Role">
      {Object.entries(ROLE).map(([id, r]) => (
        <label key={id} className={`role-pick__opt${value === id ? ' is-on' : ''}`}>
          <input type="radio" name="role" value={id} checked={value === id} onChange={() => onChange(id)} />
          <span><strong>{r.label}</strong><span className="muted small">{r.blurb}</span></span>
        </label>
      ))}
    </div>
  );
}

function ApproveSheet({ user, onClose, onApprove, busy }: { user: User; onClose: () => void; onApprove: (roleId: string) => void; busy: boolean }) {
  const [role, setRole] = useState('staff');
  return (
    <Sheet title={`Approve ${user.name || user.email}`} onClose={onClose} footer={<><span className="spacer" /><button className="btn btn--quiet" onClick={onClose}>Cancel</button><button className="btn" disabled={busy} onClick={() => onApprove(role)}>Approve as {ROLE[role]?.label}</button></>}>
      <p className="muted" style={{ marginBottom: 'var(--sp-4)' }}>{user.email} verified this email {ago(user.createdAt)}. Choose what they can do; you can change it any time.</p>
      <RolePicker value={role} onChange={setRole} />
    </Sheet>
  );
}

function InviteSheet({ onClose, onDone }: { onClose: () => void; onDone: (msg: string) => void }) {
  const [v, setV] = useState({ email: '', name: '', roleId: 'staff' });
  const [link, setLink] = useState<string | null>(null);
  const [err, setErr] = useState<Record<string, string>>({});
  const m = useMutation({
    mutationFn: () => post<{ link: string; emailed: boolean }>('/admin/users', v),
    onSuccess: (r) => { if (r.emailed) onDone(`Invite sent to ${v.email}`); else setLink(r.link); },
    onError: (e: any) => setErr(e.fields ?? { email: e.message }),
  });
  if (link) {
    return (
      <Sheet title="Invite ready" onClose={() => onDone(`${v.email} is invited`)} footer={<><span className="spacer" /><button className="btn" onClick={() => onDone(`${v.email} is invited`)}>Done</button></>}>
        <p>Emails aren't set up yet, so send {v.name || 'them'} this link on WhatsApp. They create a password, verify their email and they're in.</p>
        <div className="copy-link"><code>{link}</code><button className="btn btn--quiet btn--sm" onClick={() => navigator.clipboard?.writeText(link)}><Icon name="copy" size={18} /> Copy</button></div>
      </Sheet>
    );
  }
  return (
    <Sheet title="Invite someone" onClose={onClose} footer={<><span className="spacer" /><button className="btn btn--quiet" onClick={onClose}>Cancel</button><button className="btn" disabled={m.isPending || !v.email} onClick={() => m.mutate()}>Send invite</button></>}>
      <div className="stack">
        <p className="muted">Inviting someone approves them in advance. They sign up with this email and get in without waiting.</p>
        <div className="grid2">
          <Field label="Name" error={err.name}><input className="input" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} autoFocus /></Field>
          <Field label="Email" error={err.email}><input className="input" type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} /></Field>
        </div>
        <RolePicker value={v.roleId} onChange={(roleId) => setV({ ...v, roleId })} />
      </div>
    </Sheet>
  );
}
