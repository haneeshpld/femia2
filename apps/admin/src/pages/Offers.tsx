import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, del, get, post, put } from '../lib/api.ts';
import { ago, formatINR, paiseToRupees, rupeesToPaise } from '../lib/format.ts';
import { useCategories, useCollections } from '../lib/catalog.ts';
import { useCan } from '../lib/me.ts';
import { Icon, type IconName } from '../components/Icon.tsx';
import { Empty, ErrorBox, Field, Sheet, Skeleton, useToast } from '../components/ui.tsx';

type Kind = 'sale' | 'bundle' | 'coupon' | 'tag';
type Style = 'maroon' | 'gold' | 'ink' | 'rose' | 'green';
type Scope = 'all' | 'products' | 'categories' | 'collections';
type Status = 'live' | 'scheduled' | 'ended' | 'paused' | 'used-up';
interface Offer {
  id: string; kind: Kind; name: string; label: string; style: Style; code: string | null;
  discountType: 'percent' | 'amount'; value: number; maxDiscount: number | null; scope: Scope; scopeIds: string[];
  minQty: number; minSubtotal: number; firstOrderOnly: boolean; usageLimit: number | null; perCustomerLimit: number | null; usedCount: number;
  startsAt: string | null; endsAt: string | null; active: boolean; status: Status; orders: number; discountGiven: number;
}
interface ProductRow { id: string; title: string; thumb: string | null; category: string }

const KINDS: { kind: Kind; label: string; plural: string; icon: IconName; blurb: string }[] = [
  { kind: 'sale', label: 'Sale', plural: 'Sales', icon: 'percent', blurb: 'Lower prices on chosen products, shown with a tag and the old price struck through.' },
  { kind: 'bundle', label: 'Bundle deal', plural: 'Bundles', icon: 'gift', blurb: 'Money off the bag when shoppers buy enough pieces or spend enough. Applies by itself.' },
  { kind: 'coupon', label: 'Coupon code', plural: 'Coupons', icon: 'ticket', blurb: 'A code shoppers type at checkout. Share it on Instagram, WhatsApp or with regulars.' },
  { kind: 'tag', label: 'Offer tag', plural: 'Tags', icon: 'tag', blurb: 'A ribbon like “Bestseller” or “Onam pick” on product photos. Prices stay the same.' },
];
const KIND = Object.fromEntries(KINDS.map((k) => [k.kind, k])) as Record<Kind, (typeof KINDS)[number]>;
const STYLES: { id: Style; label: string }[] = [
  { id: 'maroon', label: 'Maroon' }, { id: 'gold', label: 'Zari gold' }, { id: 'ink', label: 'Ink' }, { id: 'rose', label: 'Rose' }, { id: 'green', label: 'Leaf' },
];
const STATUS: Record<Status, { label: string; cls: string }> = {
  live: { label: 'Live', cls: 'of-status--live' }, scheduled: { label: 'Scheduled', cls: 'of-status--soon' },
  paused: { label: 'Paused', cls: 'of-status--off' }, ended: { label: 'Ended', cls: 'of-status--off' }, 'used-up': { label: 'Used up', cls: 'of-status--off' },
};

const rupees = (p: number) => `₹${(p / 100).toLocaleString('en-IN')}`;
const valueText = (o: Pick<Offer, 'discountType' | 'value'>) => (o.discountType === 'percent' ? `${o.value}% off` : `${rupees(o.value)} off`);
function bundleRule(o: Pick<Offer, 'minQty' | 'minSubtotal'>) {
  if (o.minQty > 0 && o.minSubtotal > 0) return `Buy ${o.minQty}+ pieces above ${rupees(o.minSubtotal)}`;
  if (o.minQty > 0) return `Buy ${o.minQty} or more pieces`;
  if (o.minSubtotal > 0) return `Spend ${rupees(o.minSubtotal)} or more`;
  return 'Set a rule';
}
function when(o: Pick<Offer, 'status' | 'startsAt' | 'endsAt'>) {
  if (o.status === 'scheduled' && o.startsAt) return `Starts ${ago(o.startsAt)}`;
  if (o.status === 'ended' && o.endsAt) return `Ended ${ago(o.endsAt)}`;
  if (o.endsAt) return `Ends ${ago(o.endsAt)}`;
  return 'No end date';
}
const endsSoon = (o: Offer) => o.status === 'live' && !!o.endsAt && Date.parse(o.endsAt) - Date.now() < 3 * 86400_000;

/** Offers: sales, bundle deals, coupon codes and tags. Owners create them; staff can see what's running. */
export default function Offers() {
  const qc = useQueryClient();
  const toast = useToast();
  const canWrite = useCan()('offers.write');
  const offers = useQuery({ queryKey: ['offers'], queryFn: () => get<Offer[]>('/admin/offers') });
  const cats = useCategories();
  const colls = useCollections();
  const [tab, setTab] = useState<Kind | 'all'>('all');
  const [editing, setEditing] = useState<Offer | 'new' | null>(null);

  const done = (text: string) => { qc.invalidateQueries({ queryKey: ['offers'] }); toast({ text }); };
  const fail = (e: unknown) => toast({ text: (e as Error).message, bad: true });
  const toggle = useMutation({
    mutationFn: (o: Offer) => post(`/admin/offers/${o.id}/active`, { active: !o.active }),
    onSuccess: (_r, o) => done(o.active ? `${o.name} paused` : `${o.name} is back on`), onError: fail,
  });
  const remove = useMutation({ mutationFn: (o: Offer) => del(`/admin/offers/${o.id}`), onSuccess: () => done('Offer deleted'), onError: fail });

  const list = offers.data ?? [];
  const shown = tab === 'all' ? list : list.filter((o) => o.kind === tab);
  const live = list.filter((o) => o.status === 'live');
  const scheduled = list.filter((o) => o.status === 'scheduled');
  const given = list.reduce((s, o) => s + o.discountGiven, 0);
  const orders = list.reduce((s, o) => s + o.orders, 0);

  const scopeText = (o: Pick<Offer, 'scope' | 'scopeIds'>) => {
    if (o.scope === 'all') return 'All products';
    if (o.scope === 'products') return `${o.scopeIds.length} product${o.scopeIds.length === 1 ? '' : 's'}`;
    const src = o.scope === 'categories' ? cats.data ?? [] : colls.data ?? [];
    const names = o.scopeIds.map((id) => src.find((x) => x.id === id)?.name).filter(Boolean) as string[];
    if (!names.length) return `${o.scopeIds.length} ${o.scope}`;
    return names.length > 2 ? `${names.slice(0, 2).join(', ')} +${names.length - 2}` : names.join(', ');
  };

  return (
    <>
      <div className="page-head">
        <div><h1>Offers</h1><p className="muted">Sales, bundle deals, coupon codes and tags on your website.</p></div>
        {canWrite && <button className="btn" onClick={() => setEditing('new')}><Icon name="plus" /> New offer</button>}
      </div>

      {offers.isPending ? <Skeleton n={3} h={140} /> : offers.error ? <ErrorBox error={offers.error} retry={() => offers.refetch()} /> : (
        <>
          {list.length > 0 && (
            <div className="of-stats">
              <div className="of-stat of-stat--hero">
                <span className="of-stat__num">{live.length}</span>
                <span className="of-stat__label">live now{live.length > 0 && <span className="of-stat__names">{live.slice(0, 3).map((o) => o.code ?? o.label ?? o.name).filter(Boolean).join(' · ')}</span>}</span>
              </div>
              <div className="of-stat"><span className="of-stat__num">{scheduled.length}</span><span className="of-stat__label">scheduled</span></div>
              <div className="of-stat"><span className="of-stat__num">{orders}</span><span className="of-stat__label">orders used an offer</span></div>
              <div className="of-stat"><span className="of-stat__num">{formatINR(given)}</span><span className="of-stat__label">given in bag discounts</span></div>
            </div>
          )}

          {list.length > 0 && (
            <div className="seg of-tabs" role="tablist" aria-label="Offer type">
              <button role="tab" aria-selected={tab === 'all'} className={tab === 'all' ? 'on' : ''} onClick={() => setTab('all')}>All <span className="of-count">{list.length}</span></button>
              {KINDS.map((k) => {
                const n = list.filter((o) => o.kind === k.kind).length;
                return <button key={k.kind} role="tab" aria-selected={tab === k.kind} className={tab === k.kind ? 'on' : ''} onClick={() => setTab(k.kind)}>{k.plural} {n > 0 && <span className="of-count">{n}</span>}</button>;
              })}
            </div>
          )}

          {list.length === 0 ? (
            <div className="card of-empty">
              <h2>Run your first offer</h2>
              <p className="muted">Pick what you'd like to do. You'll see exactly how it looks to shoppers before it goes live.</p>
              <div className="of-kinds">
                {KINDS.map((k) => (
                  <button key={k.kind} className="of-kind" disabled={!canWrite} onClick={() => setEditing({ ...blank(k.kind), id: '' } as Offer)}>
                    <span className={`of-kind__icon of-kind__icon--${k.kind}`}><Icon name={k.icon} /></span>
                    <strong>{k.label}</strong><span className="muted small">{k.blurb}</span>
                  </button>
                ))}
              </div>
              {!canWrite && <p className="muted small">Only the owner can create offers.</p>}
            </div>
          ) : shown.length === 0 ? (
            <Empty icon={KIND[tab as Kind].icon} title={`No ${KIND[tab as Kind].plural.toLowerCase()} yet`} body={KIND[tab as Kind].blurb}
              action={canWrite ? <button className="btn" onClick={() => setEditing({ ...blank(tab as Kind), id: '' } as Offer)}><Icon name="plus" /> New {KIND[tab as Kind].label.toLowerCase()}</button> : undefined} />
          ) : (
            <ul className="of-grid" role="list">
              {shown.map((o) => (
                <li key={o.id} className={`of-card of-card--${o.style}${o.status === 'live' ? '' : ' is-quiet'}`}>
                  <div className="of-card__face">
                    <Preview o={o} compact />
                  </div>
                  <div className="of-card__body">
                    <div className="of-card__top">
                      <span className="of-card__kind"><Icon name={KIND[o.kind].icon} size={16} /> {KIND[o.kind].label}</span>
                      <span className={`of-status ${STATUS[o.status].cls}`}>{STATUS[o.status].label}</span>
                    </div>
                    <h2 className="of-card__name">{o.name}</h2>
                    <p className="of-card__meta">
                      {o.kind !== 'tag' && <span>{valueText(o)}{o.maxDiscount ? ` (up to ${rupees(o.maxDiscount)})` : ''}</span>}
                      {o.kind === 'bundle' && <span>{bundleRule(o)}</span>}
                      {o.kind === 'coupon' && o.minSubtotal > 0 && <span>Min. {rupees(o.minSubtotal)}</span>}
                      {o.kind === 'coupon' && o.firstOrderOnly && <span>First order only</span>}
                      <span>{scopeText(o)}</span>
                    </p>
                    <p className={`of-card__when${endsSoon(o) ? ' is-soon' : ''}`}><Icon name="clock" size={15} /> {when(o)}</p>
                    {o.kind === 'coupon' && o.usageLimit && (
                      <div className="of-usage" aria-label={`${o.usedCount} of ${o.usageLimit} uses`}>
                        <span className="of-usage__bar"><span style={{ width: `${Math.min(100, (o.usedCount / o.usageLimit) * 100)}%` }} /></span>
                        <span className="small muted">{o.usedCount} / {o.usageLimit} used</span>
                      </div>
                    )}
                    {(o.kind === 'coupon' || o.kind === 'bundle') && (
                      <p className="of-card__perf"><strong>{o.orders}</strong> order{o.orders === 1 ? '' : 's'} · <strong>{formatINR(o.discountGiven)}</strong> given</p>
                    )}
                    {canWrite && (
                      <div className="of-card__actions">
                        <button className="btn btn--quiet btn--sm" onClick={() => setEditing(o)}><Icon name="edit" size={18} /> Edit</button>
                        {(o.status !== 'ended' || !o.active) && (
                          <button className="btn btn--quiet btn--sm" onClick={() => toggle.mutate(o)} disabled={toggle.isPending}>
                            <Icon name={o.active ? 'pause' : 'play'} size={18} /> {o.active ? 'Pause' : 'Resume'}
                          </button>
                        )}
                        <span className="spacer" />
                        {o.orders === 0 && (
                          <button className="icon-btn" aria-label={`Delete ${o.name}`} onClick={() => { if (confirm(`Delete "${o.name}"? This can't be undone.`)) remove.mutate(o); }}><Icon name="trash" size={20} /></button>
                        )}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {editing && (
        <OfferSheet
          offer={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(o, isNew) => { setEditing(null); done(isNew ? `${o.name} created${o.status === 'live' ? ' and live on the website' : ''}` : 'Offer saved'); }}
        />
      )}
    </>
  );
}

// ───────────── preview: what shoppers see ─────────────

type Look = Pick<Offer, 'kind' | 'label' | 'style' | 'code' | 'discountType' | 'value' | 'minQty' | 'minSubtotal'>;
function Preview({ o, compact = false }: { o: Look; compact?: boolean }) {
  const sample = 189900;
  const off = o.discountType === 'percent' ? Math.round((sample * o.value) / 100 / 100) * 100 : o.value;
  const tag = o.label || (o.kind === 'sale' ? 'Sale' : o.kind === 'tag' ? 'Tag' : '');
  if (o.kind === 'coupon') {
    return (
      <div className="pv-ticket">
        <span className="pv-ticket__code">{o.code || 'CODE'}</span>
        <span className="pv-ticket__val">{o.value ? valueText(o) : 'Set a discount'}</span>
      </div>
    );
  }
  if (o.kind === 'bundle') {
    return (
      <div className="pv-bundle">
        <span className="pv-bundle__icon"><Icon name="gift" size={compact ? 22 : 24} /></span>
        <span className="pv-bundle__text"><strong>{o.label || (o.value ? valueText(o) : 'Bundle deal')}</strong><span>{bundleRule(o)}</span></span>
      </div>
    );
  }
  return (
    <div className="pv-card">
      <div className="pv-card__photo">
        <span className={`offer-tag offer-tag--${o.style}`}>{tag}</span>
        <span className="pv-card__fabric" aria-hidden="true" />
      </div>
      {!compact && (
        <div className="pv-card__body">
          <span className="pv-card__title">Anarkali kurta</span>
          {o.kind === 'sale' && o.value > 0
            ? <span className="pv-card__price"><b>{formatINR(Math.max(0, sample - off))}</b> <s>{formatINR(sample)}</s></span>
            : <span className="pv-card__price"><b>{formatINR(sample)}</b></span>}
        </div>
      )}
      {compact && o.kind === 'sale' && <span className="pv-card__badge">{o.value ? valueText(o) : ''}</span>}
    </div>
  );
}

// ───────────── create / edit ─────────────

interface Draft {
  kind: Kind; name: string; label: string; style: Style; code: string; discountType: 'percent' | 'amount'; value: string; maxDiscount: string;
  scope: Scope; scopeIds: string[]; minQty: string; minSubtotal: string; firstOrderOnly: boolean; usageLimit: string; perCustomerLimit: string;
  startsAt: string; endsAt: string; active: boolean;
}
const pad = (n: number) => String(n).padStart(2, '0');
const toLocal = (iso: string | null) => { if (!iso) return ''; const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const fromLocal = (s: string) => (s ? new Date(s).toISOString() : null);

function blank(kind: Kind): Partial<Offer> {
  return { kind, name: '', label: '', style: kind === 'tag' ? 'ink' : kind === 'coupon' ? 'maroon' : 'gold', code: null, discountType: 'percent', value: 0, maxDiscount: null,
    scope: 'all', scopeIds: [], minQty: kind === 'bundle' ? 2 : 0, minSubtotal: 0, firstOrderOnly: false, usageLimit: null, perCustomerLimit: kind === 'coupon' ? 1 : null,
    startsAt: null, endsAt: null, active: true };
}
function toDraft(o: Partial<Offer>): Draft {
  return {
    kind: o.kind!, name: o.name ?? '', label: o.label ?? '', style: o.style ?? 'maroon', code: o.code ?? '', discountType: o.discountType ?? 'percent',
    value: o.value ? (o.discountType === 'amount' ? paiseToRupees(o.value) : String(o.value)) : '', maxDiscount: paiseToRupees(o.maxDiscount),
    scope: o.scope ?? 'all', scopeIds: o.scopeIds ?? [], minQty: o.minQty ? String(o.minQty) : '', minSubtotal: o.minSubtotal ? paiseToRupees(o.minSubtotal) : '',
    firstOrderOnly: !!o.firstOrderOnly, usageLimit: o.usageLimit ? String(o.usageLimit) : '', perCustomerLimit: o.perCustomerLimit ? String(o.perCustomerLimit) : '',
    startsAt: toLocal(o.startsAt ?? null), endsAt: toLocal(o.endsAt ?? null), active: o.active ?? true,
  };
}
function toInput(d: Draft) {
  const int = (s: string) => (s.trim() ? Math.max(0, Math.round(Number(s))) : 0);
  const value = d.kind === 'tag' ? 0 : d.discountType === 'amount' ? rupeesToPaise(d.value) : int(d.value);
  return {
    kind: d.kind, name: d.name, label: d.label, style: d.style, code: d.kind === 'coupon' ? d.code.trim() || null : null,
    discountType: d.discountType, value, maxDiscount: d.discountType === 'percent' && d.maxDiscount.trim() ? rupeesToPaise(d.maxDiscount) : null,
    scope: d.scope, scopeIds: d.scope === 'all' ? [] : d.scopeIds,
    minQty: d.kind === 'bundle' ? int(d.minQty) : 0,
    minSubtotal: d.kind === 'bundle' || d.kind === 'coupon' ? rupeesToPaise(d.minSubtotal) : 0,
    firstOrderOnly: d.kind === 'coupon' && d.firstOrderOnly,
    usageLimit: d.kind === 'coupon' && int(d.usageLimit) ? int(d.usageLimit) : null,
    perCustomerLimit: d.kind === 'coupon' && int(d.perCustomerLimit) ? int(d.perCustomerLimit) : null,
    startsAt: fromLocal(d.startsAt), endsAt: fromLocal(d.endsAt), active: d.active,
  };
}
const suggestCode = (d: Draft) => {
  const word = d.name.replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 8) || 'FEMIA';
  const n = Number(d.value) || 10;
  return `${word}${d.discountType === 'percent' ? n : Math.round(n)}`.slice(0, 20);
};

function OfferSheet({ offer, onClose, onSaved }: { offer: Offer | null; onClose: () => void; onSaved: (o: Offer, isNew: boolean) => void }) {
  const isNew = !offer?.id;
  const [d, setD] = useState<Draft | null>(offer ? toDraft(offer) : null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => { setD((x) => (x ? { ...x, [k]: v } : x)); if (errors[k]) setErrors((e) => ({ ...e, [k]: '' })); };
  const save = useMutation({
    mutationFn: (body: ReturnType<typeof toInput>) => (isNew ? post<Offer>('/admin/offers', body) : put<Offer>(`/admin/offers/${offer!.id}`, body)),
    onSuccess: (o) => onSaved(o, isNew),
    onError: (e) => { if (e instanceof ApiError) setErrors(e.fields); },
  });

  if (!d) {
    return (
      <Sheet title="New offer" onClose={onClose}>
        <p className="muted" style={{ marginBottom: 'var(--sp-4)' }}>What would you like to run?</p>
        <div className="of-kinds of-kinds--sheet">
          {KINDS.map((k) => (
            <button key={k.kind} className="of-kind" onClick={() => setD(toDraft(blank(k.kind)))}>
              <span className={`of-kind__icon of-kind__icon--${k.kind}`}><Icon name={k.icon} /></span>
              <strong>{k.label}</strong><span className="muted small">{k.blurb}</span>
            </button>
          ))}
        </div>
      </Sheet>
    );
  }

  const k = KIND[d.kind];
  const look: Look = { ...toInput(d), code: d.code.trim().toUpperCase() || null };
  const general = save.error && !(save.error instanceof ApiError && Object.keys(save.error.fields).length) ? (save.error as Error).message : null;
  const quickEnd = (days: number) => { const e = new Date(); e.setDate(e.getDate() + days); e.setHours(23, 59, 0, 0); set('endsAt', toLocal(e.toISOString())); };

  return (
    <Sheet
      title={isNew ? `New ${k.label.toLowerCase()}` : `Edit ${k.label.toLowerCase()}`}
      onClose={onClose}
      footer={<>
        <label className="check of-live"><input type="checkbox" checked={d.active} onChange={(e) => set('active', e.target.checked)} /> Turn on</label>
        <span className="spacer" />
        <button className="btn btn--quiet" onClick={onClose}>Cancel</button>
        <button className="btn" onClick={() => save.mutate(toInput(d))} disabled={save.isPending}>{save.isPending ? 'Saving…' : isNew ? 'Create offer' : 'Save'}</button>
      </>}
    >
      <div className="stack">
        <div className={`of-preview of-preview--${d.kind}`} aria-label="Preview">
          <span className="of-preview__label">How shoppers see it</span>
          <Preview o={look} />
          {d.kind === 'bundle' && <p className="of-preview__note">In the bag: “Add 1 more piece to get {d.label || (Number(d.value) ? valueText(look) : 'this deal')}”</p>}
          {d.kind === 'coupon' && <p className="of-preview__note">Typed at checkout, applied after any sale prices.</p>}
        </div>
        {general && <div className="notice notice--bad" role="alert"><Icon name="info" /><div>{general}</div></div>}

        <Field label="Offer name" hint="For you. Shoppers don't see this." error={errors.name}>
          <input className="input" value={d.name} onChange={(e) => set('name', e.target.value)} placeholder={d.kind === 'coupon' ? 'Instagram followers' : d.kind === 'tag' ? 'Bestsellers' : 'Onam sale 2026'} maxLength={60} autoFocus />
        </Field>

        {d.kind === 'coupon' && (
          <Field label="Code" hint="Letters and numbers, 3–20. Shoppers type this at checkout." error={errors.code}>
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <input className="input of-code-input" value={d.code} onChange={(e) => set('code', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} placeholder="ONAM10" maxLength={20} />
              <button type="button" className="btn btn--quiet" onClick={() => set('code', suggestCode(d))}><Icon name="sparkle" size={18} /> Suggest</button>
            </div>
          </Field>
        )}

        {(d.kind === 'sale' || d.kind === 'tag' || d.kind === 'bundle') && (
          <Field label={d.kind === 'bundle' ? 'Deal name shoppers see (optional)' : 'Tag shoppers see'} hint={d.kind === 'bundle' ? 'Leave empty to show the rule, e.g. “Buy 2, get 10% off”.' : 'Short works best: Onam Sale, Bestseller, Festive pick.'} error={errors.label}>
            <input className="input" value={d.label} onChange={(e) => set('label', e.target.value)} placeholder={d.kind === 'tag' ? 'Bestseller' : d.kind === 'bundle' ? 'Pair & save' : 'Onam Sale'} maxLength={28} />
          </Field>
        )}

        {(d.kind === 'sale' || d.kind === 'tag') && (
          <div className="field">
            <span>Tag colour</span>
            <div className="of-styles" role="radiogroup" aria-label="Tag colour">
              {STYLES.map((s) => (
                <button key={s.id} type="button" role="radio" aria-checked={d.style === s.id} className={`of-style${d.style === s.id ? ' is-on' : ''}`} onClick={() => set('style', s.id)}>
                  <span className={`offer-tag offer-tag--${s.id}`}>{d.label || s.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {d.kind !== 'tag' && (
          <fieldset className="of-group">
            <legend>Discount</legend>
            <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
              <div className="seg" role="radiogroup" aria-label="Discount type">
                <button type="button" role="radio" aria-checked={d.discountType === 'percent'} className={d.discountType === 'percent' ? 'on' : ''} onClick={() => set('discountType', 'percent')}>% off</button>
                <button type="button" role="radio" aria-checked={d.discountType === 'amount'} className={d.discountType === 'amount' ? 'on' : ''} onClick={() => set('discountType', 'amount')}>₹ off</button>
              </div>
              <div style={{ flex: 1 }}>
                <Field label={d.discountType === 'percent' ? 'Percent' : 'Amount'} error={errors.value}>
                  <div className="prefix">{d.discountType === 'amount' && <b>₹</b>}<input className="input" inputMode="numeric" value={d.value} onChange={(e) => set('value', e.target.value.replace(/[^\d.]/g, ''))} placeholder={d.discountType === 'percent' ? '10' : '200'} /></div>
                </Field>
              </div>
            </div>
            {d.discountType === 'percent' && d.kind !== 'sale' && (
              <Field label="Most it can take off (optional)" hint="Keeps big bags from getting a very large discount." error={errors.maxDiscount}>
                <div className="prefix"><b>₹</b><input className="input" inputMode="numeric" value={d.maxDiscount} onChange={(e) => set('maxDiscount', e.target.value.replace(/[^\d.]/g, ''))} placeholder="500" /></div>
              </Field>
            )}
            {d.kind === 'sale' && <p className="muted small">Sale prices round to the nearest rupee. If two sales cover a product, shoppers get the better one.</p>}
          </fieldset>
        )}

        {d.kind === 'bundle' && (
          <fieldset className="of-group">
            <legend>When it applies</legend>
            <div className="grid2">
              <Field label="Minimum pieces" error={errors.minQty}><input className="input" inputMode="numeric" value={d.minQty} onChange={(e) => set('minQty', e.target.value.replace(/\D/g, ''))} placeholder="2" /></Field>
              <Field label="Minimum spend (optional)" error={errors.minSubtotal}><div className="prefix"><b>₹</b><input className="input" inputMode="numeric" value={d.minSubtotal} onChange={(e) => set('minSubtotal', e.target.value.replace(/[^\d.]/g, ''))} placeholder="2999" /></div></Field>
            </div>
            <p className="muted small">Only pieces from the products below count. If several deals qualify, the bag gets the biggest one.</p>
          </fieldset>
        )}

        {d.kind === 'coupon' && (
          <fieldset className="of-group">
            <legend>Rules</legend>
            <div className="grid3">
              <Field label="Minimum order" error={errors.minSubtotal}><div className="prefix"><b>₹</b><input className="input" inputMode="numeric" value={d.minSubtotal} onChange={(e) => set('minSubtotal', e.target.value.replace(/[^\d.]/g, ''))} placeholder="None" /></div></Field>
              <Field label="Total uses" error={errors.usageLimit}><input className="input" inputMode="numeric" value={d.usageLimit} onChange={(e) => set('usageLimit', e.target.value.replace(/\D/g, ''))} placeholder="Unlimited" /></Field>
              <Field label="Uses per customer" error={errors.perCustomerLimit}><input className="input" inputMode="numeric" value={d.perCustomerLimit} onChange={(e) => set('perCustomerLimit', e.target.value.replace(/\D/g, ''))} placeholder="Unlimited" /></Field>
            </div>
            <label className="check"><input type="checkbox" checked={d.firstOrderOnly} onChange={(e) => set('firstOrderOnly', e.target.checked)} /> Only for a customer's first order (checked by mobile number)</label>
          </fieldset>
        )}

        <ScopePicker d={d} set={set} error={errors.scopeIds} />

        <fieldset className="of-group">
          <legend>Schedule</legend>
          <div className="grid2">
            <Field label="Starts" hint="Empty starts it now." error={errors.startsAt}><input className="input" type="datetime-local" value={d.startsAt} onChange={(e) => set('startsAt', e.target.value)} /></Field>
            <Field label="Ends" hint="Empty runs until you pause it." error={errors.endsAt}><input className="input" type="datetime-local" value={d.endsAt} onChange={(e) => set('endsAt', e.target.value)} /></Field>
          </div>
          <div className="row">
            <span className="muted small">End in</span>
            {[['1 day', 1], ['3 days', 3], ['1 week', 7], ['1 month', 30]].map(([l, n]) => <button key={l} type="button" className="add-chip add-chip--compact" onClick={() => quickEnd(n as number)}>{l}</button>)}
            {d.endsAt && <button type="button" className="add-chip add-chip--compact" onClick={() => set('endsAt', '')}>No end</button>}
          </div>
          {(d.kind === 'sale') && <p className="muted small">In the last three days of a sale, product pages show a “Sale ends in …” countdown.</p>}
        </fieldset>
      </div>
    </Sheet>
  );
}

function ScopePicker({ d, set, error }: { d: Draft; set: <K extends keyof Draft>(k: K, v: Draft[K]) => void; error?: string }) {
  const cats = useCategories();
  const colls = useCollections();
  const products = useQuery({ queryKey: ['offer-products'], queryFn: () => get<{ items: ProductRow[] }>('/admin/products?pageSize=100'), enabled: d.scope === 'products' });
  const [q, setQ] = useState('');
  const toggle = (id: string) => set('scopeIds', d.scopeIds.includes(id) ? d.scopeIds.filter((x) => x !== id) : [...d.scopeIds, id]);
  const options = useMemo(() => {
    if (d.scope === 'categories') return (cats.data ?? []).map((c) => ({ id: c.id, name: c.name, sub: '' }));
    if (d.scope === 'collections') return (colls.data ?? []).map((c) => ({ id: c.id, name: c.name, sub: c.kind === 'occasion' ? 'Occasion' : '' }));
    if (d.scope === 'products') return (products.data?.items ?? []).map((p) => ({ id: p.id, name: p.title, sub: p.category, thumb: p.thumb }));
    return [];
  }, [d.scope, cats.data, colls.data, products.data]);
  const filtered = q ? options.filter((o) => o.name.toLowerCase().includes(q.toLowerCase())) : options;
  const scopes: { id: Scope; label: string }[] = [{ id: 'all', label: 'Everything' }, { id: 'categories', label: 'Categories' }, { id: 'collections', label: 'Collections' }, { id: 'products', label: 'Products' }];

  return (
    <fieldset className="of-group">
      <legend>{d.kind === 'tag' ? 'Show on' : 'Applies to'}</legend>
      <div className="seg" role="radiogroup" aria-label="Applies to">
        {scopes.map((s) => <button key={s.id} type="button" role="radio" aria-checked={d.scope === s.id} className={d.scope === s.id ? 'on' : ''} onClick={() => { set('scope', s.id); set('scopeIds', []); setQ(''); }}>{s.label}</button>)}
      </div>
      {d.scope !== 'all' && (
        <div className="of-pick">
          {d.scope === 'products' && <input className="input" type="search" placeholder="Search products" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search products" />}
          {products.isPending && d.scope === 'products' ? <Skeleton n={2} h={48} /> : (
            <ul className="of-pick__list" role="list">
              {filtered.map((o) => (
                <li key={o.id}>
                  <label className={`of-pick__item${d.scopeIds.includes(o.id) ? ' is-on' : ''}`}>
                    <input type="checkbox" checked={d.scopeIds.includes(o.id)} onChange={() => toggle(o.id)} />
                    {'thumb' in o && (o.thumb ? <img src={o.thumb as string} alt="" className="of-pick__thumb" /> : <span className="of-pick__thumb" />)}
                    <span><strong>{o.name}</strong>{o.sub && <span className="muted small"> · {o.sub}</span>}</span>
                  </label>
                </li>
              ))}
              {filtered.length === 0 && <li className="muted small" style={{ padding: 'var(--sp-3)' }}>Nothing found.</li>}
            </ul>
          )}
          <p className="small muted">{d.scopeIds.length} selected</p>
        </div>
      )}
      {error && <span className="err" role="alert">{error}</span>}
    </fieldset>
  );
}
