import { ProductInput, type ProductStatus } from '@femia/contracts';
import { all, audit, first, newId, nowIso, placeholders } from '../lib/db.ts';
import { conflict, notFound, parse } from '../lib/http.ts';
import { mediaRef, sortSizes, type MediaRow } from './catalog.ts';

export function slugify(s: string) {
  return s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'item';
}

async function uniqueSlug(db: D1Database, base: string, exceptId?: string) {
  let slug = base, n = 2;
  while (await first(db, 'SELECT 1 FROM products WHERE slug = ? AND id != ?', slug, exceptId ?? '')) slug = `${base}-${n++}`;
  return slug;
}

const code = (s: string | null, len: number) => (s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, len) || 'X';

/** Auto SKU: CAT-PRODUCT-SIZE-COLOUR, e.g. KUR-EMBK-M-MAR. Collisions get a numeric suffix. */
async function makeSku(db: D1Database, catSlug: string, productSlug: string, o1: string | null, o2: string | null, taken: Set<string>) {
  const prod = productSlug.split('-').map((w) => w[0]).join('').toUpperCase().slice(0, 4).padEnd(3, 'X');
  const base = [code(catSlug, 3), prod, o1 ? code(o1, 4) : null, o2 ? code(o2, 3) : null].filter(Boolean).join('-');
  let sku = base, n = 2;
  while (taken.has(sku) || (await first(db, 'SELECT 1 FROM variants WHERE sku = ?', sku))) sku = `${base}-${n++}`;
  taken.add(sku);
  return sku;
}

export async function saveProduct(db: D1Database, input: unknown, actor: string, id?: string) {
  const p = parse(ProductInput, input);
  const cat = await first<{ id: string; slug: string }>(db, 'SELECT id, slug FROM categories WHERE id = ?', p.categoryId);
  if (!cat) throw notFound('Category not found');
  const existing = id ? await first<{ id: string; slug: string; status: ProductStatus }>(db, 'SELECT id, slug, status FROM products WHERE id = ?', id) : null;
  if (id && !existing) throw notFound('Product not found');

  const productId = existing?.id ?? newId('prd');
  const slug = await uniqueSlug(db, p.slug ?? (existing?.slug || slugify(p.title)), productId);
  const now = nowIso();
  const stmts: D1PreparedStatement[] = [];

  if (existing) {
    stmts.push(db.prepare(
      `UPDATE products SET slug=?, title=?, description=?, category_id=?, fabric=?, care=?, size_chart=?, price=?, compare_at_price=?,
       seo_title=?, seo_description=?, updated_at=? WHERE id=?`,
    ).bind(slug, p.title, p.description, p.categoryId, p.fabric, p.care, p.sizeChart, p.price, p.compareAtPrice, p.seoTitle, p.seoDescription, now, productId));
  } else {
    stmts.push(db.prepare(
      `INSERT INTO products (id, slug, title, description, category_id, fabric, care, size_chart, status, price, compare_at_price, seo_title, seo_description)
       VALUES (?,?,?,?,?,?,?,?,'draft',?,?,?,?)`,
    ).bind(productId, slug, p.title, p.description, p.categoryId, p.fabric, p.care, p.sizeChart, p.price, p.compareAtPrice, p.seoTitle, p.seoDescription));
  }

  // Options (labels + swatches) are replaced wholesale.
  stmts.push(db.prepare('DELETE FROM product_options WHERE product_id = ?').bind(productId));
  p.option1Values.forEach((o, i) => stmts.push(db.prepare('INSERT INTO product_options (product_id, option, value, label, swatch, sort) VALUES (?,1,?,?,NULL,?)').bind(productId, o.value, o.label ?? o.value, i)));
  p.option2Values.forEach((o, i) => stmts.push(db.prepare('INSERT INTO product_options (product_id, option, value, label, swatch, sort) VALUES (?,2,?,?,?,?)').bind(productId, o.value, o.label, o.swatch, i)));

  // Variants are matched by (size, colour) so removing and re-adding a combination reuses its stock history.
  const current = existing ? await all<{ id: string; option1: string | null; option2: string | null; sku: string }>(db, 'SELECT id, option1, option2, sku FROM variants WHERE product_id = ?', productId) : [];
  const key = (a: string | null, b: string | null) => `${a ?? ''}|${b ?? ''}`;
  const byKey = new Map(current.map((v) => [key(v.option1, v.option2), v]));
  const seen = new Set<string>();
  const taken = new Set<string>();
  for (const [i, v] of p.variants.entries()) {
    const k = key(v.option1, v.option2);
    seen.add(k);
    const match = byKey.get(k);
    if (match) {
      const sku = v.sku && v.sku !== match.sku ? v.sku : match.sku;
      stmts.push(db.prepare('UPDATE variants SET sku=?, price=?, low_stock_threshold=?, active=?, sort=? WHERE id=?').bind(sku, v.price, v.lowStockThreshold, v.active ? 1 : 0, i, match.id));
    } else {
      const vid = newId('var');
      const sku = v.sku || (await makeSku(db, cat.slug, slug, v.option1, v.option2, taken));
      stmts.push(db.prepare('INSERT INTO variants (id, product_id, sku, option1, option2, price, on_hand, low_stock_threshold, active, sort) VALUES (?,?,?,?,?,?,?,?,?,?)')
        .bind(vid, productId, sku, v.option1, v.option2, v.price, v.onHand, v.lowStockThreshold, v.active ? 1 : 0, i));
      if (v.onHand > 0) {
        stmts.push(db.prepare("INSERT INTO stock_ledger (variant_id, delta, reason, note, actor) VALUES (?, ?, 'restock', 'Opening stock', ?)").bind(vid, v.onHand, actor));
      }
    }
  }
  for (const v of current) if (!seen.has(key(v.option1, v.option2))) stmts.push(db.prepare('UPDATE variants SET active = 0 WHERE id = ?').bind(v.id));

  stmts.push(db.prepare('DELETE FROM product_media WHERE product_id = ?').bind(productId));
  p.images.forEach((img, i) => stmts.push(db.prepare('INSERT INTO product_media (product_id, media_id, role, option2, sort) VALUES (?,?,?,?,?)').bind(productId, img.mediaId, img.role, img.option2, i)));
  stmts.push(db.prepare('DELETE FROM product_collections WHERE product_id = ?').bind(productId));
  p.collectionIds.forEach((cid, i) => stmts.push(db.prepare('INSERT INTO product_collections (product_id, collection_id, sort) VALUES (?,?,?)').bind(productId, cid, i)));
  stmts.push(audit(db, actor, existing ? 'product.update' : 'product.create', 'product', productId, p.title));

  try {
    await db.batch(stmts);
  } catch (e) {
    if (String(e).includes('UNIQUE constraint failed: variants.sku')) throw conflict('sku_taken', 'That SKU is already used by another product');
    if (String(e).includes('FOREIGN KEY')) throw conflict('bad_reference', 'A photo or collection no longer exists. Refresh and try again.');
    throw e;
  }
  return getAdminProduct(db, productId);
}

export async function setProductStatus(db: D1Database, id: string, status: ProductStatus, actor: string) {
  const p = await first<{ id: string; title: string; published_at: string | null }>(db, 'SELECT id, title, published_at FROM products WHERE id = ?', id);
  if (!p) throw notFound('Product not found');
  if (status === 'active') {
    const v = await first<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM variants WHERE product_id = ? AND active = 1', id);
    const img = await first<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM product_media WHERE product_id = ?', id);
    if (!v?.n) throw conflict('not_ready', 'Add at least one size or colour before publishing');
    if (!img?.n) throw conflict('not_ready', 'Add at least one photo before publishing');
  }
  const now = nowIso();
  await db.batch([
    db.prepare('UPDATE products SET status = ?, updated_at = ?, published_at = COALESCE(published_at, CASE WHEN ? = \'active\' THEN ? END) WHERE id = ?').bind(status, now, status, now, id),
    audit(db, actor, `product.${status}`, 'product', id, `${p.title} → ${status}`),
  ]);
  return getAdminProduct(db, id);
}

export async function duplicateProduct(db: D1Database, id: string, actor: string) {
  const src = await getAdminProduct(db, id);
  return saveProduct(db, {
    ...src, title: `${src.title} (copy)`, slug: undefined,
    variants: src.variants.map((v) => ({ option1: v.option1, option2: v.option2, price: v.price, onHand: 0, lowStockThreshold: v.lowStockThreshold, active: v.active })),
  }, actor);
}

export async function getAdminProduct(db: D1Database, id: string) {
  const p = await first<{
    id: string; slug: string; title: string; description: string; category_id: string; fabric: string; care: string; size_chart: string | null;
    status: ProductStatus; price: number; compare_at_price: number | null; seo_title: string; seo_description: string; updated_at: string; published_at: string | null;
  }>(db, 'SELECT * FROM products WHERE id = ?', id);
  if (!p) throw notFound('Product not found');
  const [opts, variants, images, colls] = await Promise.all([
    all<{ option: number; value: string; label: string; swatch: string | null }>(db, 'SELECT option, value, label, swatch FROM product_options WHERE product_id = ? ORDER BY option, sort', id),
    all<{ id: string; sku: string; option1: string | null; option2: string | null; price: number | null; on_hand: number; reserved: number; low_stock_threshold: number | null; active: number }>(db,
      'SELECT id, sku, option1, option2, price, on_hand, reserved, low_stock_threshold, active FROM variants WHERE product_id = ? ORDER BY active DESC, sort', id),
    all<MediaRow & { role: 'main' | 'alt' | 'detail'; option2: string | null }>(db,
      'SELECT pm.role, pm.option2, m.* FROM product_media pm JOIN media m ON m.id = pm.media_id WHERE pm.product_id = ? ORDER BY pm.sort', id),
    all<{ collection_id: string }>(db, 'SELECT collection_id FROM product_collections WHERE product_id = ? ORDER BY sort', id),
  ]);
  return {
    id: p.id, slug: p.slug, title: p.title, description: p.description, categoryId: p.category_id, fabric: p.fabric, care: p.care, sizeChart: p.size_chart,
    status: p.status, price: p.price, compareAtPrice: p.compare_at_price, seoTitle: p.seo_title, seoDescription: p.seo_description,
    updatedAt: p.updated_at, publishedAt: p.published_at,
    option1Values: sortSizes(opts.filter((o) => o.option === 1).map((o) => ({ value: o.value, label: o.label }))),
    option2Values: opts.filter((o) => o.option === 2).map((o) => ({ value: o.value, label: o.label, swatch: o.swatch })),
    variants: variants.map((v) => ({
      id: v.id, sku: v.sku, option1: v.option1, option2: v.option2, price: v.price, onHand: v.on_hand, reserved: v.reserved,
      available: Math.max(0, v.on_hand - v.reserved), lowStockThreshold: v.low_stock_threshold, active: v.active === 1,
    })),
    images: images.map((i) => ({ mediaId: i.id, role: i.role, option2: i.option2, media: mediaRef(i, p.title) })),
    collectionIds: colls.map((c) => c.collection_id),
  };
}

export async function listAdminProducts(db: D1Database, q: { q?: string; status?: ProductStatus; category?: string; page: number; pageSize: number }) {
  const where: string[] = ['1=1'];
  const binds: unknown[] = [];
  if (q.status) { where.push('p.status = ?'); binds.push(q.status); } else where.push("p.status != 'archived'");
  if (q.category) { where.push('p.category_id = ?'); binds.push(q.category); }
  if (q.q) { where.push('(p.title LIKE ? OR EXISTS (SELECT 1 FROM variants v WHERE v.product_id = p.id AND v.sku LIKE ?))'); binds.push(`%${q.q}%`, `%${q.q}%`); }
  const sql = where.join(' AND ');
  const [rows, total] = await Promise.all([
    all<{ id: string; slug: string; title: string; status: ProductStatus; price: number; category: string; on_hand: number; available: number; variants: number; image_key: string | null; updated_at: string }>(db,
      `SELECT p.id, p.slug, p.title, p.status, p.price, c.name AS category, p.updated_at,
         (SELECT COALESCE(SUM(on_hand),0) FROM variants v WHERE v.product_id = p.id AND v.active = 1) AS on_hand,
         (SELECT COALESCE(SUM(MAX(on_hand - reserved,0)),0) FROM variants v WHERE v.product_id = p.id AND v.active = 1) AS available,
         (SELECT COUNT(*) FROM variants v WHERE v.product_id = p.id AND v.active = 1) AS variants,
         (SELECT m.key_base FROM product_media pm JOIN media m ON m.id = pm.media_id WHERE pm.product_id = p.id ORDER BY pm.sort LIMIT 1) AS image_key
       FROM products p JOIN categories c ON c.id = p.category_id WHERE ${sql} ORDER BY p.updated_at DESC LIMIT ? OFFSET ?`,
      ...binds, q.pageSize, (q.page - 1) * q.pageSize),
    first<{ n: number }>(db, `SELECT COUNT(*) AS n FROM products p WHERE ${sql}`, ...binds),
  ]);
  return {
    items: rows.map((r) => ({ ...r, thumb: r.image_key ? `/media/${r.image_key}/480.webp` : null, image_key: undefined })),
    page: q.page, pageSize: q.pageSize, total: total?.n ?? 0,
  };
}

export async function lowStock(db: D1Database, defaultThreshold: number, limit = 20) {
  return all<{ variant_id: string; sku: string; title: string; slug: string; option1: string | null; option2: string | null; available: number; threshold: number }>(db,
    `SELECT v.id AS variant_id, v.sku, p.title, p.slug, v.option1, v.option2, MAX(v.on_hand - v.reserved, 0) AS available,
            COALESCE(v.low_stock_threshold, ?) AS threshold
     FROM variants v JOIN products p ON p.id = v.product_id
     WHERE p.status = 'active' AND v.active = 1 AND (v.on_hand - v.reserved) <= COALESCE(v.low_stock_threshold, ?)
     ORDER BY available ASC, p.title LIMIT ?`, defaultThreshold, defaultThreshold, limit);
}

export const idsIn = placeholders;
