import type { ProductListQuery } from '@femia/contracts';

/** URL search params → API list query (shared by shop, category, collection and search pages). */
export function listQuery(url: URL, extra: ProductListQuery = {}): ProductListQuery {
  const sp = url.searchParams;
  const n = (k: string) => (sp.get(k) && /^\d+$/.test(sp.get(k)!) ? Number(sp.get(k)) : undefined);
  const sort = sp.get('sort');
  return {
    size: sp.get('size') ?? undefined,
    colour: sp.get('colour') ?? undefined,
    fabric: sp.get('fabric') ?? undefined,
    min: n('min'), max: n('max'),
    q: sp.get('q')?.slice(0, 80) || undefined,
    sort: sort === 'price-asc' || sort === 'price-desc' || sort === 'popular' ? sort : 'new',
    page: Math.max(1, n('page') ?? 1),
    pageSize: 12,
    ...extra,
  } as ProductListQuery;
}
