import type {
  CartQuoteRequest, Category, CheckoutRequest, CheckoutResult, Collection, MediaRef, ProductDetail, ProductList, ProductListQuery,
  PublicOrder, PublicSettings, Quote, TrackRequest, AnalyticsEvent,
} from '@femia/contracts';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: any) { super(message); }
  get fields(): Record<string, string> { return this.details?.fields ?? {}; }
}

export interface ClientOptions {
  /** e.g. "https://api.femia.in" or "" for same-origin. */
  baseUrl?: string;
  /** Service-binding fetcher on the server (env.API.fetch) or window.fetch in the browser. */
  fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  headers?: Record<string, string>;
}

export interface PublishedContent { version: number; publishedAt: string; data: Record<string, any>; media: Record<string, MediaRef> }

function qs(params: Record<string, unknown>) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) { if (v.length) sp.set(k, v.join(',')); } else sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export function createClient(opts: ClientOptions = {}) {
  const base = (opts.baseUrl ?? '').replace(/\/$/, '');
  const f = opts.fetch ?? ((i, init) => fetch(i, init));

  async function req<T>(method: string, path: string, body?: unknown, init?: RequestInit): Promise<T> {
    const res = await f(`${base}${path}`, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), Accept: 'application/json', ...opts.headers },
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
      ...init,
    });
    if (res.status === 204) return undefined as T;
    const data = await res.json().catch(() => null) as any;
    if (!res.ok) throw new ApiError(res.status, data?.error?.code ?? 'http_error', data?.error?.message ?? `Request failed (${res.status})`, data?.error?.details);
    return data as T;
  }

  return {
    request: req,
    catalog: {
      categories: () => req<Category[]>('GET', '/catalog/categories'),
      collections: (kind?: 'collection' | 'occasion') => req<Collection[]>('GET', `/catalog/collections${qs({ kind })}`),
      products: (q: ProductListQuery = {}) => req<ProductList>('GET', `/catalog/products${qs(q as Record<string, unknown>)}`),
      product: (slug: string) => req<ProductDetail>('GET', `/catalog/products/${encodeURIComponent(slug)}`),
      productStock: (slug: string) => req<Record<string, number>>('GET', `/catalog/products/${encodeURIComponent(slug)}/stock`),
      stock: (variantIds: string[]) => req<Record<string, number>>('GET', `/catalog/stock${qs({ variantIds })}`),
    },
    cart: {
      quote: (body: CartQuoteRequest) => req<Quote>('POST', '/cart/quote', body),
      checkPincode: (pincode: string) => req<{ ok: boolean; state: string | null; message: string }>('POST', '/checkout/pincode', { pincode }),
    },
    orders: {
      create: (body: CheckoutRequest) => req<CheckoutResult>('POST', '/orders', body),
      get: (number: string, token: string) => req<PublicOrder>('GET', `/orders/${encodeURIComponent(number)}${qs({ token })}`),
      track: (body: TrackRequest) => req<PublicOrder>('POST', '/orders/track', body),
      gatewayReturn: (provider: string, body: { number: string; token: string; params: Record<string, string> }) =>
        req<PublicOrder>('POST', `/payments/${provider}/return`, body),
    },
    content: { published: () => req<PublishedContent | null>('GET', '/content/published') },
    settings: { public: () => req<PublicSettings>('GET', '/settings/public') },
    newsletter: { subscribe: (email: string, source = 'footer') => req<{ ok: true }>('POST', '/newsletter', { email, source }) },
    events: { send: (events: AnalyticsEvent[]) => req<void>('POST', '/events', { events }) },
  };
}

export type FemiaClient = ReturnType<typeof createClient>;
