# Releasing to a client account

Everything runs in the **client's** Cloudflare account. We deploy with a **scoped API token** the client creates and can revoke at any time.

## 1. Token the client creates (once)

Cloudflare dashboard → My Profile → API Tokens → Create custom token, scoped to the client's account and zone:

| Permission | Level |
|---|---|
| Account · Workers Scripts | Edit |
| Account · D1 | Edit |
| Account · Workers R2 Storage | Edit |
| Account · Account Settings | Read |
| Zone · Workers Routes | Edit (their domain only) |
| Zone · DNS | Read (their domain only) |

They send it to us over a password manager share, never chat or email. Revoking it ends our access (documented in the access sheet at handover).

## 2. Provision (once per client)

```sh
cp clients/femia.example.json clients/femia.json   # fill accountId + domains
CLOUDFLARE_API_TOKEN=… npm run provision clients/femia.json
```

Creates D1 + R2, sets `SECRETS_KEY` (generated, never stored on disk). Then set `RESEND_API_KEY` and `TELEGRAM_BOT_TOKEN` as printed.

**Cloudflare Access** (Zero Trust → Access → Applications): self-hosted app for `admin.<domain>` **and** path `api.<domain>/admin/*`, login method *One-time PIN*, allow the owner's and staff emails. Put the application **AUD tag** in `clients/femia.json` → `access.aud`.

## 3. Deploy

```sh
CLOUDFLARE_API_TOKEN=… npm run deploy clients/femia.json            # typecheck + tests, then api → storefront → admin
CLOUDFLARE_API_TOKEN=… npm run deploy clients/femia.json -- --only=storefront
```

Each Worker version is tagged `<package version>+<git sha>`. D1 migrations apply first; the storefront manifest is registered for Admin.

## 4. Roll back

```sh
CLOUDFLARE_API_TOKEN=… npm run rollback clients/femia.json
```

Returns each Worker to its previous version. Data is untouched (migrations are additive-only).

## 5. Backups

Nightly cron writes `backups/YYYY-MM-DD.json.gz` to the client's R2 bucket. Restore into an empty, migrated database:

```sh
npx wrangler r2 object get femia-media/backups/2026-12-01.json.gz --file b.json.gz -c apps/api/wrangler.femia.json
node tools/restore-backup.mjs b.json.gz > restore.sql
npx wrangler d1 execute DB --remote --file restore.sql -c apps/api/wrangler.femia.json
```

The restore must be **tested before launch** (definition of done §8).
