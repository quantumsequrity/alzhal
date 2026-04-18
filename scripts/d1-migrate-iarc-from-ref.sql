-- ============================================================
-- Migrate IARC facts from ingredient_reference (legacy) to the CIG schema.
-- Both tables live in consumer-truth-ingredients-ref, so this is a single
-- in-DB operation (no JSON export/import round-trip).
-- ============================================================

-- Ingestion audit row
INSERT INTO ingestion_run (ingester_name, ingester_version, status)
  VALUES ('migrate-iarc-from-ref', '1.0.0', 'running');

-- Single evidence row for IARC
INSERT INTO fact_evidence (source_name, source_url, source_section, snapshot_date, language, retrieved_by)
  VALUES (
    'IARC Monographs — Agents Classified by the IARC Monographs',
    'https://monographs.iarc.who.int/list-of-classifications/',
    'Full classification list (migrated from legacy ingredient_reference)',
    date('now'),
    'en',
    'migrate-iarc-from-ref:1.0.0'
  )
  ON CONFLICT(source_url, snapshot_date) DO NOTHING;

-- ingredient rows
INSERT INTO ingredient (canonical_id, primary_name, ingredient_class, cas_number, pubchem_cid, molecular_formula, molecular_weight, category, is_natural)
SELECT
  CASE
    WHEN cas_number IS NOT NULL AND cas_number GLOB '[0-9]*-[0-9][0-9]-[0-9]'
      THEN 'CAS_' || REPLACE(cas_number, '-', '_')
    ELSE 'NAME_' || LOWER(
      REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
        TRIM(COALESCE(iarc_agent_name, name_original, name)),
        ' ', '_'), ',', ''), '.', ''), '(', ''), ')', ''), '/', '_'), '-', '_'), '''', ''))
  END AS canonical_id,
  TRIM(COALESCE(iarc_agent_name, name_original, name)) AS primary_name,
  'substance' AS ingredient_class,
  cas_number,
  pubchem_cid,
  molecular_formula,
  CAST(molecular_weight AS REAL),
  'multi' AS category,
  0 AS is_natural
FROM ingredient_reference
WHERE iarc_group IS NOT NULL
  AND COALESCE(iarc_agent_name, name_original, name) IS NOT NULL
  AND TRIM(COALESCE(iarc_agent_name, name_original, name)) != ''
ON CONFLICT(canonical_id) DO NOTHING;

-- alias: primary name
INSERT INTO ingredient_alias (canonical_id, alias, alias_normalized, alias_type, language_code, confidence, source)
SELECT
  CASE
    WHEN cas_number IS NOT NULL AND cas_number GLOB '[0-9]*-[0-9][0-9]-[0-9]'
      THEN 'CAS_' || REPLACE(cas_number, '-', '_')
    ELSE 'NAME_' || LOWER(
      REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
        TRIM(COALESCE(iarc_agent_name, name_original, name)),
        ' ', '_'), ',', ''), '.', ''), '(', ''), ')', ''), '/', '_'), '-', '_'), '''', ''))
  END AS canonical_id,
  TRIM(COALESCE(iarc_agent_name, name_original, name)) AS alias,
  LOWER(TRIM(COALESCE(iarc_agent_name, name_original, name))) AS alias_normalized,
  'synonym' AS alias_type,
  'en' AS language_code,
  1.0 AS confidence,
  'IARC-legacy' AS source
FROM ingredient_reference
WHERE iarc_group IS NOT NULL
  AND COALESCE(iarc_agent_name, name_original, name) IS NOT NULL
  AND TRIM(COALESCE(iarc_agent_name, name_original, name)) != ''
ON CONFLICT(alias_normalized, alias_type, COALESCE(language_code, '')) DO NOTHING;

-- alias: CAS
INSERT INTO ingredient_alias (canonical_id, alias, alias_normalized, alias_type, language_code, confidence, source)
SELECT
  'CAS_' || REPLACE(cas_number, '-', '_') AS canonical_id,
  cas_number AS alias,
  LOWER(cas_number) AS alias_normalized,
  'cas' AS alias_type,
  NULL AS language_code,
  1.0 AS confidence,
  'IARC-legacy' AS source
FROM ingredient_reference
WHERE iarc_group IS NOT NULL
  AND cas_number IS NOT NULL
  AND cas_number GLOB '[0-9]*-[0-9][0-9]-[0-9]'
ON CONFLICT(alias_normalized, alias_type, COALESCE(language_code, '')) DO NOTHING;

-- regulatory fact: the IARC classification
INSERT INTO regulatory_fact (canonical_id, jurisdiction, fact_type, status, regulation_ref, evidence_id)
SELECT
  CASE
    WHEN cas_number IS NOT NULL AND cas_number GLOB '[0-9]*-[0-9][0-9]-[0-9]'
      THEN 'CAS_' || REPLACE(cas_number, '-', '_')
    ELSE 'NAME_' || LOWER(
      REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
        TRIM(COALESCE(iarc_agent_name, name_original, name)),
        ' ', '_'), ',', ''), '.', ''), '(', ''), ')', ''), '/', '_'), '-', '_'), '''', ''))
  END AS canonical_id,
  'WHO_IARC' AS jurisdiction,
  'classification' AS fact_type,
  'WHO/IARC Group ' || iarc_group || ' — ' || COALESCE(iarc_description, '') AS status,
  'IARC Monographs — Group ' || iarc_group AS regulation_ref,
  (SELECT id FROM fact_evidence
     WHERE source_url = 'https://monographs.iarc.who.int/list-of-classifications/'
       AND snapshot_date = date('now')
     LIMIT 1) AS evidence_id
FROM ingredient_reference
WHERE iarc_group IS NOT NULL
  AND COALESCE(iarc_agent_name, name_original, name) IS NOT NULL
  AND TRIM(COALESCE(iarc_agent_name, name_original, name)) != '';

-- Close the audit run
UPDATE ingestion_run
  SET finished_at = datetime('now'), status = 'completed'
  WHERE id = (SELECT id FROM ingestion_run
              WHERE ingester_name = 'migrate-iarc-from-ref' AND status = 'running'
              ORDER BY started_at DESC LIMIT 1);
