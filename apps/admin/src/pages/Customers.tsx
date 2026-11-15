import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { get, post } from '../lib/api.ts';
import { ago, dateTime, formatINR } from '../lib/format.ts';
import { useCan } from '../lib/me.ts';
import { Icon } from '../components/Icon.tsx';
import { Empty, ErrorBox, Skeleton, StatusBadge, useToast } from '../components/ui.tsx';

interface Row { id: string; email: string; name: string; phone: string; disabled: number; createdAt: string; lastLoginAt: string | null; orders: number; spent: number; lastOrderAt: string | null; offersUsed: number }
interface Detail {
  customer: { id: string; email: string; name: string; phone: string; marketing: number; disabled: number; createdAt: string; lastLoginAt: string | null };
  addresses: { id: string; label: string; name: string; phone: string; line1: string; line2: string; landmark: string; city: string; pincode: string; isDefault: boolean }[];
  orders: { number: string; status: string; total: number; discount: number; createdAt: string; items: number; image: string | null; title: string | null; current: boolean }[];
  offers: { label: string; code: string | null; kind: string; amount: number; orderNumber: string; at: string }[];
  totals: { orders: number; spent: number; saved: number };
  signedInDevices: number;
}
const initials = (n: string, e: string) => (n || e).split(/[^A-Za-z]+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('');

/** Shopper accounts with everything tied to them: orders now and before, offers used, saved addresses. */
export default function Customers() {
  const { id } = useParams();
  return id ? <CustomerDetail id={id} /> : <CustomerList />;
}

function CustomerList() {
  const [q, setQ] = useState('');
  const list = useQuery({ queryKey: ['customers', q], queryFn: () => get<Row[]>(`/admin/customers${q ? `?q=${encodeURIComponent(q)}` : ''}`) });
  return (
    <>
      <div className="page-head"><div><h1>Customers</h1><p className="muted">Shoppers with a Femia account. Guest orders join an account when someone signs up with the same email.</p></div></div>
      <input className="input" type="search" placeholder="Search by name, email or mobile" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search customers" style={{ maxWidth: 420, marginBottom: 'var(--sp-4)' }} />
      {list.isPending ? <Skeleton n={4} h={72} /> : list.error ? <ErrorBox error={list.error} retry={() => list.refetch()} /> : list.data.length === 0 ? (
        <Empty icon="users" title={q ? 'No one matches that search' : 'No accounts yet'} body={q ? undefined : 'When shoppers create an account on the website, they’ll appear here with their orders.'} />
      ) : (
        <ul className="cust-list" role="list">
          {list.data.map((c) => (
            <li key={c.id}>
              <Link to={`/customers/${c.id}`} className={`cust${c.disabled ? ' is-off' : ''}`}>
                <span className="avatar avatar--warm" aria-hidden="true">{initials(c.name, c.email)}</span>
                <span className="cust__who"><strong>{c.name}</strong><span className="muted small">{c.email}{c.phone && ` · ${c.phone}`}</span></span>
                <span className="cust__stat"><strong>{c.orders}</strong><span className="muted small">order{c.orders === 1 ? '' : 's'}</span></span>
                <span className="cust__stat"><strong>{formatINR(c.spent)}</strong><span className="muted small">spent</span></span>
                <span className="cust__stat cust__stat--wide"><span className="muted small">{c.lastOrderAt ? `Last order ${ago(c.lastOrderAt)}` : `Joined ${ago(c.createdAt)}`}</span>{c.offersUsed > 0 && <span className="badge">{c.offersUsed} offer{c.offersUsed > 1 ? 's' : ''} used</span>}</span>
                {c.disabled ? <span className="badge badge--bad">Closed</span> : <Icon name="chevronRight" />}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function CustomerDetail({ id }: { id: string }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const canManage = useCan()('people.manage');
  const d = useQuery({ queryKey: ['customer', id], queryFn: () => get<Detail>(`/admin/customers/${id}`) });
  const act = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: object }) => post(path, body),
    onSuccess: (_r, v) => { qc.invalidateQueries({ queryKey: ['customer', id] }); qc.invalidateQueries({ queryKey: ['customers'] }); toast({ text: v.path.endsWith('sign-out') ? 'Signed out of every device' : 'Saved' }); },
    onError: (e) => toast({ text: (e as Error).message, bad: true }),
  });
  if (d.isPending) return <Skeleton n={4} h={90} />;
  if (d.error) return <ErrorBox error={d.error} retry={() => d.refetch()} />;
  const { customer: c, totals } = d.data;
  const current = d.data.orders.filter((o) => o.current);
  const past = d.data.orders.filter((o) => !o.current);
  const orderRow = (o: Detail['orders'][number]) => (
    <li key={o.number}><Link to={`/orders/${o.number}`} className="cust-order">
      {o.image ? <img className="thumb" src={o.image} alt="" /> : <span className="thumb" />}
      <span className="cust-order__what"><strong>{o.number}</strong><span className="muted small">{o.title}{o.items > 1 ? ` + ${o.items - 1} more` : ''} · {dateTime(o.createdAt)}</span></span>
      <StatusBadge status={o.status} />
      <strong>{formatINR(o.total)}</strong>
    </Link></li>
  );

  return (
    <>
      <button className="btn btn--ghost" onClick={() => nav('/customers')} style={{ marginBottom: 'var(--sp-3)' }}><Icon name="arrowLeft" /> Customers</button>
      <section className="cust-hero card">
        <span className="avatar avatar--lg" aria-hidden="true">{initials(c.name, c.email)}</span>
        <div className="cust-hero__who">
          <h1>{c.name}</h1>
          <p className="muted">{c.email}{c.phone && ` · ${c.phone}`}</p>
          <p className="muted small">Joined {ago(c.createdAt)}{c.lastLoginAt && ` · last signed in ${ago(c.lastLoginAt)}`}{c.marketing ? ' · gets offers by email' : ''}{d.data.signedInDevices ? ` · signed in on ${d.data.signedInDevices} device${d.data.signedInDevices > 1 ? 's' : ''}` : ''}</p>
        </div>
        <div className="cust-hero__stats">
          <div><strong>{totals.orders}</strong><span>orders</span></div>
          <div><strong>{formatINR(totals.spent)}</strong><span>spent</span></div>
          <div><strong>{formatINR(totals.saved)}</strong><span>saved with offers</span></div>
        </div>
        {canManage && (
          <div className="row cust-hero__actions">
            {d.data.signedInDevices > 0 && <button className="btn btn--quiet btn--sm" onClick={() => act.mutate({ path: `/admin/customers/${id}/sign-out` })}>Sign out everywhere</button>}
            <button className="btn btn--quiet btn--sm" onClick={() => { if (c.disabled || confirm(`Close ${c.name}'s account? They'll be signed out and can't sign in. Their orders stay.`)) act.mutate({ path: `/admin/customers/${id}/access`, body: { disabled: !c.disabled } }); }}>{c.disabled ? 'Reopen account' : 'Close account'}</button>
          </div>
        )}
      </section>

      <div className="grid2 cust-grid">
        <div className="stack">
          <section className="card"><div className="card__head"><h2>Current orders</h2><span className="muted small">{current.length}</span></div>
            {current.length ? <ul className="cust-orders" role="list">{current.map(orderRow)}</ul> : <p className="muted">Nothing on the way right now.</p>}</section>
          <section className="card"><div className="card__head"><h2>Previous orders</h2><span className="muted small">{past.length}</span></div>
            {past.length ? <ul className="cust-orders" role="list">{past.map(orderRow)}</ul> : <p className="muted">No earlier orders.</p>}</section>
        </div>
        <div className="stack">
          <section className="card"><div className="card__head"><h2>Offers used</h2></div>
            {d.data.offers.length ? (
              <ul className="offers-used" role="list">{d.data.offers.map((o, i) => (
                <li key={i}><span className={`offer-chip offer-chip--${o.kind}`}>{o.code ?? o.label}</span><span className="muted small">{o.orderNumber} · {ago(o.at)}</span><strong>−{formatINR(o.amount)}</strong></li>
              ))}</ul>
            ) : <p className="muted">No offers used yet.</p>}
          </section>
          <section className="card"><div className="card__head"><h2>Saved addresses</h2></div>
            {d.data.addresses.length ? (
              <ul className="addr-list" role="list">{d.data.addresses.map((a) => (
                <li key={a.id}><strong>{a.label || a.name}{a.isDefault && <span className="badge" style={{ marginLeft: 8 }}>Default</span>}</strong>
                  <span className="muted small">{[a.name, a.line1, a.line2, a.landmark && `Near ${a.landmark}`, a.city, a.pincode].filter(Boolean).join(', ')} · {a.phone}</span></li>
              ))}</ul>
            ) : <p className="muted">No saved addresses.</p>}
          </section>
        </div>
      </div>
    </>
  );
}
