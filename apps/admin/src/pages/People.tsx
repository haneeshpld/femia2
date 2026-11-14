import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { get, patch, post } from '../lib/api.ts';
import { ago, dateTime } from '../lib/format.ts';
import { useMe } from '../lib/me.ts';
import { ErrorBox, Field, Skeleton, useToast } from '../components/ui.tsx';

interface User { id: string; email: string; name: string; roleId: string; active: number; lastSeenAt: string | null }

export default function People() {
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const users = useQuery({ queryKey: ['users'], queryFn: () => get<User[]>('/admin/users') });
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => get<{ roles: { id: string; name: string }[] }>('/admin/roles') });
  const audit = useQuery({ queryKey: ['audit'], queryFn: () => get<{ id: number; actor: string; action: string; summary: string; at: string }[]>('/admin/audit?limit=60') });
  const [n, setN] = useState({ email: '', name: '', roleId: 'staff' });
  const add = useMutation({ mutationFn: () => post('/admin/users', { ...n, active: true }), onSuccess: () => { setN({ email: '', name: '', roleId: 'staff' }); qc.invalidateQueries({ queryKey: ['users'] }); toast({ text: 'Added. Also add this email to the Cloudflare Access policy so they can sign in.' }); }, onError: (e) => toast({ text: (e as Error).message, bad: true }) });
  const upd = useMutation({ mutationFn: ({ id, body }: { id: string; body: object }) => patch(`/admin/users/${id}`, body), onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); toast({ text: 'Updated' }); }, onError: (e) => toast({ text: (e as Error).message, bad: true }) });

  if (users.isPending) return <Skeleton n={4} />;
  if (users.error) return <ErrorBox error={users.error} />;
  return (
    <>
      <div className="page-head"><div><h1>People</h1><p className="muted">Owner: everything. Staff: products, stock, orders and homepage drafts; no money settings.</p></div></div>
      <div className="stack">
        <div className="card">
          <table className="table">
            <thead><tr><th>Person</th><th>Role</th><th>Last active</th><th /></tr></thead>
            <tbody>
              {users.data.map((u) => (
                <tr key={u.id} style={{ opacity: u.active ? 1 : 0.5 }}>
                  <td><strong>{u.name || u.email}</strong><br /><span className="muted small">{u.email}</span></td>
                  <td><select className="select" style={{ minHeight: 40 }} value={u.roleId} disabled={u.id === me.id} onChange={(e) => upd.mutate({ id: u.id, body: { roleId: e.target.value } })}>{roles.data?.roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></td>
                  <td className="small">{u.lastSeenAt ? ago(u.lastSeenAt) : 'Never'}</td>
                  <td>{u.id !== me.id && <button className="btn btn--quiet" onClick={() => upd.mutate({ id: u.id, body: { active: !u.active } })}>{u.active ? 'Remove access' : 'Restore'}</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form className="card stack" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
          <h2>Add a person</h2>
          <div className="grid3">
            <Field label="Email"><input className="input" type="email" required value={n.email} onChange={(e) => setN({ ...n, email: e.target.value })} /></Field>
            <Field label="Name"><input className="input" value={n.name} onChange={(e) => setN({ ...n, name: e.target.value })} /></Field>
            <Field label="Role"><select className="select" value={n.roleId} onChange={(e) => setN({ ...n, roleId: e.target.value })}>{roles.data?.roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
          </div>
          <div className="row"><span className="spacer" /><button className="btn" disabled={!n.email || add.isPending}>Add</button></div>
        </form>
        <div className="card">
          <h2 style={{ marginBottom: 12 }}>Change log</h2>
          {audit.isPending ? <Skeleton n={4} h={28} /> : (
            <ul className="stack" style={{ listStyle: 'none', padding: 0, gap: 4 }}>
              {audit.data?.map((a) => <li key={a.id} className="small" style={{ borderBottom: '1px solid var(--c-line)', padding: '6px 0' }}><strong>{a.actor}</strong> · {a.summary || a.action}<br /><span className="muted">{dateTime(a.at)} · {a.action}</span></li>)}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
