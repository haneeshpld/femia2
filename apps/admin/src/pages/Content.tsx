import { useEffect, useState } from 'react';
import { useBlocker } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, get, post, put } from '../lib/api.ts';
import { dateTime } from '../lib/format.ts';
import type { MediaRef } from '../lib/image.ts';
import { useCan } from '../lib/me.ts';
import { Icon } from '../components/Icon.tsx';
import type { Slot } from '../components/PhotoUpload.tsx';
import { ErrorBox, Sheet, Skeleton, useToast } from '../components/ui.tsx';
import { FieldList, type F } from '../components/ContentFields.tsx';
import { HomeSections, type Block } from '../components/HomeSections.tsx';
import { homeSections, type HomeSection } from '@femia/contracts/home';

interface Manifest { sections: { id: string; label: string; page: string; fields: F[] }[]; blocks?: (Block & { fields: F[] })[]; imageSlots: Slot[] }
const STOREFRONT = import.meta.env.VITE_STOREFRONT_URL ?? 'http://localhost:4321';
type Tab = 'home' | 'every' | 'pages';
const TABS: { id: Tab; label: string; lead: string }[] = [
  { id: 'home', label: 'Home page', lead: '' },
  { id: 'every', label: 'On every page', lead: 'The announcement bar at the top, and the promises and newsletter above the footer, on every page of the website.' },
  { id: 'pages', label: 'Other pages', lead: 'The Visit us and Our story pages, your policies and the size guide.' },
];
const PAGE_NAMES: Record<string, string> = { product: 'Shown on product pages' };

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
  const [open, setOpen] = useState<string>('');
  const [tab, setTab] = useState<Tab>('home');
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!draft.data || dirty) return;
    const d = structuredClone(draft.data.data);
    if (!Array.isArray(d.home?.sections)) d.home = { sections: homeSections(d) };
    setData(d); setMedia(draft.data.media);
  }, [draft.data]);
  useEffect(() => {
    // Refresh / close tab / leave Admin with unsaved edits: the browser's own "Leave site?" prompt.
    const h = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); };
    addEventListener('beforeunload', h); return () => removeEventListener('beforeunload', h);
  }, [dirty]);

  // Moving to another Admin page (menu, back button): ask first if edits are unsaved, or saved but not live.
  const canPublish = can('content.publish');
  const unpublished = (draft.data?.draftId ?? null) !== null;
  const blocker = useBlocker(({ currentLocation, nextLocation }) =>
    currentLocation.pathname !== nextLocation.pathname && (dirty || (unpublished && canPublish)));

  const refresh = () => { qc.invalidateQueries({ queryKey: ['content-draft'] }); qc.invalidateQueries({ queryKey: ['content-versions'] }); };
  const onErr = (e: unknown) => {
    if (e instanceof ApiError && e.code === 'validation') {
      setErrors(e.fields);
      // Open the tab and the part with the first problem.
      const first = Object.keys(e.fields)[0]?.split('.')[0] ?? '';
      const sec = manifest.data?.sections.find((x) => x.id === first);
      setTab(first === 'home' || !sec ? 'home' : sec.page === 'all' ? 'every' : 'pages');
      if (sec) setOpen(sec.id);
    }
    toast({ text: (e as Error).message, bad: true });
  };
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

  const leave = {
    // On failure the error toast explains why and the dialog stays, so nothing is lost.
    saveDraft: async () => { try { await save.mutateAsync(); blocker.proceed?.(); } catch { /* stay */ } },
    publish: async () => { try { await publish.mutateAsync(); blocker.proceed?.(); } catch { /* stay */ } },
    discard: () => { setDirty(false); blocker.proceed?.(); },
    stay: () => blocker.reset?.(),
  };

  if (manifest.isPending || draft.isPending || !data) return <Skeleton n={5} h={70} />;
  if (manifest.error || draft.error) return <ErrorBox error={manifest.error ?? draft.error} />;
  const slots = Object.fromEntries(manifest.data.imageSlots.map((s) => [s.id, s]));
  const hasDraft = draft.data.draftId !== null || dirty;
  const update = (path: (string | number)[], value: unknown) => {
    setData((d) => { const next = structuredClone(d!); let o: any = next; path.slice(0, -1).forEach((k) => { o[k] ??= {}; o = o[k]; }); o[path.at(-1)!] = value; return next; });
    setDirty(true);
  };
  const ctx = { slots, media, setMedia, cats: cats.data ?? [], colls: colls.data ?? [], errors };
  const tabErr = (t: Tab) => Object.keys(errors).some((k) => {
    const id = k.split('.')[0]; const sec = manifest.data.sections.find((x) => x.id === id);
    return t === 'home' ? id === 'home' : !!sec && (t === 'every') === (sec.page === 'all');
  });
  const pageSections = manifest.data.sections.filter((sec) => (tab === 'every') === (sec.page === 'all'));

  return (
    <>
      {/* Pinned action bar: always visible while scrolling, so the next step (save / publish) is never out of sight. */}
      <div className="editor-bar">
        <div className="editor-bar__title">
          <h1>Homepage & content</h1>
          <span className={`status-pill status-pill--${dirty ? 'unsaved' : hasDraft ? 'draft' : 'live'}`} role="status">
            {dirty ? 'Unsaved changes' : hasDraft ? `Draft saved${draft.data.savedAt ? ` ${dateTime(draft.data.savedAt)}` : ''} · not live yet` : 'Everything is live'}
          </span>
        </div>
        <div className="row editor-bar__actions">
          <button className="btn btn--quiet" onClick={() => save.mutate()} disabled={!dirty || save.isPending}>{save.isPending ? 'Saving…' : 'Save draft'}</button>
          <button className="btn btn--quiet" onClick={() => preview.mutate()} disabled={preview.isPending}><Icon name="eye" /> Preview</button>
          {canPublish ? <button className={`btn${hasDraft ? ' btn--pulse' : ''}`} onClick={() => publish.mutate()} disabled={!hasDraft || publish.isPending}>{publish.isPending ? 'Publishing…' : 'Publish'}</button>
            : <span className="badge badge--warn">The owner publishes changes</span>}
        </div>
      </div>

      {blocker.state === 'blocked' && (
        <Sheet title={dirty ? 'Save your changes?' : 'Your changes aren’t live yet'} onClose={leave.stay}
          footer={<>
            <button className="btn btn--quiet" onClick={leave.stay}>Stay on this page</button>
            <span className="spacer" />
            {dirty && <button className="btn btn--danger" onClick={leave.discard}>Discard changes</button>}
            {dirty ? <button className={canPublish ? 'btn btn--quiet' : 'btn'} onClick={leave.saveDraft} disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save draft & leave'}</button>
              : <button className="btn btn--quiet" onClick={() => blocker.proceed?.()}>Leave, keep draft</button>}
            {canPublish && <button className="btn" onClick={leave.publish} disabled={publish.isPending}>{publish.isPending ? 'Publishing…' : dirty ? 'Save & publish' : 'Publish & leave'}</button>}
          </>}>
          <p>{dirty
            ? 'You’ve changed the homepage but haven’t saved. If you leave now, those changes will be lost.'
            : 'Your changes are saved as a draft, but shoppers won’t see them until you publish.'}</p>
        </Sheet>
      )}
      <div className="stack">
        <div className="seg ct-tabs" role="tablist" aria-label="What to edit">
          {TABS.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
              {t.label}{tabErr(t.id) && <span className="ct-tabs__dot" aria-label="has problems" />}
            </button>
          ))}
        </div>

        {tab === 'home' && (manifest.data.blocks?.length ?? 0) > 0 && (
          <HomeSections
            blocks={manifest.data.blocks!}
            sections={(data.home?.sections ?? []) as HomeSection[]}
            errors={errors}
            onChange={(next) => update(['home', 'sections'], next)}
            renderFields={(block, i) => (
              <FieldList fields={(block as Block & { fields: F[] }).fields} values={data.home.sections[i]?.data ?? {}} path={['home', 'sections', i, 'data']} onChange={update} ctx={ctx} />
            )}
          />
        )}

        {tab !== 'home' && (
          <>
            <p className="muted">{TABS.find((t) => t.id === tab)!.lead}</p>
            {pageSections.map((sec) => (
              <details key={sec.id} className="card ct-part" open={open === sec.id} onToggle={(e) => { if ((e.currentTarget as HTMLDetailsElement).open) setOpen(sec.id); }}>
                <summary>
                  <strong>{sec.label}</strong>
                  {Object.keys(errors).some((k) => k.startsWith(`${sec.id}.`)) && <span className="badge badge--bad">Check fields</span>}
                  {PAGE_NAMES[sec.page] && <span className="muted small">{PAGE_NAMES[sec.page]}</span>}
                  <Icon name="chevronDown" />
                </summary>
                <div className="stack ct-part__body">
                  <FieldList fields={sec.fields as F[]} values={data[sec.id] ?? {}} path={[sec.id]} onChange={update} ctx={ctx} />
                </div>
              </details>
            ))}
          </>
        )}

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
