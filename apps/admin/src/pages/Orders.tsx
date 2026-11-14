import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { get } from '../lib/api.ts';
import { ago, formatINR, METHOD_LABEL } from '../lib/format.ts';
import { useCan } from '../lib/me.ts';
import { Icon } from '../components/Icon.tsx';
import { Empty, ErrorBox, Skeleton, StatusBadge } from '../components/ui.tsx';

interface Row { number: string; status: string; paymentMethod: string; paymentStatus: string; channel: string; customerName: string; city: string; total: number; createdAt: string; itemCount: number }
const TABS = [['active', 'To do'], ['pending_payment', 'Awaiting payment'], ['new', 'New'], ['confirmed', 'Confirmed'], ['packed', 'Packed'], ['shipped', 'Shipped'], ['delivered', 'Delivered'], ['cancelled', 'Cancelled'], ['all', 'All']] as const;

export default function Orders() {
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('status') ?? 'active';
  const [q, setQ] = useState('');
  const can = useCan();
  const nav = useNavigate();
  const list = useQuery({
    queryKey: ['orders', tab, q],
    queryFn: () => get<{ items: Row[]; total: number }>(`/admin/orders?status=${tab}&pageSize=100${q ? `&q=${encodeURIComponent(q)}` : ''}`),
    refetchInterval: 30_000, placeholderData: (p) => p,
  });
  return (
    <>
      <div className="page-head">
        <div><h1>Orders</h1><p className="muted">{list.data ? `${list.data.total} order${list.data.total === 1 ? '' : 's'}` : ' '}</p></div>
        {can('orders.write') && <Link to="/orders/new" className="btn"><Icon name="plus" /> New order</Link>}
      </div>
      <div className="row" style={{ marginBottom: 'var(--sp-4)' }}>
        <div className="seg">{TABS.map(([v, l]) => <button key={v} className={tab === v ? 'on' : ''} onClick={() => setSp({ status: v })}>{l}</button>)}</div>
        <span className="spacer" />
        <input className="input" style={{ maxWidth: 260 }} type="search" placeholder="Order no., phone or name" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search orders" />
      </div>
      {list.isPending ? <Skeleton n={5} /> : list.error ? <ErrorBox error={list.error} retry={() => list.refetch()} /> : list.data.items.length === 0 ? (
        <Empty icon="bag" title={tab === 'active' ? 'All caught up' : 'No orders here'} body={tab === 'active' ? 'New orders will appear here, and you will get a Telegram alert.' : undefined} />
      ) : (
        <div className="list">
          {list.data.items.map((o) => (
            <button key={o.number} className="list-item" style={{ width: '100%', textAlign: 'left' }} onClick={() => nav(`/orders/${o.number}`)}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span className="row" style={{ gap: 8 }}><strong>{o.number}</strong><StatusBadge status={o.status} />{o.paymentStatus === 'paid' && <span className="badge badge--ok">Paid</span>}{o.paymentStatus === 'failed' && <span className="badge badge--bad">Payment failed</span>}</span>
                <span className="muted small">{o.customerName} · {o.city} · {o.itemCount} item{o.itemCount === 1 ? '' : 's'} · {METHOD_LABEL[o.paymentMethod]}{o.channel !== 'web' ? ` · via ${o.channel}` : ''}</span>
              </span>
              <span style={{ display: 'grid', justifyItems: 'end' }}><strong>{formatINR(o.total)}</strong><span className="muted small">{ago(o.createdAt)}</span></span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
