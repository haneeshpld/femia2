import { Fragment, useEffect, useState } from 'react';
import { ratioLabel, recommendedSize, type MediaRef } from '../lib/image.ts';
import { useCatalogMutations } from '../lib/catalog.ts';
import { AddInline } from './AddInline.tsx';
import { Icon } from './Icon.tsx';
import { MediaPicker } from './MediaPicker.tsx';
import type { Slot } from './PhotoUpload.tsx';
import { Field, useToast } from './ui.tsx';

/**
 * Content form fields, generated from the storefront's site.manifest.json and written for a shop owner:
 * links are picked from the shop's own pages, italics are tapped on, optional extras fold away, and a field
 * only appears when it applies (e.g. "Which collection" once "A collection" is chosen).
 */
export type F = {
  id: string; type: string; label: string; help?: string; required?: boolean; maxLength?: number; slot?: string;
  options?: { value: string; label: string }[]; itemLabel?: string; min?: number; max?: number; fields?: F[];
  showIf?: { field: string; in: string[] }; group?: string; emphasis?: boolean; choices?: { value: number; label: string }[];
};
type Ref = { id: string; name: string; slug?: string };
export type Ctx = {
  slots: Record<string, Slot>; media: Record<string, MediaRef>; setMedia: (f: (m: Record<string, MediaRef>) => Record<string, MediaRef>) => void;
  cats: Ref[]; colls: Ref[]; errors: Record<string, string>;
};
type Path = (string | number)[];
type OnChange = (p: Path, v: unknown) => void;

const visible = (f: F, values: Record<string, any>) => !f.showIf || f.showIf.in.includes(String(values?.[f.showIf.field] ?? ''));
const hasValue = (v: unknown) => (Array.isArray(v) ? v.length > 0 : v !== null && v !== undefined && v !== '' && v !== false);

/** A set of fields: hidden ones skipped, grouped ones folded under one "optional" heading where the group starts. */
export function FieldList({ fields, values, path, onChange, ctx }: { fields: F[]; values: Record<string, any>; path: Path; onChange: OnChange; ctx: Ctx }) {
  const shown = fields.filter((f) => visible(f, values));
  const done = new Set<string>();
  return (
    <>
      {shown.map((f) => {
        if (!f.group) return <FieldEditor key={f.id} f={f} value={values?.[f.id]} path={[...path, f.id]} onChange={onChange} ctx={ctx} />;
        if (done.has(f.group)) return null;
        done.add(f.group);
        const members = shown.filter((m) => m.group === f.group);
        return (
          <details key={`g-${f.group}`} className="cf-more" open={members.some((m) => hasValue(values?.[m.id])) || undefined}>
            <summary><Icon name="plus" size={16} /> {f.group}</summary>
            <div className="stack">
              {members.map((m) => <FieldEditor key={m.id} f={m} value={values?.[m.id]} path={[...path, m.id]} onChange={onChange} ctx={ctx} />)}
            </div>
          </details>
        );
      })}
    </>
  );
}

/** Counts only when it helps: from 80% of the limit. */
const counter = (v: unknown, max?: number) => {
  const n = String(v ?? '').length;
  return max && n >= max * 0.8 ? `${n} of ${max} letters` : undefined;
};

export function FieldEditor({ f, value, path, onChange, ctx }: { f: F; value: any; path: Path; onChange: OnChange; ctx: Ctx }) {
  const err = ctx.errors[path.join('.')];
  switch (f.type) {
    case 'text':
      if (f.emphasis) return <EmphasisInput f={f} value={value ?? ''} onChange={(v) => onChange(path, v)} error={err} />;
      return <Field label={f.label} hint={f.help ?? counter(value, f.maxLength)} error={err}><input className="input" maxLength={f.maxLength} value={value ?? ''} onChange={(e) => onChange(path, e.target.value)} /></Field>;
    case 'url':
      return <LinkPicker f={f} value={value ?? ''} onChange={(v) => onChange(path, v)} ctx={ctx} error={err} />;
    case 'textarea': case 'richtext':
      return <Field label={f.label} hint={f.type === 'richtext' ? 'Leave a blank line for a new paragraph. ## Heading, - list item, **bold**, [link](/url)' : f.help ?? counter(value, f.maxLength)} error={err}><textarea className="textarea" rows={f.type === 'richtext' ? 10 : 3} maxLength={f.maxLength} value={value ?? ''} onChange={(e) => onChange(path, e.target.value)} /></Field>;
    case 'boolean':
      return (
        <label className="cf-switch">
          <span className="hs-switch"><input type="checkbox" checked={!!value} onChange={(e) => onChange(path, e.target.checked)} /><span aria-hidden="true" /></span>
          <span>{f.label}</span>
        </label>
      );
    case 'number':
      if (f.choices) return <Choice label={f.label} hint={f.help} error={err} options={f.choices.map((c) => ({ value: String(c.value), label: c.label }))} value={String(value ?? '')} onChange={(v) => onChange(path, Number(v))} />;
      return <Field label={f.label} hint={f.help} error={err}><input className="input" style={{ maxWidth: 120 }} inputMode="numeric" value={value ?? ''} onChange={(e) => onChange(path, Number(e.target.value.replace(/\D/g, '')) || 0)} /></Field>;
    case 'select':
      if ((f.options?.length ?? 0) <= 4) return <Choice label={f.label} hint={f.help} error={err} options={f.options ?? []} value={value ?? f.options?.[0]?.value ?? ''} onChange={(v) => onChange(path, v)} />;
      return <Field label={f.label} hint={f.help} error={err}><select className="select" value={value ?? ''} onChange={(e) => onChange(path, e.target.value)}>{f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></Field>;
    case 'category': case 'collection': {
      const opts = f.type === 'category' ? ctx.cats : ctx.colls;
      return (
        <Field label={f.label} hint={f.help} error={err}>
          <select className="select" value={value ?? ''} onChange={(e) => onChange(path, e.target.value || null)}>
            <option value="">{f.required ? `Choose a ${f.type}` : 'None'}</option>
            {opts.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <NewRef kind={f.type} onCreated={(id) => onChange(path, id)} />
        </Field>
      );
    }
    case 'image':
      return <ImageField f={f} value={value} onChange={(v) => onChange(path, v)} ctx={ctx} error={err} />;
    case 'list':
      return <ListEditor f={f} value={Array.isArray(value) ? value : []} path={path} onChange={onChange} ctx={ctx} error={err} />;
    default: return null;
  }
}

/** A few choices as buttons, so every option is visible at once. */
function Choice({ label, hint, error, options, value, onChange }: { label: string; hint?: string; error?: string; options: { value: string; label: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="field">
      <span>{label}</span>
      <div className="seg cf-seg" role="radiogroup" aria-label={label}>
        {options.map((o) => <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>{o.label}</button>)}
      </div>
      {error ? <span className="err" role="alert">{error}</span> : hint ? <small>{hint}</small> : null}
    </div>
  );
}

// ── headings with italic words: stored as "Shop by *category*", edited as plain text plus tappable words ──
type Word = { w: string; i: boolean };
function parseEmphasis(s: string): Word[] {
  const out: Word[] = [];
  s.split('*').forEach((seg, k) => seg.split(/\s+/).filter(Boolean).forEach((w) => out.push({ w, i: k % 2 === 1 })));
  return out;
}
function serialize(words: Word[]) {
  let s = '';
  words.forEach((x, k) => {
    const prev = words[k - 1], next = words[k + 1];
    s += (k ? ' ' : '') + (x.i && !prev?.i ? '*' : '') + x.w + (x.i && !next?.i ? '*' : '');
  });
  return s;
}

function EmphasisInput({ f, value, onChange, error }: { f: F; value: string; onChange: (v: string) => void; error?: string }) {
  const words = parseEmphasis(value);
  const [text, setText] = useState(() => words.map((x) => x.w).join(' '));
  // Follow outside changes (undo, a new section) without fighting the cursor while typing.
  useEffect(() => { if (text.split(/\s+/).filter(Boolean).join(' ') !== words.map((x) => x.w).join(' ')) setText(words.map((x) => x.w).join(' ')); }, [value]);
  const type = (t: string) => {
    setText(t);
    const next = t.split(/\s+/).filter(Boolean);
    // Same number of words (a word being typed or corrected): italics stay in place.
    if (next.length === words.length) { onChange(serialize(next.map((w, k) => ({ w, i: words[k]!.i })))); return; }
    // Words added or removed: italics stay on the words that had them.
    const italic = new Map<string, number>();
    words.forEach((x) => x.i && italic.set(x.w, (italic.get(x.w) ?? 0) + 1));
    onChange(serialize(next.map((w) => {
      const n = italic.get(w) ?? 0; if (n) italic.set(w, n - 1);
      return { w, i: n > 0 };
    })));
  };
  const toggle = (k: number) => onChange(serialize(words.map((x, j) => (j === k ? { ...x, i: !x.i } : x))));
  return (
    <div className="field">
      <span>{f.label}</span>
      <input className="input" maxLength={f.maxLength} value={text} onChange={(e) => type(e.target.value)} />
      {words.length > 0 && (
        <div className="cf-emph">
          <span className="muted small">Tap words to put them in italics:</span>
          <span className="cf-emph__words">
            {words.map((x, k) => <button key={k} type="button" className={`cf-word${x.i ? ' is-on' : ''}`} aria-pressed={x.i} onClick={() => toggle(k)}>{x.w}</button>)}
          </span>
          <span className="cf-emph__preview" aria-label="How it looks">{words.map((x, k) => <Fragment key={k}>{k ? ' ' : ''}{x.i ? <em>{x.w}</em> : x.w}</Fragment>)}</span>
        </div>
      )}
      {error ? <span className="err" role="alert">{error}</span> : counter(text, f.maxLength) ? <small>{counter(text, f.maxLength)}</small> : null}
    </div>
  );
}

// ── links: picked from the shop's pages, categories and collections; a typed address only as a last resort ──
const PAGES: [string, string][] = [
  ['/shop?sort=new', 'New arrivals'], ['/shop', 'All products'], ['/shop?sort=popular', 'Most popular'], ['/collections', 'All collections'],
  ['/visit', 'Visit us page'], ['/about', 'Our story page'], ['/size-guide', 'Size guide'], ['/track', 'Track an order'], ['/wishlist', 'Wishlist'], ['/', 'Home page'],
];
const OTHER = '__other__';
function LinkPicker({ f, value, onChange, ctx, error }: { f: F; value: string; onChange: (v: string) => void; ctx: Ctx; error?: string }) {
  const cats = ctx.cats.filter((c) => c.slug).map((c) => [`/shop/${c.slug}`, c.name] as const);
  const colls = ctx.colls.filter((c) => c.slug).map((c) => [`/collections/${c.slug}`, c.name] as const);
  const known = new Set([...PAGES.map(([v]) => v), ...cats.map(([v]) => v), ...colls.map(([v]) => v)]);
  const [other, setOther] = useState(() => !!value && !known.has(value));
  const custom = other || (!!value && !known.has(value));
  return (
    <Field label={f.label} hint={custom ? 'A full web address (https://…) or a page on your website (/…).' : f.help} error={error}>
      <select className="select" value={custom ? OTHER : value} onChange={(e) => {
        if (e.target.value === OTHER) { setOther(true); return; }
        setOther(false); onChange(e.target.value);
      }}>
        {!f.required && <option value="">No link</option>}
        <optgroup label="Pages">{PAGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</optgroup>
        {cats.length > 0 && <optgroup label="Categories">{cats.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</optgroup>}
        {colls.length > 0 && <optgroup label="Collections">{colls.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</optgroup>}
        <option value={OTHER}>Another web address…</option>
      </select>
      {custom && <input className="input cf-link-other" inputMode="url" value={value} placeholder="https://… or /…" onChange={(e) => onChange(e.target.value)} autoFocus={other && !value} />}
    </Field>
  );
}

function ImageField({ f, value, onChange, ctx, error }: { f: F; value: string | null; onChange: (v: string | null) => void; ctx: Ctx; error?: string }) {
  const [picking, setPicking] = useState(false);
  const slot = ctx.slots[f.slot ?? 'page'] ?? { id: 'page', label: 'Photo', aspect: 1.5, minWidth: 1200, mask: 'rect' as const };
  const m = value ? ctx.media[value] : null;
  const rec = recommendedSize(slot);
  return (
    <Field label={f.label} hint={`${f.help ? `${f.help} ` : ''}Best at ${rec.width} × ${rec.height} px (${ratioLabel(slot.aspect)}); you can crop after choosing.`} error={error}>
      <div className="cf-photo">
        <button type="button" className="cf-photo__frame" onClick={() => setPicking(true)} aria-label={m ? `Replace ${f.label.toLowerCase()}` : `Choose ${f.label.toLowerCase()}`}
          style={{ aspectRatio: String(slot.aspect), borderRadius: slot.mask === 'arch' ? '999px 999px 8px 8px' : 8 }}>
          {m ? <img src={m.src['480']} alt={m.alt} /> : <span><Icon name="image" /> Choose photo</span>}
        </button>
        <div className="cf-photo__actions">
          <button type="button" className="btn btn--quiet" onClick={() => setPicking(true)}><Icon name="image" /> {m ? 'Replace photo' : 'Choose photo'}</button>
          {m && !f.required && <button type="button" className="btn btn--ghost" onClick={() => onChange(null)}>Remove</button>}
        </div>
      </div>
      {picking && <MediaPicker slot={slot} onClose={() => setPicking(false)} onPick={(pm) => { ctx.setMedia((x) => ({ ...x, [pm.id]: pm })); onChange(pm.id); }} />}
    </Field>
  );
}

/** A list (tags, cards, photos) as short rows with a photo and a name; one opens at a time to edit. */
function ListEditor({ f, value: items, path, onChange, ctx, error }: { f: F; value: any[]; path: Path; onChange: OnChange; ctx: Ctx; error?: string }) {
  const [open, setOpen] = useState<number | null>(null);
  const fields = f.fields ?? [];
  const word = (f.itemLabel ?? 'item').toLowerCase();
  const blank = () => Object.fromEntries(fields.map((c) => [c.id, c.type === 'boolean' ? false : c.type === 'number' ? 0 : c.type === 'image' || c.type === 'category' || c.type === 'collection' ? null : c.type === 'select' ? c.options?.[0]?.value ?? '' : '']));
  const move = (i: number, d: -1 | 1) => { const a = [...items]; [a[i + d], a[i]] = [a[i], a[i + d]]; onChange(path, a); setOpen(open === i ? i + d : open === i + d ? i : open); };
  const imageOf = (it: any) => { const fi = fields.find((c) => c.type === 'image' && it?.[c.id]); return fi ? ctx.media[it[fi.id]] : undefined; };
  const nameOf = (it: any, i: number) => {
    for (const c of fields) {
      const v = it?.[c.id];
      if (!v) continue;
      if (c.type === 'category') return ctx.cats.find((x) => x.id === v)?.name ?? '';
      if (c.type === 'collection') return ctx.colls.find((x) => x.id === v)?.name ?? '';
      if (c.type === 'text') return String(v).replace(/\*/g, '');
    }
    return `${f.itemLabel ?? 'Item'} ${i + 1}`;
  };
  const max = f.max === undefined || items.length < f.max;
  const hasPhoto = fields.some((c) => c.type === 'image');
  return (
    <div className="field cf-list">
      <span>{f.label}{items.length > 0 && <span className="muted"> · {items.length}</span>}</span>
      {error && <p className="err">{error}</p>}
      {items.length === 0 && <p className="muted small">Nothing here yet.</p>}
      <ol className="cf-list__items">
        {items.map((it, i) => {
          const img = imageOf(it);
          const isOpen = open === i;
          return (
            <li key={i} className={`cf-item${isOpen ? ' is-open' : ''}`}>
              <div className="cf-item__row">
                {hasPhoto && <span className="cf-item__thumb">{img ? <img src={img.src['480']} alt="" /> : <Icon name="image" size={18} />}</span>}
                <button type="button" className="cf-item__name" onClick={() => setOpen(isOpen ? null : i)} aria-expanded={isOpen}>{nameOf(it, i)}</button>
                <button type="button" className="icon-btn" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><Icon name="chevronLeft" className="rot90" /></button>
                <button type="button" className="icon-btn" aria-label="Move down" disabled={i === items.length - 1} onClick={() => move(i, 1)}><Icon name="chevronRight" className="rot90" /></button>
                <button type="button" className="icon-btn" aria-label={`Remove ${word}`} disabled={f.min !== undefined && items.length <= f.min} onClick={() => { onChange(path, items.filter((_, j) => j !== i)); setOpen(null); }}><Icon name="trash" /></button>
                <button type="button" className="icon-btn" aria-label={isOpen ? 'Close' : `Edit ${word}`} onClick={() => setOpen(isOpen ? null : i)}><Icon name={isOpen ? 'close' : 'edit'} /></button>
              </div>
              {isOpen && <div className="cf-item__body stack"><FieldList fields={fields} values={it} path={[...path, i]} onChange={onChange} ctx={ctx} /></div>}
            </li>
          );
        })}
      </ol>
      {max ? <button type="button" className="btn btn--ghost cf-list__add" onClick={() => { onChange(path, [...items, blank()]); setOpen(items.length); }}><Icon name="plus" /> Add {word}</button>
        : <small>That's the most this section shows ({f.max}).</small>}
    </div>
  );
}

/** Create a category / collection without leaving the editor, and select it. */
function NewRef({ kind, onCreated }: { kind: 'category' | 'collection'; onCreated: (id: string) => void }) {
  const m = useCatalogMutations();
  const toast = useToast();
  return (
    <div style={{ marginTop: 6 }}>
      <AddInline compact label={kind === 'category' ? 'New category' : 'New collection'} placeholder={kind === 'category' ? 'e.g. Kaftans' : 'e.g. Onam Edit'}
        onAdd={async (name) => {
          const r = kind === 'category' ? await m.createCategory.mutateAsync({ name }) : await m.createCollection.mutateAsync({ name, kind: 'occasion' });
          onCreated(r.id);
          toast({ text: `${name} added. Give it a photo in Catalog setup.` });
        }} />
    </div>
  );
}
