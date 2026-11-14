import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { get, post } from '../lib/api.ts';
import { dateTime, formatINR, METHOD_LABEL, STATUS_LABEL } from '../lib/format.ts';
import { useCan } from '../lib/me.ts';
import { Icon } from '../components/Icon.tsx';
import { ErrorBox, Field, Sheet, Skeleton, StatusBadge, useToast } from '../components/ui.tsx';

const COURIERS = ['India Post', 'DTDC', 'Delhivery', 'Blue Dart', 'Professional Couriers', 'ST Courier', 'Hand delivery'];

export default function OrderDetail() {
  const { number } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const can = useCan();
  const [ship, setShip] = useState(false);
  const [cancel, setCancel] = useState(false);
  const [note, setNote] = useState('');
  const o = useQuery({ queryKey: ['order', number], queryFn: () => get(`/admin/orders/${number}`) });
  const done = (msg: string) => { qc.invalidateQueries({ queryKey: ['order', number] }); qc.invalidateQueries({ queryKey: ['orders'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); toast({ text: msg }); };
  const fail = (e: unknown) => toast({ text: (e as Error).message, bad: true });
  const move = useMutation({ mutationFn: (b: Record<string, unknown>) => post(`/admin/orders/${number}/transition`, b), onSuccess: (r: { status: string }) => { done(`Order ${STATUS_LABEL[r.status]?.toLowerCase()}`); setShip(false); setCancel(false); }, onError: fail });
  const paid = useMutation({ mutationFn: () => post(`/admin/orders/${number}/mark-paid`), onSuccess: () => done('Marked as paid. The customer has been emailed.'), onError: fail });
  const addNote = useMutation({ mutationFn: () => post(`/admin/orders/${number}/notes`, { note }), onSuccess: () => { setNote(''); done('Note added'); }, onError: fail });

  if (o.isPending) return <Skeleton n={4} h={90} />;
  if (o.error) return <ErrorBox error={o.error} retry={() => o.refetch()} />;
  const d = o.data;
  const write = can('orders.write');
  const phone = String(d.phone ?? '');
  const wa = `https://wa.me/91${phone}?text=${encodeURIComponent(`Hi ${d.customerName.split(' ')[0]}, this is Femia about your order ${d.number}.`)}`;
  const holdLeft = d.holdExpiresAt ? Math.max(0, Math.round((Date.parse(d.holdExpiresAt) - Date.now()) / 60000)) : null;

  const primary = (() => {
    if (!write) return null;
    if (d.status === 'pending_payment' && d.paymentMethod === 'upi') return <button className="btn btn--lg" disabled={paid.isPending} onClick={() => confirm(`Have you received ${formatINR(d.total)} by UPI for ${d.number}? Check your UPI app first.`) && paid.mutate()}>Mark UPI paid · {formatINR(d.total)}</button>;
    if (d.status === 'new') return <button className="btn btn--lg" onClick={() => move.mutate({ to: 'confirmed' })}>Confirm order</button>;
    if (d.status === 'confirmed') return <button className="btn btn--lg" onClick={() => move.mutate({ to: 'packed' })}>Mark packed</button>;
    if (d.status === 'packed') return <button className="btn btn--lg" onClick={() => setShip(true)}>Ship order</button>;
    if (d.status === 'shipped') return <button className="btn btn--lg" onClick={() => move.mutate({ to: 'delivered' })}>Mark delivered</button>;
    return null;
  })();

  return (
    <>
      <div className="page-head">
        <div><Link to="/orders" className="muted small" style={{ textDecoration: 'none' }}>← Orders</Link><h1>{d.number}</h1><p className="muted">{dateTime(d.createdAt)} · {d.channel === 'web' ? 'Website' : `via ${d.channel}`}</p></div>
        <div className="row"><StatusBadge status={d.status} /><span className={`badge ${d.paymentStatus === 'paid' ? 'badge--ok' : d.paymentStatus === 'failed' ? 'badge--bad' : 'badge--warn'}`}>{METHOD_LABEL[d.paymentMethod]} · {({ paid: 'Paid', unpaid: 'Not paid', cod: 'Collect on delivery', failed: 'Payment failed', refunded: 'Refunded' } as Record<string, string>)[d.paymentStatus]}</span></div>
      </div>

      {d.notes && d.notes.includes('⚠') && <div className="notice notice--bad" style={{ marginBottom: 'var(--sp-4)' }}><Icon name="info" /> {d.notes}</div>}
      {d.status === 'pending_payment' && holdLeft !== null && <div className="notice" style={{ marginBottom: 'var(--sp-4)' }}><Icon name="clock" /> Items held for {holdLeft > 90 ? `${Math.round(holdLeft / 60)} h` : `${holdLeft} min`} more. If unpaid by then, the order cancels and stock is released.</div>}

      <div className="row no-print" style={{ marginBottom: 'var(--sp-4)' }}>
        {primary}
        {write && d.status === 'new' && d.paymentStatus === 'unpaid' && d.paymentMethod !== 'gateway' && <button className="btn btn--quiet" onClick={() => paid.mutate()}>Mark paid</button>}
        <span className="spacer" />
        <Link className="btn btn--quiet" to={`/orders/${d.number}/print/bill`}><Icon name="printer" /> Bill</Link>
        <Link className="btn btn--quiet" to={`/orders/${d.number}/print/slip`}><Icon name="printer" /> Packing slip</Link>
        {write && ['pending_payment', 'new', 'confirmed', 'packed'].includes(d.status) && <button className="btn btn--danger" onClick={() => setCancel(true)}>Cancel</button>}
      </div>

      <div className="grid2" style={{ alignItems: 'start' }}>
        <div className="card">
          <h2 style={{ marginBottom: 'var(--sp-3)' }}>Items</h2>
          <div className="stack" style={{ gap: 'var(--sp-3)' }}>
            {d.items.map((i: any) => (
              <div key={i.variantId} className="row" style={{ flexWrap: 'nowrap' }}>
                {i.imageUrl ? <img className="thumb" src={i.imageUrl} alt="" /> : <span className="thumb" />}
                <span style={{ flex: 1 }}><strong>{i.title}</strong><br /><span className="muted small">{i.optionLabel} · {i.sku}</span></span>
                <span>× {i.qty}</span><strong>{formatINR(i.lineTotal)}</strong>
              </div>
            ))}
          </div>
          <dl style={{ display: 'grid', gap: 4, marginTop: 'var(--sp-4)', paddingTop: 'var(--sp-3)', borderTop: '1px solid var(--c-line)' }}>
            <div className="row" style={{ justifyContent: 'space-between' }}><dt className="muted">Subtotal</dt><dd>{formatINR(d.subtotal)}</dd></div>
            <div className="row" style={{ justifyContent: 'space-between' }}><dt className="muted">Shipping</dt><dd>{d.shipping ? formatINR(d.shipping) : 'Free'}</dd></div>
            <div className="row" style={{ justifyContent: 'space-between', fontWeight: 700, fontSize: '1.125rem' }}><dt>Total</dt><dd>{formatINR(d.total)}</dd></div>
          </dl>
        </div>
        <div className="stack">
          <div className="card">
            <h2 style={{ marginBottom: 'var(--sp-3)' }}>Customer</h2>
            <p><strong>{d.customerName}</strong><br />{phone}{d.email && <><br />{d.email}</>}</p>
            <p style={{ marginTop: 8 }}>{[d.address.line1, d.address.line2, d.address.landmark && `Near ${d.address.landmark}`, d.address.city, d.address.pincode].filter(Boolean).join(', ')}</p>
            <div className="row no-print" style={{ marginTop: 'var(--sp-3)' }}>
              <a className="btn btn--quiet" href={`tel:+91${phone}`}><Icon name="phone" /> Call</a>
              <a className="btn btn--quiet" href={wa} target="_blank" rel="noopener"><Icon name="whatsapp" /> WhatsApp</a>
            </div>
            {d.courier && <p style={{ marginTop: 'var(--sp-3)' }}><strong>Shipped:</strong> {d.courier} {d.trackingNumber} {d.trackingUrl && <a href={d.trackingUrl} target="_blank" rel="noopener">Track</a>}</p>}
          </div>
          <div className="card">
            <h2 style={{ marginBottom: 'var(--sp-3)' }}>Timeline</h2>
            <ol className="stack" style={{ listStyle: 'none', padding: 0, gap: 8 }}>
              {d.events.map((e: any, i: number) => (
                <li key={i} className="small"><strong>{STATUS_LABEL[e.status] ?? (e.status === 'note' ? 'Note' : e.status === 'paid' ? 'Paid' : e.status)}</strong>{e.note && <> · {e.note}</>}<br /><span className="muted">{dateTime(e.at)} · {e.actor}{!e.public && ' · internal'}</span></li>
              ))}
            </ol>
            {write && <div className="row no-print" style={{ marginTop: 'var(--sp-3)', flexWrap: 'nowrap' }}><input className="input" placeholder="Add an internal note" value={note} onChange={(e) => setNote(e.target.value)} /><button className="btn btn--quiet" disabled={!note.trim()} onClick={() => addNote.mutate()}>Add</button></div>}
          </div>
        </div>
      </div>

      {ship && <ShipSheet onClose={() => setShip(false)} busy={move.isPending} onShip={(b) => move.mutate({ to: 'shipped', ...b })} />}
      {cancel && <CancelSheet onClose={() => setCancel(false)} busy={move.isPending} paid={d.paymentStatus === 'paid'} onCancel={(reason) => move.mutate({ to: 'cancelled', reason })} />}
    </>
  );
}

function ShipSheet({ onClose, onShip, busy }: { onClose: () => void; onShip: (b: { courier: string; trackingNumber?: string; trackingUrl?: string }) => void; busy: boolean }) {
  const [courier, setCourier] = useState('');
  const [no, setNo] = useState('');
  const [url, setUrl] = useState('');
  return (
    <Sheet title="Ship order" onClose={onClose} footer={<button className="btn btn--lg btn--block" disabled={!courier || busy} onClick={() => onShip({ courier, trackingNumber: no || undefined, trackingUrl: url || undefined })}>Mark shipped & email customer</button>}>
      <div className="stack">
        <Field label="Courier"><div className="row" style={{ gap: 6 }}>{COURIERS.map((c) => <button type="button" key={c} className={`badge ${courier === c ? 'badge--maroon' : ''}`} style={{ minHeight: 36, padding: '0 14px', fontSize: '.875rem' }} onClick={() => setCourier(c)}>{c}</button>)}</div>
          <input className="input" style={{ marginTop: 8 }} placeholder="Or type another courier" value={COURIERS.includes(courier) ? '' : courier} onChange={(e) => setCourier(e.target.value)} /></Field>
        <Field label="Tracking number"><input className="input" value={no} onChange={(e) => setNo(e.target.value)} /></Field>
        <Field label="Tracking link (optional)" hint="Paste the courier's tracking page link. It goes in the customer's email."><input className="input" type="url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" /></Field>
      </div>
    </Sheet>
  );
}

function CancelSheet({ onClose, onCancel, busy, paid }: { onClose: () => void; onCancel: (reason: string) => void; busy: boolean; paid: boolean }) {
  const [reason, setReason] = useState('Customer asked to cancel');
  return (
    <Sheet title="Cancel order" onClose={onClose} footer={<><button className="btn btn--quiet" onClick={onClose}>Keep order</button><span className="spacer" /><button className="btn btn--danger" disabled={busy} onClick={() => onCancel(reason)}>Cancel order</button></>}>
      <div className="stack">
        <p>Stock goes back to the shelf automatically.</p>
        {paid && <div className="notice"><Icon name="info" /> This order is paid. Refund the customer from your UPI app or gateway dashboard. Automated refunds arrive in 1.2.</div>}
        <Field label="Reason (shown to the customer)"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} /></Field>
      </div>
    </Sheet>
  );
}
