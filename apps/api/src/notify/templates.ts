import { formatINR, type PublicOrder } from '@femia/contracts';
import { color, font } from '@femia/tokens';

export type OrderEmailKind = 'received' | 'confirmed' | 'shipped' | 'delivered';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

const COPY: Record<OrderEmailKind, { subject: (n: string) => string; title: string; body: string }> = {
  received: { subject: (n) => `We've received your order ${n}`, title: 'Thank you for your order', body: "We've received your order and will confirm it shortly." },
  confirmed: { subject: (n) => `Your order ${n} is confirmed`, title: 'Your order is confirmed', body: "We're getting your pieces ready. We'll let you know as soon as they ship." },
  shipped: { subject: (n) => `Your order ${n} is on its way`, title: 'Your order is on its way', body: 'Your parcel has left our boutique.' },
  delivered: { subject: (n) => `Your order ${n} was delivered`, title: 'Delivered with love', body: 'We hope you love your new pieces. Reply to this email if anything is not right.' },
};

export function orderEmail(kind: OrderEmailKind, o: PublicOrder, ctx: { storeName: string; siteUrl: string; whatsapp: string }) {
  const c = COPY[kind];
  const trackUrl = `${ctx.siteUrl}/track?number=${encodeURIComponent(o.number)}`;
  const rows = o.items.map((i) => `
    <tr>
      <td style="padding:12px 0;border-bottom:1px solid ${color.line}">
        <div style="font-family:${font.display};font-size:18px;color:${color.ink}">${esc(i.title)}</div>
        <div style="font-size:13px;color:${color.muted}">${esc(i.optionLabel)} · Qty ${i.qty}</div>
      </td>
      <td align="right" style="padding:12px 0;border-bottom:1px solid ${color.line};white-space:nowrap">${formatINR(i.lineTotal)}</td>
    </tr>`).join('');
  const tracking = kind === 'shipped' && o.trackingUrl
    ? `<p style="margin:16px 0"><a href="${esc(o.trackingUrl)}" style="display:inline-block;background:${color.maroon};color:#fff;padding:12px 22px;border-radius:999px;text-decoration:none">Track with ${esc(o.courier ?? 'courier')}</a></p>` : '';

  const html = `<!doctype html><html><body style="margin:0;background:${color.cream};font-family:${font.body};color:${color.text}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${color.cream}"><tr><td align="center" style="padding:24px 12px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:${color.surface};border-radius:16px;overflow:hidden">
      <tr><td style="background:${color.maroon};padding:20px 28px;font-family:${font.display};font-size:28px;color:#fff">${esc(ctx.storeName)}</td></tr>
      <tr><td style="padding:28px">
        <h1 style="font-family:${font.display};font-weight:600;font-size:28px;color:${color.ink};margin:0 0 8px">${c.title}</h1>
        <p style="margin:0 0 4px">Hi ${esc(o.customerName.split(' ')[0] ?? '')}, ${c.body}</p>
        <p style="margin:0;color:${color.muted};font-size:14px">Order <b>${o.number}</b></p>
        ${tracking}
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;font-size:15px">${rows}
          <tr><td style="padding:8px 0;color:${color.muted}">Shipping</td><td align="right">${o.shipping ? formatINR(o.shipping) : 'Free'}</td></tr>
          <tr><td style="padding:8px 0;font-weight:700">Total</td><td align="right" style="font-weight:700">${formatINR(o.total)}</td></tr>
        </table>
        <p style="margin:24px 0 0"><a href="${trackUrl}" style="color:${color.maroon}">View order status</a></p>
      </td></tr>
      <tr><td style="padding:16px 28px;background:${color.blush};font-size:13px;color:${color.muted}">Questions? ${ctx.whatsapp ? `WhatsApp us on ${esc(ctx.whatsapp)} or reply` : 'Reply'} to this email.</td></tr>
    </table>
  </td></tr></table></body></html>`;

  const text = [
    c.title, '', `Hi ${o.customerName}, ${c.body}`, `Order ${o.number}`, '',
    ...o.items.map((i) => `${i.title} (${i.optionLabel}) x${i.qty}  ${formatINR(i.lineTotal)}`),
    `Shipping: ${o.shipping ? formatINR(o.shipping) : 'Free'}`, `Total: ${formatINR(o.total)}`, '',
    ...(kind === 'shipped' && o.trackingUrl ? [`Track: ${o.trackingUrl}`] : []), `Order status: ${trackUrl}`,
  ].join('\n');
  return { subject: c.subject(o.number), html, text };
}
