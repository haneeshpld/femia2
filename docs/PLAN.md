# Femia Release 1.0: Build Plan

Engineering companion to *Femia Release 1.0 Initial Delivery* (15 Nov 2026).
That document says **what** ships. This one says **how** it is built, and in what order.

Status legend: ☐ not started · ◐ in progress · ☑ done

---

## 1. Architecture at a glance

```
                ┌──────────────────────── client's Cloudflare account ───────────────────────┐
 customer ──▶   │  storefront (Astro SSR on Workers) ──service binding──▶  api (Hono Worker) │
                │        │  static assets, fonts                             │   │    │      │
 owner/staff ─▶ │  admin (React PWA on Workers assets) ── Cloudflare Access ─▶│   │    │      │
                │                                                     D1 ◀──┘   R2   Cron   │
                └─────────────────────────────────────────────────────────────────────────────┘
                     external: payment gateway (1 adapter) · Resend (email) · Telegram Bot API
```

| Piece | Tech | Why |
|---|---|---|
| **Storefront** (client-owned) | Astro 7 SSR on Cloudflare Workers, **React 19 islands** only where interactive (cart, size sheet, checkout, filters, search), GSAP + Lenis. Any React library can drop in as an island later | Zero-JS by default, so Lighthouse ≥ 90 is achievable on low-end Android |
| **Admin Studio + Prompt Studio Lite** (ours) | React 19 + Vite SPA, installable PWA, TanStack Query | Phone-first app feel; served as static assets behind Cloudflare Access |
| **Core API** (ours) | Hono on Workers, D1 (SQLite), R2, Cron Triggers | Free tier, one deploy unit, typed end to end |
| **Motion** | GSAP + ScrollTrigger + Lenis on plain DOM; React islands hydrate `client:visible` so heavy effects load only where used | Rich animation without paying for it on every page |
| **Contracts** | Zod 4 schemas → inferred TS types, shared by API, SDK, admin, storefront | "Contracts first": one source of truth |
| **SDK** | Tiny typed `fetch` client generated from the contracts | Storefront calls the API via service binding with the same SDK |
| **Tokens** | `packages/tokens` → CSS custom properties + TS | One palette for storefront, admin, emails, OG images |
| **Manifest** | `apps/storefront/site.manifest.json` validated by `contracts/manifest` | Admin content forms are generated from it; the 1.1 page builder reads the same file |

### Monorepo layout

```
apps/
  api/            Hono worker · D1 migrations · cron · payment adapters · notifications
  storefront/     Astro · site.manifest.json · Preact islands
  admin/          React PWA · Admin Studio · Prompt Studio Lite
packages/
  contracts/      Zod schemas, money, pricing (cart quote), pincode rules, permissions
  sdk/            typed API client
  tokens/         design tokens → CSS vars
  i18n/           en.json string keys (ml.json lands in 1.1)
tools/            seed data, image pipeline, release scripts
design/reference/ approved mockups + logo source files
```

Storefront is the part transferred to the client's GitHub at handover. It consumes `@femia/contracts`, `@femia/sdk`, `@femia/tokens`, `@femia/i18n` as versioned packages (published to a private GitHub Packages registry at release time). Inside this repo they're workspace links.

---

## 2. Key technical decisions

1. **Money is integer paise everywhere.** `₹1,299` is stored as `129900`. Formatting only happens at the edge (`formatINR`).
2. **The server recomputes every price.** The client sends `{variantId, qty}[]` only. `POST /cart/quote` and `POST /orders` both run the same `quoteCart()` from `contracts/pricing`, using DB prices.
3. **Atomic stock holds with a DB constraint.** `variants` carries `on_hand` and `reserved` with `CHECK (reserved <= on_hand)`. Placing an order runs one D1 `batch()` that increments `reserved`. If any line would oversell, the CHECK fails and the **whole batch rolls back**, so two people can't buy the last unit (acceptance test 3).
   - Gateway orders: 30-minute hold; cron releases expired holds.
   - Manual UPI: hold for `upiHoldHours` (setting, default 12 h) so staff have time to verify.
   - COD / WhatsApp / manual orders: committed immediately (`on_hand -= qty`).
   - Every change writes a row to `stock_ledger` (`reason`: restock, sale, adjustment, damage, return, hold, release). Store Counter in 1.1 only adds reasons.
4. **Generic variants.** `option1` / `option2` with labels from the manifest (`Size` / `Colour` for Femia), so the platform serves non-fashion clients unchanged.
5. **Photos per colour.** `product_media.option2_value` links a photo to a colour; the colour swatch swaps the gallery.
6. **Images.** Admin compresses and crops in the browser to the slot's aspect (3:4 product, arch tiles, etc.) and uploads **3 WebP sizes** (480 / 960 / 1600 w) to R2. The API serves `/media/:key` with immutable caching. No paid image resizing.
7. **Auth.** Cloudflare Access (email one-time code) protects `admin.*` and `/admin/*` API routes. The API verifies the `Cf-Access-Jwt-Assertion` JWT and maps the email to `users → roles → permissions`. Local dev uses `DEV_ADMIN_EMAIL`.
8. **Roles table supports any role**; 1.0 seeds `owner` (all) and `staff` (catalog, stock, orders, media, content; no `settings.*`, no `payments.keys`).
9. **Payments.** `PaymentProvider` interface (`createIntent`, `verifyWebhook`, `fetchStatus`). 1.0 ships `manual-upi` + **one gateway adapter (Razorpay first; swap for the client's choice)**. Keys are stored encrypted (AES-GCM, key in a Worker secret) so the gateway is switched on from Settings without a redeploy.
10. **Content publishing.** `content_versions` holds the full homepage/content JSON per version. Draft → Preview → Publish creates a new immutable version, and Undo re-publishes the previous one. The storefront reads the published version (cached 60 s).
11. **Ship-to check.** Kerala = pincodes 670000–695999 excluding Lakshadweep (682551–682559). Rules live in `contracts/shipping` and are driven by the `shipToStates` setting, so interstate in 1.1 = setting + rule table.
12. **Email**: `EmailProvider` interface, Resend adapter (free tier: 100/day, 3,000/month). **Owner alerts**: Telegram Bot API (free).
13. **Analytics events** (`view_item`, `add_to_bag`, `begin_checkout`, `purchase`) are written to D1 from launch via `POST /events` (sendBeacon).
14. **i18n.** Every UI string is a key in `packages/i18n/en.json`. Malayalam in 1.1 means adding a translations file, nothing else.

---

## 3. Data model (D1)

`categories` · `collections` (+ `kind`: collection | occasion) · `products` · `product_options` (values, swatch hex, sort) · `variants` (sku, option1, option2, price override, on_hand, reserved, low_stock_threshold) · `product_collections` · `media` · `product_media` · `media_usages` · `stock_ledger` · `stock_holds` · `orders` · `order_items` · `order_events` · `payments` · `content_versions` · `settings` · `secrets` · `users` · `roles` · `audit_log` · `newsletter_subscribers` · `analytics_events` · `counters`

Schema: `apps/api/migrations/0001_init.sql`.

---

## 4. API surface (v1)

Public (storefront):
`GET /catalog/categories` · `GET /catalog/collections` · `GET /catalog/products?category&collection&size&colour&fabric&min&max&sort&page&q` · `GET /catalog/products/:slug` · `GET /catalog/stock?variantIds=` · `POST /cart/quote` · `POST /checkout/pincode` · `POST /orders` · `POST /orders/track` · `POST /newsletter` · `GET /content/published` · `GET /settings/public` · `POST /events` · `GET /media/*` · `POST /payments/webhook/:provider`

Admin (`/admin/*`, Access JWT + permission check):
dashboard · products CRUD + publish/archive/duplicate · variants matrix · stock adjust + history · media upload / alt / usages · orders list, detail, status transitions, manual order, mark UPI paid, bill + packing slip · content draft / preview / publish / undo · settings · users and roles · audit log

Cron: `*/5 * * * *` release expired holds · `30 3 * * *` (09:00 IST) daily summary + low-stock check · `30 21 * * *` nightly D1 → R2 backup.

---

## 5. Build order (maps to the 4-week schedule)

### Week 1: Foundations
- ☑ Plan, repo, workspaces, TS config
- ☑ `contracts`: Zod schemas, money, pricing, shipping rules, permissions
- ☑ `tokens` from the approved mockups; `i18n` en keys
- ☑ `site.manifest.json` v1 + schema
- ☑ D1 schema + seed (dev catalogue built from mockup crops; **replaced by real content before launch**)
- ☑ API: catalog, stock, media, cart quote, auth middleware, settings/public, content/published (+ orders, payments, admin, cron)
- ☑ Unit tests: pricing, stock hold atomicity, pincode rules (30 tests; API tests run in the Workers runtime)
- ☑ CI (typecheck, test, build) + release pipeline (wrangler deploy with scoped token, versioned, rollback). Not yet run against a real account

### Week 2: Core screens
- ☑ Storefront: layout, header/announcement/footer, Home (all sections), Shop (tabs, filters, sort, pagination, empty state), Product (gallery, colour swap, size picker, size chart, related), Collections, Visit Us, About, Policies, 404, cart drawer, wishlist, search
- ☑ Admin: shell + PWA, product wizard (5 steps), variant matrix, photos per colour, stock screen, media library

### Week 3: Selling
- ☑ Checkout (one page, guest, pincode check, payment choice), order confirmation
- ☑ Orders: create (all 4 methods), holds, gateway adapter + webhook, manual UPI + "Mark paid", COD toggle and limit, WhatsApp pre-fill
- ☑ Track page, emails (4 templates), Telegram alerts, daily summary
- ☑ Admin: orders board, bill + packing slip, content forms from the manifest + preview/publish/undo, settings, people, dashboard
- ☑ Prompt Studio Lite

### Week 4: Polish and launch
- ◐ Motion pass (GSAP/Lenis, reduced motion), skeleton/empty/error/success states everywhere
- ☐ a11y + Lighthouse + device testing; Playwright e2e for all §8 flows and §9 acceptance tests
- ☐ Real content load, owner training, go-live

---

## 6. Open items that need the client

| Item | Default until confirmed |
|---|---|
| Payment gateway | Razorpay adapter built first (interface makes the swap a new file) |
| Flat shipping fee below ₹999 | ₹79 |
| COD order limit | ₹5,000, COD on |
| UPI hold window | 12 h |
| Courier | free-text courier name + tracking URL template |
| Email sender domain | `orders@<client domain>` via Resend (needs DNS records) |
| Mockup typefaces | Cormorant Garamond (display) + DM Sans (body), self-hosted; swap if the designer specifies others |
| `FEMIA10` code in the mockup's announcement bar | Coupons are 1.1, so 1.0 announcement copy must not promise a code |
| Logo | Emblem + wordmark recreated as clean vectors (source PNGs have a glow halo and a black matte) |

---

## 7. Decision log

| Date | Decision |
|---|---|
| 15 Nov 2026 | Storefront stays on **Astro** (not Next.js): free-tier Worker size limits and Lighthouse ≥ 90 on low-end Android. Interactive islands use **React 19** (not Preact) so any React library works later. |
| 15 Nov 2026 | Animation = **GSAP + ScrollTrigger + Lenis**, plus Astro view transitions between pages. **No React Three Fiber**: the 1.1 silk ribbon becomes a GSAP-animated layered image instead of real-time 3D. |

---

## 8. Open follow-ups (found while building)

| # | Item | When |
|---|---|---|
| 1 | Visual QA against the mockups at 360/390/430/768/1280/1440 (web analysis pass) | Week 4, next session |
| 2 | Hydrate the storefront React shell on first interaction instead of idle (React DOM is ~65 KB gz) to protect TBT on low-end Android | Week 4 perf pass |
| 3 | Playwright e2e for browse → bag → checkout (each method), add product, update stock, publish content | Week 4 |
| 4 | Gateway "retry payment" button on the order page when the customer dismisses the payment window | Week 4 |
| 5 | ~~Categories and collections editing in Admin~~ Done: Catalog setup page + inline "+ New" everywhere (15 Nov) | Done |
| 6 | Real photos, copy and policies (seed content is placeholder, policies marked DRAFT) | Client, Week 2–3 |
| 7 | Default OG image (`/og-default.jpg`) and on-brand email header image | Week 4 |
| 8 | Rate limiting on `/orders/track` and `/newsletter` (Cloudflare WAF rate-limit rule, free tier) | Go-live checklist |
| 9 | Icon set is duplicated in storefront and admin: move to a shared package | Cleanup |
