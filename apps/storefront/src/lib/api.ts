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
