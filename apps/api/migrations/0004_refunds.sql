-- Refunds: automatic through the payment gateway (Razorpay) or recorded by hand for UPI / cash.
CREATE TABLE refunds (
  id                  TEXT PRIMARY KEY,
  order_id            TEXT NOT NULL REFERENCES orders(id),
  provider            TEXT,                         -- 'razorpay'; NULL for manual refunds
  provider_payment_id TEXT,
  provider_refund_id  TEXT,
  amount              INTEGER NOT NULL CHECK (amount > 0),
  -- gateway: pending → processed | failed · manual (UPI / cash): to_send → sent
  status              TEXT NOT NULL CHECK (status IN ('pending', 'processed', 'failed', 'to_send', 'sent')),
  reason              TEXT NOT NULL DEFAULT '',
  reference           TEXT,                         -- UTR / note for manual refunds
  error               TEXT,
  requested_by        TEXT NOT NULL,                -- 'customer' or the admin's email
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  processed_at        TEXT
);
CREATE INDEX refunds_order ON refunds(order_id);
CREATE UNIQUE INDEX refunds_provider_id ON refunds(provider_refund_id) WHERE provider_refund_id IS NOT NULL;

ALTER TABLE orders ADD COLUMN cancelled_by TEXT;  -- 'customer' · 'store' · 'system'

-- Refunding money on its own (not as part of a cancellation) is an owner permission.
UPDATE roles SET permissions = json_insert(permissions, '$[#]', 'payments.refund') WHERE id = 'owner';
