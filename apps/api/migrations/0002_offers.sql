-- Offers: automatic sales, cart bundle deals, coupon codes and price-neutral offer tags.
CREATE TABLE offers (
  id                TEXT PRIMARY KEY,
  kind              TEXT NOT NULL CHECK (kind IN ('sale', 'bundle', 'coupon', 'tag')),
  name              TEXT NOT NULL,                 -- internal name, e.g. "Onam sale 2026"
  label             TEXT NOT NULL DEFAULT '',      -- shown to shoppers, e.g. "Onam Sale"
  style             TEXT NOT NULL DEFAULT 'maroon' CHECK (style IN ('maroon', 'gold', 'ink', 'rose', 'green')),
  code              TEXT UNIQUE,                   -- coupons only, upper case
  discount_type     TEXT NOT NULL DEFAULT 'percent' CHECK (discount_type IN ('percent', 'amount')),
  value             INTEGER NOT NULL DEFAULT 0,    -- percent (1–90) or paise
  max_discount      INTEGER,                       -- paise cap, optional
  scope             TEXT NOT NULL DEFAULT 'all' CHECK (scope IN ('all', 'products', 'categories', 'collections')),
  scope_ids         TEXT NOT NULL DEFAULT '[]',    -- JSON array of ids for the scope
  min_qty           INTEGER NOT NULL DEFAULT 0,    -- bundles: pieces from the scope
  min_subtotal      INTEGER NOT NULL DEFAULT 0,    -- bundles / coupons: paise
  first_order_only  INTEGER NOT NULL DEFAULT 0,
  usage_limit       INTEGER,                       -- coupons: total uses
  per_customer_limit INTEGER,                      -- coupons: uses per mobile number
  used_count        INTEGER NOT NULL DEFAULT 0 CHECK (usage_limit IS NULL OR used_count <= usage_limit),
  starts_at         TEXT,
  ends_at           TEXT,
  active            INTEGER NOT NULL DEFAULT 1,
  created_by        TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX offers_live ON offers(active, kind);

-- What each order actually got (sales show up in order_items.unit_price vs list_price).
CREATE TABLE order_discounts (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id  TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  offer_id  TEXT REFERENCES offers(id),
  kind      TEXT NOT NULL,
  label     TEXT NOT NULL,
  code      TEXT,
  amount    INTEGER NOT NULL
);
CREATE INDEX order_discounts_order ON order_discounts(order_id);
CREATE INDEX order_discounts_offer ON order_discounts(offer_id);

ALTER TABLE orders ADD COLUMN discount INTEGER NOT NULL DEFAULT 0;
ALTER TABLE order_items ADD COLUMN list_price INTEGER;

-- Discounts are money: the owner manages offers; staff can see them.
UPDATE roles SET permissions = json_insert(permissions, '$[#]', 'offers.write') WHERE id = 'owner';
