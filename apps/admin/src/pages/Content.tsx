import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, get, post, put } from '../lib/api.ts';
import { dateTime } from '../lib/format.ts';
import type { MediaRef } from '../lib/image.ts';
import { useCan } from '../lib/me.ts';
import { Icon } from '../components/Icon.tsx';
import { MediaPicker } from '../components/MediaPicker.tsx';
import type { Slot } from '../components/PhotoUpload.tsx';
import { ErrorBox, Field, Skeleton, useToast } from '../components/ui.tsx';
import { AddInline } from '../components/AddInline.tsx';
import { useCatalogMutations } from '../lib/catalog.ts';

type F = { id: string; type: string; label: string; help?: string; required?: boolean; maxLength?: number; slot?: string; options?: { value: string; label: string }[]; itemLabel?: string; min?: number; max?: number; fields?: F[] };
interface Manifest { sections: { id: string; label: string; page: string; fields: F[] }[]; imageSlots: Slot[] }
const STOREFRONT = import.meta.env.VITE_STOREFRONT_URL ?? 'http://localhost:4321';

/** Homepage & content: forms generated from the storefront's site.manifest.json. */
export default function Content() {
  const qc = useQueryClient();
  const toast = useToast();
  const can = useCan();
  const manifest = useQuery({ queryKey: ['manifest'], queryFn: () => get<Manifest>('/admin/manifest'), staleTime: Infinity });
  const draft = useQuery({ queryKey: ['content-draft'], queryFn: () => get<{ draftId: number | null; savedAt: string | null; data: Record<string, any>; media: Record<string, MediaRef> }>('/admin/content/draft') });
  const versions = useQuery({ queryKey: ['content-versions'], queryFn: () => get<{ id: number; status: string; note: string; created_by: string; published_at: string }[]>('/admin/content/versions') });
  const cats = useQuery({ queryKey: ['categories'], queryFn: () => get<{ id: string; name: string }[]>('/admin/categories') });
  const colls = useQuery({ queryKey: ['collections'], queryFn: () => get<{ id: string; name: string }[]>('/admin/collections') });
  const [data, setData] = useState<Record<string, any> | null>(null);
  const [media, setMedia] = useState<Record<string, MediaRef>>({});
  const [open, setOpen] = useState<string>('hero');
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => { if (draft.data && !dirty) { setData(structuredClone(draft.data.data)); setMedia(draft.data.media); } }, [draft.data]);
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); };
    addEventListener('beforeunload', h); return () => removeEventListener('beforeunload', h);
  }, [dirty]);

  const refresh = () => { qc.invalidateQueries({ queryKey: ['content-draft'] }); qc.invalidateQueries({ queryKey: ['content-versions'] }); };
  const onErr = (e: unknown) => { if (e instanceof ApiError && e.code === 'validation') { setErrors(e.fields); setOpen(Object.keys(e.fields)[0]?.split('.')[0] ?? open); } toast({ text: (e as Error).message, bad: true }); };
  const save = useMutation({ mutationFn: () => put('/admin/content/draft', { data, note: '' }), onSuccess: () => { setDirty(false); setErrors({}); refresh(); }, onError: onErr });
  const publish = useMutation({
    mutationFn: async () => { if (dirty) await put('/admin/content/draft', { data, note: '' }); return post('/admin/content/publish'); },
    onSuccess: () => { setDirty(false); refresh(); toast({ text: 'Published. The website updates within a minute.', action: { label: 'Undo', run: () => undo.mutate() } }); },
    onError: onErr,
  });
  const undo = useMutation({ mutationFn: () => post('/admin/content/undo'), onSuccess: (r) => { setData(structuredClone(r.data)); setMedia(r.media); setDirty(false); refresh(); toast({ text: 'Restored the previous version' }); }, onError: onErr });
  const preview = useMutation({
    mutationFn: async () => { if (dirty) await put('/admin/content/draft', { data, note: '' }); setDirty(false); return post<{ token: string }>('/admin/content/preview-token'); },
    onSuccess: ({ token }) => { refresh(); window.open(`${STOREFRONT}/preview?token=${encodeURIComponent(token)}`, '_blank', 'noopener'); },
    onError: onErr,
  });

  if (manifest.isPending || draft.isPending || !data) return <Skeleton n={5} h={70} />;
  if (manifest.error || draft.error) return <ErrorBox error={manifest.error ?? draft.error} />;
  const slots = Object.fromEntries(manifest.data.imageSlots.map((s) => [s.id, s]));
  const hasDraft = draft.data.draftId !== null || dirty;
  const update = (path: (string | number)[], value: unknown) => {
    setData((d) => { const next = structuredClone(d!); let o: any = next; path.slice(0, -1).forEach((k) => { o[k] ??= {}; o = o[k]; }); o[path.at(-1)!] = value; return next; });
    setDirty(true);
  };
  const ctx = { slots, media, setMedia, cats: cats.data ?? [], colls: colls.data ?? [], errors };

  return (
    <>
      <div className="page-head">
        <div><h1>Homepage & content</h1><p className="muted">{dirty ? 'Unsaved changes' : hasDraft ? `Draft saved ${draft.data.savedAt ? dateTime(draft.data.savedAt) : ''} · not live yet` : 'Everything is live'}</p></div>
        <div className="row">
          <button className="btn btn--quiet" onClick={() => save.mutate()} disabled={!dirty || save.isPending}>{save.isPending ? 'Saving…' : 'Save draft'}</button>
          <button className="btn btn--quiet" onClick={() => preview.mutate()} disabled={preview.isPending}><Icon name="eye" /> Preview</button>
          {can('content.publish') ? <button className="btn" onClick={() => publish.mutate()} disabled={!hasDraft || publish.isPending}>{publish.isPending ? 'Publishing…' : 'Publish'}</button>
            : <span className="badge badge--warn">The owner publishes changes</span>}
        </div>
      </div>
      <div className="stack">
        {manifest.data.sections.map((sec) => (
          <details key={sec.id} className="card" open={open === sec.id} onToggle={(e) => (e.currentTarget as HTMLDetailsElement).open && setOpen(sec.id)}>
            <summary style={{ cursor: 'pointer', listStyle: 'none', display: 'flex', alignItems: 'center', gap: 12, minHeight: 44 }}>
              <strong style={{ flex: 1 }}>{sec.label}</strong>
              {Object.keys(errors).some((k) => k.startsWith(sec.id)) && <span className="badge badge--bad">Check fields</span>}
              <span className="muted small">{sec.page === 'all' ? 'Every page' : sec.page}</span><Icon name="chevronDown" />
            </summary>
            <div className="stack" style={{ marginTop: 'var(--sp-4)' }}>
              {sec.fields.map((f) => <FieldEditor key={f.id} f={f} value={data[sec.id]?.[f.id]} path={[sec.id, f.id]} onChange={update} ctx={ctx} />)}
            </div>
          </details>
        ))}
        {can('content.publish') && (
          <div className="card">
            <div className="card__head"><h2>Published versions</h2><button className="btn btn--quiet" onClick={() => confirm('Go back to the previous published version?') && undo.mutate()} disabled={undo.isPending || (versions.data?.length ?? 0) < 2}><Icon name="undo" /> Undo last publish</button></div>
            <ul className="stack" style={{ listStyle: 'none', padding: 0, gap: 6 }}>
              {versions.data?.slice(0, 8).map((v) => <li key={v.id} className="row small"><span className={`badge ${v.status === 'published' ? 'badge--ok' : ''}`}>{v.status === 'published' ? 'Live' : `v${v.id}`}</span><span>{dateTime(v.published_at)} · {v.created_by}</span><span className="muted">{v.note}</span></li>)}
            </ul>
          </div>
        )}
      </div>
    </>
  );
}

type Ctx = { slots: Record<string, Slot>; media: Record<string, MediaRef>; setMedia: (f: (m: Record<string, MediaRef>) => Record<string, MediaRef>) => void; cats: { id: string; name: string }[]; colls: { id: string; name: string }[]; errors: Record<string, string> };

function FieldEditor({ f, value, path, onChange, ctx }: { f: F; value: any; path: (string | number)[]; onChange: (p: (string | number)[], v: unknown) => void; ctx: Ctx }) {
  const [picking, setPicking] = useState(false);
  const err = ctx.errors[path.join('.')];
  const label = f.label + (f.required ? '' : '');
  const counter = f.maxLength ? `${String(value ?? '').length}/${f.maxLength}` : undefined;
  switch (f.type) {
    case 'text': case 'url':
      return <Field label={label} hint={f.help ?? counter} error={err}><input className="input" type={f.type === 'url' ? 'text' : 'text'} inputMode={f.type === 'url' ? 'url' : undefined} maxLength={f.maxLength} value={value ?? ''} onChange={(e) => onChange(path, e.target.value)} placeholder={f.type === 'url' ? '/shop or https://…' : undefined} /></Field>;
    case 'textarea': case 'richtext':
      return <Field label={label} hint={f.type === 'richtext' ? 'Blank line = new paragraph. ## Heading, - list item, **bold**, [link](/url)' : counter} error={err}><textarea className="textarea" rows={f.type === 'richtext' ? 10 : 3} maxLength={f.maxLength} value={value ?? ''} onChange={(e) => onChange(path, e.target.value)} /></Field>;
    case 'boolean':
      return <label className="check"><input type="checkbox" checked={!!value} onChange={(e) => onChange(path, e.target.checked)} /> {label}</label>;
    case 'number':
      return <Field label={label} error={err}><input className="input" style={{ maxWidth: 120 }} inputMode="numeric" value={value ?? ''} onChange={(e) => onChange(path, Number(e.target.value.replace(/\D/g, '')) || 0)} /></Field>;
    case 'select':
      return <Field label={label} error={err}><select className="select" value={value ?? ''} onChange={(e) => onChange(path, e.target.value)}>{f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></Field>;
    case 'category': case 'collection': {
      const opts = f.type === 'category' ? ctx.cats : ctx.colls;
      return (
        <Field label={label} error={err}>
          <select className="select" value={value ?? ''} onChange={(e) => onChange(path, e.target.value || null)}>{!f.required && <option value="">None</option>}{opts.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
          <NewRef kind={f.type} onCreated={(id) => onChange(path, id)} />
        </Field>
      );
    }
    case 'image': {
      const slot = ctx.slots[f.slot ?? 'page'] ?? { id: 'page', label: 'Photo', aspect: 1.5, minWidth: 1200, mask: 'rect' as const };
      const m = value ? ctx.media[value] : null;
      return (
        <Field label={label} hint={slot.label} error={err}>
          <div className="row">
            <div style={{ width: 120, aspectRatio: String(slot.aspect), borderRadius: slot.mask === 'arch' ? '999px 999px 8px 8px' : 8, overflow: 'hidden', background: 'var(--c-sand)' }}>
              {m && <img src={m.src['480']} alt={m.alt} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
            </div>
            <button type="button" className="btn btn--quiet" onClick={() => setPicking(true)}><Icon name="image" /> {m ? 'Change' : 'Choose photo'}</button>
            {m && !f.required && <button type="button" className="btn btn--ghost" onClick={() => onChange(path, null)}>Remove</button>}
          </div>
          {picking && <MediaPicker slot={slot} onClose={() => setPicking(false)} onPick={(pm) => { ctx.setMedia((x) => ({ ...x, [pm.id]: pm })); onChange(path, pm.id); }} />}
        </Field>
      );
    }
    case 'list': {
      const items: any[] = Array.isArray(value) ? value : [];
      const blank = () => Object.fromEntries((f.fields ?? []).map((c) => [c.id, c.type === 'boolean' ? false : c.type === 'number' ? 0 : c.type === 'image' || c.type === 'category' || c.type === 'collection' ? null : c.type === 'select' ? c.options?.[0]?.value ?? '' : '']));
      return (
        <fieldset style={{ border: '1px solid var(--c-line)', borderRadius: 'var(--r-md)', padding: 'var(--sp-4)' }}>
          <legend className="small" style={{ fontWeight: 700, padding: '0 6px' }}>{label}</legend>
          {err && <p className="err">{err}</p>}
          <div className="stack">
            {items.map((it, i) => (
              <div key={i} className="stack" style={{ background: 'var(--c-cream)', borderRadius: 'var(--r-md)', padding: 'var(--sp-3)' }}>
                <div className="row"><strong className="small" style={{ flex: 1 }}>{f.itemLabel} {i + 1}</strong>
                  <button type="button" className="icon-btn" aria-label="Move up" disabled={i === 0} onClick={() => { const a = [...items]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; onChange(path, a); }}><Icon name="chevronLeft" className="rot90" /></button>
                  <button type="button" className="icon-btn" aria-label="Remove" disabled={f.min !== undefined && items.length <= f.min} onClick={() => onChange(path, items.filter((_, j) => j !== i))}><Icon name="trash" /></button>
                </div>
                {(f.fields ?? []).map((c) => <FieldEditor key={c.id} f={c} value={it?.[c.id]} path={[...path, i, c.id]} onChange={onChange} ctx={ctx} />)}
              </div>
            ))}
            {(f.max === undefined || items.length < f.max) && <button type="button" className="btn btn--ghost" onClick={() => onChange(path, [...items, blank()])}><Icon name="plus" /> Add {f.itemLabel?.toLowerCase()}</button>}
          </div>
        </fieldset>
      );
    }
    default: return null;
  }
}

/** Create a category / collection without leaving the homepage editor, and select it. */
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
