/** Home page sections (zod-free, safe for browser bundles). */
export interface HomeSection { id: string; type: string; enabled: boolean; data: Record<string, any> }

/**
 * Content saved before the page builder kept home sections as fixed top-level keys.
 * Read them as the equivalent section list so old content renders and edits unchanged.
 */
export function homeSections(content: Record<string, any>): HomeSection[] {
  if (Array.isArray(content.home?.sections)) return content.home.sections as HomeSection[];
  const out: HomeSection[] = [];
  const push = (id: string, type: string, data: unknown) => { if (data && typeof data === 'object') out.push({ id, type, enabled: true, data: data as Record<string, any> }); };
  push('hero', 'hero', content.hero);
  if (content.categories) push('categories', 'categories', { heading: content.categories.eyebrow, items: content.categories.items });
  if (content.newArrivals) push('new-arrivals', 'products', {
    heading: content.newArrivals.title, linkLabel: content.newArrivals.eyebrow, source: content.newArrivals.collection ? 'collection' : 'newest',
    collection: content.newArrivals.collection ?? null, category: null, count: content.newArrivals.count ?? 4,
  });
  if (content.occasions) push('occasions', 'occasions', { heading: content.occasions.title, items: content.occasions.items ?? [] });
  if (content.boutique) push('boutique', 'boutique', { heading: content.boutique.title, body: content.boutique.body, image: content.boutique.image ?? null });
  if (content.styled) out.push({ id: 'instagram', type: 'instagram', enabled: content.styled.enabled !== false, data: { heading: content.styled.eyebrow, handle: content.styled.handle, images: content.styled.images ?? [] } });
  return out;
}
