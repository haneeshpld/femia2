// Adds generated hero and category concepts to the existing LOCAL dev database and R2.
// Unlike load-local.mjs, this preserves catalogue edits and content history.
import { getPlatformProxy } from 'wrangler';
import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname;
const PERSIST = join(ROOT, '.wrangler/state/v3');
const media = [
  ['med_herolead', 'hero', 'lead-ivory.webp', 'Woman modelling an ivory embroidered kurta in a sunlit boutique'],
  ['med_heromaroon', 'hero', 'embroidered-kurta-maroon.webp', 'Maroon embroidered cotton kurta, front'],
  ['med_heropeach', 'hero', 'floral-coord-peach.webp', 'Peach floral cotton co-ord set'],
  ['med_heroolive', 'hero', 'printed-kurta-olive.webp', 'Olive printed rayon kurta'],
  ['med_herolavender', 'hero', 'chikankari-kurta-lavender.webp', 'Lavender chikankari georgette kurta'],
  ['med_catkurtas', 'categories', 'kurtas.webp', 'Maroon embroidered kurta'],
  ['med_catcoords', 'categories', 'co-ord-sets.webp', 'Peach floral co-ord set'],
  ['med_catdresses', 'categories', 'dresses.webp', 'Mustard tiered dress'],
  ['med_cattops', 'categories', 'tops.webp', 'Lavender embroidered top'],
  ['med_catbottoms', 'categories', 'bottoms.webp', 'Cream block-print palazzo'],
];
const productMedia = [
  ['prd_seed1', 'med_seed16', 'med_heromaroon', 'med_hero_maroon'],
  ['prd_seed2', 'med_seed18', 'med_heropeach', 'med_hero_peach'],
  ['prd_seed3', 'med_seed19', 'med_heroolive', 'med_hero_olive'],
  ['prd_seed4', 'med_seed20', 'med_herolavender', 'med_hero_lavender'],
];
const categoryMedia = [
  ['cat_kurtas', 'med_catkurtas'],
  ['cat_coords', 'med_catcoords'],
  ['cat_dresses', 'med_catdresses'],
  ['cat_tops', 'med_cattops'],
  ['cat_bottoms', 'med_catbottoms'],
];

const proxy = await getPlatformProxy({
  configPath: join(ROOT, 'apps/api/wrangler.jsonc'),
  persist: { path: PERSIST },
});
try {
  const db = proxy.env.DB;
  const current = await db.prepare("SELECT id, data FROM content_versions WHERE status='published' ORDER BY id DESC LIMIT 1").first();
  if (!current) throw new Error('No published local content found. Load the dev seed first.');
  const data = JSON.parse(current.data);
  const hero = data.home?.sections?.find((section) => section.type === 'hero')?.data ?? data.hero;
  if (!hero) throw new Error('No hero section found in local content.');

  for (const [id, folder, file, alt] of media) {
    const source = join(ROOT, 'design/generated', folder, file);
    const { width, height } = await sharp(source).metadata();
    const { dominant } = await sharp(source).stats();
    const placeholder = '#' + [dominant.r, dominant.g, dominant.b].map((n) => n.toString(16).padStart(2, '0')).join('');
    await db.prepare('INSERT OR IGNORE INTO media (id, key_base, width, height, sizes, alt, placeholder, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, `seed/${id}`, 1600, Math.round(height / width * 1600), '[480,960,1600]', alt, placeholder, 'seed').run();
    for (const size of [480, 960, 1600]) {
      const bytes = readFileSync(join(ROOT, '.seed/media', id, `${size}.webp`));
      await proxy.env.MEDIA.put(`seed/${id}/${size}.webp`, bytes, { httpMetadata: { contentType: 'image/webp' } });
    }
  }

  for (const [productId, oldId, newId, priorId] of productMedia) {
    await db.prepare('UPDATE product_media SET media_id = ? WHERE product_id = ? AND media_id IN (?, ?)')
      .bind(newId, productId, oldId, priorId).run();
  }

  for (const [categoryId, mediaId] of categoryMedia) {
    await db.prepare('UPDATE categories SET image_id = ? WHERE id = ?').bind(mediaId, categoryId).run();
  }

  let contentChanged = false;
  for (const field of ['image', 'imageTablet', 'imageMobile']) {
    if (hero[field] !== 'med_herolead') { hero[field] = 'med_herolead'; contentChanged = true; }
  }
  for (const section of data.home?.sections ?? []) {
    if (section.type !== 'categories') continue;
    for (const item of section.data.items ?? []) {
      const imageId = categoryMedia.find(([categoryId]) => categoryId === item.category)?.[1];
      if (imageId && item.image !== imageId) { item.image = imageId; contentChanged = true; }
    }
  }
  if (contentChanged) {
    await db.batch([
      db.prepare("UPDATE content_versions SET status = 'archived' WHERE status = 'published'"),
      db.prepare("INSERT INTO content_versions (status, data, note, created_by, published_at) VALUES ('published', ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))")
        .bind(JSON.stringify(data), 'Generated hero and category editorial concepts (dev)', 'seed'),
    ]);
  }
  console.log('Applied ten generated images to local dev data; prior published content remains in history.');
} finally {
  await proxy.dispose();
}
