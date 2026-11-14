/** Time-sortable id: prefix + 9 base36 chars of ms time + 8 random chars. */
export function newId(prefix: string): string {
  const t = Date.now().toString(36).padStart(9, '0');
  const r = crypto.getRandomValues(new Uint8Array(8));
  const rand = Array.from(r, (b) => (b % 36).toString(36)).join('');
  return `${prefix}_${t}${rand}`;
}

export function token(bytes = 18): string {
  const r = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...r)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export const nowIso = () => new Date().toISOString();

export async function all<T>(db: D1Database, sql: string, ...binds: unknown[]): Promise<T[]> {
  const r = await db.prepare(sql).bind(...binds).all<T>();
  return r.results;
}

export async function first<T>(db: D1Database, sql: string, ...binds: unknown[]): Promise<T | null> {
  return db.prepare(sql).bind(...binds).first<T>();
}

export const placeholders = (n: number) => Array.from({ length: n }, () => '?').join(',');

export function isConstraintError(err: unknown): boolean {
  const m = err instanceof Error ? err.message + String((err as { cause?: unknown }).cause ?? '') : String(err);
  return /CHECK constraint failed|constraint failed/i.test(m);
}

export function audit(db: D1Database, actor: string, action: string, entity: string, entityId: string | null, summary: string, data?: unknown) {
  return db
    .prepare('INSERT INTO audit_log (actor, action, entity, entity_id, summary, data) VALUES (?,?,?,?,?,?)')
    .bind(actor, action, entity, entityId, summary, data === undefined ? null : JSON.stringify(data));
}
