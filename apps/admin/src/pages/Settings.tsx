import { useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, get, put } from '../lib/api.ts';
import { paiseToRupees, rupeesToPaise } from '../lib/format.ts';
import { useCan } from '../lib/me.ts';
import { ErrorBox, Field, Skeleton, useToast } from '../components/ui.tsx';

interface KeyField { id: string; label: string; secret: boolean; set: boolean; preview: string | null ; source?: 'secret' | 'admin' | null }
interface Resp { settings: any; gateway: { provider: string; label: string; fields: KeyField[]; webhookUrl: string; mode?: 'test' | 'live' | null } | null }

export default function Settings() {
  const q = useQuery({ queryKey: ['settings'], queryFn: () => get<Resp>('/admin/settings') });
  if (q.isPending) return <Skeleton n={4} h={120} />;
  if (q.error) return <ErrorBox error={q.error} />;
  return (
    <>
      <div className="page-head"><div><h1>Settings</h1><p className="muted">Changes apply to the website within a minute.</p></div></div>
      <div className="stack">
        <Store initial={q.data.settings.store} />
        <Shipping initial={q.data.settings.shipping} />
        <Payments initial={q.data.settings.payments} gateway={q.data.gateway} />
        <Notifications initial={q.data.settings.notifications} />
      </div>
    </>
  );
}

function useSection(section: string) {
  const qc = useQueryClient();
  const toast = useToast();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const m = useMutation({
    mutationFn: (v: unknown) => put(`/admin/settings/${section}`, v),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['settings'] }); setErrors({}); toast({ text: 'Saved' }); },
    onError: (e) => { if (e instanceof ApiError) setErrors(e.fields); toast({ text: (e as Error).message, bad: true }); },
  });
  return { save: m.mutate, busy: m.isPending, errors };
}

function Section({ title, desc, children, onSave, busy, canSave = true }: { title: string; desc?: string; children: ReactNode; onSave: () => void; busy: boolean; canSave?: boolean }) {
  const can = useCan();
  return (
    <form className="card stack" onSubmit={(e) => { e.preventDefault(); onSave(); }}>
      <div><h2>{title}</h2>{desc && <p className="muted small">{desc}</p>}</div>
      <fieldset disabled={!can('settings.write')} style={{ border: 0, padding: 0, display: 'grid', gap: 'var(--sp-4)' }}>{children}</fieldset>
      {can('settings.write') && canSave && <div className="row"><span className="spacer" /><button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></div>}
    </form>
  );
}

function Store({ initial }: { initial: any }) {
  const [s, setS] = useState(initial);
  const { save, busy, errors } = useSection('store');
  const set = (k: string) => (e: { target: { value: string } }) => setS({ ...s, [k]: e.target.value });
  const setA = (k: string) => (e: { target: { value: string } }) => setS({ ...s, address: { ...s.address, [k]: e.target.value } });
  return (
    <Section title="Store" desc="Shown in the footer, Visit Us page, emails and bills." onSave={() => save(s)} busy={busy}>
      <div className="grid2">
        <Field label="Store name" error={errors.name}><input className="input" value={s.name} onChange={set('name')} /></Field>
        <Field label="Tagline"><input className="input" value={s.tagline} onChange={set('tagline')} /></Field>
        <Field label="Email" error={errors.email}><input className="input" type="email" value={s.email} onChange={set('email')} /></Field>
        <Field label="Phone"><input className="input" inputMode="tel" value={s.phone} onChange={set('phone')} /></Field>
        <Field label="WhatsApp number" hint="10-digit mobile. Used for chat buttons and WhatsApp orders."><input className="input" inputMode="tel" value={s.whatsapp} onChange={set('whatsapp')} /></Field>
        <Field label="Opening hours" hint="e.g. Open daily · 10 AM – 9 PM"><input className="input" value={s.hoursSummary} onChange={set('hoursSummary')} /></Field>
      </div>
      <div className="grid2">
        <Field label="Address line 1"><input className="input" value={s.address.line1} onChange={setA('line1')} /></Field>
        <Field label="Address line 2"><input className="input" value={s.address.line2} onChange={setA('line2')} /></Field>
        <Field label="City"><input className="input" value={s.address.city} onChange={setA('city')} /></Field>
        <Field label="Pincode"><input className="input" inputMode="numeric" value={s.address.pincode} onChange={setA('pincode')} /></Field>
      </div>
      <div className="grid2">
        <Field label="Google Maps link"><input className="input" inputMode="url" value={s.mapUrl} onChange={set('mapUrl')} /></Field>
        <Field label="Instagram link"><input className="input" inputMode="url" value={s.socials.instagram} onChange={(e) => setS({ ...s, socials: { ...s.socials, instagram: e.target.value } })} /></Field>
      </div>
    </Section>
  );
}

function Shipping({ initial }: { initial: any }) {
  const [s, setS] = useState(initial);
  const { save, busy, errors } = useSection('shipping');
  return (
    <Section title="Shipping" onSave={() => save(s)} busy={busy}>
      <div className="grid2">
        <Field label="Free shipping above" error={errors.freeShippingThreshold}><div className="prefix"><b>₹</b><input className="input" inputMode="numeric" value={paiseToRupees(s.freeShippingThreshold)} onChange={(e) => setS({ ...s, freeShippingThreshold: rupeesToPaise(e.target.value) })} /></div></Field>
        <Field label="Shipping fee below that" error={errors.flatFee}><div className="prefix"><b>₹</b><input className="input" inputMode="numeric" value={paiseToRupees(s.flatFee)} onChange={(e) => setS({ ...s, flatFee: rupeesToPaise(e.target.value) })} /></div></Field>
      </div>
      <Field label="We deliver to" hint="Other states arrive with GST mode in release 1.1."><div className="row"><span className="badge badge--maroon">Kerala</span></div></Field>
      <label className="check"><input type="checkbox" checked={s.cod.enabled} onChange={(e) => setS({ ...s, cod: { ...s.cod, enabled: e.target.checked } })} /> Offer Cash on Delivery</label>
      {s.cod.enabled && <Field label="COD order limit" hint="Leave empty for no limit."><div className="prefix"><b>₹</b><input className="input" inputMode="numeric" value={paiseToRupees(s.cod.maxOrderValue)} onChange={(e) => setS({ ...s, cod: { ...s.cod, maxOrderValue: e.target.value ? rupeesToPaise(e.target.value) : null } })} /></div></Field>}
    </Section>
  );
}

function Payments({ initial, gateway }: { initial: any; gateway: Resp['gateway'] }) {
  const [s, setS] = useState(initial);
  const { save, busy, errors } = useSection('payments');
  const can = useCan();
  const qc = useQueryClient();
  const toast = useToast();
  const [keys, setKeys] = useState<Record<string, string>>({});
  const saveKeys = useMutation({
    mutationFn: () => put('/admin/settings/payments/keys', { provider: s.gateway.provider, keys: Object.fromEntries(Object.entries(keys).filter(([, v]) => v.trim())) }),
    onSuccess: () => { setKeys({}); qc.invalidateQueries({ queryKey: ['settings'] }); toast({ text: 'Gateway keys saved securely' }); },
    onError: (e) => toast({ text: (e as Error).message, bad: true }),
  });
  useEffect(() => setS(initial), [initial]);
  const keysReady = !!gateway?.fields.filter((f) => f.id !== 'webhookSecret').every((f) => f.set);
  const fromSecrets = !!gateway?.fields.some((f) => f.source === 'secret');
  return (
    <>
      <Section title="Payments" desc="Customers see only the methods you switch on." onSave={() => save(s)} busy={busy}>
        <label className="check"><input type="checkbox" checked={s.upi.enabled} onChange={(e) => setS({ ...s, upi: { ...s.upi, enabled: e.target.checked } })} /> UPI (scan & pay, you confirm in Admin)</label>
        {s.upi.enabled && (
          <div className="grid3">
            <Field label="UPI ID" error={errors['upi.vpa']} hint="e.g. femia@okicici"><input className="input" value={s.upi.vpa} onChange={(e) => setS({ ...s, upi: { ...s.upi, vpa: e.target.value.trim() } })} /></Field>
            <Field label="Name on UPI"><input className="input" value={s.upi.payeeName} onChange={(e) => setS({ ...s, upi: { ...s.upi, payeeName: e.target.value } })} /></Field>
            <Field label="Hold items for (hours)" hint="Unpaid UPI orders cancel after this."><input className="input" inputMode="numeric" value={s.upi.holdHours} onChange={(e) => setS({ ...s, upi: { ...s.upi, holdHours: Number(e.target.value.replace(/\D/g, '')) || 1 } })} /></Field>
          </div>
        )}
        <label className="check"><input type="checkbox" checked={s.whatsapp.enabled} onChange={(e) => setS({ ...s, whatsapp: { ...s.whatsapp, enabled: e.target.checked } })} /> WhatsApp orders</label>
        <label className="check"><input type="checkbox" checked={s.gateway.enabled} disabled={!keysReady} onChange={(e) => setS({ ...s, gateway: { ...s.gateway, enabled: e.target.checked } })} /> Online payments via {gateway?.label ?? 'gateway'}{!keysReady && <span className="muted small"> (add keys below first)</span>}</label>
      </Section>
      {gateway && can('payments.keys') && (
        <form className="card stack" onSubmit={(e) => { e.preventDefault(); saveKeys.mutate(); }}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div><h2>{gateway.label} keys</h2>
              <p className="muted small">{fromSecrets
                ? 'Set as Cloudflare Worker secrets from the deploy (clients/femia.secrets.env). Those always win over keys typed here. Staff can never see them.'
                : 'Stored encrypted. Staff can never see them. Use test keys until KYC is approved, then swap in live keys: no redeploy needed.'}</p></div>
            {gateway.mode && <span className={`badge ${gateway.mode === 'live' ? 'badge--ok' : 'badge--warn'}`}>{gateway.mode === 'live' ? 'Live: real payments' : 'Test mode: no real money'}</span>}
          </div>
          <div className="grid3">
            {gateway.fields.map((f) => (
              <Field key={f.id} label={f.label} hint={f.source === 'secret' ? `Cloudflare secret: ${f.preview}` : f.set ? `Saved: ${f.preview}` : f.id === 'webhookSecret' ? 'Optional, but needed for instant confirmations' : 'Not set'}>
                <input className="input" type={f.secret ? 'password' : 'text'} autoComplete="off" value={keys[f.id] ?? ''} onChange={(e) => setKeys({ ...keys, [f.id]: e.target.value })}
                  disabled={f.source === 'secret'} placeholder={f.source === 'secret' ? 'Managed by deploy secrets' : f.set ? 'Leave blank to keep' : ''} />
              </Field>
            ))}
          </div>
          <Field label="Webhook URL" hint={`Add this in your ${gateway.label} dashboard → Webhooks, with events payment.captured, payment.failed, order.paid, refund.processed, refund.failed.`}><input className="input" readOnly value={gateway.webhookUrl} onFocus={(e) => e.target.select()} /></Field>
          <div className="row"><span className="spacer" /><button className="btn" disabled={saveKeys.isPending || !Object.values(keys).some((v) => v.trim())}>Save keys</button></div>
        </form>
      )}
    </>
  );
}

function Notifications({ initial }: { initial: any }) {
  const [s, setS] = useState(initial);
  const { save, busy } = useSection('notifications');
  return (
    <Section title="Alerts" desc="Telegram alerts for every new order, failed payment and low stock, plus a 9 AM daily summary." onSave={() => save(s)} busy={busy}>
      <div className="grid2">
        <Field label="Telegram chat ID" hint="Message our bot /start, then paste the number it replies with."><input className="input" inputMode="numeric" value={s.telegramChatId} onChange={(e) => setS({ ...s, telegramChatId: e.target.value.trim() })} /></Field>
        <Field label="Low-stock alert at" hint="Items at or below this count show as low."><input className="input" inputMode="numeric" value={s.lowStockThreshold} onChange={(e) => setS({ ...s, lowStockThreshold: Number(e.target.value.replace(/\D/g, '')) || 0 })} /></Field>
      </div>
      <label className="check"><input type="checkbox" checked={s.dailySummary} onChange={(e) => setS({ ...s, dailySummary: e.target.checked })} /> Send the 9 AM daily summary</label>
    </Section>
  );
}
