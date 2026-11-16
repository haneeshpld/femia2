import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { get, post } from '../lib/api.ts';
import { dateTime, formatINR, instrumentLabel, METHOD_LABEL, STATUS_LABEL } from '../lib/format.ts';
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
  const [refunding, setRefunding] = useState(false);
  const [note, setNote] = useState('');
  const o = useQuery({ queryKey: ['order', number], queryFn: () => get(`/admin/orders/${number}`) });
  const done = (msg: string) => { qc.invalidateQueries({ queryKey: ['order', number] }); qc.invalidateQueries({ queryKey: ['orders'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); toast({ text: msg }); };
  const fail = (e: unknown) => toast({ text: (e as Error).message, bad: true });
  const move = useMutation({ mutationFn: (b: Record<string, unknown>) => post(`/admin/orders/${number}/transition`, b), onSuccess: (r: { status: string }) => { done(`Order ${STATUS_LABEL[r.status]?.toLowerCase()}`); setShip(false); setCancel(false); }, onError: fail });
  const paid = useMutation({ mutationFn: () => post(`/admin/orders/${number}/mark-paid`), onSuccess: () => done('Marked as paid. The customer has been emailed.'), onError: fail });
  const checkPay = useMutation({ mutationFn: () => post<{ status: string }>(`/admin/orders/${number}/check-payment`), onSuccess: (r) => (r.status === 'paid' ? done('Razorpay confirms the payment. The order is now paid.') : toast({ text: 'Razorpay has no completed payment for this order yet.' })), onError: fail });
  const refundAct = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: object }) => post<{ status?: string; error?: string }>(path, body),
    onSuccess: (r, v) => {
      if (r?.status === 'failed') { toast({ text: `Refund didn’t go through: ${r.error ?? 'gateway error'}. You can retry.`, bad: true }); qc.invalidateQueries({ queryKey: ['order', number] }); return; }
      done(v.path.endsWith('/sent') ? 'Refund marked as sent' : v.path.endsWith('/check') ? `Refund is ${r?.status ?? 'updated'}` : v.path.endsWith('/retry') ? 'Refund sent to Razorpay again' : 'Refund started');
      setRefunding(false);
    },
    onError: fail,
  });
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
    if (d.status === 'pending_payment' && d.paymentMethod === 'gateway') return <button className="btn btn--lg" disabled={checkPay.isPending} onClick={() => checkPay.mutate()}>{checkPay.isPending ? 'Checking…' : 'Check payment with Razorpay'}</button>;
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
        {/* WhatsApp / phone orders are often confirmed or shipped before the money arrives: paying must stay recordable at every stage */}
        {write && ['new', 'confirmed', 'packed', 'shipped', 'delivered'].includes(d.status) && d.paymentStatus === 'unpaid' && d.paymentMethod !== 'gateway' && (
          <button className="btn btn--quiet" disabled={paid.isPending} onClick={() => confirm(`Have you received ${formatINR(d.total)} for ${d.number}?`) && paid.mutate()}>Mark paid</button>
        )}
        <span className="spacer" />
        <Link className="btn btn--quiet" to={`/orders/${d.number}/print/bill`}><Icon name="printer" /> Bill</Link>
        <Link className="btn btn--quiet" to={`/orders/${d.number}/print/slip`}><Icon name="printer" /> Packing slip</Link>
        {can('payments.refund') && d.refundable > 0 && <button className="btn btn--quiet" onClick={() => setRefunding(true)}><Icon name="undo" /> Refund</button>}
        {/* cancelling a paid order is a refund decision, so it needs the refund permission (the API checks too) */}
        {write && ['pending_payment', 'new', 'confirmed', 'packed'].includes(d.status) && (d.paymentStatus !== 'paid' || can('payments.refund')) && <button className="btn btn--danger" onClick={() => setCancel(true)}>Cancel</button>}
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
            {(d.discounts ?? []).map((x: { label: string; code: string | null; amount: number }, k: number) => (
              <div key={k} className="row" style={{ justifyContent: 'space-between', color: 'var(--c-maroon)' }}><dt>{x.label}{x.code && ` · ${x.code}`}</dt><dd>−{formatINR(x.amount)}</dd></div>
            ))}
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
          <PaymentCard d={d} />
          {(d.refundList?.length ?? 0) > 0 && (
            <RefundsCard list={d.refundList} write={write} refund={can('payments.refund')} busy={refundAct.isPending}
              onAction={(path, body) => refundAct.mutate({ path, body })} />
          )}
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
      {cancel && <CancelSheet onClose={() => setCancel(false)} busy={move.isPending} paid={d.paymentStatus === 'paid'} amount={d.refundable} online={d.paymentMethod === 'gateway' && !!d.payment?.reference}
        onCancel={(reason, refund) => move.mutate({ to: 'cancelled', reason, refund })} />}
      {refunding && <RefundSheet max={d.refundable} online={d.paymentMethod === 'gateway' && !!d.payment?.reference} busy={refundAct.isPending} onClose={() => setRefunding(false)}
        onRefund={(amount, reason) => refundAct.mutate({ path: `/admin/orders/${d.number}/refunds`, body: { amount, reason } })} />}
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

const PAY_LABEL: Record<string, string> = { paid: 'Paid', unpaid: 'Not paid', cod: 'Collect on delivery', failed: 'Payment failed', refunded: 'Refunded' };
const REFUND_LABEL: Record<string, [string, string]> = {
  pending: ['In progress', 'badge--warn'], processed: ['Refunded', 'badge--ok'], failed: ['Failed', 'badge--bad'], to_send: ['To send by UPI', 'badge--maroon'], sent: ['Sent', 'badge--ok'],
};
const rzpPayment = (id: string) => `https://dashboard.razorpay.com/app/payments/${encodeURIComponent(id)}`;

function Copy({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return <button type="button" className="copy-btn" onClick={() => { navigator.clipboard?.writeText(text); setOk(true); setTimeout(() => setOk(false), 1500); }} aria-label={`Copy ${text}`}>{ok ? 'Copied' : 'Copy'}</button>;
}

/** How the order was paid: method, state, gateway ids (linked to Razorpay), when, and every gateway attempt. */
function PaymentCard({ d }: { d: any }) {
  const p = d.payment;
  if (!p) return null;
  return (
    <div className="card pay-card">
      <div className="card__head" style={{ marginBottom: 'var(--sp-3)' }}><h2>Payment</h2>
        <span className={`badge ${d.paymentStatus === 'paid' || d.paymentStatus === 'refunded' ? 'badge--ok' : d.paymentStatus === 'failed' ? 'badge--bad' : 'badge--warn'}`}>{PAY_LABEL[d.paymentStatus]}</span></div>
      <dl className="kv">
        <div><dt>Method</dt><dd>{instrumentLabel(p.instrument) ? `${instrumentLabel(p.instrument)} · ` : ''}{METHOD_LABEL[d.paymentMethod]}{p.provider ? ` · ${p.provider === 'razorpay' ? 'Razorpay' : p.provider}` : ''}</dd></div>
        <div><dt>Amount</dt><dd>{formatINR(p.amount)}</dd></div>
        {p.reference && <div><dt>Payment ID</dt><dd><a href={rzpPayment(p.reference)} target="_blank" rel="noopener"><code>{p.reference}</code></a> <Copy text={p.reference} /></dd></div>}
        {p.gatewayOrderId && <div><dt>Razorpay order</dt><dd><code>{p.gatewayOrderId}</code> <Copy text={p.gatewayOrderId} /></dd></div>}
        {d.paidAt && <div><dt>Paid</dt><dd>{dateTime(d.paidAt)}</dd></div>}
        {d.refundable > 0 && d.refundable < d.total && <div><dt>Left to refund</dt><dd>{formatINR(d.refundable)}</dd></div>}
        {d.status === 'cancelled' && <div><dt>Cancelled by</dt><dd>{d.cancelledBy === 'customer' ? 'Customer' : d.cancelledBy === 'system' ? 'Automatically (not paid in time)' : 'Store'}{d.cancelReason && ` · ${String(d.cancelReason).replace(/^Cancelled by you: /, '')}`}</dd></div>}
      </dl>
      {(d.gatewayAttempts?.length ?? 0) > 1 && (
        <details className="attempts"><summary className="small">{d.gatewayAttempts.length} payment attempts</summary>
          <ul>{d.gatewayAttempts.map((a: any) => <li key={a.orderId} className="small"><code>{a.orderId}</code> · {a.status}{a.paymentId && <> · <code>{a.paymentId}</code></>} · {dateTime(a.createdAt)}</li>)}</ul>
        </details>
      )}
    </div>
  );
}

/** Every refund on the order with what can be done next: check, retry, or mark a UPI refund as sent. */
/** write: check a refund's status (staff too) · refund: retry or mark sent, which moves money (owner only). */
function RefundsCard({ list, write, refund, busy, onAction }: { list: any[]; write: boolean; refund: boolean; busy: boolean; onAction: (path: string, body?: object) => void }) {
  const [ref, setRef] = useState<Record<string, string>>({});
  return (
    <div className="card">
      <h2 style={{ marginBottom: 'var(--sp-3)' }}>Refunds</h2>
      <ul className="refunds">
        {list.map((r) => (
          <li key={r.id} className="refund">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <strong className="refund__amt">{formatINR(r.amount)}</strong>
              <span className={`badge ${REFUND_LABEL[r.status]?.[1] ?? ''}`}>{REFUND_LABEL[r.status]?.[0] ?? r.status}</span>
            </div>
            <p className="small muted">{r.provider ? 'Back to the original payment method via Razorpay' : 'To send by UPI / cash'} · {r.reason}</p>
            <p className="small muted">Started {dateTime(r.createdAt)} by {r.requestedBy === 'customer' ? 'the customer (cancelled)' : r.requestedBy === 'system' ? 'the system' : r.requestedBy}{r.processedAt && ` · completed ${dateTime(r.processedAt)}`}</p>
            {(r.providerRefundId || r.reference) && <p className="small"><span className="muted">Reference</span> <code>{r.providerRefundId ?? r.reference}</code> <Copy text={r.providerRefundId ?? r.reference} /></p>}
            {r.error && <p className="small" style={{ color: 'var(--c-danger)' }}>{r.error}</p>}
            {(write || refund) && (
              <div className="row no-print" style={{ marginTop: 6 }}>
                {r.status === 'pending' && <button className="btn btn--quiet btn--sm" disabled={busy} onClick={() => onAction(`/admin/refunds/${r.id}/check`)}>Check status</button>}
                {refund && r.status === 'failed' && <button className="btn btn--sm" disabled={busy} onClick={() => onAction(`/admin/refunds/${r.id}/retry`)}>Retry refund</button>}
                {refund && r.status === 'to_send' && (
                  <>
                    <input className="input" style={{ flex: 1, minWidth: 180, minHeight: 40 }} placeholder="UPI reference (UTR) after sending" value={ref[r.id] ?? ''} onChange={(e) => setRef({ ...ref, [r.id]: e.target.value })} />
                    <button className="btn btn--sm" disabled={busy || (ref[r.id] ?? '').trim().length < 3} onClick={() => onAction(`/admin/refunds/${r.id}/sent`, { reference: ref[r.id] })}>Mark sent</button>
                  </>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function RefundSheet({ max, online, busy, onClose, onRefund }: { max: number; online: boolean; busy: boolean; onClose: () => void; onRefund: (amount: number, reason: string) => void }) {
  const [rupees, setRupees] = useState(String(max / 100));
  const [reason, setReason] = useState('');
  const paise = Math.round(Number(rupees.replace(/[^\d.]/g, '')) * 100) || 0;
  const bad = paise <= 0 || paise > max;
  return (
    <Sheet title="Refund" onClose={onClose} footer={<><button className="btn btn--quiet" onClick={onClose}>Close</button><span className="spacer" />
      <button className="btn" disabled={busy || bad || reason.trim().length < 2} onClick={() => onRefund(paise, reason)}>{online ? `Refund ${paise ? formatINR(paise) : ''} via Razorpay` : `Record ${paise ? formatINR(paise) : ''} to send`}</button></>}>
      <div className="stack">
        <p className="muted">{online ? 'The money goes back to the card, UPI or bank account the customer paid with. Banks take 5–7 working days.' : 'This was paid by UPI or cash: send the money from your UPI app, then mark it sent with the UTR.'}</p>
        <Field label="Amount" hint={`Up to ${formatINR(max)}`} error={paise > max ? `Up to ${formatINR(max)}` : undefined}>
          <div className="prefix"><b>₹</b><input className="input" inputMode="decimal" value={rupees} onChange={(e) => setRupees(e.target.value)} /></div>
        </Field>
        <div className="row">{[1, 0.5].map((f) => <button key={f} type="button" className="add-chip add-chip--compact" onClick={() => setRupees(String(Math.round((max * f) / 100)))}>{f === 1 ? 'Full amount' : 'Half'}</button>)}</div>
        <Field label="Reason (shown to the customer in the timeline)"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="Returned item, damaged piece, price adjustment…" /></Field>
      </div>
    </Sheet>
  );
}

function CancelSheet({ onClose, onCancel, busy, paid, amount, online }: { onClose: () => void; onCancel: (reason: string, refund: boolean) => void; busy: boolean; paid: boolean; amount: number; online: boolean }) {
  const [reason, setReason] = useState('Customer asked to cancel');
  const [refund, setRefund] = useState(true);
  return (
    <Sheet title="Cancel order" onClose={onClose} footer={<><button className="btn btn--quiet" onClick={onClose}>Keep order</button><span className="spacer" /><button className="btn btn--danger" disabled={busy} onClick={() => onCancel(reason, refund)}>{paid && refund && amount > 0 ? `Cancel & refund ${formatINR(amount)}` : 'Cancel order'}</button></>}>
      <div className="stack">
        <p>Stock goes back to the shelf automatically.</p>
        {paid && amount > 0 && (
          <label className="check refund-opt">
            <input type="checkbox" checked={refund} onChange={(e) => setRefund(e.target.checked)} />
            <span><strong>Refund {formatINR(amount)} to the customer</strong><br /><span className="muted small">{online ? 'Automatically through Razorpay, back to how they paid.' : 'Recorded as a refund to send by UPI; mark it sent once done.'}</span></span>
          </label>
        )}
        <Field label="Reason (shown to the customer)"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} /></Field>
      </div>
    </Sheet>
  );
}
