import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, get, post, put } from '../lib/api.ts';
import { formatINR, paiseToRupees, percentOff, rupeesToPaise } from '../lib/format.ts';
import type { MediaRef } from '../lib/image.ts';
import { useCan } from '../lib/me.ts';
import { Icon } from '../components/Icon.tsx';
import { PhotoUpload, PRODUCT_SLOT } from '../components/PhotoUpload.tsx';
import { ErrorBox, Field, Skeleton, StatusBadge, useToast } from '../components/ui.tsx';
import { AddColour, AddInline } from '../components/AddInline.tsx';
import { slugValue, useCatalogMutations, useCategories, useCollections, usePresets } from '../lib/catalog.ts';

const CARE: Record<string, string> = {
  default: 'Gentle hand wash in cold water. Wash dark colours separately. Dry in shade. Warm iron on the reverse.',
  Silk: 'Dry clean only. Store folded in a muslin cloth. Iron on low heat on the reverse.',
  Georgette: 'Dry clean recommended, or gentle hand wash in cold water. Do not wring. Iron on low heat.',
  Organza: 'Dry clean only. Iron on low heat with a cloth in between.',
};
const STEPS = ['Photos', 'Details', 'Sizes & Colours', 'Price', 'Preview'] as const;

interface Img { mediaId: string; role: 'main' | 'alt' | 'detail'; option2: string | null; media: MediaRef }
interface V { id?: string; option1: string | null; option2: string | null; sku?: string; price: number | null; onHand: number; reserved?: number; available?: number; lowStockThreshold: number | null; active: boolean }
interface State {
  id?: string; status?: string; slug?: string; title: string; description: string; categoryId: string; fabric: string; care: string;
  price: number; compareAtPrice: number | null; sizes: string[]; colours: { value: string; label: string; swatch: string | null }[];
  variants: V[]; images: Img[]; collectionIds: string[]; seoTitle: string; seoDescription: string;
}
const EMPTY: State = { title: '', description: '', categoryId: '', fabric: '', care: CARE.default!, price: 0, compareAtPrice: null, sizes: [], colours: [], variants: [], images: [], collectionIds: [], seoTitle: '', seoDescription: '' };

export default function ProductWizard() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const back = sp.get('return');
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const can = useCan();
  const [step, setStep] = useState(() => Math.min(4, Math.max(0, Number(sp.get('step') ?? 0) || 0)));
  const [s, setS] = useState<State>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [bulk, setBulk] = useState('');

  const cats = useCategories();
  const colls = useCollections();
  const presets = usePresets();
  const m = useCatalogMutations();
  const SIZE_PRESETS = presets.data?.sizes ?? ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
  const FABRICS = presets.data?.fabrics ?? [];
  const COLOUR_PRESETS: [string, string][] = (presets.data?.colours ?? []).map((c) => [c.label, c.hex]);
  /** Remember a new size / fabric / colour in the store's lists (best effort: the product still gets it if this fails). */
  const remember = (patch: Partial<NonNullable<typeof presets.data>>) => {
    if (presets.data) m.savePresets.mutate({ ...presets.data, ...patch });
  };
  const existing = useQuery({ queryKey: ['product', id], queryFn: () => get(`/admin/products/${id}`), enabled: !!id });

  useEffect(() => {
    const p = existing.data;
    if (!p) return;
    setS({
      id: p.id, status: p.status, slug: p.slug, title: p.title, description: p.description, categoryId: p.categoryId, fabric: p.fabric, care: p.care,
      price: p.price, compareAtPrice: p.compareAtPrice, sizes: p.option1Values.map((o: { value: string }) => o.value), colours: p.option2Values,
      variants: p.variants.filter((v: V) => v.active), images: p.images, collectionIds: p.collectionIds, seoTitle: p.seoTitle, seoDescription: p.seoDescription,
    });
    if (!sp.get('step')) setStep(4);
  }, [existing.data]);
  useEffect(() => { if (!s.categoryId && cats.data?.[0]) setS((x) => ({ ...x, categoryId: cats.data![0]!.id })); }, [cats.data]);

  // Keep the variant matrix in sync with sizes × colours (existing rows keep their id/stock).
  const matrix = useMemo(() => {
    const sizes: (string | null)[] = s.sizes.length ? s.sizes : [null];
    const colours: (string | null)[] = s.colours.length ? s.colours.map((c) => c.value) : [null];
    return colours.flatMap((c) => sizes.map((z) => s.variants.find((v) => v.option1 === z && v.option2 === c) ?? { option1: z, option2: c, price: null, onHand: 0, lowStockThreshold: null, active: true }));
  }, [s.sizes, s.colours, s.variants]);
  const setVariant = (o1: string | null, o2: string | null, patch: Partial<V>) =>
    setS((x) => {
      const has = x.variants.some((v) => v.option1 === o1 && v.option2 === o2);
      const base = matrix.find((v) => v.option1 === o1 && v.option2 === o2)!;
      return { ...x, variants: has ? x.variants.map((v) => (v.option1 === o1 && v.option2 === o2 ? { ...v, ...patch } : v)) : [...x.variants, { ...base, ...patch }] };
    });

  const payload = () => ({
    title: s.title, slug: s.id ? s.slug : undefined, description: s.description, categoryId: s.categoryId, fabric: s.fabric, care: s.care, sizeChart: null,
    price: s.price, compareAtPrice: s.compareAtPrice || null,
    option1Values: s.sizes.map((v) => ({ value: v })), option2Values: s.colours,
    variants: matrix.map((v) => ({ id: v.id, option1: v.option1, option2: v.option2, sku: v.sku, price: v.price, onHand: v.onHand, lowStockThreshold: v.lowStockThreshold, active: true })),
    images: s.images.map((i) => ({ mediaId: i.mediaId, role: i.role, option2: s.colours.some((c) => c.value === i.option2) ? i.option2 : null })),
    collectionIds: s.collectionIds, seoTitle: s.seoTitle, seoDescription: s.seoDescription,
  });

  const save = useMutation({
    mutationFn: async (publish: boolean) => {
      const saved = s.id ? await put(`/admin/products/${s.id}`, payload()) : await post('/admin/products', payload());
      return publish && saved.status !== 'active' ? post(`/admin/products/${saved.id}/status`, { status: 'active' }) : saved;
    },
    onSuccess: (p, publish) => {
      qc.invalidateQueries({ queryKey: ['products'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); qc.setQueryData(['product', p.id], p);
      const backTo = back ? `${back}${back.includes('?') ? '&' : '?'}product=${p.id}` : null;
      toast({ text: publish ? `${p.title} is live on the website` : 'Saved', ...(backTo ? { action: { label: back!.startsWith('/prompt') ? 'Back to Prompt Studio' : 'Back', run: () => nav(backTo) } } : {}) });
      if (!s.id) nav(`/products/${p.id}${back ? `?return=${encodeURIComponent(back)}` : ''}`, { replace: true });
      setS((x) => ({ ...x, id: p.id, status: p.status, slug: p.slug, variants: p.variants.filter((v: V) => v.active) }));
      setErrors({});
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'validation') {
        setErrors(e.fields);
        const f = Object.keys(e.fields)[0] ?? '';
        setStep(f.startsWith('variants') || f.startsWith('option') ? 2 : f === 'price' || f === 'compareAtPrice' ? 3 : 1);
      }
      toast({ text: (e as Error).message, bad: true });
    },
  });
  const status = useMutation({
    mutationFn: (st: string) => post(`/admin/products/${s.id}/status`, { status: st }),
    onSuccess: (p) => { setS((x) => ({ ...x, status: p.status })); qc.invalidateQueries({ queryKey: ['products'] }); toast({ text: p.status === 'archived' ? 'Archived: hidden from the website' : p.status === 'draft' ? 'Hidden from the website' : 'Live on the website' }); },
    onError: (e) => toast({ text: (e as Error).message, bad: true }),
  });
  const dup = useMutation({ mutationFn: () => post(`/admin/products/${s.id}/duplicate`), onSuccess: (p) => { toast({ text: 'Copy created as a draft' }); nav(`/products/${p.id}`); } });

  if (id && existing.isPending) return <Skeleton n={4} h={80} />;
  if (existing.error) return <ErrorBox error={existing.error} retry={() => existing.refetch()} />;
  const readOnly = !can('catalog.write');

  const stepOk = [s.images.length > 0, s.title.trim().length >= 2 && !!s.categoryId, matrix.length > 0, s.price > 0, true];
  const pct = percentOff(s.price, s.compareAtPrice);
  const colourLabel = (v: string | null) => s.colours.find((c) => c.value === v)?.label ?? 'All colours';

  return (
    <>
      <div className="page-head">
        <div>
          <Link to="/products" className="muted small" style={{ textDecoration: 'none' }}>← Products</Link>
          <h1>{s.id ? s.title || 'Product' : 'Add product'}</h1>
        </div>
        {s.id && (
          <div className="row">
            {s.status && <StatusBadge status={s.status} />}
            {s.status === 'active' && <a className="btn btn--quiet" href={`${import.meta.env.VITE_STOREFRONT_URL ?? 'http://localhost:4321'}/products/${s.slug}`} target="_blank" rel="noopener"><Icon name="eye" /> View</a>}
            {!readOnly && <button className="btn btn--quiet" onClick={() => dup.mutate()}><Icon name="copy" /> Duplicate</button>}
          </div>
        )}
      </div>

      <nav className="steps" aria-label="Steps">
        {STEPS.map((label, i) => (
          <button key={label} className={i === step ? 'on' : stepOk[i] ? 'done' : ''} onClick={() => setStep(i)} aria-current={i === step ? 'step' : undefined}><b>{stepOk[i] && i !== step ? '✓' : i + 1}</b>{label}</button>
        ))}
      </nav>

      <fieldset disabled={readOnly} style={{ border: 0, padding: 0, minWidth: 0 }}>
        {step === 0 && (
          <div className="card stack">
            <div><h2>Photos</h2><p className="muted small">Add 3–6 photos. The first photo of each colour is shown on the shop page. You'll match photos to colours in step 3.</p></div>
            <div className="photo-grid">
              {s.images.map((img, i) => (
                <div className="photo" key={img.mediaId + i}>
                  <img src={img.media.src['480']} alt={img.media.alt} />
                  {i === 0 && <span className="badge badge--maroon photo__tag">Main</span>}
                  <div className="photo__bar">
                    <button type="button" aria-label="Move left" disabled={i === 0} onClick={() => setS((x) => { const a = [...x.images]; [a[i - 1], a[i]] = [a[i]!, a[i - 1]!]; return { ...x, images: a }; })}><Icon name="chevronLeft" size={18} /></button>
                    <button type="button" aria-label="Remove photo" onClick={() => setS((x) => ({ ...x, images: x.images.filter((_, j) => j !== i) }))}><Icon name="trash" size={18} /></button>
                    <button type="button" aria-label="Move right" disabled={i === s.images.length - 1} onClick={() => setS((x) => { const a = [...x.images]; [a[i + 1], a[i]] = [a[i]!, a[i + 1]!]; return { ...x, images: a }; })}><Icon name="chevronRight" size={18} /></button>
                  </div>
                </div>
              ))}
              <PhotoUpload slot={PRODUCT_SLOT} defaultAlt={s.title} onUploaded={(m) => setS((x) => ({ ...x, images: [...x.images, { mediaId: m.id, role: x.images.length ? 'alt' : 'main', option2: null, media: m }] }))} />
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="card stack">
            <Field label="Product name" error={errors.title}><input className="input" value={s.title} onChange={(e) => setS({ ...s, title: e.target.value })} placeholder="e.g. Embroidered Cotton Kurta" autoFocus /></Field>
            <Field label="Category">
              <div className="seg" style={{ flexWrap: 'wrap' }}>
                {cats.data?.map((c) => <button type="button" key={c.id} className={s.categoryId === c.id ? 'on' : ''} onClick={() => setS({ ...s, categoryId: c.id })}>{c.name}</button>)}
              </div>
              <div style={{ marginTop: 8 }}>
                <AddInline label="New category" placeholder="e.g. Kaftans" onAdd={async (name) => { const c = await m.createCategory.mutateAsync({ name }); setS((x) => ({ ...x, categoryId: c.id })); toast({ text: `Category "${c.name}" added` }); }} />
              </div>
            </Field>
            <Field label="Fabric">
              <div className="row" style={{ gap: 6 }}>
                {FABRICS.map((f) => <button type="button" key={f} className={`badge ${s.fabric === f ? 'badge--maroon' : ''}`} style={{ minHeight: 36, padding: '0 14px', fontSize: '.875rem' }}
                  onClick={() => setS({ ...s, fabric: f, care: s.care === CARE[s.fabric] || s.care === CARE.default || !s.care ? CARE[f] ?? CARE.default! : s.care })}>{f}</button>)}
                {s.fabric && !FABRICS.includes(s.fabric) && <span className="badge badge--maroon" style={{ minHeight: 36, padding: '0 14px', fontSize: '.875rem' }}>{s.fabric}</span>}
                <AddInline compact label="Add fabric" placeholder="e.g. Modal silk" onAdd={(f) => { setS((x) => ({ ...x, fabric: f, care: x.care || CARE.default! })); if (!FABRICS.some((x) => x.toLowerCase() === f.toLowerCase())) remember({ fabrics: [...FABRICS, f] }); }} />
              </div>
            </Field>
            <Field label="Description" hint="2–3 sentences: the cut, the details, when to wear it." error={errors.description}>
              <textarea className="textarea" value={s.description} onChange={(e) => setS({ ...s, description: e.target.value })} rows={4} />
            </Field>
            <Field label="Care"><textarea className="textarea" value={s.care} onChange={(e) => setS({ ...s, care: e.target.value })} rows={2} /></Field>
            <Field label="Collections (optional)">
              <div className="row" style={{ gap: 6 }}>
                {colls.data?.map((c) => {
                  const on = s.collectionIds.includes(c.id);
                  return <button type="button" key={c.id} className={`badge ${on ? 'badge--maroon' : ''}`} style={{ minHeight: 36, padding: '0 14px', fontSize: '.875rem' }}
                    onClick={() => setS({ ...s, collectionIds: on ? s.collectionIds.filter((x) => x !== c.id) : [...s.collectionIds, c.id] })}>{c.name}</button>;
                })}
                <AddInline compact label="New collection" placeholder="e.g. Onam Edit" onAdd={async (name) => { const c = await m.createCollection.mutateAsync({ name }); setS((x) => ({ ...x, collectionIds: [...x.collectionIds, c.id] })); toast({ text: `Collection "${c.name}" added. Add a photo in Catalog setup.` }); }} />
              </div>
            </Field>
          </div>
        )}

        {step === 2 && (
          <div className="stack">
            <div className="card stack">
              <h2>Sizes</h2>
              <div className="row" style={{ gap: 6 }}>
                {[...SIZE_PRESETS, ...s.sizes.filter((z) => !SIZE_PRESETS.includes(z))].map((z) => {
                  const on = s.sizes.includes(z);
                  return <button type="button" key={z} className={`btn ${on ? '' : 'btn--quiet'}`} style={{ minWidth: 56, padding: '0 12px' }} aria-pressed={on}
                    onClick={() => setS({ ...s, sizes: on ? s.sizes.filter((x) => x !== z) : SIZE_PRESETS.filter((p) => p === z || s.sizes.includes(p)).concat(s.sizes.filter((x) => !SIZE_PRESETS.includes(x))) })}>{z}</button>;
                })}
              </div>
              <AddInline label="Add size" placeholder="e.g. 4XL, 28, Free Size" maxLength={20} onAdd={(z) => {
                const v = z.trim();
                setS((x) => (x.sizes.includes(v) ? x : { ...x, sizes: [...x.sizes, v] }));
                if (!SIZE_PRESETS.includes(v)) remember({ sizes: [...SIZE_PRESETS, v] });
              }} />
              <div className="row"><button type="button" className="btn btn--ghost" onClick={() => setS({ ...s, sizes: ['S', 'M', 'L', 'XL'] })}>S–XL</button><button type="button" className="btn btn--ghost" onClick={() => setS({ ...s, sizes: ['XS', 'S', 'M', 'L', 'XL', 'XXL'] })}>XS–XXL</button><button type="button" className="btn btn--ghost" onClick={() => setS({ ...s, sizes: [] })}>No sizes</button></div>
            </div>

            <div className="card stack">
              <h2>Colours</h2>
              <div className="row" style={{ gap: 8 }}>
                {COLOUR_PRESETS.map(([label, hex]) => {
                  const value = slugValue(label);
                  const on = s.colours.some((c) => c.value === value);
                  return (
                    <button type="button" key={label} aria-pressed={on} title={label} onClick={() => setS({ ...s, colours: on ? s.colours.filter((c) => c.value !== value) : [...s.colours, { value, label, swatch: hex }] })}
                      style={{ display: 'grid', justifyItems: 'center', gap: 2, fontSize: '.6875rem', width: 56 }}>
                      <span style={{ width: 36, height: 36, borderRadius: '50%', background: hex, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.15)', outline: on ? '2.5px solid var(--c-maroon)' : 'none', outlineOffset: 2 }} />
                      {label}
                    </button>
                  );
                })}
              </div>
              {s.colours.filter((c) => !COLOUR_PRESETS.some(([l]) => slugValue(l) === c.value)).length > 0 && (
                <div className="row" style={{ gap: 8 }}>
                  {s.colours.filter((c) => !COLOUR_PRESETS.some(([l]) => slugValue(l) === c.value)).map((c) => (
                    <span key={c.value} className="chip-x"><span style={{ width: 18, height: 18, borderRadius: '50%', background: c.swatch ?? '#ccc', boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.15)' }} />{c.label}
                      <button type="button" aria-label={`Remove ${c.label}`} onClick={() => setS((x) => ({ ...x, colours: x.colours.filter((y) => y.value !== c.value) }))}><Icon name="close" size={14} /></button></span>
                  ))}
                </div>
              )}
              <AddColour onAdd={({ label, hex }) => {
                const value = slugValue(label);
                setS((x) => (x.colours.some((c) => c.value === value) ? x : { ...x, colours: [...x.colours, { value, label, swatch: hex }] }));
                if (presets.data && !presets.data.colours.some((c) => slugValue(c.label) === value)) remember({ colours: [...presets.data.colours, { label, hex }] });
              }} />
              {s.colours.length > 0 && <p className="small"><strong>Selected:</strong> {s.colours.map((c) => c.label).join(', ')}</p>}
            </div>

            {s.colours.length > 0 && s.images.length > 0 && (
              <div className="card stack">
                <div><h2>Which colour is each photo?</h2><p className="muted small">Shoppers see these photos when they pick a colour.</p></div>
                <div className="photo-grid">
                  {s.images.map((img, i) => (
                    <div key={img.mediaId + i} className="stack" style={{ gap: 6 }}>
                      <div className="photo"><img src={img.media.src['480']} alt="" /></div>
                      <select className="select" value={img.option2 ?? ''} onChange={(e) => setS((x) => ({ ...x, images: x.images.map((m, j) => (j === i ? { ...m, option2: e.target.value || null } : m)) }))} aria-label={`Colour for photo ${i + 1}`}>
                        <option value="">All colours</option>
                        {s.colours.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="card stack">
              <div className="card__head" style={{ marginBottom: 0 }}>
                <div><h2>{s.id ? 'Variants' : 'Opening stock'}</h2><p className="muted small">{matrix.length} variant{matrix.length === 1 ? '' : 's'}. SKUs are created automatically.</p></div>
                {!s.id && <div className="row"><input className="input" style={{ width: 80 }} inputMode="numeric" placeholder="Qty" value={bulk} onChange={(e) => setBulk(e.target.value.replace(/\D/g, ''))} aria-label="Quantity for all" /><button type="button" className="btn btn--quiet" onClick={() => setS((x) => ({ ...x, variants: matrix.map((v) => ({ ...v, onHand: Number(bulk || 0) })) }))}>Set all</button></div>}
              </div>
              {errors.variants && <p className="err">{errors.variants}</p>}
              <div style={{ overflowX: 'auto' }}>
                <table className="table">
                  <thead><tr><th>Colour</th><th>Size</th><th>{s.id ? 'In stock' : 'Qty'}</th><th>SKU</th></tr></thead>
                  <tbody>
                    {matrix.map((v) => (
                      <tr key={`${v.option1}|${v.option2}`}>
                        <td>{colourLabel(v.option2)}</td><td>{v.option1 ?? '—'}</td>
                        <td>{v.id ? <span>{v.onHand}{v.reserved ? <span className="muted small"> ({v.reserved} held)</span> : null}</span>
                          : <input className="input" style={{ width: 84, minHeight: 40 }} inputMode="numeric" value={v.onHand || ''} placeholder="0" onChange={(e) => setVariant(v.option1, v.option2, { onHand: Number(e.target.value.replace(/\D/g, '') || 0) })} aria-label={`Quantity ${v.option1 ?? ''} ${colourLabel(v.option2)}`} />}</td>
                        <td className="muted small">{v.sku ?? 'auto'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {s.id && <p className="muted small">To change stock for existing variants, use <Link to="/stock">Stock</Link> (every change is recorded).</p>}
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="card stack">
            <div className="grid2">
              <Field label="Selling price" error={errors.price}>
                <div className="prefix"><b>₹</b><input className="input" inputMode="decimal" value={paiseToRupees(s.price || null)} onChange={(e) => setS({ ...s, price: rupeesToPaise(e.target.value) })} placeholder="1299" autoFocus /></div>
              </Field>
              <Field label="MRP (optional)" hint="Shown struck through, with the % off." error={errors.compareAtPrice}>
                <div className="prefix"><b>₹</b><input className="input" inputMode="decimal" value={paiseToRupees(s.compareAtPrice)} onChange={(e) => setS({ ...s, compareAtPrice: e.target.value ? rupeesToPaise(e.target.value) : null })} placeholder="1799" /></div>
              </Field>
            </div>
            {s.price > 0 && <p className="small">Shoppers see: <strong>{formatINR(s.price)}</strong>{pct > 0 && <> <s className="muted">{formatINR(s.compareAtPrice!)}</s> <span style={{ color: 'var(--c-maroon)', fontWeight: 700 }}>{pct}% off</span></>}</p>}
            <details>
              <summary className="small" style={{ cursor: 'pointer', minHeight: 44, display: 'flex', alignItems: 'center' }}>Different price for some sizes?</summary>
              <table className="table"><tbody>
                {matrix.map((v) => (
                  <tr key={`${v.option1}|${v.option2}`}><td>{colourLabel(v.option2)} / {v.option1 ?? '—'}</td>
                    <td><div className="prefix"><b>₹</b><input className="input" style={{ maxWidth: 140, minHeight: 40 }} inputMode="decimal" placeholder={paiseToRupees(s.price)} value={paiseToRupees(v.price)} onChange={(e) => setVariant(v.option1, v.option2, { price: e.target.value ? rupeesToPaise(e.target.value) : null })} /></div></td></tr>
                ))}
              </tbody></table>
            </details>
            <details>
              <summary className="small" style={{ cursor: 'pointer', minHeight: 44, display: 'flex', alignItems: 'center' }}>Google listing (optional)</summary>
              <div className="stack">
                <Field label="Search title" hint={`${s.seoTitle.length}/70`}><input className="input" maxLength={70} value={s.seoTitle} placeholder={s.title} onChange={(e) => setS({ ...s, seoTitle: e.target.value })} /></Field>
                <Field label="Search description" hint={`${s.seoDescription.length}/160`}><textarea className="textarea" maxLength={160} value={s.seoDescription} placeholder={s.description.slice(0, 155)} onChange={(e) => setS({ ...s, seoDescription: e.target.value })} /></Field>
              </div>
            </details>
          </div>
        )}

        {step === 4 && (
          <div className="grid2" style={{ alignItems: 'start' }}>
            <div className="card" style={{ padding: 0, overflow: 'hidden', maxWidth: 320 }}>
              {s.images[0] ? <img src={s.images[0].media.src['960']} alt="" style={{ aspectRatio: '3/4', objectFit: 'cover', width: '100%' }} /> : <div className="skeleton" style={{ aspectRatio: '3/4', borderRadius: 0 }} />}
              <div style={{ padding: 'var(--sp-4)' }}>
                <p style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', fontWeight: 600, color: 'var(--c-ink)' }}>{s.title || 'Product name'}</p>
                <p><strong>{formatINR(s.price)}</strong>{pct > 0 && <> <s className="muted">{formatINR(s.compareAtPrice!)}</s> <span style={{ color: 'var(--c-maroon)', fontWeight: 700 }}>{pct}% off</span></>}</p>
                <div className="row" style={{ gap: 6, marginTop: 8 }}>{s.colours.map((c) => <span key={c.value} title={c.label} style={{ width: 22, height: 22, borderRadius: '50%', background: c.swatch ?? '#ccc', boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.15)' }} />)}</div>
              </div>
            </div>
            <div className="card stack">
              <h2>Ready to publish?</h2>
              <ul className="stack" style={{ listStyle: 'none', padding: 0, gap: 8 }}>
                {[
                  [stepOk[0], `${s.images.length} photo${s.images.length === 1 ? '' : 's'}`, 0],
                  [stepOk[1], s.title ? `${s.title} · ${cats.data?.find((c) => c.id === s.categoryId)?.name ?? ''}${s.fabric ? ` · ${s.fabric}` : ''}` : 'Name and category', 1],
                  [stepOk[2], `${s.sizes.length || 'No'} sizes × ${s.colours.length || 'no'} colours = ${matrix.length} variants, ${matrix.reduce((n, v) => n + v.onHand, 0)} in stock`, 2],
                  [stepOk[3], s.price ? `Price ${formatINR(s.price)}` : 'Set a price', 3],
                ].map(([ok, text, i]) => (
                  <li key={String(i)} className="row"><span className={`badge ${ok ? 'badge--ok' : 'badge--warn'}`}>{ok ? '✓' : '!'}</span><span style={{ flex: 1 }}>{String(text)}</span><button type="button" className="btn btn--ghost" onClick={() => setStep(Number(i))}>Edit</button></li>
                ))}
              </ul>
              {s.id && s.status !== 'archived' && !readOnly && (
                <div className="row">
                  {s.status === 'active' && <button type="button" className="btn btn--quiet" onClick={() => status.mutate('draft')}>Hide from website</button>}
                  <button type="button" className="btn btn--danger" onClick={() => confirm('Archive this product? It will be hidden from the website. You can restore it later.') && status.mutate('archived')}>Archive</button>
                </div>
              )}
              {s.status === 'archived' && !readOnly && <button type="button" className="btn btn--quiet" onClick={() => status.mutate('draft')}>Restore as draft</button>}
            </div>
          </div>
        )}
      </fieldset>

      {!readOnly && (
        <div className="wizard-foot no-print">
          {step > 0 && <button type="button" className="btn btn--quiet" onClick={() => setStep(step - 1)}>Back</button>}
          <button type="button" className="btn btn--quiet" onClick={() => save.mutate(false)} disabled={save.isPending || !s.title || !s.price}>{save.isPending ? 'Saving…' : s.id ? 'Save' : 'Save draft'}</button>
          <span className="spacer" />
          {step < 4 ? <button type="button" className="btn btn--lg" onClick={() => setStep(step + 1)}>Next</button>
            : <button type="button" className="btn btn--lg" disabled={save.isPending || !stepOk.slice(0, 4).every(Boolean)} onClick={() => save.mutate(true)}>{s.status === 'active' ? 'Save & update' : 'Publish'}</button>}
        </div>
      )}
    </>
  );
}
