# Femia platform · Release 1.0

Storefront (client-owned) + Admin Studio + Prompt Studio Lite + Core API, on Cloudflare's free tier in the client's account.
Plan and decisions: [docs/PLAN.md](docs/PLAN.md) · Release runbook: [docs/RELEASE.md](docs/RELEASE.md)

## Run it locally

```sh
npm install
npm run seed          # (stop dev:api first) local D1 + R2 with the DEV catalogue (placeholder photos cropped from the mockups)
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

## Storefront scripts (client router)

The storefront navigates in place (Astro `ClientRouter`), so `<script>` modules run **once**. Anything that touches page content must use `onPage()` from `src/lib/lifecycle.ts`: it runs on every page and takes a cleanup that runs before the next swap. Header, footer, announcement bar, tab bar and the cart shell are persisted (`transition:persist`). Pages that send `Cache-Control: … s-maxage` are cached at the edge by `src/middleware.ts`; personal pages must send `no-store`.

## Deploying

Each Cloudflare account is a profile in `clients/` (gitignored). `clients/personal.json` is your test account (staging, `*.workers.dev`). See [docs/RELEASE.md](docs/RELEASE.md):
`npm run provision clients/personal.json` → `npm run data -- copy local clients/personal.json` → `npm run deploy clients/personal.json`. Moving to another account later: `npm run client:new <name> -- --from=personal`, provision, `npm run data -- copy`, deploy.

## Accounts and sign-in

- **Admin** (`localhost:5173`): sign in with password + a 6-digit code. Locally every code is `123456` until `RESEND_API_KEY` is set. New sign-ups appear under **Team** for approval; invited people are approved already. The local test owner login is in `apps/api/.dev.vars.example`.
- **Shoppers** (`localhost:4321/account`): email + code (also `123456` locally). The account shows current and previous orders, offers used, saved addresses and their details; checkout fills itself in when signed in.
- **Admin → Customers** shows every shopper account with its orders, offers used and addresses.
- API tests act as the owner through `DEV_AUTH_BYPASS` (set only in `vitest.config.ts`).

## Razorpay (online payments)

- Keys live in `apps/api/.dev.vars` locally (`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`) and in `clients/femia.secrets.env` for deploys; both are gitignored. `npm run deploy` pushes the deploy copy as Cloudflare Worker secrets (`npm run secrets` does it on its own).
- Switch it on in Admin → Settings → Payments ("Online payments via Razorpay"). Admin shows whether the keys are in test or live mode.
- Payments are confirmed three ways: the signed browser return, signed webhooks, and a 5-minute check with Razorpay's API (also run before any hold is released, from the order page's "Complete your payment" button and Admin's "Check payment with Razorpay"). Authorised payments are captured for the exact order amount.
- **Cancelling and refunds**: shoppers can cancel from their order page until it's packed; paid orders refund automatically (Razorpay back to the original method; UPI/cash orders become a "to send" refund the owner marks sent with the UTR). Store cancellations refund the same way, owners can refund part or all of an order (returns), failed refunds can be retried, and refund status follows Razorpay's `refund.*` webhooks plus a 5-minute check. Add the `refund.processed` and `refund.failed` events to the Razorpay webhook.
- Webhooks can't reach your laptop; locally the order page and Admin check confirm payments instead.

## Festive themes

Owners switch seasonal decorations on in Admin → Festive themes (now, or between dates). Six themes: Christmas,
Ramzan & Eid al-Fitr (`ramzan`), Bakrid, Onam, Vishu, and India's national days (`india`: Republic Day and
Independence Day); one is on at a time, and it decorates the home page only. The storefront marks the live theme on `<html data-festive>` and
loads `apps/storefront/src/festive/<id>/` only while it's on. Preview any theme without switching it on: add
`?festive=ramzan` to a page (`?festive=live` to leave, `?festive-day=1` to see the festival-day greeting).

Every theme is built from the shared kit (`src/festive/kit.ts` + `kit.css`): a strip along the header with ornaments
hanging from its pins, a seal on the home page, sparkle, and details (announcement bar colour, a footer hem, the
motif in place of the gold diamonds). A theme folder only declares its layout, options and colours.
Artwork for all themes is generated by `node tools/festive/art.mjs` into `public/festive/<id>/` (storefront and admin).
To use your own artwork, replace those files keeping the names (`strip.svg`, `hem.svg`, `mark.svg`, `seal.svg` and the
ornaments named in the theme's `index.ts`).

To add a festival: add its id and options to `FestiveSettings` in `packages/contracts/src/settings.ts`, draw its
artwork in `tools/festive/art.mjs`, create `src/festive/<id>/index.ts` and register it in `src/festive/index.ts`, and
add it to `THEMES` in `apps/admin/src/pages/Festive.tsx`.

## Rules that keep 1.1 additive

- Money is integer paise; the server recomputes every price.
- Stock only changes through `services/stock.ts` (ledger row for every change; DB CHECK prevents overselling).
- D1 migrations are additive only (new tables/columns), so code rollback is always safe.
- Every UI string lives in `packages/i18n/src/en.json`.
- New gateway = one file implementing `PaymentProvider` + register in `src/payments/index.ts`.
