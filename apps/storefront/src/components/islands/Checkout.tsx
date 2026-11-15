import { useStore } from '@nanostores/react';
import { json } from '../../lib/http.ts';
import { useEffect, useMemo, useRef, useState, type SyntheticEvent } from 'react';
import type { CheckoutResult, PublicSettings, Quote } from '@femia/contracts';
import { formatINR } from '@femia/contracts/money';
import { t } from '@femia/i18n';
import { $cart, removeLine, setQty } from '../../lib/stores.ts';
import { Icon } from './Icon.tsx';
import { navigate } from 'astro:transitions/client';
import { acct, setSignedIn } from '../../lib/account.ts';

type Method = 'gateway' | 'cod' | 'whatsapp';
/** What the shopper picks. UPI and cards are both Razorpay: they only change which screen Razorpay opens on. */
type Choice = { id: 'upi' | 'card' | 'cod' | 'whatsapp'; method: Method; payWith: 'upi' | 'other' | null; label: string; hint: string; icon: 'upi' | 'card' | 'cash' | 'whatsapp'; tag?: string };
const SAVED = 'femia.checkout.v1';
const FIELDS = ['name', 'phone', 'email', 'line1', 'line2', 'landmark', 'city', 'pincode'] as const;
type Form = Record<(typeof FIELDS)[number], string>;

const COUPON = 'femia.coupon.v1';
const readCoupon = () => { try { return sessionStorage.getItem(COUPON); } catch { return null; } };
const keepCoupon = (c: string | null) => { try { if (c) sessionStorage.setItem(COUPON, c); else sessionStorage.removeItem(COUPON); } catch { /* ignore */ } };
const phoneDigits = (p: string) => { const d = p.replace(/\D/g, '').slice(-10); return /^[6-9]\d{9}$/.test(d) ? d : null; };

function loadSaved(): Partial<Form> { try { return JSON.parse(localStorage.getItem(SAVED) ?? '{}'); } catch { return {}; } }

declare global { interface Window { Razorpay?: new (o: Record<string, unknown>) => { open(): void; on(e: string, cb: (r: unknown) => void): void } } }
/**
 * Close the payment window before the order's stock hold runs out, so nobody pays for an order that's about to be
 * cancelled. (Late payments are still caught and refunded or reopened by the server; this just makes them rare.)
 */
export function razorpayTimeout(holdUntil: string | undefined | null): { timeout?: number } {
  const left = Math.floor((Date.parse(holdUntil ?? '') - Date.now()) / 1000) - 120;
  return Number.isFinite(left) ? { timeout: Math.max(60, left) } : {};
}

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
    payments.gateway && { id: 'upi', method: 'gateway', payWith: 'upi', icon: 'upi', label: t('checkout.pay.upi'), hint: 'Google Pay, PhonePe, Paytm, BHIM or any UPI app', tag: 'Instant' },
    payments.gateway && { id: 'card', method: 'gateway', payWith: 'other', icon: 'card', label: t('checkout.pay.card'), hint: 'Visa, Mastercard, RuPay, all major banks and wallets' },
    payments.cod && { id: 'cod', method: 'cod', payWith: null, icon: 'cash', label: t('checkout.pay.cod'), hint: payments.codMax ? `Pay when it arrives · up to ${formatINR(payments.codMax)}` : 'Pay when it arrives' },
    payments.whatsapp && { id: 'whatsapp', method: 'whatsapp', payWith: null, icon: 'whatsapp', label: t('checkout.pay.whatsapp'), hint: 'Send us your order and pay as you prefer' },
  ].filter(Boolean) as Choice[]), [payments]);
  // Nothing is chosen for the shopper (only when there's a single way to pay): paying by a default they never
  // saw is how people end up in the wrong payment app.
  const [choiceId, setChoiceId] = useState<Choice['id'] | null>(methods.length === 1 ? methods[0]!.id : null);
  const choice = methods.find((m) => m.id === choiceId) ?? null;
  const method: Method | null = choice?.method ?? null;
  const payRef = useRef<HTMLFieldSetElement>(null);
  const goToPay = () => {
    const calm = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    payRef.current?.scrollIntoView({ block: 'start', behavior: calm ? 'auto' : 'smooth' });
    payRef.current?.querySelector<HTMLInputElement>('input[name="pay"]:checked, input[name="pay"]')?.focus({ preventScroll: true });
  };
  /** An online order waiting for payment whose window the shopper closed: paid again in place, or set aside. */
  const [pending, setPending] = useState<{ number: string; token: string; provider: string; key: string } | null>(null);
  const [payNote, setPayNote] = useState<string | null>(null);
  const [sumOpen, setSumOpen] = useState(false);
  const [newsletter, setNewsletter] = useState(false);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pin, setPin] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  // The message sits above the form but Pay is at the bottom: bring it into view, or a refused order looks like nothing happened.
  const bannerRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (!banner) return;
    const calm = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    bannerRef.current?.scrollIntoView({ block: 'center', behavior: calm ? 'auto' : 'smooth' });
  }, [banner]);
  const newRef = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `ref-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const clientRef = useRef(newRef());
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  // Signed-in shoppers: details filled in, saved addresses to pick from, and the order lands in their account.
  type Saved = { id: string; label: string; name: string; phone: string; line1: string; line2: string; landmark: string; city: string; pincode: string; isDefault: boolean };
  const [account, setAccount] = useState<{ customer: { name: string; email: string; phone: string }; addresses: Saved[] } | null>(null);
  const [addrId, setAddrId] = useState<string | null>(null);
  const [saveAddress, setSaveAddress] = useState(true);
  const useAddress = (a: Saved) => {
    setAddrId(a.id);
    setForm((f) => ({ ...f, name: a.name || f.name, phone: a.phone || f.phone, line1: a.line1, line2: a.line2, landmark: a.landmark, city: a.city, pincode: a.pincode }));
    setErrors({}); void checkPin(a.pincode);
  };
  useEffect(() => {
    acct('/account/me').then((r) => {
      setAccount(r); setSignedIn(r.customer);
      setForm((f) => ({ ...f, name: f.name || r.customer.name, phone: f.phone || r.customer.phone, email: r.customer.email }));
      const def = r.addresses.find((a: Saved) => a.isDefault) ?? r.addresses[0];
      if (def) useAddress(def);
    }).catch(() => {});
  }, []);

  // Coupon: typed here, checked by the server with every quote (usage, first order and minimums need the phone).
  const [coupon, setCoupon] = useState<string | null>(() => (typeof window === 'undefined' ? null : readCoupon()));
  const [codeOpen, setCodeOpen] = useState(false);
  const [codeInput, setCodeInput] = useState('');
  const [checking, setChecking] = useState(false);
  const phone = phoneDigits(form.phone);

  const key = lines.map((l) => `${l.variantId}:${l.qty}`).join('|');
  useEffect(() => {
    if (!lines.length) { setQuote(null); return; }
    const ctrl = new AbortController();
    fetch('/api/cart/quote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctrl.signal,
      body: JSON.stringify({ lines: lines.map((l) => ({ variantId: l.variantId, qty: l.qty })), coupon, phone }) })
      .then((r) => json<Quote>(r)).then((q: Quote) => { setQuote(q); applyIssues(q); setChecking(false); }).catch(() => setChecking(false));
    return () => ctrl.abort();
  }, [key, coupon, phone]);

  const applyCode = () => {
    const c = codeInput.trim().toUpperCase();
    if (!c) return;
    setChecking(true); setCoupon(c); keepCoupon(c);
  };
  const removeCode = () => { setCoupon(null); keepCoupon(null); setCodeInput(''); setCodeOpen(true); };
  const couponState = quote?.coupon && quote.coupon.code === coupon ? quote.coupon : null;

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
    if (!choice) e.pay = t('checkout.pay.required');
    return e;
  }

  /** Open Razorpay for an order. Closing it keeps the shopper here, free to pay again or choose another way. */
  async function openGateway(o: { number: string; token: string; provider: string; payload: Record<string, unknown>; holdUntil?: string | null }) {
    const orderUrl = `/order/${o.number}?token=${encodeURIComponent(o.token)}`;
    try { await loadRazorpay(); } catch {
      setBusy(false); setPayNote(t('checkout.pay.unavailable')); goToPay(); return;
    }
    const rz = new window.Razorpay!({
      ...o.payload,
      ...razorpayTimeout(o.holdUntil),
      handler: async (resp: Record<string, string>) => {
        await fetch(`/api/payments/${o.provider}/return`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ number: o.number, token: o.token, params: resp }) }).catch(() => {});
        void navigate(orderUrl);
      },
      modal: { ondismiss: () => { setPayNote(t('checkout.pay.closed')); goToPay(); } },
    });
    rz.open();
    // Razorpay's window now covers the page: the button is free again however that window ends (closed, timed out).
    setBusy(false);
  }

  async function submit(ev: SyntheticEvent) {
    ev.preventDefault();
    setBanner(null); setPayNote(null);
    const e = validate();
    setErrors(e);
    const first = Object.keys(e)[0];
    if (first === 'pay') { goToPay(); return; }
    if (first) { document.getElementById(`co-${first}`)?.focus(); return; }
    if (!choice || !method) return;
    setBusy(true);
    try { localStorage.setItem(SAVED, JSON.stringify(form)); } catch { /* ignore */ }
    if (!couponState?.applied) keepCoupon(null);
    const body = {
      lines: lines.map((l) => ({ variantId: l.variantId, qty: l.qty })),
      customer: { name: form.name, phone: form.phone, email: form.email },
      address: { line1: form.line1, line2: form.line2, landmark: form.landmark, city: form.city, pincode: form.pincode.trim() },
      paymentMethod: method, payWith: choice.payWith, newsletter, clientRef: clientRef.current, saveAddress: !!account && !addrId && saveAddress,
      coupon: couponState?.applied ? coupon : null,
    };
    // What the order is (not how it's paid): an unchanged order is paid again in place, never placed twice.
    const orderKey = JSON.stringify([body.lines, body.customer, body.address, body.coupon]);

    if (pending) {
      const post = (path: string, payload: object) => fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        .then(async (r) => ({ ok: r.ok, d: await json<any>(r).catch(() => null) })).catch(() => ({ ok: false, d: null }));
      const pendingUrl = `/order/${pending.number}?token=${encodeURIComponent(pending.token)}`;
      if (method === 'gateway' && pending.key === orderKey) {
        const { ok, d } = await post(`/api/orders/${pending.number}/pay`, { token: pending.token, payWith: choice.payWith });
        if (ok && d?.status === 'paid') { void navigate(pendingUrl); return; }
        if (ok) { await openGateway({ number: pending.number, token: pending.token, provider: d.provider, payload: d.payload, holdUntil: d.holdUntil }); return; }
        if (d?.error?.code !== 'closed') { setBusy(false); setBanner(d?.error?.message ?? t('error.generic')); return; }
        setPending(null); clientRef.current = newRef(); body.clientRef = clientRef.current; // hold ran out: place it afresh
      } else {
        // Another way to pay (or the bag / address changed): set the unpaid online order aside first.
        const { ok, d } = await post(`/api/orders/${pending.number}/switch-method`, { token: pending.token });
        if (ok && d?.status === 'paid') { void navigate(pendingUrl); return; }
        if (!ok) { setBusy(false); setBanner(d?.error?.message ?? t('error.generic')); return; }
        setPending(null); clientRef.current = newRef(); body.clientRef = clientRef.current;
      }
    }

    const res = await fetch('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null);
    const data = res ? await json<any>(res).catch(() => null) : null;
    if (!res || !res.ok) {
      setBusy(false);
      const err = data?.error;
      if (err?.code === 'validation') {
        const map: Record<string, string> = {};
        for (const [k, v] of Object.entries(err.details?.fields ?? {})) map[k.replace(/^(customer|address)\./, '')] = String(v);
        setErrors(map); setBanner(err.message);
      } else if (err?.code === 'cart_changed' && err.details?.quote) { setQuote(err.details.quote); applyIssues(err.details.quote); setBanner(err.message); clientRef.current = newRef(); }
      else if (err?.code === 'coupon_invalid') { if (err.details?.quote) setQuote(err.details.quote); setBanner(err.message); clientRef.current = newRef(); }
      else if (err?.code === 'pincode_blocked') { setErrors({ pincode: err.message }); setPin({ ok: false, message: err.message }); }
      else setBanner(err?.message ?? t('error.generic'));
      return;
    }
    const r = data as CheckoutResult;
    if (r.next.type === 'gateway') {
      setPending({ number: r.order.number, token: r.accessToken, provider: r.next.provider, key: orderKey });
      await openGateway({ number: r.order.number, token: r.accessToken, provider: r.next.provider, payload: r.next.payload, holdUntil: r.next.holdUntil });
      return;
    }
    void navigate(`/order/${r.order.number}?token=${encodeURIComponent(r.accessToken)}`);
  }

  if (!hydrated) return <div className="co-skel"><div className="skeleton" style={{ height: 420 }} /><div className="skeleton" style={{ height: 300 }} /></div>;
  if (!lines.length) return (
    <div className="empty"><span className="empty__icon"><Icon name="bag" size={36} /></span><h2>{t('bag.empty.title')}</h2><p>{t('bag.empty.body')}</p><a className="btn" href="/shop?sort=new">{t('bag.empty.cta')}</a></div>
  );

  const total = quote?.total ?? lines.reduce((s, l) => s + l.price * l.qty, 0);
  const count = lines.reduce((n, l) => n + l.qty, 0);
  const cta = !method ? t('checkout.pay.choose') : method === 'gateway' ? t('checkout.pay', { total: formatINR(total) }) : method === 'whatsapp' ? 'Send order on WhatsApp' : t('checkout.place', { total: formatINR(total) });
  const barCta = !method ? t('checkout.pay.choose') : method === 'gateway' ? (choice?.payWith === 'upi' ? 'Pay with UPI' : 'Pay securely') : method === 'whatsapp' ? 'Order on WhatsApp' : 'Place order';
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
        {banner && <p ref={bannerRef} className="co__banner" role="alert"><Icon name="info" size={20} /> {banner}</p>}
        {account ? (
          <p className="co__who"><span className="co__who-mono" aria-hidden="true">{account.customer.name.trim()[0]?.toUpperCase()}</span>
            <span>Signed in as <strong>{account.customer.name}</strong><span className="muted"> · {account.customer.email}</span></span>
            <a href="/account" className="co__who-link">Your account</a></p>
        ) : (
          <a className="co__signin" href="/account/sign-in?next=/checkout">
            <Icon name="user" size={20} /><span><strong>Have a Femia account?</strong> Sign in for saved addresses and all your orders in one place.</span><Icon name="arrowRight" size={18} />
          </a>
        )}
        <fieldset className="co__card">
          <legend><span className="co__step">1</span> {t('checkout.contact')}</legend>
          {field('name', t('checkout.name'), { autoComplete: 'name', required: true })}
          <div className="co__row">
            {field('phone', t('checkout.phone'), { type: 'tel', inputMode: 'numeric', autoComplete: 'tel-national', required: true, placeholder: '98470 12345' })}
            {field('email', t('checkout.email'), { type: 'email', inputMode: 'email', autoComplete: 'email', required: true, readOnly: !!account, title: account ? 'Orders go to your account email' : undefined })}
          </div>
        </fieldset>
        <fieldset className="co__card">
          <legend><span className="co__step">2</span> {t('checkout.address')}</legend>
          {account && account.addresses.length > 0 && (
            <div className="co__saved" role="radiogroup" aria-label="Saved addresses">
              {account.addresses.map((a) => (
                <button key={a.id} type="button" role="radio" aria-checked={addrId === a.id} className={`co__addr${addrId === a.id ? ' is-on' : ''}`} onClick={() => useAddress(a)}>
                  <strong>{a.label || a.name}</strong><span>{a.line1}, {a.city} {a.pincode}</span>
                </button>
              ))}
              <button type="button" role="radio" aria-checked={!addrId} className={`co__addr co__addr--new${!addrId ? ' is-on' : ''}`}
                onClick={() => { setAddrId(null); setForm((f) => ({ ...f, line1: '', line2: '', landmark: '', city: '', pincode: '' })); setPin(null); }}>
                <Icon name="plus" size={18} /> New address
              </button>
            </div>
          )}
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
          {account && !addrId && <label className="co__nl"><input type="checkbox" checked={saveAddress} onChange={(e) => setSaveAddress(e.target.checked)} /> Save this address to my account</label>}
        </fieldset>
        <fieldset className="co__card co__paycard" ref={payRef}>
          <legend><span className="co__step">3</span> {t('checkout.payment')}</legend>
          {payNote && <p className="co__paynote" role="status"><Icon name="info" size={18} /> {payNote}</p>}
          <div className="co__pay" role="radiogroup" aria-label={t('checkout.payment')} aria-invalid={!!errors.pay} aria-describedby={errors.pay ? 'co-pay-err' : undefined}>
            {methods.map((m) => (
              <label key={m.id} className={`co__method${choiceId === m.id ? ' is-on' : ''}`}>
                <input type="radio" name="pay" value={m.id} checked={choiceId === m.id} onChange={() => { setChoiceId(m.id); setErrors((x) => ({ ...x, pay: '' })); }} />
                <span className="co__method-icon" aria-hidden="true"><Icon name={m.icon} size={20} /></span>
                <span className="co__method-text"><strong>{m.label}{m.tag && <em>{m.tag}</em>}</strong><span>{m.hint}</span></span>
              </label>
            ))}
          </div>
          {errors.pay && <p id="co-pay-err" className="field-error">{errors.pay}</p>}
          {method === 'gateway' && <p className="co__rzp"><Icon name="lock" size={15} /> Secured by Razorpay. You'll pay in the next step without leaving this page.</p>}
          {method === 'cod' && payments.codMax !== null && total > payments.codMax && <p className="field-error">Cash on Delivery is available for orders up to {formatINR(payments.codMax)}.</p>}
          <label className="co__nl"><input type="checkbox" checked={newsletter} onChange={(e) => setNewsletter(e.target.checked)} /> {t('checkout.newsletter')}</label>
        </fieldset>
      </div>
      <aside className={`co__side${sumOpen ? ' is-open' : ''}`} aria-labelledby="co-sum">
        <button type="button" className="co__peek" aria-expanded={sumOpen} aria-controls="co-sumbody" onClick={() => setSumOpen((o) => !o)}>
          <Icon name="bag" size={18} />
          <span>{sumOpen ? 'Hide' : 'Show'} order summary <small>· {count} {count === 1 ? 'item' : 'items'}</small></span>
          <Icon name="chevronDown" size={18} className="co__peek-chev" />
          <strong>{formatINR(total)}</strong>
        </button>
        <div className="co__card co__summary" id="co-sumbody">
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
          {quote?.nudge && <p className="deal-nudge"><Icon name="tag" size={18} /> <span>{quote.nudge}</span></p>}
          <div className="code">
            {couponState?.applied ? (
              <div className="code__ticket" role="status">
                <span className="code__seal"><Icon name="check" size={18} /></span>
                <span className="code__what"><strong>{couponState.code}</strong><span>{t('checkout.code.saved', { amount: formatINR(quote!.discounts.find((d) => d.kind === 'coupon')?.amount ?? 0) })}</span></span>
                <button type="button" className="code__remove" onClick={removeCode}>{t('checkout.code.remove')}</button>
              </div>
            ) : codeOpen || coupon ? (
              <div className="code__form">
                <label htmlFor="co-code" className="sr-only">{t('checkout.code.label')}</label>
                <div className="code__row">
                  <input id="co-code" className="input code__input" value={codeInput || coupon || ''} placeholder={t('checkout.code.placeholder')} autoCapitalize="characters" autoComplete="off" spellCheck={false} maxLength={20}
                    onChange={(e) => { setCodeInput(e.target.value.toUpperCase()); if (coupon) { setCoupon(null); keepCoupon(null); } }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyCode(); } }}
                    aria-invalid={!!(couponState && !couponState.applied)} aria-describedby="co-code-msg" />
                  <button type="button" className="btn btn--outline code__apply" onClick={applyCode} disabled={checking || !(codeInput || '').trim()}>{checking ? '…' : t('checkout.code.apply')}</button>
                </div>
                <p id="co-code-msg" className="field-error" aria-live="polite">{couponState && !couponState.applied ? couponState.message : ''}</p>
              </div>
            ) : (
              <button type="button" className="code__open" onClick={() => setCodeOpen(true)}><Icon name="tag" size={18} /> {t('checkout.code.open')}</button>
            )}
          </div>
          <dl className="totals">
            <div><dt>{t('bag.subtotal')}</dt><dd>{formatINR(quote?.subtotal ?? total)}</dd></div>
            {quote?.discounts.map((d) => <div key={d.offerId} className="totals__deal"><dt>{d.label}{d.code && ` · ${d.code}`}</dt><dd>−{formatINR(d.amount)}</dd></div>)}
            <div><dt>{t('bag.shipping')}</dt><dd>{quote ? (quote.shipping ? formatINR(quote.shipping) : t('bag.free')) : '—'}</dd></div>
            {quote && quote.freeShippingRemaining > 0 && <p className="co__hint">Add {formatINR(quote.freeShippingRemaining)} more for free shipping.</p>}
            <div className="totals__grand"><dt>{t('bag.total')}</dt><dd>{formatINR(total)}</dd></div>
            {quote && quote.savings > 0 && <div className="totals__save"><dt>{t('checkout.youSave')}</dt><dd>{formatINR(quote.savings)}</dd></div>}
          </dl>
          {choice && (
            <p className="co__paywith"><Icon name={choice.icon} size={16} /> <span>{t('checkout.pay.with')} <strong>{choice.label}</strong></span>
              <button type="button" className="co__paywith-change" onClick={goToPay}>{t('checkout.pay.change')}</button></p>
          )}
          <button className="btn btn--block co__place" type="submit" disabled={busy || !methods.length}>
            {busy ? t('common.loading') : cta}
          </button>
          <p className="co__secure"><Icon name="shield" size={16} /> Prices are confirmed on our server when you place the order.</p>
        </div>
      </aside>
      {/* Phones: the total and the pay button stay at the bottom of the screen. */}
      <div className="co__bar">
        <div className="co__bar-total">
          <span>{t('bag.total')}{quote && quote.savings > 0 && <em> · you save {formatINR(quote.savings)}</em>}</span>
          <strong>{formatINR(total)}</strong>
        </div>
        <button className="btn co__bar-btn" type="submit" disabled={busy || !methods.length}>{busy ? t('common.loading') : barCta}</button>
      </div>
    </form>
  );
}
