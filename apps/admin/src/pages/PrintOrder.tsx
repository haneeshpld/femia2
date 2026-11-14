import { useEffect } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { get } from '../lib/api.ts';
import { dateTime, formatINR } from '../lib/format.ts';
import { ErrorBox, Skeleton } from '../components/ui.tsx';

/** Bill of supply (no GST at launch: Kerala-only, under threshold) and packing slip. */
export default function PrintOrder() {
  const { number, doc } = useParams();
  const q = useQuery({ queryKey: ['order-doc', number], queryFn: () => get(`/admin/orders/${number}/document`) });
  useEffect(() => { if (q.data) setTimeout(() => window.print(), 300); }, [q.data]);
  if (q.isPending) return <Skeleton n={3} />;
  if (q.error) return <ErrorBox error={q.error} />;
  const { order: o, items, store } = q.data;
  const slip = doc === 'slip';
  return (
    <div className="card" style={{ maxWidth: 760, margin: '0 auto', fontSize: 14 }}>
      <div className="row no-print" style={{ marginBottom: 16 }}><Link to={`/orders/${number}`}>← Back</Link><span className="spacer" /><button className="btn" onClick={() => window.print()}>Print</button></div>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div><img src="/wordmark.webp" alt={store.name} style={{ height: 40 }} /><p style={{ marginTop: 6 }}>{[store.address.line1, store.address.line2, store.address.city, store.address.state, store.address.pincode].filter(Boolean).join(', ')}<br />{store.phone}{store.email && ` · ${store.email}`}</p></div>
        <div style={{ textAlign: 'right' }}><h1 style={{ fontSize: 22 }}>{slip ? 'Packing slip' : 'Bill of supply'}</h1><p>{o.number}<br />{dateTime(o.created_at)}</p></div>
      </div>
      <hr style={{ margin: '16px 0', border: 0, borderTop: '1px solid #ddd' }} />
      <p><strong>{slip ? 'Ship to' : 'Billed to'}</strong><br />{o.customer_name} · {o.phone}<br />{[o.line1, o.line2, o.landmark && `Near ${o.landmark}`, o.city, o.pincode].filter(Boolean).join(', ')}</p>
      <table className="table" style={{ marginTop: 16 }}>
        <thead><tr><th>Item</th><th>SKU</th><th style={{ textAlign: 'right' }}>Qty</th>{!slip && <><th style={{ textAlign: 'right' }}>Rate</th><th style={{ textAlign: 'right' }}>Amount</th></>}{slip && <th>Packed ✓</th>}</tr></thead>
        <tbody>{items.map((i: any) => <tr key={i.id}><td>{i.title}<br /><span className="muted">{i.option_label}</span></td><td>{i.sku}</td><td style={{ textAlign: 'right' }}>{i.qty}</td>{!slip && <><td style={{ textAlign: 'right' }}>{formatINR(i.unit_price)}</td><td style={{ textAlign: 'right' }}>{formatINR(i.line_total)}</td></>}{slip && <td>☐</td>}</tr>)}</tbody>
      </table>
      {!slip && (
        <div style={{ marginLeft: 'auto', width: 260, marginTop: 12 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}><span>Subtotal</span><span>{formatINR(o.subtotal)}</span></div>
          <div className="row" style={{ justifyContent: 'space-between' }}><span>Shipping</span><span>{o.shipping ? formatINR(o.shipping) : 'Free'}</span></div>
          <div className="row" style={{ justifyContent: 'space-between', fontWeight: 700, fontSize: 16 }}><span>Total</span><span>{formatINR(o.total)}</span></div>
          <p className="muted small" style={{ marginTop: 6 }}>Payment: {({ upi: 'UPI', gateway: 'Online', cod: 'Cash on delivery', whatsapp: 'WhatsApp order' } as Record<string, string>)[o.payment_method]} · {o.payment_status === 'paid' ? 'Paid' : o.payment_status === 'cod' ? 'To collect' : 'Unpaid'}</p>
        </div>
      )}
      <p className="muted small" style={{ marginTop: 24 }}>{slip ? 'Thank you for shopping with Femia! Easy returns within 7 days. WhatsApp us with your order number.' : 'This is a computer-generated bill of supply.'}</p>
    </div>
  );
}
