# Releasing to a Cloudflare account

Each Cloudflare account Femia runs in is a **client**: `clients/<name>.json` (settings) + `clients/<name>.secrets.env` (secrets). Both are gitignored. Your personal test account and the shop's real account are simply two clients, so moving later is four commands and no code changes.

## Quick start: your personal test account

1. **API token** (Cloudflare → My Profile → API Tokens → Create custom token, your account): Workers Scripts Edit, D1 Edit, Workers R2 Storage Edit, Account Settings Read. Then `export CLOUDFLARE_API_TOKEN=…` in your terminal.
2. **Profile**: `clients/personal.json` already exists (staging, `*.workers.dev`, hidden from search engines), with `clients/personal.secrets.env` holding the Razorpay test keys and a fixed sign-in code for the test site.
3. `npm run provision clients/personal.json`: finds your account and workers.dev subdomain, creates the database and photo storage, and adds the master key to the secrets file if it isn't there.
4. `npm run data -- copy local clients/personal.json` (optional): your local products, photos, orders, customers, offers and team, plus your local master key so your Admin password keeps working.
5. `npm run deploy clients/personal.json`: runs the tests, deploys API, shop and Admin, pushes the secrets, and prints the three addresses and the Razorpay webhook URL.

Without Resend, sign-in codes on the test site are the `FIXED_OTP_CODE` in `clients/personal.secrets.env`.

## Moving to another account (e.g. the shop's real one)

```sh
npm run client:new femia -- --production --from=personal --token-env=CF_TOKEN_FEMIA   # copies the secrets, incl. the master key
# edit clients/femia.json: custom domains (optional), email.from; edit clients/femia.secrets.env: live keys, OWNER_EMAIL, RESEND_API_KEY
export CF_TOKEN_FEMIA=…            # token for the new account (your personal one stays in CLOUDFLARE_API_TOKEN)
npm run provision clients/femia.json
npm run data -- copy clients/personal.json clients/femia.json   # database + photos, account to account
npm run deploy clients/femia.json
```

Then point Razorpay's webhook at the new API address and remove the old deployment if you like. `npm run data -- export <client>` makes a backup folder (database, photos and master key: keep it private); `npm run data -- import <folder> <client>` restores one. Importing over an account that already has products or orders needs `--replace` and asks you to type the account's name.

**The master key (`SECRETS_KEY`) belongs to the data.** It peppers Admin passwords and encrypts gateway keys saved in Admin, so it always travels with `data copy`; never change it on a live shop.

**Custom domains**: set `domains.store`, `domains.admin`, `domains.api` in the client file (the domain must be a zone in that account; add the token permissions Zone · Workers Routes Edit and Zone · DNS Read). Leave them empty to use `*.workers.dev`.

## Token permissions

| Permission | Level |
|---|---|
| Account · Workers Scripts | Edit |
| Account · D1 | Edit |
| Account · Workers R2 Storage | Edit |
| Account · Account Settings | Read |
| Zone · Workers Routes | Edit (custom domains only) |
| Zone · DNS | Read (custom domains only) |

For a client's own account, they create the token and share it through a password manager, never chat or email. Revoking it ends our access.

## Secrets

**Worker secrets: one file, pushed on every deploy.** Copy `clients/femia.secrets.example.env` to `clients/femia.secrets.env` (gitignored) and fill it in. `npm run deploy` uploads it with `wrangler secret bulk` (values never printed or kept on disk elsewhere) and stops if a required secret is missing. To push or check on their own:

```sh
CLOUDFLARE_API_TOKEN=… npm run secrets clients/femia.json            # push, then list what's set
CLOUDFLARE_API_TOKEN=… npm run secrets clients/femia.json -- --check # names only, what's missing
```

**Razorpay**: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` (Razorpay → Settings → API keys; `rzp_test_…` until KYC, then `rzp_live_…`) and `RAZORPAY_WEBHOOK_SECRET`. In Razorpay → Settings → Webhooks add `https://<api domain>/payments/webhook/razorpay` with the events `payment.captured`, `payment.failed`, `order.paid`, `refund.processed`, `refund.failed`, and paste the same webhook secret. Secrets win over keys typed in Admin → Settings. Even without webhooks, the API checks pending online payments with Razorpay every 5 minutes and before releasing any hold, so a paid order is never cancelled.

**Sign-in secrets** (on the API Worker):
- `OWNER_EMAIL`: the owner's email. The first Admin sign-up with it becomes the owner; everyone else waits for an admin's approval (or is invited).
- `RESEND_API_KEY`: sends the 6-digit codes. **Shopper sign-in stays off until it's set.** Guest checkout still works.
- Optional, temporary: `FIXED_OTP_CODE` (six digits the owner chooses). It lets the Admin team sign in with password + that code before Resend is ready. It never works for shopper accounts. Delete it once Resend works.
- Never set `DEV_AUTH_BYPASS` on a deployed Worker (tests only, and ignored outside development anyway).

Cloudflare Access is no longer needed; Admin has its own sign-in (password + emailed code, new accounts approved by an admin).

## Deploy

```sh
CLOUDFLARE_API_TOKEN=… npm run deploy clients/femia.json            # typecheck + tests, then api → storefront → admin
CLOUDFLARE_API_TOKEN=… npm run deploy clients/femia.json -- --only=storefront
```

Each Worker version is tagged `<package version>+<git sha>`. D1 migrations apply first; the storefront manifest is registered for Admin.

## Roll back

```sh
CLOUDFLARE_API_TOKEN=… npm run rollback clients/femia.json
```

Returns each Worker to its previous version. Data is untouched (migrations are additive-only).

## Backups

Nightly cron writes `backups/YYYY-MM-DD.json.gz` to the client's R2 bucket. Restore into an empty, migrated database:

```sh
npx wrangler r2 object get femia-media/backups/2026-12-01.json.gz --file b.json.gz -c apps/api/wrangler.femia.json
node tools/restore-backup.mjs b.json.gz > restore.sql
npx wrangler d1 execute DB --remote --file restore.sql -c apps/api/wrangler.femia.json
```

The restore must be **tested before launch** (definition of done §8).
