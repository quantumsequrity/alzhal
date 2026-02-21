-- Ingredients Reference Database Schema
-- Local cache of chemical/safety data from multiple authoritative sources:
-- PubChem, OpenFDA, EFSA OpenFoodTox, WHO/IARC, EU Food Additives

DROP TABLE IF EXISTS ingredient_reference;

CREATE TABLE ingredient_reference (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,                         -- Lowercased canonical name (lookup key)
  name_original TEXT,                         -- Original casing for display

  -- PubChem (Chemical Identity)
  cas_number TEXT,                            -- CAS Registry Number
  pubchem_cid INTEGER,                        -- PubChem Compound ID
  molecular_formula TEXT,                     -- e.g. "C6H8O7"
  molecular_weight TEXT,                      -- e.g. "192.12"
  iupac_name TEXT,                            -- IUPAC systematic name

  -- OpenFDA (Adverse Events & Recalls)
  fda_adverse_event_count INTEGER DEFAULT 0,  -- Total FDA adverse event reports
  fda_recall_count INTEGER DEFAULT 0,         -- Total FDA recall count
  fda_recent_recalls TEXT DEFAULT '[]',       -- JSON array [{reason, classification, status}]
  last_fda_sync_at TEXT,                      -- When FDA data was last refreshed

  -- EFSA OpenFoodTox (Toxicological Reference Values)
  efsa_adi TEXT,                              -- Acceptable Daily Intake (mg/kg bw/day)
  efsa_noael TEXT,                            -- No Observed Adverse Effect Level
  efsa_hazard TEXT,                           -- Hazard type (e.g. "Genotoxicity", "Carcinogenicity")
  efsa_evaluation_year INTEGER,               -- Year of EFSA evaluation

  -- WHO/IARC (Carcinogen Classification)
  iarc_group TEXT,                            -- "1", "2A", "2B", "3" or NULL
  iarc_description TEXT,                      -- e.g. "Carcinogenic to humans"
  iarc_agent_name TEXT,                       -- IARC's canonical agent name

  -- EU Food Additives
  e_number TEXT,                              -- E-number (e.g. "E330")
  eu_approved INTEGER DEFAULT 0,             -- 1 = approved in EU, 0 = not listed
  eu_max_level TEXT,                          -- Maximum permitted level (mg/kg or "quantum satis")
  eu_food_categories TEXT DEFAULT '[]',       -- JSON array of approved food categories
  eu_restrictions TEXT,                       -- Any restrictions/conditions

  -- Composite safety flags (derived from all sources)
  is_banned_anywhere INTEGER DEFAULT 0,       -- 1 if banned in any jurisdiction
  banned_in TEXT DEFAULT '[]',                -- JSON array of countries where banned
  safety_concerns TEXT DEFAULT '[]',          -- JSON array of concern strings from all sources

  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ingref_name ON ingredient_reference(name);
CREATE INDEX IF NOT EXISTS idx_ingref_cas ON ingredient_reference(cas_number);
CREATE INDEX IF NOT EXISTS idx_ingref_enumber ON ingredient_reference(e_number);
CREATE INDEX IF NOT EXISTS idx_ingref_iarc ON ingredient_reference(iarc_group);
