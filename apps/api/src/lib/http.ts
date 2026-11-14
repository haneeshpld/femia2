import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';

export class HttpError extends Error {
  constructor(public status: ContentfulStatusCode, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

export const notFound = (what = 'Not found') => new HttpError(404, 'not_found', what);
export const badRequest = (message: string, details?: unknown) => new HttpError(400, 'bad_request', message, details);
export const conflict = (code: string, message: string, details?: unknown) => new HttpError(409, code, message, details);
export const forbidden = (message = 'You do not have access to this') => new HttpError(403, 'forbidden', message);

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.output<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const fields = Object.fromEntries(r.error.issues.map((i) => [i.path.join('.') || '_', i.message]));
    throw new HttpError(422, 'validation', 'Please check the highlighted fields', { fields });
  }
  return r.data;
}

export async function readJson<T extends z.ZodType>(c: Context, schema: T): Promise<z.output<T>> {
  let body: unknown;
  try { body = await c.req.json(); } catch { throw badRequest('Request body must be JSON'); }
  return parse(schema, body);
}

export function errorResponse(err: unknown, c: Context) {
  if (err instanceof HttpError) {
    return c.json({ error: { code: err.code, message: err.message, details: err.details } }, err.status);
  }
  console.error('unhandled', err);
  return c.json({ error: { code: 'internal', message: 'Something went wrong. Please try again.' } }, 500);
}
