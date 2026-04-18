-- ============================================================
-- product table — barcode-keyed product data (sourced from Open Food Facts)
-- Additive migration on top of the v1 CIG schema.
-- ============================================================

CREATE TABLE IF NOT EXISTS product (
  barcode            TEXT PRIMARY KEY,
  product_name       TEXT NOT NULL,
  brand              TEXT,
  category           TEXT,
  ingredients_text   TEXT,
  additives_tags     TEXT,   -- JSON array of E-number slugs (e.g. '["en:e621","en:e330"]')
  allergens_tags     TEXT,   -- JSON array
  categories_tags    TEXT,   -- JSON array
  countries_tags     TEXT,   -- JSON array
  nutriscore_grade   TEXT,
  nova_group         INTEGER,
  ecoscore_grade     TEXT,
  source             TEXT NOT NULL DEFAULT 'OpenFoodFacts',
  source_url         TEXT,
  last_seen_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_product_name_lower ON product(LOWER(product_name));
CREATE INDEX IF NOT EXISTS idx_product_brand      ON product(LOWER(brand));

-- Normalized product aliases: map barcode or normalized name → the same barcode.
-- Enables the existing alias resolver to surface a product by name lookup.
CREATE TABLE IF NOT EXISTS product_alias (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  barcode            TEXT NOT NULL REFERENCES product(barcode) ON DELETE CASCADE,
  alias              TEXT NOT NULL,
  alias_normalized   TEXT NOT NULL,
  alias_type         TEXT NOT NULL,   -- 'barcode' | 'product_name' | 'brand'
  language_code      TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_product_alias_normalized ON product_alias(alias_normalized);
CREATE INDEX IF NOT EXISTS idx_product_alias_barcode    ON product_alias(barcode);
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_alias_unique
  ON product_alias(alias_normalized, alias_type, COALESCE(language_code, ''));

INSERT OR IGNORE INTO schema_version (version, description)
  VALUES (2, 'Add product + product_alias tables for barcode-keyed lookups (OpenFoodFacts)');
