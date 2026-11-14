import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { get, post } from '../lib/api.ts';
import { dateTime } from '../lib/format.ts';
import { Icon } from '../components/Icon.tsx';
import { Empty, ErrorBox, Field, Sheet, Skeleton, useToast } from '../components/ui.tsx';

interface Row { id: string; sku: string; option1: string | null; option2: string | null; colourLabel: string | null; onHand: number; reserved: number; available: number; threshold: number; productId: string; title: string; status: string; thumb: string | null }
const REASONS = [['restock', 'New stock arrived'], ['return', 'Customer return'], ['adjustment', 'Count correction'], ['damage', 'Damaged / lost']] as const;

export default function Stock() {
  const [sp, setSp] = useSearchParams();
  const [q, setQ] = useState('');
  const low = sp.get('filter') === 'low';
  const [open, setOpen] = useState<Row | null>(null);
  const list = useQuery({ queryKey: ['stock', q, low], queryFn: () => get<Row[]>(`/admin/stock?${new URLSearchParams({ ...(q ? { q } : {}), ...(low ? { filter: 'low' } : {}) })}`), placeholderData: (p) => p });
  const groups = useMemo(() => {
    const m = new Map<string, Row[]>();
    for (const r of list.data ?? []) (m.get(r.productId) ?? m.set(r.productId, []).get(r.productId)!).push(r);
    return [...m.values()];
  }, [list.data]);

  return (
    <>
      <div className="page-head"><div><h1>Stock</h1><p className="muted">Tap an item to add or remove stock. Every change is recorded.</p></div></div>
      <div className="row" style={{ marginBottom: 'var(--sp-4)' }}>
        <div className="seg"><button className={!low ? 'on' : ''} onClick={() => setSp({})}>All</button><button className={low ? 'on' : ''} onClick={() => setSp({ filter: 'low' })}>Low stock</button></div>
        <span className="spacer" />
        <input className="input" style={{ maxWidth: 280 }} type="search" placeholder="Search name or SKU" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search stock" />
      </div>
      {list.isPending ? <Skeleton n={6} /> : list.error ? <ErrorBox error={list.error} retry={() => list.refetch()} /> : groups.length === 0 ? (
        <Empty icon="layers" title={low ? 'Nothing is running low' : 'No items found'} body={low ? 'Every item is above its low-stock level.' : undefined} />
      ) : (
        <div className="stack">
          {groups.map((g) => (
            <div className="card" key={g[0]!.productId}>
              <div className="row" style={{ marginBottom: 'var(--sp-3)' }}>
                {g[0]!.thumb ? <img className="thumb" src={g[0]!.thumb} alt="" /> : <span className="thumb" />}
                <strong style={{ flex: 1 }}>{g[0]!.title}</strong>
                {g[0]!.status === 'draft' && <span className="badge badge--warn">Draft</span>}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8 }}>
                {g.map((v) => (
                  <button key={v.id} className="list-item" style={{ boxShadow: 'none', border: '1.5px solid var(--c-line)', justifyContent: 'space-between' }} onClick={() => setOpen(v)}>
                    <span style={{ textAlign: 'left' }}><strong style={{ display: 'block' }}>{v.option1 ?? 'One size'}</strong><span className="muted small">{v.colourLabel ?? v.option2 ?? ''}</span></span>
                    <span className={`badge ${v.available === 0 ? 'badge--bad' : v.available <= v.threshold ? 'badge--warn' : 'badge--ok'}`} style={{ fontSize: '.9375rem' }}>{v.available}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      {open && <AdjustSheet row={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function AdjustSheet({ row, onClose }: { row: Row; onClose: () => void }) {
  const [delta, setDelta] = useState(1);
  const [reason, setReason] = useState<(typeof REASONS)[number][0]>('restock');
  const [note, setNote] = useState('');
  const qc = useQueryClient();
  const toast = useToast();
  const hist = useQuery({ queryKey: ['stock-history', row.id], queryFn: () => get<{ id: number; delta: number; reserved_delta: number; reason: string; order_id: string | null; note: string; actor: string; created_at: string }[]>(`/admin/stock/${row.id}/history`) });
  const save = useMutation({
    mutationFn: () => post('/admin/stock/adjust', { variantId: row.id, delta: reason === 'damage' ? -Math.abs(delta) : delta, reason, note }),
    onSuccess: (r: { on_hand: number }) => {
      qc.invalidateQueries({ queryKey: ['stock'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); qc.invalidateQueries({ queryKey: ['products'] });
      toast({ text: `${row.title} ${row.option1 ?? ''}: now ${r.on_hand} in stock` }); onClose();
    },
    onError: (e) => toast({ text: (e as Error).message, bad: true }),
  });
  const after = row.onHand + (reason === 'damage' ? -Math.abs(delta) : delta);
  const LABEL: Record<string, string> = { restock: 'Restock', sale: 'Sold', return: 'Return', adjustment: 'Correction', damage: 'Damaged', hold: 'Held for order', release: 'Hold released', cancel: 'Order cancelled' };
  return (
    <Sheet title={`${row.title} · ${[row.option1, row.colourLabel].filter(Boolean).join(' / ')}`} onClose={onClose}
      footer={<button className="btn btn--lg btn--block" disabled={!delta || after < row.reserved || save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : `Save · ${after} in stock`}</button>}>
      <div className="stack">
        <p className="muted small">In stock: <strong>{row.onHand}</strong>{row.reserved > 0 && <> · {row.reserved} held for unpaid orders</>} · SKU {row.sku}</p>
        <div className="big-step">
          <button type="button" onClick={() => setDelta((d) => d - 1)} aria-label="Remove one">−</button>
          <output aria-live="polite">{delta > 0 ? `+${delta}` : delta}</output>
          <button type="button" onClick={() => setDelta((d) => d + 1)} aria-label="Add one">+</button>
        </div>
        <Field label="Reason">
          <div className="seg" style={{ flexWrap: 'wrap' }}>{REASONS.map(([v, l]) => <button type="button" key={v} className={reason === v ? 'on' : ''} onClick={() => { setReason(v); if (v === 'damage' && delta > 0) setDelta(-delta); if ((v === 'restock' || v === 'return') && delta < 0) setDelta(-delta); }}>{l}</button>)}</div>
        </Field>
        <Field label="Note (optional)"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="e.g. New lot from supplier" /></Field>
        {after < row.reserved && <p className="err">Can't go below {row.reserved}: those units are held for orders awaiting payment.</p>}
        <div>
          <h2 style={{ marginBottom: 8 }}><Icon name="clock" size={18} /> History</h2>
          {hist.isPending ? <Skeleton n={3} h={32} /> : (
            <ul className="stack" style={{ listStyle: 'none', padding: 0, gap: 4 }}>
              {hist.data?.map((h) => (
                <li key={h.id} className="row small" style={{ justifyContent: 'space-between', borderBottom: '1px solid var(--c-line)', padding: '6px 0' }}>
                  <span><strong>{LABEL[h.reason] ?? h.reason}</strong> {h.note && <span className="muted">· {h.note}</span>}<br /><span className="muted">{dateTime(h.created_at)} · {h.actor}</span></span>
                  <span style={{ fontWeight: 700, color: h.delta > 0 ? 'var(--c-success)' : h.delta < 0 ? 'var(--c-danger)' : 'var(--c-muted)' }}>{h.delta ? (h.delta > 0 ? `+${h.delta}` : h.delta) : `${h.reserved_delta > 0 ? 'held ' : 'freed '}${Math.abs(h.reserved_delta)}`}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Sheet>
  );
}
