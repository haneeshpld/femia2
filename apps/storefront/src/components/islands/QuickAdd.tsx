import { useEffect, useMemo, useState } from 'react';
import { json } from '../../lib/http.ts';
import type { ProductDetail } from '@femia/contracts';
import { formatINR, percentOff } from '@femia/contracts/money';
import { t } from '@femia/i18n';
import { addToCart } from '../../lib/stores.ts';
import { flyToBag, morphFrom } from '../../lib/fly.ts';
import { track } from '../../lib/analytics.ts';
import { Icon } from './Icon.tsx';
import { Sheet } from './Sheet.tsx';

/** Size sheet: pick colour + size without leaving the grid. */
export function QuickAdd({ slug, colour, origin, imageUrl, onClose, onAdded, sizeGuide }: {
  slug: string | null; colour?: string | null; origin?: DOMRect; imageUrl?: string | null; onClose: () => void; onAdded: (msg: string) => void; sizeGuide: string;
}) {
  const [p, setP] = useState<ProductDetail | null>(null);
  const [error, setError] = useState(false);
  const [c2, setC2] = useState<string | null>(null);
  const [size, setSize] = useState<string | null>(null);
  const [showGuide, setShowGuide] = useState(false);

  // The card's photo grows into the sheet's photo.
  useEffect(() => {
    if (slug) void morphFrom(origin, imageUrl, () => document.querySelector('.sheet.is-open .qa__img'));
  }, [slug]);

  useEffect(() => {
    if (!slug) return;
    setP(null); setError(false); setSize(null); setShowGuide(false);
    Promise.all([
      fetch(`/api/catalog/products/${slug}`).then((r) => (r.ok ? json<ProductDetail>(r) : Promise.reject())),
      fetch(`/api/catalog/products/${slug}/stock`).then((r) => (r.ok ? json<Record<string, number>>(r) : {})),
    ]).then(([prod, stock]: [ProductDetail, Record<string, number>]) => {
      prod.variants = prod.variants.map((v) => ({ ...v, available: stock[v.id] ?? v.available }));
      setP(prod);
      setC2(colour ?? prod.option2Values[0]?.value ?? null);
    }).catch(() => setError(true));
  }, [slug]);

  const variantFor = (s: string | null) => p?.variants.find((v) => v.option1 === s && (v.option2 ?? null) === (c2 ?? null));
  const chosen = variantFor(size);
  const image = useMemo(() => p?.images.find((i) => i.option2 === c2) ?? p?.images[0], [p, c2]);

  const add = () => {
    if (!p || !chosen) return;
    const colourLabel = p.option2Values.find((o) => o.value === c2)?.label;
    addToCart({
      variantId: chosen.id, productId: p.id, slug: p.slug, title: p.title, optionLabel: [size, colourLabel].filter(Boolean).join(' / '),
      price: chosen.price, compareAtPrice: chosen.compareAtPrice, image: image?.src['480'] ?? null,
    });
    track('add_to_bag', { productId: p.id, variantId: chosen.id, value: chosen.price });
    flyToBag(document.querySelector('.sheet.is-open .qa__img')?.getBoundingClientRect() ?? origin, image?.src['480']);
    onAdded([p.title, [size, colourLabel].filter(Boolean).join(' / ')].filter(Boolean).join(' · '));
    onClose();
  };

  const title = p ? p.title : t('common.loading');
  return (
    <Sheet open={!!slug} onClose={onClose} labelledBy="qa-title" side="bottom" title={title}
      footer={p && <button type="button" className="btn btn--block" disabled={!chosen || chosen.available <= 0} onClick={add}>
        <Icon name="bag" size={20} /> {chosen ? t('common.addToBag') : t('product.selectSize')}
      </button>}>
      {error && <p>{t('error.generic')}</p>}
      {!p && !error && <div className="qa qa--loading"><div className="skeleton qa__img" /><div className="skeleton" style={{ height: 120 }} /></div>}
      {p && (
        <div className="qa">
          {image && <img className="qa__img" src={image.src['480']} alt={image.alt} width={120} height={160} />}
          <div className="qa__info">
            <p className="price">
              {formatINR(chosen?.price ?? p.price)}
              {p.compareAtPrice && <><s>{formatINR(p.compareAtPrice)}</s><span className="off">{t('common.off', { pct: percentOff(p.price, p.compareAtPrice) })}</span></>}
            </p>
            {p.option2Values.length > 0 && (
              <fieldset className="opt">
                <legend>{p.option2Name}: <strong>{p.option2Values.find((o) => o.value === c2)?.label}</strong></legend>
                <div className="swatches">
                  {p.option2Values.map((o) => (
                    <button key={o.value} type="button" className="swatch" style={{ ['--sw' as string]: o.swatch ?? '#ccc' }} aria-pressed={o.value === c2} aria-label={o.label} onClick={() => { setC2(o.value); setSize(null); }} />
                  ))}
                </div>
              </fieldset>
            )}
            {p.option1Values.length > 0 && (
              <fieldset className="opt">
                <legend>{p.option1Name}{size && <>: <strong>{size}</strong></>}</legend>
                <div className="sizes">
                  {p.option1Values.map((o) => {
                    const v = variantFor(o.value);
                    const avail = v?.available ?? 0;
                    return (
                      <button key={o.value} type="button" className="size" aria-pressed={size === o.value} disabled={avail <= 0} onClick={() => setSize(o.value)}
                        aria-label={`${o.label}${avail <= 0 ? `, ${t('common.soldOut')}` : avail <= 2 ? `, ${t('product.onlyLeft', { count: avail })}` : ''}`}>
                        {o.label}
                      </button>
                    );
                  })}
                </div>
                {chosen && chosen.available > 0 && chosen.available <= 2 && <p className="low">{t('product.onlyLeft', { count: chosen.available })}</p>}
              </fieldset>
            )}
            {sizeGuide && <button type="button" className="link-arrow" onClick={() => setShowGuide((s) => !s)} aria-expanded={showGuide}><Icon name="ruler" size={20} /> {t('product.sizeChart')}</button>}
            {showGuide && <SizeTable md={sizeGuide} />}
            <a className="qa__more" href={`/products/${p.slug}`}>View full details</a>
          </div>
        </div>
      )}
    </Sheet>
  );
}

export function SizeTable({ md }: { md: string }) {
  const rows = md.trim().split('\n').filter((l) => l.trim().startsWith('|') && !/^\|[\s:|-]+\|$/.test(l.trim()))
    .map((l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
  const [head, ...body] = rows;
  if (!head) return null;
  return (
    <div className="table-wrap"><table className="size-table">
      <thead><tr>{head.map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
      <tbody>{body.map((r) => <tr key={r[0]}>{r.map((c, i) => <td key={i}>{c}</td>)}</tr>)}</tbody>
    </table></div>
  );
}
