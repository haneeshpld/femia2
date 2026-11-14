-- Femia Core API · schema v1
-- Money columns are INTEGER paise. Timestamps are ISO-8601 UTC text.

PRAGMA foreign_keys = ON;

CREATE TABLE media (
  id            TEXT PRIMARY KEY,
  key_base      TEXT NOT NULL,              -- R2 prefix; files at {key_base}/{width}.webp
  width         INTEGER NOT NULL,
  height        INTEGER NOT NULL,
  sizes         TEXT NOT NULL DEFAULT '[480,960,1600]',
  alt           TEXT NOT NULL DEFAULT '',
  placeholder   TEXT,                       -- dominant colour or tiny data URI
  bytes         INTEGER NOT NULL DEFAULT 0,
  created_by    TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE categories (
  id         TEXT PRIMARY KEY,
  slug       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  sort       INTEGER NOT NULL DEFAULT 0,
  image_id   TEXT REFERENCES media(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE collections (
  id          TEXT PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'collection' CHECK (kind IN ('collection','occasion')),
  description TEXT NOT NULL DEFAULT '',
  sort        INTEGER NOT NULL DEFAULT 0,
  image_id    TEXT REFERENCES media(id),
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE products (
  id               TEXT PRIMARY KEY,
  slug             TEXT NOT NULL UNIQUE,
  title            TEXT NOT NULL,
  description      TEXT NOT NULL DEFAULT '',
  category_id      TEXT NOT NULL REFERENCES categories(id),
  fabric           TEXT NOT NULL DEFAULT '',
  care             TEXT NOT NULL DEFAULT '',
  size_chart       TEXT,                    -- markdown table, null = use store default
  status           TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','archived')),
  option1_name     TEXT NOT NULL DEFAULT 'Size',
  option2_name     TEXT NOT NULL DEFAULT 'Colour',
  price            INTEGER NOT NULL CHECK (price >= 0),
  compare_at_price INTEGER CHECK (compare_at_price IS NULL OR compare_at_price >= 0),
  seo_title        TEXT NOT NULL DEFAULT '',
  seo_description  TEXT NOT NULL DEFAULT '',
  popularity       INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  published_at     TEXT
);
CREATE INDEX products_status_cat ON products(status, category_id);
CREATE INDEX products_published ON products(status, published_at DESC);

CREATE TABLE product_options (
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  option     INTEGER NOT NULL CHECK (option IN (1,2)),
  value      TEXT NOT NULL,
  label      TEXT NOT NULL,
  swatch     TEXT,
  sort       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (product_id, option, value)
);

-- reserved = units held by unpaid orders. CHECK (reserved <= on_hand) makes overselling impossible:
-- a hold that would exceed stock fails the constraint and rolls back the whole D1 batch.
CREATE TABLE variants (
  id                  TEXT PRIMARY KEY,
  product_id          TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sku                 TEXT NOT NULL UNIQUE,
  option1             TEXT,
  option2             TEXT,
  price               INTEGER CHECK (price IS NULL OR price >= 0),
  compare_at_price    INTEGER,
  on_hand             INTEGER NOT NULL DEFAULT 0,
  reserved            INTEGER NOT NULL DEFAULT 0,
  low_stock_threshold INTEGER,
  active              INTEGER NOT NULL DEFAULT 1,
  sort                INTEGER NOT NULL DEFAULT 0,
  CHECK (on_hand >= 0),
  CHECK (reserved >= 0),
  CHECK (reserved <= on_hand),
  UNIQUE (product_id, option1, option2)
);
CREATE INDEX variants_product ON variants(product_id);

CREATE TABLE product_media (
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  media_id   TEXT NOT NULL REFERENCES media(id),
  role       TEXT NOT NULL DEFAULT 'main' CHECK (role IN ('main','alt','detail')),
  option2    TEXT,
  sort       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (product_id, media_id)
);
CREATE INDEX product_media_media ON product_media(media_id);

CREATE TABLE product_collections (
  product_id    TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  sort          INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (product_id, collection_id)
);
CREATE INDEX product_collections_coll ON product_collections(collection_id);

CREATE TABLE stock_ledger (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  variant_id    TEXT NOT NULL REFERENCES variants(id),
  delta         INTEGER NOT NULL,          -- change to on_hand (0 for hold/release rows)
  reserved_delta INTEGER NOT NULL DEFAULT 0,
  reason        TEXT NOT NULL,             -- restock|sale|return|adjustment|damage|hold|release|cancel (open-ended for 1.1)
  order_id      TEXT,
  note          TEXT NOT NULL DEFAULT '',
  actor         TEXT NOT NULL DEFAULT 'system',
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX stock_ledger_variant ON stock_ledger(variant_id, id DESC);

CREATE TABLE orders (
  id               TEXT PRIMARY KEY,
  number           TEXT NOT NULL UNIQUE,
  access_token     TEXT NOT NULL,
  client_ref       TEXT UNIQUE,
  status           TEXT NOT NULL CHECK (status IN ('pending_payment','new','confirmed','packed','shipped','delivered','cancelled')),
  payment_method   TEXT NOT NULL CHECK (payment_method IN ('upi','gateway','cod','whatsapp')),
  payment_status   TEXT NOT NULL CHECK (payment_status IN ('unpaid','paid','failed','cod','refunded')),
  channel          TEXT NOT NULL DEFAULT 'web' CHECK (channel IN ('web','whatsapp','phone','shop')),
  stock_state      TEXT NOT NULL CHECK (stock_state IN ('held','committed','released')),
  hold_expires_at  TEXT,
  customer_name    TEXT NOT NULL,
  phone            TEXT NOT NULL,
  email            TEXT NOT NULL DEFAULT '',
  line1            TEXT NOT NULL DEFAULT '',
  line2            TEXT NOT NULL DEFAULT '',
  landmark         TEXT NOT NULL DEFAULT '',
  city             TEXT NOT NULL DEFAULT '',
  state            TEXT NOT NULL DEFAULT 'KL',
  pincode          TEXT NOT NULL DEFAULT '',
  subtotal         INTEGER NOT NULL,
  shipping         INTEGER NOT NULL,
  total            INTEGER NOT NULL,
  courier          TEXT,
  tracking_number  TEXT,
  tracking_url     TEXT,
  notes            TEXT NOT NULL DEFAULT '',
  cancel_reason    TEXT,
  created_by       TEXT,
  paid_at          TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX orders_status ON orders(status, created_at DESC);
CREATE INDEX orders_hold ON orders(stock_state, hold_expires_at);
CREATE INDEX orders_phone ON orders(phone);

CREATE TABLE order_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id     TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  variant_id   TEXT NOT NULL REFERENCES variants(id),
  product_id   TEXT NOT NULL,
  slug         TEXT NOT NULL,
  sku          TEXT NOT NULL,
  title        TEXT NOT NULL,
  option_label TEXT NOT NULL,
  image_url    TEXT,
  unit_price   INTEGER NOT NULL,
  qty          INTEGER NOT NULL CHECK (qty > 0),
  line_total   INTEGER NOT NULL
);
CREATE INDEX order_items_order ON order_items(order_id);

CREATE TABLE order_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id   TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status     TEXT NOT NULL,
  note       TEXT,
  public     INTEGER NOT NULL DEFAULT 1,
  actor      TEXT NOT NULL DEFAULT 'system',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX order_events_order ON order_events(order_id, id);

CREATE TABLE payments (
  id                  TEXT PRIMARY KEY,
  order_id            TEXT NOT NULL REFERENCES orders(id),
  provider            TEXT NOT NULL,
  provider_order_id   TEXT,
  provider_payment_id TEXT,
  amount              INTEGER NOT NULL,
  status              TEXT NOT NULL CHECK (status IN ('created','paid','failed','refunded')),
  raw                 TEXT,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX payments_order ON payments(order_id);
CREATE UNIQUE INDEX payments_provider_order ON payments(provider, provider_order_id);

CREATE TABLE webhook_events (
  provider    TEXT NOT NULL,
  event_id    TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (provider, event_id)
);

CREATE TABLE content_versions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  status       TEXT NOT NULL CHECK (status IN ('draft','published','archived')),
  data         TEXT NOT NULL,
  note         TEXT NOT NULL DEFAULT '',
  created_by   TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  published_at TEXT
);
CREATE INDEX content_versions_status ON content_versions(status, id DESC);

CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE secrets (
  key        TEXT PRIMARY KEY,
  iv         TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE roles (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  permissions TEXT NOT NULL,       -- JSON array of permission strings
  system      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE users (
  id           TEXT PRIMARY KEY,
  email        TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL DEFAULT '',
  role_id      TEXT NOT NULL REFERENCES roles(id),
  active       INTEGER NOT NULL DEFAULT 1,
  last_seen_at TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  actor      TEXT NOT NULL,
  action     TEXT NOT NULL,
  entity     TEXT NOT NULL,
  entity_id  TEXT,
  summary    TEXT NOT NULL DEFAULT '',
  data       TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX audit_log_entity ON audit_log(entity, entity_id);

CREATE TABLE newsletter_subscribers (
  email           TEXT PRIMARY KEY,
  source          TEXT NOT NULL DEFAULT 'footer',
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  unsubscribed_at TEXT
);

CREATE TABLE analytics_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  session_id TEXT NOT NULL,
  path       TEXT,
  product_id TEXT,
  variant_id TEXT,
  order_id   TEXT,
  value      INTEGER,
  meta       TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX analytics_events_name_time ON analytics_events(name, created_at);

CREATE TABLE counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL);
INSERT INTO counters (name, value) VALUES ('order_number', 1000);

INSERT INTO roles (id, name, permissions, system) VALUES
  ('owner', 'Owner', '["dashboard.view","catalog.read","catalog.write","stock.write","media.write","orders.read","orders.write","content.write","content.publish","settings.read","settings.write","payments.keys","people.manage","audit.read"]', 1),
  ('staff', 'Staff', '["dashboard.view","catalog.read","catalog.write","stock.write","media.write","orders.read","orders.write","content.write"]', 1);
