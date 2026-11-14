import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { get } from '../lib/api.ts';
import { formatINR } from '../lib/format.ts';
import { useCan } from '../lib/me.ts';
import { Icon } from '../components/Icon.tsx';
import { Empty, ErrorBox, Skeleton, StatusBadge } from '../components/ui.tsx';

interface Row { id: string; slug: string; title: string; status: string; price: number; category: string; on_hand: number; available: number; variants: number; thumb: string | null }

export default function Products() {
  const [status, setStatus] = useState<'' | 'active' | 'draft' | 'archived'>('');
  const [q, setQ] = useState('');
  const can = useCan();
  const nav = useNavigate();
  const list = useQuery({
    queryKey: ['products', status, q],
    queryFn: () => get<{ items: Row[]; total: number }>(`/admin/products?pageSize=100${status ? `&status=${status}` : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`),
    placeholderData: (p) => p,
  });
  return (
    <>
      <div className="page-head">
        <div><h1>Products</h1><p className="muted">{list.data ? `${list.data.total} products` : ' '}</p></div>
        {can('catalog.write') && (
          <div className="row">
            <Link to="/catalog" className="btn btn--quiet"><Icon name="tag" /> Categories, colours & sizes</Link>
            <Link to="/products/new" className="btn"><Icon name="plus" /> Add product</Link>
          </div>
        )}
      </div>
      <div className="row" style={{ marginBottom: 'var(--sp-4)' }}>
        <div className="seg" role="tablist">
          {([['', 'All'], ['active', 'Live'], ['draft', 'Drafts'], ['archived', 'Archived']] as const).map(([v, l]) => (
            <button key={v} role="tab" aria-selected={status === v} className={status === v ? 'on' : ''} onClick={() => setStatus(v)}>{l}</button>
          ))}
        </div>
        <span className="spacer" />
        <input className="input" style={{ maxWidth: 280 }} type="search" placeholder="Search name or SKU" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search products" />
      </div>
      {list.isPending ? <Skeleton n={5} /> : list.error ? <ErrorBox error={list.error} retry={() => list.refetch()} /> : list.data.items.length === 0 ? (
        <Empty icon="box" title={q ? 'No products match' : 'No products yet'} body={q ? 'Try another name or SKU.' : 'Add your first product: it takes about 3 minutes from your phone.'}
          action={!q && can('catalog.write') ? <Link className="btn" to="/products/new">Add product</Link> : undefined} />
      ) : (
        <div className="list">
          {list.data.items.map((p) => (
            <button key={p.id} className="list-item" onClick={() => nav(`/products/${p.id}`)} style={{ textAlign: 'left', width: '100%' }}>
              {p.thumb ? <img className="thumb" src={p.thumb} alt="" /> : <span className="thumb" />}
              <span style={{ flex: 1, minWidth: 0 }}>
                <strong style={{ display: 'block' }}>{p.title}</strong>
                <span className="muted small">{p.category} · {formatINR(p.price)} · {p.variants} variants</span>
              </span>
              <span style={{ display: 'grid', justifyItems: 'end', gap: 4 }}>
                <StatusBadge status={p.status} />
                <span className={`small ${p.available === 0 ? 'err' : 'muted'}`}>{p.available === 0 ? 'Out of stock' : `${p.available} in stock`}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
