import { useEffect, useState, type FormEvent } from 'react';
import { formatINR } from '@femia/contracts/money';
import { acct, AccountError, setSignedIn } from '../../lib/account.ts';
import { navigate } from 'astro:transitions/client';
import { Icon } from './Icon.tsx';

interface Profile { id: string; email: string; name: string; phone: string; marketing: boolean; createdAt: string }
interface Address { id: string; label: string; name: string; phone: string; line1: string; line2: string; landmark: string; city: string; state: string; pincode: string; isDefault: boolean }
interface Order { number: string; status: string; paymentMethod: string; paymentStatus: string; total: number; discount: number; createdAt: string; items: number; image: string | null; title: string | null; trackingUrl: string | null; courier: string | null; url: string; current: boolean; refund: 'pending' | 'done' | null }
interface History { orders: Order[]; offers: { label: string; code: string | null; kind: string; amount: number; orderNumber: string; at: string }[]; totals: { orders: number; spent: number; saved: number } }

type Tab = 'orders' | 'offers' | 'addresses' | 'profile';
const TABS: { id: Tab; label: string; icon: 'bag' | 'tag' | 'pin' | 'user' }[] = [
  { id: 'orders', label: 'Orders', icon: 'bag' }, { id: 'offers', label: 'Savings', icon: 'tag' }, { id: 'addresses', label: 'Addresses', icon: 'pin' }, { id: 'profile', label: 'Profile', icon: 'user' },
];
const STAGES = ['new', 'confirmed', 'packed', 'shipped', 'delivered'];
const STAGE_LABEL: Record<string, string> = { pending_payment: 'Awaiting payment', new: 'Placed', confirmed: 'Confirmed', packed: 'Packed', shipped: 'On the way', delivered: 'Delivered', cancelled: 'Cancelled' };
const date = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

/** The shopper's own space: orders now and before, what they've saved, addresses and details. */
export default function AccountHome() {
  const [me, setMe] = useState<{ customer: Profile; addresses: Address[] } | null>(null);
  const [hist, setHist] = useState<History | null>(null);
  const [tab, setTab] = useState<Tab>(() => (TABS.find((t) => `#${t.id}` === location.hash)?.id ?? 'orders'));
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([acct('/account/me'), acct<History>('/account/orders')])
      .then(([m, h]) => { setMe(m); setHist(h); setSignedIn(m.customer); })
      .catch((e: AccountError) => { if (e.status === 401) void navigate(`/account/sign-in?next=${encodeURIComponent('/account')}`); else setToast(e.message); });
  }, []);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3200); return () => clearTimeout(t); }, [toast]);
  const pick = (t: Tab) => { setTab(t); history.replaceState(null, '', `#${t}`); };

  if (!me || !hist) return <div className="acc-skel" aria-busy="true"><div className="skeleton" style={{ height: 140 }} /><div className="skeleton" style={{ height: 320 }} /></div>;
  const c = me.customer;
  const current = hist.orders.filter((o) => o.current);
  const past = hist.orders.filter((o) => !o.current);
  const signOut = async (everywhere = false) => {
    await acct(everywhere ? '/account/sign-out-everywhere' : '/auth/customer/sign-out', { body: {} }).catch(() => {});
    setSignedIn(null); void navigate('/');
  };

  return (
    <div className="acc">
      <header className="acc-hero">
        <span className="acc-hero__mono" aria-hidden="true">{c.name.trim()[0]?.toUpperCase()}</span>
        <div className="acc-hero__hello">
          <h1>Hello, <em>{c.name.split(' ')[0]}</em></h1>
          <p className="muted">Femia member since {new Date(c.createdAt).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</p>
        </div>
        <dl className="acc-hero__stats">
          <div><dt>Orders</dt><dd>{hist.totals.orders}</dd></div>
          <div><dt>Saved with offers</dt><dd>{formatINR(hist.totals.saved)}</dd></div>
        </dl>
      </header>

      <nav className="acc-tabs" aria-label="Your account">
        {TABS.map((t) => (
          <button key={t.id} type="button" className={tab === t.id ? 'is-on' : ''} aria-current={tab === t.id ? 'page' : undefined} onClick={() => pick(t.id)}>
            <Icon name={t.icon} size={18} /> {t.label}{t.id === 'orders' && current.length > 0 && <span className="acc-tabs__n">{current.length}</span>}
          </button>
        ))}
      </nav>

      {tab === 'orders' && (
        <div className="acc-panel">
          <section aria-labelledby="now">
            <h2 id="now" className="acc-h">On their way</h2>
            {current.length === 0 ? <p className="acc-empty">Nothing on the way right now. <a href="/shop?sort=new">See what's new</a></p> : (
              <ul className="acc-orders" role="list">{current.map((o) => <OrderCard key={o.number} o={o} live />)}</ul>
            )}
          </section>
          <section aria-labelledby="past">
            <h2 id="past" className="acc-h">Previous orders</h2>
            {past.length === 0 ? <p className="acc-empty">Your earlier orders will appear here.</p> : <ul className="acc-orders" role="list">{past.map((o) => <OrderCard key={o.number} o={o} />)}</ul>}
          </section>
        </div>
      )}

      {tab === 'offers' && (
        <div className="acc-panel">
          <div className="acc-savings">
            <span className="acc-savings__ring" aria-hidden="true"><Icon name="tag" size={26} /></span>
            <div><p className="muted">You've saved</p><p className="acc-savings__num">{formatINR(hist.totals.saved)}</p><p className="muted small">with offers and codes on {hist.offers.length} order{hist.offers.length === 1 ? '' : 's'}</p></div>
          </div>
          {hist.offers.length === 0 ? <p className="acc-empty">Offers and codes you use will show here. Keep an eye on our sales.</p> : (
            <ul className="acc-offers" role="list">
              {hist.offers.map((d, i) => (
                <li key={i}><span className={`acc-offer acc-offer--${d.kind}`}>{d.code ?? d.label}</span>
                  <span className="acc-offer__on"><strong>{d.code ? d.label : d.kind === 'bundle' ? 'Bundle deal' : 'Offer'}</strong><span className="muted small">Order {d.orderNumber} · {date(d.at)}</span></span>
                  <strong className="acc-offer__amt">−{formatINR(d.amount)}</strong></li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === 'addresses' && <Addresses list={me.addresses} onChange={(addresses, msg) => { setMe({ ...me, addresses }); setToast(msg); }} />}

      {tab === 'profile' && <ProfileForm c={c} onSaved={(customer) => { setMe({ ...me, customer }); setSignedIn(customer); setToast('Your details are saved'); }} onSignOut={signOut} />}

      {toast && <p className="acc-toast" role="status">{toast}</p>}
    </div>
  );
}

function OrderCard({ o, live = false }: { o: Order; live?: boolean }) {
  const at = STAGES.indexOf(o.status);
  return (
    <li className={`acc-order${live ? ' is-live' : ''}`}>
      <a href={o.url} className="acc-order__link">
        <span className="acc-order__img">{o.image ? <img src={o.image} alt="" width={72} height={96} loading="lazy" /> : null}</span>
        <span className="acc-order__body">
          <span className="acc-order__top"><strong>{o.number}</strong><span className={`acc-status acc-status--${o.status}`}>{STAGE_LABEL[o.status] ?? o.status}</span>
            {o.refund && <span className={`acc-status ${o.refund === 'done' ? 'acc-status--delivered' : 'acc-status--confirmed'}`}>{o.refund === 'done' ? 'Refunded' : 'Refund in progress'}</span>}</span>
          <span className="acc-order__what">{o.title}{o.items > 1 ? ` and ${o.items - 1} more` : ''}</span>
          <span className="muted small">{date(o.createdAt)} · {formatINR(o.total)}{o.discount > 0 ? ` · saved ${formatINR(o.discount)}` : ''}</span>
          {live && at >= 0 && (
            <span className="acc-track" aria-label={`Progress: ${STAGE_LABEL[o.status]}`}>
              {STAGES.map((s, i) => <i key={s} className={i <= at ? 'is-done' : ''} />)}
            </span>
          )}
          {live && o.status === 'pending_payment' && <span className="acc-order__pay">Complete your payment <Icon name="arrowRight" size={16} /></span>}
        </span>
        <Icon name="chevronRight" size={20} />
      </a>
      {live && o.trackingUrl && <a className="acc-order__track" href={o.trackingUrl} target="_blank" rel="noopener">Track with {o.courier || 'courier'} <Icon name="arrowRight" size={16} /></a>}
    </li>
  );
}

const EMPTY: Omit<Address, 'id' | 'isDefault'> & { isDefault: boolean } = { label: '', name: '', phone: '', line1: '', line2: '', landmark: '', city: '', state: 'Kerala', pincode: '', isDefault: false };
function Addresses({ list, onChange }: { list: Address[]; onChange: (a: Address[], msg: string) => void }) {
  const [editing, setEditing] = useState<(typeof EMPTY & { id?: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState<Record<string, string>>({});
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    setBusy(true); setF({});
    try {
      const { id, ...body } = editing;
      const r = await acct<{ addresses: Address[] }>(id ? `/account/addresses/${id}` : '/account/addresses', { method: id ? 'PUT' : 'POST', body });
      onChange(r.addresses, id ? 'Address updated' : 'Address added'); setEditing(null);
    } catch (err) { setF((err as AccountError).fields); } finally { setBusy(false); }
  };
  const remove = async (a: Address) => {
    if (!confirm(`Remove ${a.label || 'this address'}?`)) return;
    const r = await acct<{ addresses: Address[] }>(`/account/addresses/${a.id}`, { method: 'DELETE' });
    onChange(r.addresses, 'Address removed');
  };
  const makeDefault = async (a: Address) => {
    const { id, ...rest } = a;
    const r = await acct<{ addresses: Address[] }>(`/account/addresses/${id}`, { method: 'PUT', body: { ...rest, isDefault: true } });
    onChange(r.addresses, 'Default address changed');
  };
  const field = (k: keyof typeof EMPTY, label: string, props: Record<string, unknown> = {}) => (
    <div className="field">
      <label htmlFor={`ad-${k}`}>{label}</label>
      <input id={`ad-${k}`} className="input" value={String(editing![k] ?? '')} onChange={(e) => setEditing({ ...editing!, [k]: e.target.value })} aria-invalid={!!f[k] || undefined} {...props} />
      {f[k] && <p className="field-error">{f[k]}</p>}
    </div>
  );

  return (
    <div className="acc-panel">
      <div className="acc-addrs">
        {list.map((a) => (
          <article key={a.id} className={`acc-addr${a.isDefault ? ' is-default' : ''}`}>
            <header><strong>{a.label || a.name}</strong>{a.isDefault && <span className="acc-badge">Default</span>}</header>
            <p>{a.name}<br />{[a.line1, a.line2].filter(Boolean).join(', ')}{a.landmark && <><br />Near {a.landmark}</>}<br />{a.city} {a.pincode}</p>
            <p className="muted small">{a.phone}</p>
            <footer>
              <button type="button" className="ac-link" onClick={() => setEditing({ ...a })}>Edit</button>
              {!a.isDefault && <button type="button" className="ac-link" onClick={() => makeDefault(a)}>Make default</button>}
              <button type="button" className="ac-link ac-link--quiet" onClick={() => remove(a)}>Remove</button>
            </footer>
          </article>
        ))}
        {!editing && <button type="button" className="acc-addr acc-addr--add" onClick={() => setEditing({ ...EMPTY })}><Icon name="plus" size={22} /> Add an address</button>}
      </div>
      {editing && (
        <form className="acc-form" onSubmit={save} noValidate>
          <h2 className="acc-h">{editing.id ? 'Edit address' : 'New address'}</h2>
          <div className="acc-grid">
            {field('label', 'Label (optional)', { placeholder: 'Home, Work, Amma’s place' })}
            {field('name', 'Full name', { autoComplete: 'name' })}
            {field('phone', 'Mobile number', { type: 'tel', inputMode: 'numeric', autoComplete: 'tel-national' })}
            {field('pincode', 'Pincode', { inputMode: 'numeric', maxLength: 6, autoComplete: 'postal-code' })}
          </div>
          {field('line1', 'House / flat, street', { autoComplete: 'address-line1' })}
          <div className="acc-grid">
            {field('line2', 'Area (optional)', { autoComplete: 'address-line2' })}
            {field('landmark', 'Landmark (optional)')}
            {field('city', 'Town / city', { autoComplete: 'address-level2' })}
          </div>
          <label className="ac-check"><input type="checkbox" checked={editing.isDefault} onChange={(e) => setEditing({ ...editing, isDefault: e.target.checked })} /> Use as my default address</label>
          <div className="acc-actions"><button type="button" className="btn btn--outline" onClick={() => { setEditing(null); setF({}); }}>Cancel</button><button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Save address'}</button></div>
        </form>
      )}
    </div>
  );
}

function ProfileForm({ c, onSaved, onSignOut }: { c: Profile; onSaved: (p: Profile) => void; onSignOut: (everywhere?: boolean) => void }) {
  const [v, setV] = useState({ name: c.name, phone: c.phone, marketing: c.marketing });
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState<Record<string, string>>({});
  const dirty = v.name !== c.name || v.phone !== c.phone || v.marketing !== c.marketing;
  const save = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setF({});
    try { onSaved((await acct<{ customer: Profile }>('/account/me', { method: 'PATCH', body: v })).customer); } catch (err) { setF((err as AccountError).fields); } finally { setBusy(false); }
  };
  return (
    <div className="acc-panel acc-profile">
      <form className="acc-form" onSubmit={save} noValidate>
        <h2 className="acc-h">Your details</h2>
        <div className="field"><label htmlFor="pf-name">Name</label><input id="pf-name" className="input" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} autoComplete="name" aria-invalid={!!f.name || undefined} />{f.name && <p className="field-error">{f.name}</p>}</div>
        <div className="field"><label htmlFor="pf-email">Email</label><div className="acc-verified"><input id="pf-email" className="input" value={c.email} readOnly aria-describedby="pf-email-v" /><span id="pf-email-v"><Icon name="check" size={14} /> Verified</span></div></div>
        <div className="field"><label htmlFor="pf-phone">Mobile number</label><input id="pf-phone" className="input" type="tel" inputMode="numeric" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} autoComplete="tel-national" aria-invalid={!!f.phone || undefined} />{f.phone && <p className="field-error">{f.phone}</p>}</div>
        <label className="ac-check"><input type="checkbox" checked={v.marketing} onChange={(e) => setV({ ...v, marketing: e.target.checked })} /> Email me about new arrivals and offers</label>
        <div className="acc-actions"><button className="btn" disabled={busy || !dirty}>{busy ? 'Saving…' : 'Save changes'}</button></div>
      </form>
      <aside className="acc-security">
        <h2 className="acc-h">Signing in</h2>
        <p className="muted small">You sign in with a code sent to {c.email}. There's no password to forget or leak.</p>
        <button type="button" className="btn btn--outline btn--block" onClick={() => onSignOut(false)}><Icon name="logout" size={18} /> Sign out</button>
        <button type="button" className="ac-link ac-link--quiet" onClick={() => { if (confirm('Sign out on every phone and computer, including this one?')) onSignOut(true); }}>Sign out on all devices</button>
      </aside>
    </div>
  );
}
