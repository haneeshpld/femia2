import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { get } from '../lib/api.ts';
import type { MediaRef } from '../lib/image.ts';
import { useCan } from '../lib/me.ts';
import { slugValue, useCatalogMutations, useCategories, useCollections, usePresets, type Category, type Collection } from '../lib/catalog.ts';
import { AddColour, AddInline } from '../components/AddInline.tsx';
import { Icon } from '../components/Icon.tsx';
import { MediaPicker } from '../components/MediaPicker.tsx';
import type { Slot } from '../components/PhotoUpload.tsx';
import { ErrorBox, Skeleton, useToast } from '../components/ui.tsx';

const ARCH: Slot = { id: 'arch', label: 'Category tile (arch)', aspect: 0.77, minWidth: 800, mask: 'arch' };
const OCCASION: Slot = { id: 'occasion', label: 'Collection card', aspect: 1.2, minWidth: 1200, mask: 'rect' };
const TABS = [['categories', 'Categories'], ['collections', 'Collections & occasions'], ['colours', 'Colours'], ['sizes', 'Sizes'], ['fabrics', 'Fabrics']] as const;
type Tab = (typeof TABS)[number][0];

/** One place to grow the shop's vocabulary. Everything here is also addable inline wherever it's picked. */
export default function Catalog() {
  const [tab, setTab] = useState<Tab>('categories');
  return (
    <>
      <div className="page-head">
        <div><h1>Catalog setup</h1><p className="muted">Categories, collections and the colour, size and fabric lists used when adding products.</p></div>
      </div>
      <div className="seg" role="tablist" style={{ marginBottom: 'var(--sp-4)' }}>
        {TABS.map(([v, l]) => <button key={v} role="tab" aria-selected={tab === v} className={tab === v ? 'on' : ''} onClick={() => setTab(v)}>{l}</button>)}
      </div>
      {tab === 'categories' && <Categories />}
      {tab === 'collections' && <Collections />}
      {tab === 'colours' && <Colours />}
      {(tab === 'sizes' || tab === 'fabrics') && <Words kind={tab} />}
    </>
  );
}

function useMediaMap() {
  return useQuery({ queryKey: ['media', 'all-for-catalog'], queryFn: () => get<{ items: MediaRef[] }>('/admin/media?page=1').then((r) => Object.fromEntries(r.items.map((m) => [m.id, m]))) });
}

function Thumb({ m, aspect, arch }: { m?: MediaRef; aspect: number; arch?: boolean }) {
  return (
    <span style={{ width: 64, aspectRatio: String(aspect), borderRadius: arch ? '999px 999px 6px 6px' : 8, overflow: 'hidden', background: 'var(--c-sand)', flex: 'none', display: 'block' }}>
      {m && <img src={m.src['480']} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
    </span>
  );
}

function Categories() {
  const q = useCategories();
  const media = useMediaMap();
  const m = useCatalogMutations();
  const toast = useToast();
  const can = useCan();
  if (q.isPending) return <Skeleton n={4} />;
  if (q.error) return <ErrorBox error={q.error} />;
  return (
    <div className="card stack">
      <p className="muted small">Categories are the shop tabs and the arch tiles on the homepage. A category appears on the website once it has a live product.</p>
      <div className="list">
        {q.data.map((c) => <CategoryRow key={c.id} c={c} m={media.data?.[c.imageId ?? '']} />)}
      </div>
      {can('catalog.write') && <AddInline label="New category" placeholder="e.g. Kaftans" onAdd={async (name) => { await m.createCategory.mutateAsync({ name }); toast({ text: `"${name}" added` }); }} />}
    </div>
  );
}

function CategoryRow({ c, m: photo }: { c: Category; m?: MediaRef }) {
  const [name, setName] = useState(c.name);
  const [pick, setPick] = useState(false);
  const mut = useCatalogMutations();
  const toast = useToast();
  const can = useCan();
  const qcMedia = useMediaMap();
  useEffect(() => setName(c.name), [c.name]);
  return (
    <div className="list-item" style={{ boxShadow: 'none', border: '1px solid var(--c-line)' }}>
      <Thumb m={photo} aspect={ARCH.aspect} arch />
      <input className="input" style={{ flex: 1, minWidth: 0 }} value={name} onChange={(e) => setName(e.target.value)} disabled={!can('catalog.write')} aria-label="Category name" />
      {name.trim() !== c.name && <button className="btn" onClick={() => mut.updateCategory.mutate({ id: c.id, name: name.trim() }, { onSuccess: () => toast({ text: 'Renamed' }), onError: (e) => toast({ text: (e as Error).message, bad: true }) })}>Save</button>}
      {can('catalog.write') && <button className="btn btn--quiet" onClick={() => setPick(true)}><Icon name="image" /> {photo ? 'Change photo' : 'Add photo'}</button>}
      {pick && <MediaPicker slot={ARCH} onClose={() => setPick(false)} onPick={(pm) => mut.updateCategory.mutate({ id: c.id, imageId: pm.id }, { onSuccess: () => { qcMedia.refetch(); toast({ text: 'Photo updated' }); } })} />}
    </div>
  );
}

function Collections() {
  const q = useCollections();
  const media = useMediaMap();
  const m = useCatalogMutations();
  const toast = useToast();
  const can = useCan();
  const [kind, setKind] = useState<'occasion' | 'collection'>('occasion');
  if (q.isPending) return <Skeleton n={4} />;
  if (q.error) return <ErrorBox error={q.error} />;
  return (
    <div className="card stack">
      <p className="muted small">Occasions appear in "Dressed for every moment" on the homepage; collections are curated edits on the Collections page. Hidden ones stay saved but disappear from the website.</p>
      <div className="list">{q.data.map((c) => <CollectionRow key={c.id} c={c} m={media.data?.[c.imageId ?? '']} />)}</div>
      {can('catalog.write') && (
        <AddInline label="New collection or occasion" placeholder="e.g. Onam Edit" maxLength={50}
          extra={<select className="select" style={{ width: 'auto', minHeight: 44 }} value={kind} onChange={(e) => setKind(e.target.value as 'occasion' | 'collection')} aria-label="Type"><option value="occasion">Occasion</option><option value="collection">Collection</option></select>}
          onAdd={async (name) => { await m.createCollection.mutateAsync({ name, kind }); toast({ text: `"${name}" added` }); }} />
      )}
    </div>
  );
}

function CollectionRow({ c, m: photo }: { c: Collection; m?: MediaRef }) {
  const [name, setName] = useState(c.name);
  const [desc, setDesc] = useState(c.description);
  const [pick, setPick] = useState(false);
  const mut = useCatalogMutations();
  const toast = useToast();
  const can = useCan();
  const media = useMediaMap();
  const dirty = name.trim() !== c.name || desc.trim() !== c.description;
  const ro = !can('catalog.write');
  return (
    <div className="list-item" style={{ boxShadow: 'none', border: '1px solid var(--c-line)', alignItems: 'flex-start', flexWrap: 'wrap', opacity: c.active ? 1 : 0.6 }}>
      <Thumb m={photo} aspect={OCCASION.aspect} />
      <div className="stack" style={{ flex: '1 1 260px', gap: 6 }}>
        <div className="row" style={{ gap: 6 }}>
          <input className="input" style={{ flex: 1 }} value={name} onChange={(e) => setName(e.target.value)} disabled={ro} aria-label="Name" />
          <select className="select" style={{ width: 'auto' }} value={c.kind} disabled={ro} onChange={(e) => mut.updateCollection.mutate({ id: c.id, kind: e.target.value as 'occasion' | 'collection' })} aria-label="Type">
            <option value="occasion">Occasion</option><option value="collection">Collection</option>
          </select>
        </div>
        <input className="input" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="One line about this edit" maxLength={200} disabled={ro} aria-label="Description" />
      </div>
      {!ro && (
        <div className="row" style={{ gap: 6 }}>
          {dirty && <button className="btn" onClick={() => mut.updateCollection.mutate({ id: c.id, name: name.trim(), description: desc.trim() }, { onSuccess: () => toast({ text: 'Saved' }), onError: (e) => toast({ text: (e as Error).message, bad: true }) })}>Save</button>}
          <button className="btn btn--quiet" onClick={() => setPick(true)}><Icon name="image" /> {photo ? 'Photo' : 'Add photo'}</button>
          <button className="btn btn--quiet" onClick={() => mut.updateCollection.mutate({ id: c.id, active: !c.active }, { onSuccess: () => toast({ text: c.active ? 'Hidden from the website' : 'Showing on the website' }) })}>{c.active ? 'Hide' : 'Show'}</button>
        </div>
      )}
      {pick && <MediaPicker slot={OCCASION} onClose={() => setPick(false)} onPick={(pm) => mut.updateCollection.mutate({ id: c.id, imageId: pm.id }, { onSuccess: () => { media.refetch(); toast({ text: 'Photo updated' }); } })} />}
    </div>
  );
}

function Colours() {
  const q = usePresets();
  const m = useCatalogMutations();
  const toast = useToast();
  const can = useCan();
  if (q.isPending) return <Skeleton n={2} />;
  if (q.error) return <ErrorBox error={q.error} />;
  const p = q.data;
  return (
    <div className="card stack">
      <p className="muted small">These swatches appear in step 3 of Add product. Removing one here doesn't change products that already use it.</p>
      <div className="row" style={{ gap: 8 }}>
        {p.colours.map((c) => (
          <span key={c.label} className="chip-x">
            <span style={{ width: 20, height: 20, borderRadius: '50%', background: c.hex, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.15)' }} />{c.label}
            {can('catalog.write') && <button type="button" aria-label={`Remove ${c.label}`} onClick={() => m.savePresets.mutate({ ...p, colours: p.colours.filter((x) => x.label !== c.label) })}><Icon name="close" size={14} /></button>}
          </span>
        ))}
      </div>
      {can('catalog.write') && <AddColour onAdd={async ({ label, hex }) => {
        if (p.colours.some((c) => slugValue(c.label) === slugValue(label))) throw new Error(`"${label}" is already in the list`);
        await m.savePresets.mutateAsync({ ...p, colours: [...p.colours, { label, hex }] });
        toast({ text: `${label} added` });
      }} />}
    </div>
  );
}

function Words({ kind }: { kind: 'sizes' | 'fabrics' }) {
  const q = usePresets();
  const m = useCatalogMutations();
  const toast = useToast();
  const can = useCan();
  if (q.isPending) return <Skeleton n={2} />;
  if (q.error) return <ErrorBox error={q.error} />;
  const p = q.data;
  const list = p[kind];
  const move = (i: number, d: -1 | 1) => { const a = [...list]; [a[i], a[i + d]] = [a[i + d]!, a[i]!]; m.savePresets.mutate({ ...p, [kind]: a }); };
  return (
    <div className="card stack">
      <p className="muted small">{kind === 'sizes' ? 'Sizes show in this order on product pages. Use the arrows to reorder.' : 'Fabrics are offered in step 2 of Add product and as a shop filter.'}</p>
      <div className="row" style={{ gap: 8 }}>
        {list.map((w, i) => (
          <span key={w} className="chip-x">
            {kind === 'sizes' && can('catalog.write') && <button type="button" aria-label={`Move ${w} earlier`} disabled={i === 0} onClick={() => move(i, -1)}><Icon name="chevronLeft" size={14} /></button>}
            {w}
            {kind === 'sizes' && can('catalog.write') && <button type="button" aria-label={`Move ${w} later`} disabled={i === list.length - 1} onClick={() => move(i, 1)}><Icon name="chevronRight" size={14} /></button>}
            {can('catalog.write') && <button type="button" aria-label={`Remove ${w}`} onClick={() => m.savePresets.mutate({ ...p, [kind]: list.filter((x) => x !== w) })}><Icon name="close" size={14} /></button>}
          </span>
        ))}
      </div>
      {can('catalog.write') && <AddInline label={kind === 'sizes' ? 'Add size' : 'Add fabric'} placeholder={kind === 'sizes' ? 'e.g. 4XL or 28' : 'e.g. Modal silk'} maxLength={kind === 'sizes' ? 20 : 40}
        onAdd={async (w) => {
          if (list.some((x) => x.toLowerCase() === w.toLowerCase())) throw new Error(`"${w}" is already in the list`);
          await m.savePresets.mutateAsync({ ...p, [kind]: [...list, w] });
          toast({ text: `${w} added` });
        }} />}
    </div>
  );
}
