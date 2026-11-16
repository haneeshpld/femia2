import { contentSchemaFor, SiteManifest } from '@femia/contracts';
import { audit, first, all, placeholders } from '../lib/db.ts';
import { mediaRef, type MediaRow } from './catalog.ts';
import type { MediaRef } from '@femia/contracts';
import { HttpError, notFound } from '../lib/http.ts';
import { hmacSha256Hex, safeEqual } from '../lib/crypto.ts';

export async function getManifest(db: D1Database): Promise<SiteManifest> {
  const row = await first<{ value: string }>(db, "SELECT value FROM settings WHERE key = 'site_manifest'");
  if (!row) throw new HttpError(500, 'manifest_missing', 'Storefront manifest has not been registered. Run the release pipeline or seed.');
  return SiteManifest.parse(JSON.parse(row.value));
}

export async function getPublished(db: D1Database) {
  const row = await first<{ id: number; data: string; published_at: string }>(db, "SELECT id, data, published_at FROM content_versions WHERE status = 'published' ORDER BY id DESC LIMIT 1");
  if (!row) return null;
  const data = JSON.parse(row.data) as Record<string, unknown>;
  return { version: row.id, publishedAt: row.published_at, data, media: await resolveMedia(db, data) };
}

/** Content stores media ids; resolve them to full refs (sizes, alt, dimensions) in one query. */
export async function resolveMedia(db: D1Database, data: unknown): Promise<Record<string, MediaRef>> {
  const ids = new Set<string>();
  const walk = (v: unknown) => {
    if (typeof v === 'string' && /^med_[a-z0-9_]+$/.test(v)) ids.add(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(data);
  if (!ids.size) return {};
  const rows = await all<MediaRow>(db, `SELECT * FROM media WHERE id IN (${placeholders(ids.size)})`, ...ids);
  return Object.fromEntries(rows.map((r) => [r.id, mediaRef(r)]));
}

export async function getDraft(db: D1Database) {
  const row = await first<{ id: number; data: string; created_at: string; created_by: string | null }>(db, "SELECT id, data, created_at, created_by FROM content_versions WHERE status = 'draft' ORDER BY id DESC LIMIT 1");
  if (row) {
    const data = JSON.parse(row.data) as Record<string, unknown>;
    return { draftId: row.id, savedAt: row.created_at, savedBy: row.created_by, data, media: await resolveMedia(db, data) };
  }
  const pub = await getPublished(db);
  return { draftId: null, savedAt: null, savedBy: null, data: pub?.data ?? {}, media: pub?.media ?? {} };
}

export async function saveDraft(db: D1Database, data: unknown, note: string, actor: string) {
  const schema = contentSchemaFor(await getManifest(db));
  const r = schema.safeParse(data);
  if (!r.success) {
    throw new HttpError(422, 'validation', 'Some content fields need attention', { fields: Object.fromEntries(r.error.issues.map((i) => [i.path.join('.'), i.message])) });
  }
  const json = JSON.stringify(r.data);
  const existing = await first<{ id: number }>(db, "SELECT id FROM content_versions WHERE status = 'draft' ORDER BY id DESC LIMIT 1");
  if (existing) {
    await db.prepare("UPDATE content_versions SET data = ?, note = ?, created_by = ?, created_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").bind(json, note, actor, existing.id).run();
  } else {
    await db.prepare("INSERT INTO content_versions (status, data, note, created_by) VALUES ('draft', ?, ?, ?)").bind(json, note, actor).run();
  }
  return getDraft(db);
}

/** Publish = freeze the draft as a new immutable version. The previous one is archived (kept for undo). */
export async function publishDraft(db: D1Database, actor: string) {
  const draft = await first<{ id: number; data: string; note: string }>(db, "SELECT id, data, note FROM content_versions WHERE status = 'draft' ORDER BY id DESC LIMIT 1");
  if (!draft) throw new HttpError(409, 'nothing_to_publish', 'There are no unpublished changes');
  await db.batch([
    db.prepare("UPDATE content_versions SET status = 'archived' WHERE status = 'published'"),
    db.prepare("INSERT INTO content_versions (status, data, note, created_by, published_at) VALUES ('published', ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))").bind(draft.data, draft.note, actor),
    db.prepare('DELETE FROM content_versions WHERE id = ?').bind(draft.id),
    audit(db, actor, 'content.publish', 'content', null, draft.note || 'Published homepage & content'),
  ]);
  return getPublished(db);
}

/** One-click undo: re-publish the version before the current one, as a new version (history is never rewritten). */
export async function undoPublish(db: D1Database, actor: string) {
  const [current, previous] = await all<{ id: number; data: string }>(db,
    "SELECT id, data FROM content_versions WHERE status IN ('published','archived') ORDER BY id DESC LIMIT 2");
  if (!current || !previous) throw new HttpError(409, 'nothing_to_undo', 'There is no earlier version to go back to');
  await db.batch([
    db.prepare("UPDATE content_versions SET status = 'archived' WHERE status = 'published'"),
    db.prepare("INSERT INTO content_versions (status, data, note, created_by, published_at) VALUES ('published', ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))").bind(previous.data, `Undo: restored version ${previous.id}`, actor),
    audit(db, actor, 'content.undo', 'content', String(previous.id), `Restored version ${previous.id}`),
  ]);
  return getPublished(db);
}

export async function versions(db: D1Database) {
  return all<{ id: number; status: string; note: string; created_by: string | null; published_at: string | null }>(db,
    "SELECT id, status, note, created_by, published_at FROM content_versions WHERE status != 'draft' ORDER BY id DESC LIMIT 30");
}

export async function getVersion(db: D1Database, id: number) {
  const row = await first<{ id: number; data: string }>(db, 'SELECT id, data FROM content_versions WHERE id = ?', id);
  if (!row) throw notFound('Version not found');
  const data = JSON.parse(row.data);
  return { version: row.id, data, media: await resolveMedia(db, data) };
}

/** Short-lived signed link so the storefront can render the unpublished draft (preview) without exposing admin auth. */
export async function previewToken(secret: string, ttlMinutes = 30) {
  const exp = Date.now() + ttlMinutes * 60e3;
  return `${exp}.${await hmacSha256Hex(secret, `content-preview:${exp}`)}`;
}

export async function verifyPreviewToken(secret: string, token: string) {
  const [exp, sig] = token.split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return safeEqual(await hmacSha256Hex(secret, `content-preview:${exp}`), sig);
}
