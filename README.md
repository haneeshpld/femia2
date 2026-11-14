# Femia platform · Release 1.0

Storefront (client-owned) + Admin Studio + Prompt Studio Lite + Core API, on Cloudflare's free tier in the client's account.
Plan and decisions: [docs/PLAN.md](docs/PLAN.md) · Release runbook: [docs/RELEASE.md](docs/RELEASE.md)

## Run it locally

```sh
npm install
npm run seed          # local D1 + R2 with the DEV catalogue (placeholder photos cropped from the mockups)
npm run dev:api       # Core API      http://localhost:8787
npm run dev:store     # Storefront    http://localhost:4321
npm run dev:admin     # Admin Studio  http://localhost:5173  (signed in as owner@femia.local)
```

Admin as staff: send header `X-Dev-User: staff@femia.local` (dev only), or change `DEV_ADMIN_EMAIL` in `apps/api/.dev.vars`.
Emails and Telegram alerts are logged to the API console until `RESEND_API_KEY` / `TELEGRAM_BOT_TOKEN` are set.

## Layout

| Path | What |
|---|---|
| `apps/api` | Hono Worker · D1 schema (`migrations/`) · payments (`src/payments`) · notifications · cron |
| `apps/storefront` | Astro 7 SSR + React islands · GSAP/Lenis · `site.manifest.json` |
| `apps/admin` | React PWA: products wizard, stock, orders, homepage editor, photos, Prompt Studio Lite, settings, people |
| `packages/contracts` | Zod schemas, pricing, shipping rules, permissions (`/money` entry is zod-free for browsers) |
| `packages/sdk` · `tokens` · `i18n` | typed API client · design tokens → CSS · English strings |
| `tools/seed` · `tools/release` | dev seed · provision / deploy / rollback into a client account |

## Checks

```sh
npm run typecheck && npm test && npm run build
```

API tests run inside the Workers runtime (`@cloudflare/vitest-plugin`) and cover the money paths: last-unit race,
hold expiry, UPI mark-paid, gateway success / failure / abandoned with signed webhooks, pincode blocking, staff permissions.

## Rules that keep 1.1 additive

- Money is integer paise; the server recomputes every price.
- Stock only changes through `services/stock.ts` (ledger row for every change; DB CHECK prevents overselling).
- D1 migrations are additive only (new tables/columns), so code rollback is always safe.
- Every UI string lives in `packages/i18n/src/en.json`.
- New gateway = one file implementing `PaymentProvider` + register in `src/payments/index.ts`.
