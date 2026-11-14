import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, del, get, patch } from '../lib/api.ts';
import type { MediaRef } from '../lib/image.ts';
import { PhotoUpload, PRODUCT_SLOT } from '../components/PhotoUpload.tsx';
import { Empty, ErrorBox, Field, Sheet, Skeleton, useToast } from '../components/ui.tsx';

export default function Media() {
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<MediaRef | null>(null);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['media', page], queryFn: () => get<{ items: (MediaRef & { createdAt: string; bytes: number })[]; total: number; pageSize: number }>(`/admin/media?page=${page}`) });
  return (
    <>
      <div className="page-head"><div><h1>Photos</h1><p className="muted">{q.data ? `${q.data.total} photos · compressed in your browser, 3 sizes each` : ' '}</p></div></div>
      {q.isPending ? <Skeleton n={3} h={160} /> : q.error ? <ErrorBox error={q.error} /> : (
        <>
          <div className="photo-grid">
            <PhotoUpload slot={PRODUCT_SLOT} onUploaded={() => qc.invalidateQueries({ queryKey: ['media'] })} label="Upload" />
            {q.data.items.map((m) => <button key={m.id} className="photo" onClick={() => setOpen(m)} aria-label={m.alt || 'Photo without description'}><img src={m.src['480']} alt="" loading="lazy" />{!m.alt && <span className="badge badge--warn photo__tag">No description</span>}</button>)}
          </div>
          {q.data.items.length === 0 && <Empty icon="image" title="No photos yet" />}
          {q.data.total > q.data.pageSize && <div className="row" style={{ justifyContent: 'center', marginTop: 16 }}><button className="btn btn--quiet" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</button><button className="btn btn--quiet" disabled={page * q.data.pageSize >= q.data.total} onClick={() => setPage(page + 1)}>Next</button></div>}
        </>
      )}
      {open && <PhotoSheet m={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function PhotoSheet({ m, onClose }: { m: MediaRef; onClose: () => void }) {
  const [alt, setAlt] = useState(m.alt);
  const qc = useQueryClient();
  const toast = useToast();
  const usages = useQuery({ queryKey: ['media-usages', m.id], queryFn: () => get<{ type: string; label: string }[]>(`/admin/media/${m.id}/usages`) });
  const save = useMutation({ mutationFn: () => patch(`/admin/media/${m.id}`, { alt }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['media'] }); toast({ text: 'Saved' }); onClose(); } });
  const remove = useMutation({ mutationFn: () => del(`/admin/media/${m.id}`), onSuccess: () => { qc.invalidateQueries({ queryKey: ['media'] }); toast({ text: 'Photo deleted' }); onClose(); }, onError: (e) => toast({ text: e instanceof ApiError ? e.message : 'Could not delete', bad: true }) });
  const inUse = (usages.data?.length ?? 0) > 0;
  return (
    <Sheet title="Photo" onClose={onClose} footer={<>
      <button className="btn btn--danger" disabled={inUse || remove.isPending} onClick={() => confirm('Delete this photo for good?') && remove.mutate()}>Delete</button>
      <span className="spacer" /><button className="btn" onClick={() => save.mutate()} disabled={alt === m.alt}>Save</button>
    </>}>
      <div className="stack">
        <img src={m.src['960']} alt={m.alt} style={{ maxHeight: 360, margin: '0 auto', borderRadius: 8 }} />
        <Field label="Description (alt text)"><input className="input" value={alt} onChange={(e) => setAlt(e.target.value)} maxLength={200} /></Field>
        <div><strong className="small">Used in</strong>
          {usages.isPending ? <Skeleton n={1} h={24} /> : inUse ? <ul className="small">{usages.data!.map((u, i) => <li key={i}>{u.label} <span className="muted">({u.type})</span></li>)}</ul> : <p className="muted small">Not used anywhere. Safe to delete.</p>}
        </div>
      </div>
    </Sheet>
  );
}
