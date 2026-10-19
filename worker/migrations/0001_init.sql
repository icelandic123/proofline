-- Proofline state. PayPal stays the system of record for disputes and orders;
-- these tables hold the agent's work, the seller's decisions and the store's
-- own fulfilment records (carrier events, listing snapshots).
CREATE TABLE IF NOT EXISTS cases (
  dispute_id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'new',      -- new | ready | needs_edit | submitted | resolved
  plan TEXT,                               -- CasePlan JSON
  draft TEXT,                              -- Draft JSON
  decision TEXT,                           -- what the seller approved, JSON
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  capture_id TEXT,
  buyer_email TEXT,
  created_at TEXT NOT NULL,
  data TEXT NOT NULL                       -- Order JSON, including trackers and carrier events
);
CREATE INDEX IF NOT EXISTS orders_capture ON orders(capture_id);
CREATE INDEX IF NOT EXISTS orders_buyer ON orders(buyer_email);
CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  actor TEXT NOT NULL,                     -- agent | seller | paypal | demo
  kind TEXT NOT NULL,
  dispute_id TEXT,
  order_id TEXT,
  text TEXT NOT NULL,
  detail TEXT
);
CREATE INDEX IF NOT EXISTS activity_ts ON activity(ts);
-- Disputes for offline mode (no PayPal credentials configured).
CREATE TABLE IF NOT EXISTS sim_disputes (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
