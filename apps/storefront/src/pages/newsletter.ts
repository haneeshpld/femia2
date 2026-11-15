import type { APIRoute } from 'astro';
import { apiFor } from '../lib/api.ts';

/** No-JS fallback for the newsletter form. */
export const POST: APIRoute = async ({ request, redirect }) => {
  const form = await request.formData();
  const back = new URL(request.headers.get('referer') ?? '/', request.url);
  try { await apiFor(request).newsletter.subscribe(String(form.get('email') ?? ''), 'footer'); back.searchParams.set('subscribed', '1'); }
  catch { back.searchParams.set('subscribed', '0'); }
  return redirect(back.pathname + back.search + '#nl-title', 303);
};
