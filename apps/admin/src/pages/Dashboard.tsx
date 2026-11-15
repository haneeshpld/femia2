import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { get } from '../lib/api.ts';
import { ago, formatINR } from '../lib/format.ts';
import { useCan, useMe } from '../lib/me.ts';
import { Icon } from '../components/Icon.tsx';
import { ErrorBox, Skeleton } from '../components/ui.tsx';

type Stage = 'pending_payment' | 'new' | 'confirmed' | 'packed' | 'shipped' | 'delivered' | 'cancelled';
interface Dash {
  today: { orders: number; revenue: number }; last7Days: { orders: number; revenue: number }; previous7Days: { orders: number; revenue: number };
  daily: { day: string; revenue: number; orders: number }[];
  ordersWaiting: number; upiAwaitingVerification: number; holdsExpiringSoon: number;
  pipeline: Record<Stage, { count: number; oldestAt: string | null; stalled: number }>;
  codToCollect: { orders: number; amount: number };
  topProducts: { title: string; slug: string; qty: number; revenue: number }[];
  offers: { live: number; names: string[]; endingNext: { name: string; endsAt: string } | null; given7Days: number };
  lowStock: { variant_id: string; sku: string; title: string; option1: string | null; option2: string | null; available: number }[];
}

/** The flow an order takes. "act" stages are the shop's move; the rest are waiting on someone else or finished. */
const FLOW: { id: Exclude<Stage, 'cancelled'>; label: string; role: 'wait' | 'act' | 'transit' | 'done'; stall: string }[] = [
  { id: 'pending_payment', label: 'Awaiting payment', role: 'wait', stall: '' },
  { id: 'new', label: 'New', role: 'act', stall: 'over a day old' },
  { id: 'confirmed', label: 'Confirmed', role: 'act', stall: 'over 2 days' },
  { id: 'packed', label: 'Packed', role: 'act', stall: 'over 2 days' },
  { id: 'shipped', label: 'Shipped', role: 'transit', stall: 'over a week' },
  { id: 'delivered', label: 'Delivered', role: 'done', stall: '' },
];
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The one thing to do next, most urgent first. */
function nextUp(d: Dash): { stage: Stage; text: string } | null {
  const p = d.pipeline;
  if (d.upiAwaitingVerification > 0) return { stage: 'pending_payment', text: `Check ${plural(d.upiAwaitingVerification, 'UPI payment')} and mark ${d.upiAwaitingVerification === 1 ? 'it' : 'them'} paid` };
  if (p.new.count > 0) return { stage: 'new', text: `Confirm ${plural(p.new.count, 'new order')}` };
  if (p.confirmed.count > 0) return { stage: 'confirmed', text: `Pack ${plural(p.confirmed.count, 'confirmed order')}` };
  if (p.packed.count > 0) return { stage: 'packed', text: `Hand ${plural(p.packed.count, 'packed order')} to the courier` };
  return null;
}

export function Dashboard() {
  const me = useMe();
  const can = useCan();
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => get<Dash>('/admin/dashboard'), enabled: can('dashboard.view'), refetchInterval: 60_000 });
  const hour = Number(new Intl.DateTimeFormat('en-IN', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kolkata' }).format(new Date()));
  const hello = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <>
      <div className="page-head">
        <div><h1>{hello}{me.name ? `, ${me.name.split(' ')[0]}` : ''}</h1><p className="muted">Here's your store today.</p></div>
        <div className="row">
          {can('catalog.write') && <Link className="btn" to="/products/new"><Icon name="plus" /> Add product</Link>}
          {can('orders.write') && <Link className="btn btn--quiet" to="/orders/new"><Icon name="bag" /> New order</Link>}
        </div>
      </div>
      {q.isPending ? <Skeleton n={3} h={110} /> : q.error ? <ErrorBox error={q.error} retry={() => q.refetch()} /> : <Body d={q.data} canOrders={can('orders.read')} canStock={can('stock.write')} canOffers={can('catalog.read')} />}
    </>
  );
}

function Body({ d, canOrders, canStock, canOffers }: { d: Dash; canOrders: boolean; canStock: boolean; canOffers: boolean }) {
  const next = nextUp(d);
  const days = Array.from({ length: 7 }, (_, i) => {
    const day = new Date(Date.now() + 5.5 * 3600e3 - (6 - i) * 864e5).toISOString().slice(0, 10);
    return { day, revenue: d.daily.find((x) => x.day === day)?.revenue ?? 0 };
  });
  const max = Math.max(1, ...days.map((x) => x.revenue));
  const trend = d.previous7Days.revenue > 0 ? Math.round(((d.last7Days.revenue - d.previous7Days.revenue) / d.previous7Days.revenue) * 100) : null;
  const aov = d.last7Days.orders ? Math.round(d.last7Days.revenue / d.last7Days.orders / 100) * 100 : 0;
  const toOrders = (s: string) => (canOrders ? `/orders?status=${s}` : '#');
  const openTotal = FLOW.filter((s) => s.role !== 'done').reduce((n, s) => n + d.pipeline[s.id].count, 0);

  return (
    <div className="stack">
      {canOrders && (next ? (
        <Link to={toOrders(next.stage)} className="next-up">
          <span className="next-up__icon"><Icon name="bag" /></span>
          <span className="next-up__text"><span className="next-up__label">Next up</span><strong>{next.text}</strong></span>
          <Icon name="chevronRight" />
        </Link>
      ) : (
        <div className="next-up next-up--clear"><span className="next-up__icon"><Icon name="check" /></span><span className="next-up__text"><strong>All caught up.</strong> No orders are waiting on you.</span></div>
      ))}

      <section className="card pipe" aria-labelledby="pipe-title">
        <div className="card__head">
          <div><h2 id="pipe-title">Orders by stage</h2><p className="muted small">{plural(openTotal, 'open order')}. Delivered and cancelled show the last 30 days.</p></div>
          {canOrders && <Link to="/orders?status=all" className="btn btn--ghost">All orders</Link>}
        </div>
        <ol className="pipe__flow">
          {FLOW.map((s) => {
            const st = d.pipeline[s.id];
            const isNext = next?.stage === s.id;
            const cls = ['pipe__stage', `pipe__stage--${s.role}`, st.count === 0 && 'is-empty', isNext && 'is-next'].filter(Boolean).join(' ');
            const sub = st.count === 0 ? (s.role === 'done' ? 'last 30 days' : 'none')
              : st.stalled > 0 && s.stall ? <span className="pipe__late">{st.stalled} {s.stall}</span>
              : s.id === 'pending_payment' && d.holdsExpiringSoon > 0 ? <span className="pipe__late">{d.holdsExpiringSoon} expiring soon</span>
              : s.role === 'done' ? 'last 30 days'
              : st.oldestAt ? `oldest ${ago(st.oldestAt)}` : '';
            return (
              <li key={s.id}>
                <Link to={toOrders(s.id)} className={cls} aria-label={`${s.label}: ${st.count}`}>
                  <span className="pipe__count">{st.count}</span>
                  <span className="pipe__label">{s.label}</span>
                  <span className="pipe__sub">{sub}</span>
                </Link>
              </li>
            );
          })}
        </ol>
        <p className="pipe__foot small">
          <Link to={toOrders('cancelled')}>{plural(d.pipeline.cancelled.count, 'order')} cancelled</Link> in the last 30 days
          {d.codToCollect.orders > 0 && <> · <strong>{formatINR(d.codToCollect.amount)}</strong> cash on delivery still to collect from {plural(d.codToCollect.orders, 'order')}</>}
        </p>
      </section>

      <div className="grid3 dash-sales">
        <div className="card stat">
          <p className="muted small">Today</p>
          <p className="stat__num">{formatINR(d.today.revenue)}</p>
          <p className="muted small">{plural(d.today.orders, 'order')}</p>
        </div>
        <div className="card stat">
          <p className="muted small">Last 7 days</p>
          <p className="stat__num">{formatINR(d.last7Days.revenue)}</p>
          <p className="small">
            {trend !== null
              ? <span className={trend >= 0 ? 'trend trend--up' : 'trend trend--down'}>{trend >= 0 ? '▲' : '▼'} {Math.abs(trend)}% vs the week before</span>
              : <span className="muted">{plural(d.last7Days.orders, 'order')}</span>}
          </p>
          <div className="bars" aria-label="Daily sales, last 7 days" role="img">
            {days.map((x) => <span key={x.day} title={`${x.day}: ${formatINR(x.revenue)}`} style={{ height: `${Math.max(4, (x.revenue / max) * 100)}%` }} className={x.revenue ? '' : 'is-zero'} />)}
          </div>
        </div>
        <div className="card stat">
          <p className="muted small">Average order (7 days)</p>
          <p className="stat__num">{aov ? formatINR(aov) : '—'}</p>
          <p className="muted small">{plural(d.last7Days.orders, 'order')} this week</p>
        </div>
      </div>

      <div className="grid2">
        <section className="card" aria-labelledby="top-title">
          <div className="card__head"><h2 id="top-title">Best sellers this week</h2></div>
          {d.topProducts.length === 0 ? <p className="muted">No sales yet this week.</p> : (
            <ol className="top-list">
              {d.topProducts.map((p, i) => (
                <li key={p.slug}>
                  <span className="top-list__rank">{i + 1}</span>
                  <span className="top-list__name">{p.title}</span>
                  <span className="muted small">{plural(p.qty, 'piece')} · {formatINR(p.revenue)}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
        <section className="card" aria-labelledby="offers-title">
          <div className="card__head"><h2 id="offers-title">Offers</h2>{canOffers && <Link to="/offers" className="btn btn--ghost">Manage</Link>}</div>
          {d.offers.live === 0 ? <p className="muted">No offers running. Sales, bundle deals and codes help slow weeks.</p> : (
            <div className="stack" style={{ gap: 'var(--sp-3)' }}>
              <p><strong>{plural(d.offers.live, 'offer')} live</strong>{d.offers.names.length > 0 && <span className="muted">: {d.offers.names.join(', ')}</span>}</p>
              {d.offers.endingNext && <p className="small"><Icon name="clock" size={16} /> {d.offers.endingNext.name} ends {ago(d.offers.endingNext.endsAt)}</p>}
              <p className="muted small">{formatINR(d.offers.given7Days)} given in bag discounts this week</p>
            </div>
          )}
        </section>
      </div>

      <section className="card" aria-labelledby="low-title">
        <div className="card__head"><h2 id="low-title">Low stock</h2>{canStock && <Link to="/stock?filter=low" className="btn btn--ghost">Update stock</Link>}</div>
        {d.lowStock.length === 0 ? <p className="muted">Everything is well stocked.</p> : (
          <ul className="list" style={{ listStyle: 'none', padding: 0 }}>
            {d.lowStock.map((l) => (
              <li key={l.variant_id} className="row" style={{ justifyContent: 'space-between', borderBottom: '1px solid var(--c-line)', padding: '8px 0' }}>
                <span><strong>{l.title}</strong> <span className="muted">{[l.option1, l.option2].filter(Boolean).join(' / ')}</span></span>
                <span className={`badge ${l.available === 0 ? 'badge--bad' : 'badge--warn'}`}>{l.available === 0 ? 'Sold out' : `${l.available} left`}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
