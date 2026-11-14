import { useStore } from '@nanostores/react';
import { json } from '../../lib/http.ts';
import { useEffect, useMemo, useRef, useState, type SyntheticEvent } from 'react';
import type { CheckoutResult, PublicSettings, Quote } from '@femia/contracts';
import { formatINR } from '@femia/contracts/money';
import { t } from '@femia/i18n';
import { $cart, removeLine, setQty } from '../../lib/stores.ts';
import { Icon } from './Icon.tsx';
import './shell.css';
import './checkout.css';

type Method = 'upi' | 'gateway' | 'cod' | 'whatsapp';
const SAVED = 'femia.checkout.v1';
const FIELDS = ['name', 'phone', 'email', 'line1', 'line2', 'landmark', 'city', 'pincode'] as const;
type Form = Record<(typeof FIELDS)[number], string>;

function loadSaved(): Partial<Form> { try { return JSON.parse(localStorage.getItem(SAVED) ?? '{}'); } catch { return {}; } }

declare global { interface Window { Razorpay?: new (o: Record<string, unknown>) => { open(): void; on(e: string, cb: (r: unknown) => void): void } } }
function loadRazorpay() {
  return new Promise<void>((res, rej) => {
    if (window.Razorpay) return res();
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js'; s.onload = () => res(); s.onerror = () => rej(new Error('razorpay'));
    document.head.appendChild(s);
  });
}

export default function Checkout({ payments }: { payments: PublicSettings['payments'] }) {
  const lines = useStore($cart);
  const [form, setForm] = useState<Form>(() => ({ ...Object.fromEntries(FIELDS.map((f) => [f, ''])), ...loadSaved() }) as Form);
  const methods = useMemo(() => ([
    payments.upi && { id: 'upi', label: t('checkout.pay.upi'), hint: 'Scan & pay from any UPI app. No fees.' },
    payments.gateway && { id: 'gateway', label: t('checkout.pay.gateway'), hint: 'Secure checkout by our payment partner.' },
    payments.cod && { id: 'cod', label: t('checkout.pay.cod'), hint: payments.codMax ? `Available up to ${formatINR(payments.codMax)}.` : 'Pay when it arrives.' },
    payments.whatsapp && { id: 'whatsapp', label: t('checkout.pay.whatsapp'), hint: 'Send your order to us on WhatsApp and pay as you prefer.' },
  ].filter(Boolean) as { id: Method; label: string; hint: string }[]), [payments]);
  const [method, setMethod] = useState<Method>(methods[0]?.id ?? 'cod');
  const [newsletter, setNewsletter] = useState(false);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pin, setPin] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const clientRef = useRef(typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `ref-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  const key = lines.map((l) => `${l.variantId}:${l.qty}`).join('|');
  useEffect(() => {
    if (!lines.length) { setQuote(null); return; }
    fetch('/api/cart/quote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lines: lines.map((l) => ({ variantId: l.variantId, qty: l.qty })) }) })
      .then((r) => json<Quote>(r)).then((q: Quote) => { setQuote(q); applyIssues(q); }).catch(() => {});
  }, [key]);

  function applyIssues(q: Quote) {
    if (!q.issues.length) return;
    const msgs = q.issues.map((i) => {
      const l = $cart.get().find((x) => x.variantId === i.variantId);
      if (i.code === 'reduced') { setQty(i.variantId, i.available); return `${l?.title ?? 'An item'}: ${t('bag.issue.reduced', { available: i.available })}`; }
      removeLine(i.variantId); return `${l?.title ?? 'An item'}: ${t(`bag.issue.${i.code}`)}`;
    });
    setBanner(msgs.join(' '));
  }

  const set = (k: keyof Form) => (e: { target: { value: string } }) => { setForm((f) => ({ ...f, [k]: e.target.value })); if (errors[k]) setErrors((x) => ({ ...x, [k]: '' })); };

  async function checkPin(v = form.pincode) {
    const p = v.trim();
    if (!/^[1-9]\d{5}$/.test(p)) { setPin(null); return; }
    const r = await fetch('/api/checkout/pincode', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pincode: p }) }).then((x) => json<{ ok: boolean; message: string }>(x)).catch(() => null);
    if (r) setPin({ ok: r.ok, message: r.message });
  }

  function validate(): Record<string, string> {
    const e: Record<string, string> = {};
    if (form.name.trim().length < 2) e.name = 'Enter your name';
    if (!/^(\+?91|0)?[6-9]\d{9}$/.test(form.phone.replace(/[\s-]/g, ''))) e.phone = 'Enter a 10-digit mobile number';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) e.email = 'Enter a valid email address';
    if (form.line1.trim().length < 3) e.line1 = 'Enter your house / street';
    if (form.city.trim().length < 2) e.city = 'Enter your town or city';
    if (!/^[1-9]\d{5}$/.test(form.pincode.trim())) e.pincode = 'Enter a 6-digit pincode';
    else if (pin && !pin.ok) e.pincode = pin.message;
    return e;
  }

  async function submit(ev: SyntheticEvent) {
    ev.preventDefault();
    setBanner(null);
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) { document.getElementById(`co-${Object.keys(e)[0]}`)?.focus(); return; }
    setBusy(true);
    try { localStorage.setItem(SAVED, JSON.stringify(form)); } catch { /* ignore */ }
    const body = {
      lines: lines.map((l) => ({ variantId: l.variantId, qty: l.qty })),
      customer: { name: form.name, phone: form.phone, email: form.email },
      address: { line1: form.line1, line2: form.line2, landmark: form.landmark, city: form.city, pincode: form.pincode.trim() },
      paymentMethod: method, newsletter, clientRef: clientRef.current,
    };
    const res = await fetch('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null);
    const data = res ? await json<any>(res).catch(() => null) : null;
    if (!res || !res.ok) {
      setBusy(false);
      const err = data?.error;
      if (err?.code === 'validation') {
        const map: Record<string, string> = {};
        for (const [k, v] of Object.entries(err.details?.fields ?? {})) map[k.replace(/^(customer|address)\./, '')] = String(v);
        setErrors(map); setBanner(err.message);
      } else if (err?.code === 'cart_changed' && err.details?.quote) { setQuote(err.details.quote); applyIssues(err.details.quote); setBanner(err.message); clientRef.current = crypto.randomUUID?.() ?? clientRef.current + '1'; }
      else if (err?.code === 'pincode_blocked') { setErrors({ pincode: err.message }); setPin({ ok: false, message: err.message }); }
      else setBanner(err?.message ?? t('error.generic'));
      return;
    }
    const r = data as CheckoutResult;
    const orderUrl = `/order/${r.order.number}?token=${encodeURIComponent(r.accessToken)}`;
    if (r.next.type === 'gateway') {
      try {
        await loadRazorpay();
        const rz = new window.Razorpay!({
          ...r.next.payload,
          handler: async (resp: Record<string, string>) => {
            await fetch(`/api/payments/${(r.next as { provider: string }).provider}/return`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ number: r.order.number, token: r.accessToken, params: resp }) }).catch(() => {});
            location.assign(orderUrl);
          },
          modal: { ondismiss: () => location.assign(orderUrl) },
        });
        rz.open();
      } catch { location.assign(orderUrl); }
      return;
    }
    location.assign(orderUrl);
  }

  if (!hydrated) return <div className="co-skel"><div className="skeleton" style={{ height: 420 }} /><div className="skeleton" style={{ height: 300 }} /></div>;
  if (!lines.length) return (
    <div className="empty"><span className="empty__icon"><Icon name="bag" size={36} /></span><h2>{t('bag.empty.title')}</h2><p>{t('bag.empty.body')}</p><a className="btn" href="/shop?sort=new">{t('bag.empty.cta')}</a></div>
  );

  const total = quote?.total ?? lines.reduce((s, l) => s + l.price * l.qty, 0);
  const field = (k: keyof Form, label: string, props: Record<string, unknown> = {}) => (
    <div className="field">
      <label htmlFor={`co-${k}`}>{label}</label>
      <input id={`co-${k}`} className="input" value={form[k]} onChange={set(k)} aria-invalid={!!errors[k]} aria-describedby={errors[k] ? `co-${k}-err` : undefined} {...props} />
      {errors[k] && <p id={`co-${k}-err`} className="field-error">{errors[k]}</p>}
    </div>
  );

  return (
    <form className="co" onSubmit={submit} noValidate>
      <div className="co__main">
        {banner && <p className="co__banner" role="alert"><Icon name="info" size={20} /> {banner}</p>}
        <fieldset className="co__card">
          <legend><span className="co__step">1</span> {t('checkout.contact')}</legend>
          {field('name', t('checkout.name'), { autoComplete: 'name', required: true })}
          <div className="co__row">
            {field('phone', t('checkout.phone'), { type: 'tel', inputMode: 'numeric', autoComplete: 'tel-national', required: true, placeholder: '98470 12345' })}
            {field('email', t('checkout.email'), { type: 'email', inputMode: 'email', autoComplete: 'email', required: true })}
          </div>
        </fieldset>
        <fieldset className="co__card">
          <legend><span className="co__step">2</span> {t('checkout.address')}</legend>
          {field('line1', t('checkout.line1'), { autoComplete: 'address-line1', required: true })}
          {field('line2', t('checkout.line2'), { autoComplete: 'address-line2' })}
          <div className="co__row">
            {field('city', t('checkout.city'), { autoComplete: 'address-level2', required: true })}
            <div className="field">
              <label htmlFor="co-pincode">{t('checkout.pincode')}</label>
              <input id="co-pincode" className="input" value={form.pincode} inputMode="numeric" maxLength={6} autoComplete="postal-code" required
                onChange={(e) => { set('pincode')(e); setPin(null); if (e.target.value.length === 6) void checkPin(e.target.value); }} onBlur={() => checkPin()}
                aria-invalid={!!errors.pincode || (pin ? !pin.ok : false)} aria-describedby="co-pincode-msg" />
              <p id="co-pincode-msg" className={errors.pincode || (pin && !pin.ok) ? 'field-error' : 'co__ok'} aria-live="polite">
                {errors.pincode || (pin ? (pin.ok ? <><Icon name="check" size={16} /> {pin.message}</> : pin.message) : '')}
              </p>
            </div>
          </div>
          {field('landmark', t('checkout.landmark'))}
        </fieldset>
        <fieldset className="co__card">
          <legend><span className="co__step">3</span> {t('checkout.payment')}</legend>
          <div className="co__pay" role="radiogroup">
            {methods.map((m) => (
              <label key={m.id} className={`co__method${method === m.id ? ' is-on' : ''}`}>
                <input type="radio" name="pay" value={m.id} checked={method === m.id} onChange={() => setMethod(m.id)} />
                <span><strong>{m.label}</strong><span className="muted">{m.hint}</span></span>
              </label>
            ))}
          </div>
          {method === 'cod' && payments.codMax !== null && total > payments.codMax && <p className="field-error">Cash on Delivery is available for orders up to {formatINR(payments.codMax)}.</p>}
          <label className="co__nl"><input type="checkbox" checked={newsletter} onChange={(e) => setNewsletter(e.target.checked)} /> {t('checkout.newsletter')}</label>
        </fieldset>
      </div>
      <aside className="co__side" aria-labelledby="co-sum">
        <div className="co__card co__summary">
          <h2 id="co-sum" className="co__sumtitle">{t('checkout.summary')}</h2>
          <ul className="lines" role="list">
            {lines.map((l) => (
              <li key={l.variantId} className="line line--compact">
                <span className="line__img">{l.image && <img src={l.image} alt="" width={64} height={85} />}<span className="line__qty">{l.qty}</span></span>
                <span className="line__info"><span className="line__title">{l.title}</span><span className="line__opt">{l.optionLabel}</span></span>
                <span className="line__total">{formatINR(l.price * l.qty)}</span>
              </li>
            ))}
          </ul>
          <dl className="totals">
            <div><dt>{t('bag.subtotal')}</dt><dd>{formatINR(quote?.subtotal ?? total)}</dd></div>
            <div><dt>{t('bag.shipping')}</dt><dd>{quote ? (quote.shipping ? formatINR(quote.shipping) : t('bag.free')) : '—'}</dd></div>
            {quote && quote.freeShippingRemaining > 0 && <p className="co__hint">Add {formatINR(quote.freeShippingRemaining)} more for free shipping.</p>}
            <div className="totals__grand"><dt>{t('bag.total')}</dt><dd>{formatINR(total)}</dd></div>
          </dl>
          <button className="btn btn--block co__place" type="submit" disabled={busy || !methods.length}>
            {busy ? t('common.loading') : t('checkout.place', { total: formatINR(total) })}
          </button>
          <p className="co__secure"><Icon name="shield" size={18} /> Prices are confirmed on our server when you place the order.</p>
        </div>
      </aside>
    </form>
  );
}
