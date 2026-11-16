// Apply replacement DEV concepts to the existing local database and R2 state.
// New media IDs preserve immutable cached URLs and existing owner edits/history.
import { getPlatformProxy } from 'wrangler';
import sharp from 'sharp';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { editorialV2 } from './editorial-v2.mjs';

const ROOT = new URL('../../', import.meta.url).pathname;
const SOURCE = join(ROOT, 'design/generated/editorial-v2');
const PERSIST = join(ROOT, '.wrangler/state/v3');
const SIZES = [480, 960, 1600];
const replacements = new Map([
  ['med_seed06', 'med_v2_everyday'], ['med_seed07', 'med_v2_festive'], ['med_seed08', 'med_v2_work'],
  ['med_seed09', 'med_v2_boutique'],
  ['med_seed10', 'med_v2_style_lavender'], ['med_seed11', 'med_v2_style_mustard'],
  ['med_seed12', 'med_v2_style_ivory'], ['med_seed13', 'med_v2_style_maroon'],
  ['med_seed15', 'med_v2_about'],
]);
const productReplacements = [
  ['prd_seed1', 'med_seed17', 'med_v2_navy'],
  ['prd_seed5', 'med_seed21', 'med_v2_mustard_dress'],
  ['prd_seed6', 'med_seed22', 'med_v2_cream_coord'],
  ['prd_seed7', 'med_seed23', 'med_v2_rose_dress'],
  ['prd_seed8', 'med_seed04', 'med_cattops'],
  ['prd_seed9', 'med_seed05', 'med_catbottoms'],
];
const collectionReplacements = [
  ['col_everyday', 'med_seed06', 'med_v2_everyday'],
  ['col_festive', 'med_seed07', 'med_v2_festive'],
  ['col_work', 'med_seed08', 'med_v2_work'],
];

const proxy = await getPlatformProxy({
  configPath: join(ROOT, 'apps/api/wrangler.jsonc'),
  persist: { path: PERSIST },
});
try {
  const db = proxy.env.DB;
  const current = await db.prepare("SELECT id, data FROM content_versions WHERE status='published' ORDER BY id DESC LIMIT 1").first();
  if (!current) throw new Error('No published local content found. Load the dev seed first.');

  for (const [id, file, alt] of editorialV2) {
    const source = join(SOURCE, file);
    const { width, height } = await sharp(source).metadata();
    const { dominant } = await sharp(source).stats();
    const placeholder = '#' + [dominant.r, dominant.g, dominant.b].map((n) => n.toString(16).padStart(2, '0')).join('');
    await db.prepare('INSERT OR IGNORE INTO media (id, key_base, width, height, sizes, alt, placeholder, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, `seed/${id}`, 1600, Math.round(height / width * 1600), JSON.stringify(SIZES), alt, placeholder, 'seed').run();
    const dir = join(ROOT, '.seed/media', id);
    mkdirSync(dir, { recursive: true });
    for (const size of SIZES) {
      const bytes = await sharp(source).resize({ width: size, kernel: 'lanczos3' }).webp({ quality: 84, effort: 6 }).toBuffer();
      writeFileSync(join(dir, `${size}.webp`), bytes);
      await proxy.env.MEDIA.put(`seed/${id}/${size}.webp`, bytes, { httpMetadata: { contentType: 'image/webp' } });
    }
  }

  const mediaIds = JSON.parse(readFileSync(join(ROOT, '.seed/media.json'), 'utf8'));
  writeFileSync(join(ROOT, '.seed/media.json'), JSON.stringify([...new Set([...mediaIds, ...editorialV2.map(([id]) => id)])]));

  const data = JSON.parse(current.data);
  let contentChanged = false;
  const swap = (obj, key) => {
    if (obj && replacements.has(obj[key])) { obj[key] = replacements.get(obj[key]); contentChanged = true; }
  };
  for (const section of data.home?.sections ?? []) {
    swap(section.data, 'image');
    for (const item of section.data?.items ?? []) swap(item, 'image');
    for (const shot of section.data?.images ?? []) swap(shot, 'image');
    if (section.type === 'instagram' && section.data?.images?.some((shot) => String(shot.image).startsWith('med_v2_style_'))) {
      if (section.data.heading === 'Styled *by you*') { section.data.heading = 'Style *inspiration*'; contentChanged = true; }
      if (section.data.handle === '@femia__boutique') { section.data.handle = ''; contentChanged = true; }
    }
  }
  swap(data.boutique, 'image');
  swap(data.about, 'image');
  for (const shot of data.styled?.images ?? []) swap(shot, 'image');
  for (const item of data.occasions?.items ?? []) swap(item, 'image');

  const statements = [];
  for (const [productId, oldId, newId] of productReplacements) {
    statements.push(db.prepare('UPDATE product_media SET media_id = ? WHERE product_id = ? AND media_id = ?').bind(newId, productId, oldId));
  }
  for (const [collectionId, oldId, newId] of collectionReplacements) {
    statements.push(db.prepare('UPDATE collections SET image_id = ? WHERE id = ? AND image_id = ?').bind(newId, collectionId, oldId));
  }
  if (contentChanged) {
    statements.push(db.prepare("UPDATE content_versions SET status = 'archived' WHERE id = ?").bind(current.id));
    statements.push(db.prepare("INSERT INTO content_versions (status, data, note, created_by, published_at) VALUES ('published', ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))")
      .bind(JSON.stringify(data), 'Sharper development editorial concepts', 'seed'));
  }
  await db.batch(statements);
  console.log(`Applied ${editorialV2.length} replacement concepts to local dev media; content ${contentChanged ? 'updated' : 'already current'}.`);
} finally {
  await proxy.dispose();
}
