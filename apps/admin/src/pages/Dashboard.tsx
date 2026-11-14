import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { get } from '../lib/api.ts';
import { formatINR } from '../lib/format.ts';
import { useCan, useMe } from '../lib/me.ts';
import { Icon } from '../components/Icon.tsx';
import { ErrorBox, Skeleton } from '../components/ui.tsx';

interface Dash {
  today: { orders: number; revenue: number }; last7Days: { orders: number; revenue: number };
  daily: { day: string; revenue: number; orders: number }[];
  ordersWaiting: number; upiAwaitingVerification: number;
  lowStock: { variant_id: string; sku: string; title: string; option1: string | null; option2: string | null; available: number }[];
}

export function Dashboard() {
  const me = useMe();
  const can = useCan();
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => get<Dash>('/admin/dashboard'), enabled: can('dashboard.view'), refetchInterval: 60_000 });
  const hour = Number(new Intl.DateTimeFormat('en-IN', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kolkata' }).format(new Date()));
  const hello = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(Date.now() + 5.5 * 3600e3 - (6 - i) * 864e5).toISOString().slice(0, 10);
    return { day: d, revenue: q.data?.daily.find((x) => x.day === d)?.revenue ?? 0 };
  });
  const max = Math.max(1, ...days.map((d) => d.revenue));

  return (
    <>
      <div className="page-head">
        <div><h1>{hello}{me.name ? `, ${me.name.split(' ')[0]}` : ''}</h1><p className="muted">Here's your store today.</p></div>
        <div className="row">
          {can('catalog.write') && <Link className="btn" to="/products/new"><Icon name="plus" /> Add product</Link>}
          {can('orders.write') && <Link className="btn btn--quiet" to="/orders/new"><Icon name="bag" /> New order</Link>}
        </div>
      </div>
      {q.isPending ? <Skeleton n={3} h={96} /> : q.error ? <ErrorBox error={q.error} retry={() => q.refetch()} /> : (
        <div className="stack">
          {(q.data.upiAwaitingVerification > 0 || q.data.ordersWaiting > 0) && (
            <Link to="/orders" className="notice" style={{ textDecoration: 'none' }}>
              <Icon name="bag" />
              <span style={{ flex: 1 }}>
                {q.data.ordersWaiting > 0 && <><strong>{q.data.ordersWaiting} order{q.data.ordersWaiting > 1 ? 's' : ''}</strong> waiting to be packed or shipped. </>}
                {q.data.upiAwaitingVerification > 0 && <><strong>{q.data.upiAwaitingVerification} UPI payment{q.data.upiAwaitingVerification > 1 ? 's' : ''}</strong> to verify.</>}
              </span>
              <Icon name="chevronRight" />
            </Link>
          )}
          <div className="grid2">
            <div className="card"><p className="muted small">Today</p><p style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--c-ink)' }}>{formatINR(q.data.today.revenue)}</p><p className="muted small">{q.data.today.orders} order{q.data.today.orders === 1 ? '' : 's'}</p></div>
            <div className="card">
              <p className="muted small">Last 7 days</p>
              <p style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--c-ink)' }}>{formatINR(q.data.last7Days.revenue)}</p>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 48, marginTop: 8 }} aria-label="Daily sales, last 7 days" role="img">
                {days.map((d) => <span key={d.day} title={`${d.day}: ${formatINR(d.revenue)}`} style={{ flex: 1, height: `${Math.max(4, (d.revenue / max) * 100)}%`, background: d.revenue ? 'var(--c-maroon)' : 'var(--c-line)', borderRadius: 3 }} />)}
              </div>
            </div>
          </div>
          <div className="card">
            <div className="card__head"><h2>Low stock</h2>{can('stock.write') && <Link to="/stock?filter=low" className="btn btn--ghost">Update stock</Link>}</div>
            {q.data.lowStock.length === 0 ? <p className="muted">Everything is well stocked.</p> : (
              <ul className="list" style={{ listStyle: 'none', padding: 0 }}>
                {q.data.lowStock.map((l) => (
                  <li key={l.variant_id} className="row" style={{ justifyContent: 'space-between', borderBottom: '1px solid var(--c-line)', padding: '8px 0' }}>
                    <span><strong>{l.title}</strong> <span className="muted">{[l.option1, l.option2].filter(Boolean).join(' / ')}</span></span>
                    <span className={`badge ${l.available === 0 ? 'badge--bad' : 'badge--warn'}`}>{l.available === 0 ? 'Sold out' : `${l.available} left`}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </>
  );
}
