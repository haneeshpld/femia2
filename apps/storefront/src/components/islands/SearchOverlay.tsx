import { useEffect, useRef, useState } from 'react';
import { json } from '../../lib/http.ts';
import type { ProductCard } from '@femia/contracts';
import { formatINR } from '@femia/contracts/money';
import { track } from '../../lib/analytics.ts';
import { Icon } from './Icon.tsx';
import { Sheet } from './Sheet.tsx';

const SUGGESTIONS = ['Kurtas', 'Co-ord sets', 'Dresses', 'Cotton', 'Embroidered'];

export function SearchOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<ProductCard[] | null>(null);
  const [loading, setLoading] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setResults(null); return; }
    setLoading(true);
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/catalog/products?q=${encodeURIComponent(term)}&pageSize=6`, { signal: ctrl.signal })
        .then((r) => json<{ items: ProductCard[] }>(r)).then((d) => { setResults(d.items); setLoading(false); track('search', { meta: { q: term } }); })
        .catch(() => setLoading(false));
    }, 220);
    return () => { clearTimeout(timer); ctrl.abort(); };
  }, [q]);

  return (
    <Sheet open={open} onClose={onClose} labelledBy="search-title" side="top" title="Search">
      <form action="/search" method="get" className="search-form" role="search" onSubmit={() => onClose()}>
        <Icon name="search" />
        <label htmlFor="search-q" className="sr-only">Search products</label>
        <input id="search-q" ref={input} name="q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search kurtas, co-ords, fabrics…" autoComplete="off" data-autofocus enterKeyHint="search" />
      </form>
      {!results && (
        <div className="search-suggest">
          <p className="eyebrow">Popular</p>
          <div className="chips">{SUGGESTIONS.map((s) => <button key={s} type="button" className="chip" onClick={() => { setQ(s); input.current?.focus(); }}>{s}</button>)}</div>
        </div>
      )}
      <div aria-live="polite">
        {loading && <p className="muted">Searching…</p>}
        {results && !loading && results.length === 0 && <p className="muted">No matches for “{q}”. Try a fabric or a category.</p>}
        {results && results.length > 0 && (
          <ul className="search-results" role="list">
            {results.map((p) => (
              <li key={p.id}>
                <a href={`/products/${p.slug}`}>
                  {p.images[0] && <img src={p.images[0].src['480']} alt="" width={56} height={75} loading="lazy" />}
                  <span><strong>{p.title}</strong><span className="muted">{p.category.name} · {formatINR(p.price)}</span></span>
                </a>
              </li>
            ))}
            <li><a className="link-arrow" href={`/search?q=${encodeURIComponent(q)}`}>See all results <Icon name="arrowRight" size={18} /></a></li>
          </ul>
        )}
      </div>
    </Sheet>
  );
}
