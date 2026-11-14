import type { Env } from '../env.ts';
import { all, audit, first, newId } from '../lib/db.ts';
import { badRequest, conflict, notFound } from '../lib/http.ts';
import { mediaRef, type MediaRow } from './catalog.ts';

export const MEDIA_SIZES = [480, 960, 1600] as const;
const MAX_BYTES = 2_500_000;

/**
 * Admin compresses + crops in the browser and uploads 3 WebP renditions (multipart: w480, w960, w1600).
 * No server-side image processing, so this stays on the free tier.
 */
export async function uploadMedia(env: Env, form: FormData, actor: string) {
  const width = Number(form.get('width')), height = Number(form.get('height'));
  if (!width || !height) throw badRequest('width and height are required');
  const files: [number, File][] = [];
  for (const w of MEDIA_SIZES) {
    const f = form.get(`w${w}`);
    if (!(f instanceof File)) throw badRequest(`Missing ${w}px rendition`);
    if (f.size > MAX_BYTES) throw badRequest(`The ${w}px image is too large (max 2.5 MB)`);
    if (f.type !== 'image/webp') throw badRequest('Images must be WebP');
    files.push([w, f]);
  }
  const id = newId('med');
  const keyBase = `p/${id}`;
  await Promise.all(files.map(([w, f]) => env.MEDIA.put(`${keyBase}/${w}.webp`, f.stream(), {
    httpMetadata: { contentType: 'image/webp', cacheControl: 'public, max-age=31536000, immutable' },
  })));
  const bytes = files.reduce((s, [, f]) => s + f.size, 0);
  const alt = String(form.get('alt') ?? '').slice(0, 200);
  const placeholder = String(form.get('placeholder') ?? '').slice(0, 2000) || null;
  await env.DB.batch([
    env.DB.prepare('INSERT INTO media (id, key_base, width, height, sizes, alt, placeholder, bytes, created_by) VALUES (?,?,?,?,?,?,?,?,?)')
      .bind(id, keyBase, width, height, JSON.stringify(MEDIA_SIZES), alt, placeholder, bytes, actor),
    audit(env.DB, actor, 'media.upload', 'media', id, alt || 'Uploaded photo'),
  ]);
  return mediaRef((await first<MediaRow>(env.DB, 'SELECT * FROM media WHERE id = ?', id))!);
}

/** "Used in" protection: where a photo appears, so it can't be deleted from under a live page. */
export async function mediaUsages(db: D1Database, id: string) {
  const [products, cats, colls, content] = await Promise.all([
    all<{ title: string; slug: string }>(db, 'SELECT DISTINCT p.title, p.slug FROM product_media pm JOIN products p ON p.id = pm.product_id WHERE pm.media_id = ?', id),
    all<{ name: string }>(db, 'SELECT name FROM categories WHERE image_id = ?', id),
    all<{ name: string }>(db, 'SELECT name FROM collections WHERE image_id = ?', id),
    all<{ status: string }>(db, "SELECT DISTINCT status FROM content_versions WHERE status IN ('draft','published') AND instr(data, ?) > 0", `"${id}"`),
  ]);
  return [
    ...products.map((p) => ({ type: 'product', label: p.title, ref: p.slug })),
    ...cats.map((c) => ({ type: 'category', label: c.name, ref: null })),
    ...colls.map((c) => ({ type: 'collection', label: c.name, ref: null })),
    ...content.map((c) => ({ type: 'content', label: c.status === 'draft' ? 'Homepage (draft)' : 'Homepage (live)', ref: null })),
  ];
}

export async function deleteMedia(env: Env, id: string, actor: string) {
  const m = await first<MediaRow & { key_base: string }>(env.DB, 'SELECT * FROM media WHERE id = ?', id);
  if (!m) throw notFound('Photo not found');
  const usedIn = await mediaUsages(env.DB, id);
  if (usedIn.length) throw conflict('media_in_use', 'This photo is in use. Remove it from these places first.', { usedIn });
  await env.MEDIA.delete(MEDIA_SIZES.map((w) => `${m.key_base}/${w}.webp`));
  await env.DB.batch([env.DB.prepare('DELETE FROM media WHERE id = ?').bind(id), audit(env.DB, actor, 'media.delete', 'media', id, m.alt)]);
}

export async function listMedia(db: D1Database, page = 1, pageSize = 40) {
  const rows = await all<MediaRow & { created_at: string; bytes: number }>(db, 'SELECT * FROM media ORDER BY created_at DESC LIMIT ? OFFSET ?', pageSize, (page - 1) * pageSize);
  const total = (await first<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM media'))?.n ?? 0;
  return { items: rows.map((r) => ({ ...mediaRef(r), createdAt: r.created_at, bytes: r.bytes })), page, pageSize, total };
}
