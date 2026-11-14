interface Env {
  API?: Fetcher;
  API_ORIGIN?: string;
  PUBLIC_SITE_URL: string;
  ASSETS: Fetcher;
}
declare namespace Cloudflare { interface Env extends globalThis.Env {} }
