-- Accounts: shopper accounts (email + code), admin sign-in (password + code, approved by another admin),
-- sessions, one-time codes and rate limits.

-- ── shoppers ──
CREATE TABLE customers (
  id                TEXT PRIMARY KEY,
  email             TEXT NOT NULL UNIQUE,          -- lower case, verified by code
  name              TEXT NOT NULL,
  phone             TEXT NOT NULL DEFAULT '',      -- 10 digits
  email_verified_at TEXT NOT NULL,
  marketing         INTEGER NOT NULL DEFAULT 0,
  disabled          INTEGER NOT NULL DEFAULT 0,
  last_login_at     TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX customers_phone ON customers(phone);

CREATE TABLE customer_addresses (
  id          TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  label       TEXT NOT NULL DEFAULT '',            -- Home, Work…
  name        TEXT NOT NULL,
  phone       TEXT NOT NULL,
  line1       TEXT NOT NULL,
  line2       TEXT NOT NULL DEFAULT '',
  landmark    TEXT NOT NULL DEFAULT '',
  city        TEXT NOT NULL,
  state       TEXT NOT NULL DEFAULT 'Kerala',
  pincode     TEXT NOT NULL,
  is_default  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX customer_addresses_customer ON customer_addresses(customer_id);

ALTER TABLE orders ADD COLUMN customer_id TEXT REFERENCES customers(id);
CREATE INDEX orders_customer ON orders(customer_id, created_at DESC);
CREATE INDEX orders_email ON orders(email);
ALTER TABLE order_discounts ADD COLUMN customer_id TEXT;
CREATE INDEX order_discounts_customer ON order_discounts(offer_id, customer_id);

-- ── admin team ──
ALTER TABLE users ADD COLUMN password_hash TEXT;
-- invited (added by an admin, pre-approved) · pending (signed up, waiting for approval) · active · disabled · rejected
ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE users ADD COLUMN email_verified_at TEXT;
ALTER TABLE users ADD COLUMN approved_by TEXT;
ALTER TABLE users ADD COLUMN approved_at TEXT;
ALTER TABLE users ADD COLUMN failed_logins INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN locked_until TEXT;
ALTER TABLE users ADD COLUMN password_changed_at TEXT;
ALTER TABLE users ADD COLUMN last_login_at TEXT;
UPDATE users SET status = CASE WHEN active = 1 THEN 'active' ELSE 'disabled' END;

-- Sign-ups wait here until the email is verified (the password is never stored before that).
CREATE TABLE admin_signups (
  email         TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ── sessions (token kept only as a SHA-256 hash) ──
CREATE TABLE sessions (
  id           TEXT PRIMARY KEY,                   -- sha256(token)
  kind         TEXT NOT NULL CHECK (kind IN ('customer','admin')),
  subject_id   TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  revoked_at   TEXT,
  ip           TEXT NOT NULL DEFAULT '',
  user_agent   TEXT NOT NULL DEFAULT ''
);
CREATE INDEX sessions_subject ON sessions(kind, subject_id);

-- ── one-time codes (stored as an HMAC, never in plain text) ──
CREATE TABLE otp_codes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  purpose     TEXT NOT NULL,
  email       TEXT NOT NULL,
  code_hash   TEXT NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  expires_at  TEXT NOT NULL,
  consumed_at TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX otp_codes_lookup ON otp_codes(purpose, email, id DESC);

CREATE TABLE rate_limits (
  key      TEXT PRIMARY KEY,
  count    INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);
