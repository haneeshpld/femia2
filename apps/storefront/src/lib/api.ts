import { env } from 'cloudflare:workers';
import { createClient, type FemiaClient } from '@femia/sdk';

/**
 * Forward a request to the Core API: service binding in production; plain HTTP when API_ORIGIN is set
 * (local dev only, via .dev.vars, so production never has a public fallback).
 */
export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const e = env as unknown as Env;
  if (e.API_ORIGIN) return fetch(`${e.API_ORIGIN}${path}`, init);
  if (!e.API) throw new Error('API service binding missing');
  return e.API.fetch(new Request(`https://api.internal${path}`, init));
}

let client: FemiaClient | undefined;
export function api(): FemiaClient {
  client ??= createClient({ fetch: (input, init) => apiFetch(String(input), init) });
  return client;
}

/**
 * A client for calls made on a shopper's behalf from the server (track an order, the no-JS newsletter form). It
 * passes on the shopper's IP so the API's per-visitor limits apply to them, not to the storefront as a whole.
 */
export function apiFor(request: Request): FemiaClient {
  const ip = request.headers.get('cf-connecting-ip');
  return createClient({ fetch: (input, init) => apiFetch(String(input), init), headers: ip ? { 'cf-connecting-ip': ip } : {} });
}
