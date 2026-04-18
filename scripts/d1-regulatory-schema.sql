-- Canonical Ingredient Graph + Regulatory Facts
-- Schema v1 — 2026-04-18
-- Goal: every regulatory claim is LOOKED UP, never generated.
-- No row exists without a verifiable source URL.

-- ============================================================
-- ingredient: one canonical identity per substance
-- All aliases (E-numbers, CAS, synonyms, misspellings, translations) point to this.
-- ============================================================
CREATE TABLE IF NOT EXISTS ingredient (
  canonical_id       TEXT PRIMARY KEY,
  primary_name       TEXT NOT NULL,
  ingredient_class   TEXT NOT NULL,
  cas_number         TEXT,
  pubchem_cid        INTEGER,
  e_number           TEXT,
  ins_number         TEXT,
  inci_name          TEXT,
  molecular_formula  TEXT,
  molecular_weight   REAL,
  category           TEXT NOT NULL,
  is_natural         INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ingredient_cas      ON ingredient(cas_number)   WHERE cas_number  IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_ingredient_pubchem  ON ingredient(pubchem_cid)  WHERE pubchem_cid IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_ingredient_enumber  ON ingredient(e_number)     WHERE e_number    IS NOT NULL;
CREATE INDEX        IF NOT EXISTS idx_ingredient_primary  ON ingredient(primary_name);
CREATE INDEX        IF NOT EXISTS idx_ingredient_category ON ingredient(category);

-- ============================================================
-- ingredient_alias: "Salt" == "NaCl" == "Sodium Chloride" == "塩"
-- alias_normalized is what the query engine hits.
-- ============================================================
CREATE TABLE IF NOT EXISTS ingredient_alias (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  canonical_id       TEXT NOT NULL REFERENCES ingredient(canonical_id) ON DELETE CASCADE,
  alias              TEXT NOT NULL,
  alias_normalized   TEXT NOT NULL,
  alias_type         TEXT NOT NULL,
  language_code      TEXT,
  confidence         REAL NOT NULL DEFAULT 1.0,
  source             TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX        IF NOT EXISTS idx_alias_normalized ON ingredient_alias(alias_normalized);
CREATE INDEX        IF NOT EXISTS idx_alias_canonical  ON ingredient_alias(canonical_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_alias_unique     ON ingredient_alias(alias_normalized, alias_type, COALESCE(language_code, ''));

-- ============================================================
-- fact_evidence: every fact MUST reference one of these rows.
-- Without an evidence row, a fact cannot be inserted (FK RESTRICT).
-- ============================================================
CREATE TABLE IF NOT EXISTS fact_evidence (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  source_name        TEXT NOT NULL,
  source_url         TEXT NOT NULL,
  source_section     TEXT,
  document_hash      TEXT,
  snapshot_date      TEXT NOT NULL,
  language           TEXT NOT NULL DEFAULT 'en',
  retrieved_by       TEXT NOT NULL,
  r2_object_key      TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX        IF NOT EXISTS idx_evidence_source_name ON fact_evidence(source_name);
CREATE INDEX        IF NOT EXISTS idx_evidence_snapshot    ON fact_evidence(snapshot_date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_evidence_url_snap    ON fact_evidence(source_url, snapshot_date);

-- ============================================================
-- regulatory_fact: the authoritative per-jurisdiction claim.
-- max_per_100g_mg is ONLY for quantified limits; NULL when qualitative only.
-- superseded_by chains old versions to new versions; active fact is WHERE superseded_by IS NULL.
-- ============================================================
CREATE TABLE IF NOT EXISTS regulatory_fact (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  canonical_id       TEXT NOT NULL REFERENCES ingredient(canonical_id) ON DELETE CASCADE,
  jurisdiction       TEXT NOT NULL,
  fact_type          TEXT NOT NULL,
  status             TEXT NOT NULL,
  max_per_100g_mg    REAL,
  food_class         TEXT,
  product_category   TEXT,
  regulation_ref     TEXT,
  evidence_id        INTEGER NOT NULL REFERENCES fact_evidence(id) ON DELETE RESTRICT,
  effective_date     TEXT,
  superseded_by      INTEGER REFERENCES regulatory_fact(id),
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX        IF NOT EXISTS idx_fact_ingredient   ON regulatory_fact(canonical_id);
CREATE INDEX        IF NOT EXISTS idx_fact_jurisdiction ON regulatory_fact(jurisdiction);
CREATE INDEX        IF NOT EXISTS idx_fact_type         ON regulatory_fact(fact_type);
CREATE INDEX        IF NOT EXISTS idx_fact_active       ON regulatory_fact(canonical_id, jurisdiction) WHERE superseded_by IS NULL;

-- Prevent duplicate ACTIVE facts for the same (ingredient, jurisdiction, fact_type).
-- Partial unique index (only applies to rows where superseded_by IS NULL).
CREATE UNIQUE INDEX IF NOT EXISTS idx_fact_active_unique
  ON regulatory_fact(canonical_id, jurisdiction, fact_type, COALESCE(food_class, ''), COALESCE(regulation_ref, ''))
  WHERE superseded_by IS NULL;

-- ============================================================
-- nutrition_fact: USDA FDC + OFF, per-100g canonical values.
-- Separate from regulatory_fact because these are measurements, not rules.
-- ============================================================
CREATE TABLE IF NOT EXISTS nutrition_fact (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  canonical_id           TEXT NOT NULL REFERENCES ingredient(canonical_id) ON DELETE CASCADE,
  source                 TEXT NOT NULL,
  source_food_id         TEXT,
  energy_kcal_100g       REAL,
  energy_kj_100g         REAL,
  protein_g_100g         REAL,
  fat_g_100g             REAL,
  saturated_fat_g_100g   REAL,
  trans_fat_g_100g       REAL,
  carbohydrate_g_100g    REAL,
  sugar_g_100g           REAL,
  fiber_g_100g           REAL,
  sodium_mg_100g         REAL,
  evidence_id            INTEGER REFERENCES fact_evidence(id),
  retrieved_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_nutrition_ingredient ON nutrition_fact(canonical_id);
CREATE INDEX IF NOT EXISTS idx_nutrition_source     ON nutrition_fact(source);

-- ============================================================
-- FTS5: full-text search over regulation prose for long-tail queries
-- ("why is potassium bromate restricted in baked goods in India?")
-- Used ONLY when regulatory_fact returns no hit.
-- ============================================================
CREATE VIRTUAL TABLE IF NOT EXISTS regulation_text USING fts5(
  canonical_id UNINDEXED,
  jurisdiction UNINDEXED,
  section,
  text,
  source_url   UNINDEXED,
  evidence_id  UNINDEXED,
  tokenize = 'porter unicode61 remove_diacritics 2'
);

-- ============================================================
-- ingestion_run: audit trail for every ingester execution
-- ============================================================
CREATE TABLE IF NOT EXISTS ingestion_run (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  ingester_name      TEXT NOT NULL,
  ingester_version   TEXT NOT NULL,
  started_at         TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at        TEXT,
  status             TEXT NOT NULL DEFAULT 'running',
  rows_inserted      INTEGER DEFAULT 0,
  rows_updated       INTEGER DEFAULT 0,
  rows_superseded    INTEGER DEFAULT 0,
  error_message      TEXT
);

CREATE INDEX IF NOT EXISTS idx_ingestion_ingester ON ingestion_run(ingester_name, started_at DESC);

-- ============================================================
-- schema_version
-- ============================================================
CREATE TABLE IF NOT EXISTS schema_version (
  version            INTEGER PRIMARY KEY,
  applied_at         TEXT NOT NULL DEFAULT (datetime('now')),
  description        TEXT NOT NULL
);

INSERT OR IGNORE INTO schema_version (version, description)
  VALUES (1, 'Canonical Ingredient Graph v1 — grounded regulatory facts with mandatory provenance');
