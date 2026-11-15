import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ApiError, get, post } from '../lib/api.ts';
import { formatINR } from '../lib/format.ts';
import { Icon } from '../components/Icon.tsx';
import { Field, useToast } from '../components/ui.tsx';

interface StockRow { id: string; title: string; option1: string | null; colourLabel: string | null; available: number; thumb: string | null }

/** Manual order (WhatsApp / phone / walk-in). Same server pricing and stock rules as the website. */
export default function NewOrder() {
  const nav = useNavigate();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [lines, setLines] = useState<{ row: StockRow; qty: number }[]>([]);
  const [c, setC] = useState({ name: '', phone: '', email: '', line1: '', city: '', pincode: '' });
  const [channel, setChannel] = useState<'whatsapp' | 'phone' | 'shop'>('whatsapp');
  const [method, setMethod] = useState<'upi' | 'cod' | 'whatsapp'>('upi');
  const [paid, setPaid] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const search = useQuery({ queryKey: ['stock', q, false], queryFn: () => get<StockRow[]>(`/admin/stock?q=${encodeURIComponent(q)}`), enabled: q.length >= 2 });
  const quote = useQuery({
    queryKey: ['quote', lines.map((l) => `${l.row.id}:${l.qty}`).join()], enabled: lines.length > 0,
    queryFn: () => post<{ total: number; shipping: number }>('/cart/quote', { lines: lines.map((l) => ({ variantId: l.row.id, qty: l.qty })) }),
  });
  // Walk-in orders are "delivered" at the boutique: use its own address.
  const shop = useQuery({ queryKey: ['settings'], queryFn: () => get<{ settings: { store: { address: { line1: string; line2: string; city: string; pincode: string } } } }>('/admin/settings') }).data?.settings.store.address;
  const create = useMutation({
    mutationFn: () => post('/admin/orders', {
      channel, paymentMethod: method, paid: method === 'cod' ? false : paid, note: '',
      lines: lines.map((l) => ({ variantId: l.row.id, qty: l.qty })),
      customer: { name: c.name, phone: c.phone, email: c.email.trim() },
      address: channel === 'shop' && !c.line1 ? { line1: `Collected at boutique${shop?.line1 ? `, ${shop.line1}` : ''}`, line2: shop?.line2 ?? '', city: shop?.city ?? '', pincode: shop?.pincode ?? '' } : { line1: c.line1, city: c.city, pincode: c.pincode },
    }),
    onSuccess: (r) => { toast({ text: `Order ${r.order.number} created` }); nav(`/orders/${r.order.number}`); },
    onError: (e) => { if (e instanceof ApiError) setErrors(Object.fromEntries(Object.entries(e.fields).map(([k, v]) => [k.split('.').pop()!, v]))); toast({ text: (e as Error).message, bad: true }); },
  });
  const set = (k: keyof typeof c) => (e: { target: { value: string } }) => setC({ ...c, [k]: e.target.value });

  return (
    <>
      <div className="page-head"><h1>New order</h1></div>
      <div className="stack">
        <div className="card stack">
          <h2>Items</h2>
          <input className="input" type="search" placeholder="Search product or SKU" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          {search.data && q.length >= 2 && (
            <div className="list" style={{ maxHeight: 280, overflow: 'auto' }}>
              {search.data.map((r) => (
                <button key={r.id} className="list-item" disabled={r.available <= 0} onClick={() => { setLines((ls) => ls.some((l) => l.row.id === r.id) ? ls : [...ls, { row: r, qty: 1 }]); setQ(''); }}>
                  {r.thumb ? <img className="thumb" src={r.thumb} alt="" /> : <span className="thumb" />}
                  <span style={{ flex: 1, textAlign: 'left' }}><strong>{r.title}</strong><br /><span className="muted small">{[r.option1, r.colourLabel].filter(Boolean).join(' / ')}</span></span>
                  <span className={`badge ${r.available ? 'badge--ok' : 'badge--bad'}`}>{r.available ? `${r.available} in stock` : 'Sold out'}</span>
                </button>
              ))}
            </div>
          )}
          {search.data && q.length >= 2 && search.data.length === 0 && (
            <div className="notice" style={{ alignItems: 'center' }}>
              <span style={{ flex: 1 }}>No product matches “{q}”.</span>
              <a className="btn btn--quiet" href={`/products/new?return=${encodeURIComponent('/orders/new')}`}><Icon name="plus" /> Add new product</a>
            </div>
          )}
          {lines.map((l) => (
            <div key={l.row.id} className="row" style={{ flexWrap: 'nowrap' }}>
              <span style={{ flex: 1 }}><strong>{l.row.title}</strong> <span className="muted">{[l.row.option1, l.row.colourLabel].filter(Boolean).join(' / ')}</span></span>
              <input className="input" style={{ width: 70 }} inputMode="numeric" value={l.qty} onChange={(e) => setLines((ls) => ls.map((x) => (x.row.id === l.row.id ? { ...x, qty: Math.max(1, Math.min(l.row.available, Number(e.target.value.replace(/\D/g, '')) || 1)) } : x)))} aria-label="Quantity" />
              <button className="icon-btn" onClick={() => setLines((ls) => ls.filter((x) => x.row.id !== l.row.id))} aria-label="Remove"><Icon name="trash" /></button>
            </div>
          ))}
          {quote.data && <p><strong>Total {formatINR(quote.data.total)}</strong> <span className="muted small">({quote.data.shipping ? `incl. ${formatINR(quote.data.shipping)} shipping` : 'free shipping'})</span></p>}
        </div>
        <div className="card stack">
          <h2>Customer</h2>
          <Field label="Order came from"><div className="seg">{(['whatsapp', 'phone', 'shop'] as const).map((v) => <button key={v} className={channel === v ? 'on' : ''} onClick={() => setChannel(v)}>{({ whatsapp: 'WhatsApp', phone: 'Phone call', shop: 'In the boutique' })[v]}</button>)}</div></Field>
          <div className="grid2">
            <Field label="Name" error={errors.name}><input className="input" value={c.name} onChange={set('name')} /></Field>
            <Field label="Mobile" error={errors.phone}><input className="input" inputMode="tel" value={c.phone} onChange={set('phone')} /></Field>
          </div>
          <Field label="Email (optional, for order updates)" error={errors.email}><input className="input" type="email" value={c.email} onChange={set('email')} /></Field>
          {channel !== 'shop' && <>
            <Field label="Address" error={errors.line1}><input className="input" value={c.line1} onChange={set('line1')} /></Field>
            <div className="grid2">
              <Field label="Town / city" error={errors.city}><input className="input" value={c.city} onChange={set('city')} /></Field>
              <Field label="Pincode" error={errors.pincode}><input className="input" inputMode="numeric" maxLength={6} value={c.pincode} onChange={set('pincode')} /></Field>
            </div>
          </>}
        </div>
        <div className="card stack">
          <h2>Payment</h2>
          <div className="seg">{(['upi', 'cod', 'whatsapp'] as const).map((v) => <button key={v} className={method === v ? 'on' : ''} onClick={() => setMethod(v)}>{({ upi: 'UPI', cod: 'Cash on delivery', whatsapp: 'Other / later' })[v]}</button>)}</div>
          {method !== 'cod' && <label className="check"><input type="checkbox" checked={paid} onChange={(e) => setPaid(e.target.checked)} /> Payment already received</label>}
        </div>
        <button className="btn btn--lg" disabled={!lines.length || !c.name || !c.phone || create.isPending} onClick={() => create.mutate()}>{create.isPending ? 'Creating…' : 'Create order'}</button>
      </div>
    </>
  );
}
