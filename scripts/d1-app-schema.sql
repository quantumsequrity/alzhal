-- Consumer Truth App Database Schema (Cloudflare D1 / SQLite)
-- Replaces Supabase tables with edge-local D1

-- Products table
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  product_name TEXT UNIQUE NOT NULL,
  brand TEXT,
  category TEXT,
  total_ingredients INTEGER DEFAULT 0,
  scanned_count INTEGER DEFAULT 0,
  last_scanned_at TEXT DEFAULT (datetime('now')),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_products_name ON products(product_name);

-- Ingredients table
CREATE TABLE IF NOT EXISTS ingredients (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  simple_name TEXT,
  chemical_formula TEXT,
  raw_materials TEXT,
  common_uses TEXT,
  fda_status TEXT,
  eu_status TEXT,
  who_status TEXT,
  banned_in TEXT DEFAULT '[]',       -- JSON array
  safe_limit TEXT,
  concerns TEXT DEFAULT '[]',        -- JSON array
  category TEXT,
  analyzed_count INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ingredients_name ON ingredients(name);

-- Scans table
CREATE TABLE IF NOT EXISTS scans (
  id TEXT PRIMARY KEY,
  product_id TEXT,
  input_type TEXT NOT NULL,
  language TEXT DEFAULT 'English',
  ingredients_found TEXT DEFAULT '[]',  -- JSON array
  response_sent INTEGER DEFAULT 1,     -- boolean as integer
  share_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_scans_product ON scans(product_id);

-- Conversations table
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  scan_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_conversations_scan ON conversations(scan_id);

-- Feedback table
CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY,
  scan_id TEXT NOT NULL,
  rating TEXT NOT NULL,
  comment TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_feedback_scan ON feedback(scan_id);

-- Queries table
CREATE TABLE IF NOT EXISTS queries (
  id TEXT PRIMARY KEY,
  scan_id TEXT,
  question TEXT NOT NULL,
  question_type TEXT DEFAULT 'general',
  language TEXT DEFAULT 'English',
  response TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_queries_scan ON queries(scan_id);
