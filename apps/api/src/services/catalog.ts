import type {
  Category, Collection, Facets, MediaRef, OptionValue, ProductCard, ProductDetail, ProductImage, ProductList, ProductListQuery,
} from '@femia/contracts';
import { ProductListQuery as ListQuerySchema, bestSale, bundleText, inScope, isLive, tagsFor, type ScopeItem } from '@femia/contracts';
import { automaticOffers } from './offers.ts';
import type { z } from 'zod';
import { all, first, placeholders } from '../lib/db.ts';

const NEW_DAYS = 30;

export interface MediaRow { id: string; key_base: string; width: number; height: number; sizes: string; alt: string; placeholder: string | null }

export function mediaRef(m: MediaRow, altFallback = ''): MediaRef {
  const sizes = JSON.parse(m.sizes) as number[];
  return {
    id: m.id,
    alt: m.alt || altFallback,
    width: m.width,
    height: m.height,
    src: Object.fromEntries(sizes.map((w) => [String(w), `/media/${m.key_base}/${w}.webp`])),
    ...(m.placeholder ? { placeholder: m.placeholder } : {}),
  };
}

const MEDIA_COLS = 'm.id, m.key_base, m.width, m.height, m.sizes, m.alt, m.placeholder';

export async function listCategories(db: D1Database): Promise<Category[]> {
  const rows = await all<{ id: string; slug: string; name: string; sort: number } & Partial<Record<`m_${keyof MediaRow}`, unknown>>>(
    db,
    `SELECT c.id, c.slug, c.name, c.sort, m.id AS m_id, m.key_base AS m_key_base, m.width AS m_width, m.height AS m_height, m.sizes AS m_sizes, m.alt AS m_alt, m.placeholder AS m_placeholder
     FROM categories c LEFT JOIN media m ON m.id = c.image_id
     WHERE EXISTS (SELECT 1 FROM products p WHERE p.category_id = c.id AND p.status = 'active')
     ORDER BY c.sort, c.name`,
  );
  return rows.map((r) => ({ id: r.id, slug: r.slug, name: r.name, sort: r.sort, image: r.m_id ? mediaRef(unprefix(r), r.name) : null }));
}

export async function listCollections(db: D1Database, kind?: 'collection' | 'occasion'): Promise<Collection[]> {
  const rows = await all<{ id: string; slug: string; name: string; kind: 'collection' | 'occasion'; description: string; sort: number } & Record<string, unknown>>(
    db,
    `SELECT c.id, c.slug, c.name, c.kind, c.description, c.sort, m.id AS m_id, m.key_base AS m_key_base, m.width AS m_width, m.height AS m_height, m.sizes AS m_sizes, m.alt AS m_alt, m.placeholder AS m_placeholder
     FROM collections c LEFT JOIN media m ON m.id = c.image_id
     WHERE c.active = 1 ${kind ? 'AND c.kind = ?' : ''}
     ORDER BY c.sort, c.name`,
    ...(kind ? [kind] : []),
  );
  return rows.map((r) => ({
    id: r.id, slug: r.slug, name: r.name, kind: r.kind, description: r.description, sort: r.sort,
    image: r.m_id ? mediaRef(unprefix(r), r.name) : null,
  }));
}

function unprefix(r: Record<string, unknown>): MediaRow {
  return { id: r.m_id, key_base: r.m_key_base, width: r.m_width, height: r.m_height, sizes: r.m_sizes, alt: r.m_alt, placeholder: r.m_placeholder } as MediaRow;
}

interface ProductRow {
  id: string; slug: string; title: string; price: number; compare_at_price: number | null; published_at: string | null;
  category_id: string; category_slug: string; category_name: string;
}

const AVAILABLE = '(v.on_hand - v.reserved)';

/** Build WHERE for the product list. Facets ignore their own filter so options stay visible while filtering. */
function buildWhere(q: z.output<typeof ListQuerySchema>, skip?: 'size' | 'colour' | 'fabric' | 'price') {
  const where = ["p.status = 'active'"];
  const binds: unknown[] = [];
  if (q.category) { where.push('c.slug = ?'); binds.push(q.category); }
  if (q.collection) {
    where.push('EXISTS (SELECT 1 FROM product_collections pc JOIN collections co ON co.id = pc.collection_id WHERE pc.product_id = p.id AND co.slug = ?)');
    binds.push(q.collection);
  }
  if (q.q) {
    where.push("(p.title LIKE ? ESCAPE '\\' OR p.fabric LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\')");
    const like = `%${q.q.replace(/[\\%_]/g, (m) => '\\' + m)}%`;
    binds.push(like, like, like);
  }
  if (skip !== 'size' && q.size.length) {
    where.push(`EXISTS (SELECT 1 FROM variants v WHERE v.product_id = p.id AND v.active = 1 AND ${AVAILABLE} > 0 AND v.option1 IN (${placeholders(q.size.length)}))`);
    binds.push(...q.size);
  }
  if (skip !== 'colour' && q.colour.length) {
    where.push(`EXISTS (SELECT 1 FROM variants v WHERE v.product_id = p.id AND v.active = 1 AND v.option2 IN (${placeholders(q.colour.length)}))`);
    binds.push(...q.colour);
  }
  if (skip !== 'fabric' && q.fabric.length) { where.push(`p.fabric IN (${placeholders(q.fabric.length)})`); binds.push(...q.fabric); }
  if (skip !== 'price' && q.min !== undefined) { where.push('p.price >= ?'); binds.push(q.min); }
  if (skip !== 'price' && q.max !== undefined) { where.push('p.price <= ?'); binds.push(q.max); }
  return { sql: where.join(' AND '), binds };
}

const ORDER_BY: Record<string, string> = {
  new: 'p.published_at DESC, p.id DESC',
  'price-asc': 'p.price ASC, p.id',
  'price-desc': 'p.price DESC, p.id',
  popular: 'p.popularity DESC, p.published_at DESC',
};

export async function listProducts(db: D1Database, input: ProductListQuery): Promise<ProductList> {
  const q = ListQuerySchema.parse(input);
  const { sql, binds } = buildWhere(q);
  const from = 'FROM products p JOIN categories c ON c.id = p.category_id';
  const offset = (q.page - 1) * q.pageSize;

  const [countRow, rows, facets] = await Promise.all([
    first<{ n: number }>(db, `SELECT COUNT(*) AS n ${from} WHERE ${sql}`, ...binds),
    all<ProductRow>(
      db,
      `SELECT p.id, p.slug, p.title, p.price, p.compare_at_price, p.published_at, p.category_id, c.slug AS category_slug, c.name AS category_name
       ${from} WHERE ${sql} ORDER BY ${ORDER_BY[q.sort]} LIMIT ? OFFSET ?`,
      ...binds, q.pageSize, offset,
    ),
    computeFacets(db, q),
  ]);

  return { items: await hydrateCards(db, rows), page: q.page, pageSize: q.pageSize, total: countRow?.n ?? 0, facets };
}

async function computeFacets(db: D1Database, q: z.output<typeof ListQuerySchema>): Promise<Facets> {
  const from = 'FROM products p JOIN categories c ON c.id = p.category_id';
  const s = buildWhere(q, 'size'), co = buildWhere(q, 'colour'), f = buildWhere(q, 'fabric'), pr = buildWhere(q, 'price');
  const [sizes, colours, fabrics, price] = await Promise.all([
    all<{ value: string; count: number }>(db,
      `SELECT v.option1 AS value, COUNT(DISTINCT p.id) AS count ${from} JOIN variants v ON v.product_id = p.id AND v.active = 1 AND ${AVAILABLE} > 0
       WHERE ${s.sql} AND v.option1 IS NOT NULL GROUP BY v.option1`, ...s.binds),
    all<{ value: string; label: string; swatch: string | null; count: number }>(db,
      `SELECT po.value, MIN(po.label) AS label, MIN(po.swatch) AS swatch, COUNT(DISTINCT p.id) AS count ${from}
       JOIN product_options po ON po.product_id = p.id AND po.option = 2
       WHERE ${co.sql} GROUP BY po.value ORDER BY count DESC, po.value`, ...co.binds),
    all<{ value: string; count: number }>(db,
      `SELECT p.fabric AS value, COUNT(*) AS count ${from} WHERE ${f.sql} AND p.fabric != '' GROUP BY p.fabric ORDER BY count DESC`, ...f.binds),
    first<{ min: number | null; max: number | null }>(db, `SELECT MIN(p.price) AS min, MAX(p.price) AS max ${from} WHERE ${pr.sql}`, ...pr.binds),
  ]);
  return { sizes: sortSizes(sizes), colours, fabrics, price: { min: price?.min ?? 0, max: price?.max ?? 0 } };
}

const SIZE_ORDER = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '2XL', '3XL', '4XL', '5XL', 'Free Size'];
export function sortSizes<T extends { value: string }>(xs: T[]): T[] {
  const rank = (v: string) => { const i = SIZE_ORDER.indexOf(v); return i === -1 ? 100 + (Number.parseFloat(v) || 0) : i; };
  return [...xs].sort((a, b) => rank(a.value) - rank(b.value) || a.value.localeCompare(b.value));
}

/** Attach colours, images and sold-out state to product rows (3 queries for any page size). */
async function hydrateCards(db: D1Database, rows: ProductRow[]): Promise<ProductCard[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const ph = placeholders(ids.length);
  const [opts, imgs, stock, colls, offers] = await Promise.all([
    all<{ product_id: string; value: string; label: string; swatch: string | null }>(db,
      `SELECT product_id, value, label, swatch FROM product_options WHERE option = 2 AND product_id IN (${ph}) ORDER BY product_id, sort`, ...ids),
    all<MediaRow & { product_id: string; role: 'main' | 'alt' | 'detail'; option2: string | null }>(db,
      `SELECT pm.product_id, pm.role, pm.option2, ${MEDIA_COLS} FROM product_media pm JOIN media m ON m.id = pm.media_id
       WHERE pm.product_id IN (${ph}) AND pm.role IN ('main','alt') ORDER BY pm.product_id, pm.sort`, ...ids),
    all<{ product_id: string; available: number }>(db,
      `SELECT product_id, SUM(MAX(on_hand - reserved, 0)) AS available FROM variants WHERE active = 1 AND product_id IN (${ph}) GROUP BY product_id`, ...ids),
    all<{ product_id: string; collection_id: string }>(db, `SELECT product_id, collection_id FROM product_collections WHERE product_id IN (${ph})`, ...ids),
    automaticOffers(db),
  ]);
  const collsBy = new Map<string, string[]>();
  for (const c of colls) (collsBy.get(c.product_id) ?? collsBy.set(c.product_id, []).get(c.product_id)!).push(c.collection_id);
  const now = Date.now();
  const by = <T extends { product_id: string }>(xs: T[]) => {
    const m = new Map<string, T[]>();
    for (const x of xs) (m.get(x.product_id) ?? m.set(x.product_id, []).get(x.product_id)!).push(x);
    return m;
  };
  const optsBy = by(opts), imgsBy = by(imgs);
  const stockBy = new Map(stock.map((s) => [s.product_id, s.available]));
  const cutoff = Date.now() - NEW_DAYS * 864e5;

  return rows.map((r) => {
    const colours: OptionValue[] = (optsBy.get(r.id) ?? []).map((o) => ({ value: o.value, label: o.label, swatch: o.swatch }));
    const all = imgsBy.get(r.id) ?? [];
    // Card shows: per colour, its first main image + first alt (hover). Falls back to colour-agnostic photos.
    const images: ProductImage[] = [];
    const pick = (colour: string | null) => {
      const forColour = all.filter((i) => i.option2 === colour);
      const pool = forColour.length ? forColour : all.filter((i) => i.option2 === null);
      const main = pool.find((i) => i.role === 'main') ?? pool[0];
      const alt = pool.find((i) => i !== main);
      for (const i of [main, alt]) if (i && !images.some((x) => x.id === i.id && x.option2 === colour)) {
        images.push({ ...mediaRef(i, r.title), role: i === main ? 'main' : 'alt', option2: colour });
      }
    };
    if (colours.length) colours.forEach((c) => pick(c.value)); else pick(null);
    if (!images.length && all[0]) {
      // No colour-specific or shared photos matched: fall back to the first photos so a card is never blank.
      all.slice(0, 2).forEach((i, n) => images.push({ ...mediaRef(i, r.title), role: n === 0 ? 'main' : 'alt', option2: i.option2 }));
    }
    // Offers: the best live sale sets the price (old price struck through); tags are labels only.
    const scope: ScopeItem = { productId: r.id, categoryId: r.category_id, collectionIds: collsBy.get(r.id) ?? [] };
    const sale = bestSale(r.price, scope, offers, now);
    const badges: ProductCard['badges'] = [
      ...(sale ? [{ label: sale.offer.label, style: sale.offer.style, kind: 'sale' as const }] : []),
      ...tagsFor(scope, offers, now).map((t) => ({ ...t, kind: 'tag' as const })),
    ];
    return {
      id: r.id, slug: r.slug, title: r.title,
      price: sale ? sale.price : r.price,
      compareAtPrice: sale ? Math.max(r.compare_at_price ?? 0, r.price) : r.compare_at_price,
      category: { slug: r.category_slug, name: r.category_name },
      colours, images,
      soldOut: (stockBy.get(r.id) ?? 0) <= 0,
      isNew: !!r.published_at && Date.parse(r.published_at) > cutoff,
      badges,
      saleEndsAt: sale?.offer.endsAt ?? null,
    };
  });
}

export async function getProduct(db: D1Database, slug: string, opts: { includeDraft?: boolean } = {}): Promise<ProductDetail | null> {
  const p = await first<ProductRow & {
    description: string; fabric: string; care: string; size_chart: string | null; option1_name: string; option2_name: string;
    seo_title: string; seo_description: string; category_id: string; status: string;
  }>(db,
    `SELECT p.*, c.slug AS category_slug, c.name AS category_name FROM products p JOIN categories c ON c.id = p.category_id
     WHERE p.slug = ? ${opts.includeDraft ? '' : "AND p.status = 'active'"}`, slug);
  if (!p) return null;

  const [card] = await hydrateCards(db, [p]);
  const [offers, collIds] = await Promise.all([
    automaticOffers(db),
    all<{ collection_id: string }>(db, 'SELECT collection_id FROM product_collections WHERE product_id = ?', p.id),
  ]);
  const scope: ScopeItem = { productId: p.id, categoryId: p.category_id, collectionIds: collIds.map((c) => c.collection_id) };
  const [options, variants, images, collections, relatedRows] = await Promise.all([
    all<{ option: 1 | 2; value: string; label: string; swatch: string | null }>(db,
      'SELECT option, value, label, swatch FROM product_options WHERE product_id = ? ORDER BY option, sort', p.id),
    all<{ id: string; sku: string; option1: string | null; option2: string | null; price: number | null; compare_at_price: number | null; available: number }>(db,
      `SELECT id, sku, option1, option2, price, compare_at_price, MAX(on_hand - reserved, 0) AS available
       FROM variants WHERE product_id = ? AND active = 1 ORDER BY sort`, p.id),
    all<MediaRow & { role: 'main' | 'alt' | 'detail'; option2: string | null }>(db,
      `SELECT pm.role, pm.option2, ${MEDIA_COLS} FROM product_media pm JOIN media m ON m.id = pm.media_id WHERE pm.product_id = ? ORDER BY pm.sort`, p.id),
    all<{ slug: string; name: string }>(db,
      `SELECT co.slug, co.name FROM product_collections pc JOIN collections co ON co.id = pc.collection_id WHERE pc.product_id = ? AND co.active = 1 ORDER BY co.sort`, p.id),
    all<ProductRow>(db,
      `SELECT p.id, p.slug, p.title, p.price, p.compare_at_price, p.published_at, p.category_id, c.slug AS category_slug, c.name AS category_name
       FROM products p JOIN categories c ON c.id = p.category_id
       WHERE p.status = 'active' AND p.id != ? ORDER BY (p.category_id = ?) DESC, p.popularity DESC, p.published_at DESC LIMIT 4`, p.id, p.category_id),
  ]);

  const toOv = (o: { value: string; label: string; swatch: string | null }): OptionValue => ({ value: o.value, label: o.label, swatch: o.swatch });
  return {
    ...card!,
    images: images.map((i) => ({ ...mediaRef(i, p.title), role: i.role, option2: i.option2 })),
    description: p.description,
    fabric: p.fabric,
    care: p.care,
    sizeChart: p.size_chart,
    option1Name: p.option1_name,
    option2Name: p.option2_name,
    option1Values: sortSizes(options.filter((o) => o.option === 1).map(toOv)),
    option2Values: options.filter((o) => o.option === 2).map(toOv),
    variants: variants.map((v) => {
      const list = v.price ?? p.price;
      const sale = bestSale(list, scope, offers);
      const cap = v.compare_at_price ?? p.compare_at_price;
      return {
        id: v.id, sku: v.sku, option1: v.option1, option2: v.option2,
        price: sale ? sale.price : list, compareAtPrice: sale ? Math.max(cap ?? 0, list) : cap, available: v.available,
      };
    }),
    collections,
    deals: offers.filter((o) => o.kind === 'bundle' && isLive(o) && inScope(o, scope)).map((o) => ({ label: o.label, text: bundleText(o), style: o.style })),
    related: await hydrateCards(db, relatedRows),
    seo: { title: p.seo_title || p.title, description: p.seo_description || p.description.slice(0, 155) },
  };
}

/** Live availability for the product page (HTML is cached; stock is not). */
export async function stockForProduct(db: D1Database, slug: string): Promise<Record<string, number>> {
  const rows = await all<{ id: string; available: number }>(db,
    `SELECT v.id, MAX(v.on_hand - v.reserved, 0) AS available FROM variants v JOIN products p ON p.id = v.product_id
     WHERE p.slug = ? AND p.status = 'active' AND v.active = 1`, slug);
  return Object.fromEntries(rows.map((r) => [r.id, r.available]));
}

export async function stockForVariants(db: D1Database, ids: string[]): Promise<Record<string, number>> {
  if (!ids.length) return {};
  const rows = await all<{ id: string; available: number }>(db,
    `SELECT id, MAX(on_hand - reserved, 0) AS available FROM variants WHERE active = 1 AND id IN (${placeholders(ids.length)})`, ...ids);
  return Object.fromEntries(rows.map((r) => [r.id, r.available]));
}
