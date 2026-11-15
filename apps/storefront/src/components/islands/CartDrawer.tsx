import { useStore } from '@nanostores/react';
import { json } from '../../lib/http.ts';
import { useEffect, useState } from 'react';
import type { Quote } from '@femia/contracts';
import { formatINR } from '@femia/contracts/money';
import { t } from '@femia/i18n';
import { $cart, removeLine, setQty } from '../../lib/stores.ts';
import { track } from '../../lib/analytics.ts';
import { Icon } from './Icon.tsx';
import { Sheet } from './Sheet.tsx';

export function CartDrawer({ open, onClose, threshold }: { open: boolean; onClose: () => void; threshold: number }) {
  const lines = useStore($cart);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [notices, setNotices] = useState<string[]>([]);

  // Re-price against the server whenever the drawer opens or the bag changes while open.
  useEffect(() => {
    if (!open || !lines.length) { setQuote(null); return; }
    const ctrl = new AbortController();
    fetch('/api/cart/quote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctrl.signal, body: JSON.stringify({ lines: lines.map((l) => ({ variantId: l.variantId, qty: l.qty })) }) })
      .then((r) => (r.ok ? json<Quote>(r) : null))
      .then((q: Quote | null) => {
        if (!q) return;
        setQuote(q);
        const msgs: string[] = [];
        for (const issue of q.issues) {
          const line = lines.find((l) => l.variantId === issue.variantId);
          if (!line) continue;
          if (issue.code === 'reduced') { setQty(issue.variantId, issue.available); msgs.push(`${line.title}: ${t('bag.issue.reduced', { available: issue.available })}`); }
          else { removeLine(issue.variantId); msgs.push(`${line.title}: ${t(`bag.issue.${issue.code}`)}`); }
        }
        // keep stored prices honest
        for (const ql of q.lines) {
          const l = lines.find((x) => x.variantId === ql.variantId);
          if (l && l.price !== ql.price) $cart.set($cart.get().map((x) => (x.variantId === ql.variantId ? { ...x, price: ql.price, compareAtPrice: ql.compareAtPrice } : x)));
        }
        if (msgs.length) setNotices(msgs);
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [open, lines.map((l) => `${l.variantId}:${l.qty}`).join('|')]);

  useEffect(() => { if (!open) setNotices([]); }, [open]);

  const subtotal = quote?.subtotal ?? lines.reduce((s, l) => s + l.price * l.qty, 0);
  const afterDeals = subtotal - (quote?.discountTotal ?? 0);
  const remaining = quote ? quote.freeShippingRemaining : Math.max(0, threshold - subtotal);
  const progress = Math.min(100, (afterDeals / threshold) * 100);
  const saleOf = new Map(quote?.lines.map((l) => [l.variantId, l.saleLabel]) ?? []);
  const bundle = quote?.discounts.find((d) => d.kind === 'bundle');
  const count = lines.reduce((n, l) => n + l.qty, 0);

  const footer = lines.length > 0 && (
    <>
      <dl className="totals">
        <div><dt>{t('bag.subtotal')}</dt><dd>{formatINR(subtotal)}</dd></div>
        {quote?.discounts.map((d) => <div key={d.offerId} className="totals__deal"><dt>{d.label}{d.code && ` · ${d.code}`}</dt><dd>−{formatINR(d.amount)}</dd></div>)}
        <div><dt>{t('bag.shipping')}</dt><dd>{remaining === 0 ? t('bag.free') : quote ? formatINR(quote.shipping) : '—'}</dd></div>
        {quote && quote.savings > 0 && <div className="totals__save"><dt>You save</dt><dd>{formatINR(quote.savings)}</dd></div>}
      </dl>
      <a className="btn btn--block" href="/checkout" onClick={() => { track('begin_checkout', { value: subtotal }); onClose(); }}>
        {t('bag.checkout')} · {formatINR(quote?.total ?? subtotal)} <Icon name="arrowRight" size={20} className="arrow" />
      </a>
    </>
  );

  return (
    <Sheet open={open} onClose={onClose} labelledBy="bag-title" title={<>{t('bag.title')}{count > 0 && <span className="sheet__count"> ({count})</span>}</>} footer={footer}>
      {lines.length === 0 ? (
        <div className="empty">
          <span className="empty__icon"><Icon name="bag" size={36} /></span>
          <h3>{t('bag.empty.title')}</h3>
          <p>{t('bag.empty.body')}</p>
          <a className="btn" href="/shop?sort=new">{t('bag.empty.cta')}</a>
        </div>
      ) : (
        <>
          <div className="ship-progress" role="status">
            <p>{remaining === 0 ? <><Icon name="truck" size={18} /> {t('bag.freeShipping.unlocked')}</> : t('bag.freeShipping.remaining', { amount: formatINR(remaining) })}</p>
            <div className="ship-progress__bar"><span style={{ width: `${progress}%` }} /></div>
          </div>
          {bundle ? (
            <p className="deal-nudge deal-nudge--won" role="status"><Icon name="sparkle" size={18} /> <span><strong>Deal unlocked:</strong> {bundle.label}. You save {formatINR(bundle.amount)}.</span></p>
          ) : quote?.nudge ? (
            <p className="deal-nudge" role="status"><Icon name="tag" size={18} /> <span>{quote.nudge}</span></p>
          ) : null}
          {notices.length > 0 && <ul className="notices" role="alert">{notices.map((n) => <li key={n}><Icon name="info" size={18} /> {n}</li>)}</ul>}
          <ul className="lines" role="list">
            {lines.map((l) => (
              <li key={l.variantId} className="line">
                <a href={`/products/${l.slug}`} className="line__img">{l.image ? <img src={l.image} alt="" width={84} height={112} loading="lazy" /> : null}</a>
                <div className="line__info">
                  <a href={`/products/${l.slug}`} className="line__title">{l.title}</a>
                  <p className="line__opt">{l.optionLabel}</p>
                  <p className={`price${saleOf.get(l.variantId) ? ' price--sale' : ''}`}>{formatINR(l.price)}{l.compareAtPrice && l.compareAtPrice > l.price && <s>{formatINR(l.compareAtPrice)}</s>}</p>
                  {saleOf.get(l.variantId) && <span className="offer-tag offer-tag--gold line__tag">{saleOf.get(l.variantId)}</span>}
                  <div className="line__row">
                    <div className="qty" role="group" aria-label={`${t('bag.qty')}: ${l.title}`}>
                      <button type="button" onClick={() => setQty(l.variantId, l.qty - 1)} aria-label="Decrease quantity"><Icon name="minus" size={18} /></button>
                      <output aria-live="polite">{l.qty}</output>
                      <button type="button" onClick={() => setQty(l.variantId, l.qty + 1)} aria-label="Increase quantity" disabled={l.qty >= 10}><Icon name="plus" size={18} /></button>
                    </div>
                    <button type="button" className="line__remove" onClick={() => removeLine(l.variantId)}>{t('bag.remove')}</button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </Sheet>
  );
}
