-- ============================================================
-- Canonical-ID reconciliation (D1-safe, no TEMP tables)
-- For every NAME_* canonical_id that shares an alias_normalized
-- with a CAS_* canonical_id, the CAS row wins. The NAME row's
-- facts and aliases get re-pointed at the CAS row, then the NAME
-- ingredient row is deleted.
-- ============================================================

INSERT INTO ingestion_run (ingester_name, ingester_version, status)
  VALUES ('reconcile-canonical-ids', '1.0.0', 'running');

-- 1) Re-point regulatory_fact rows from NAME_* → CAS_*
UPDATE regulatory_fact
   SET canonical_id = (
     SELECT a_cas.canonical_id
       FROM ingredient_alias a_cas
       JOIN ingredient_alias a_name
         ON a_cas.alias_normalized = a_name.alias_normalized
        AND a_cas.alias_type      = a_name.alias_type
        AND COALESCE(a_cas.language_code, '') = COALESCE(a_name.language_code, '')
      WHERE a_name.canonical_id = regulatory_fact.canonical_id
        AND a_cas.canonical_id LIKE 'CAS_%'
      LIMIT 1
   )
 WHERE canonical_id LIKE 'NAME_%'
   AND EXISTS (
     SELECT 1
       FROM ingredient_alias a_cas
       JOIN ingredient_alias a_name
         ON a_cas.alias_normalized = a_name.alias_normalized
        AND a_cas.alias_type      = a_name.alias_type
        AND COALESCE(a_cas.language_code, '') = COALESCE(a_name.language_code, '')
      WHERE a_name.canonical_id = regulatory_fact.canonical_id
        AND a_cas.canonical_id LIKE 'CAS_%'
   );

-- 2) Re-point aliases whose target doesn't already exist on the CAS row
UPDATE ingredient_alias
   SET canonical_id = (
     SELECT a_cas.canonical_id
       FROM ingredient_alias a_cas
       JOIN ingredient_alias a_name
         ON a_cas.alias_normalized = a_name.alias_normalized
        AND a_cas.alias_type      = a_name.alias_type
        AND COALESCE(a_cas.language_code, '') = COALESCE(a_name.language_code, '')
      WHERE a_name.canonical_id = ingredient_alias.canonical_id
        AND a_cas.canonical_id LIKE 'CAS_%'
      LIMIT 1
   )
 WHERE canonical_id LIKE 'NAME_%'
   AND EXISTS (
     SELECT 1
       FROM ingredient_alias a_cas
       JOIN ingredient_alias a_name
         ON a_cas.alias_normalized = a_name.alias_normalized
        AND a_cas.alias_type      = a_name.alias_type
        AND COALESCE(a_cas.language_code, '') = COALESCE(a_name.language_code, '')
      WHERE a_name.canonical_id = ingredient_alias.canonical_id
        AND a_cas.canonical_id LIKE 'CAS_%'
   )
   AND NOT EXISTS (
     -- avoid the UNIQUE constraint: don't duplicate an alias already on the CAS side
     SELECT 1 FROM ingredient_alias ia2
      WHERE ia2.canonical_id = (
              SELECT a_cas.canonical_id
                FROM ingredient_alias a_cas
                JOIN ingredient_alias a_name
                  ON a_cas.alias_normalized = a_name.alias_normalized
                 AND a_cas.alias_type      = a_name.alias_type
                 AND COALESCE(a_cas.language_code, '') = COALESCE(a_name.language_code, '')
               WHERE a_name.canonical_id = ingredient_alias.canonical_id
                 AND a_cas.canonical_id LIKE 'CAS_%'
               LIMIT 1
            )
        AND ia2.alias_normalized = ingredient_alias.alias_normalized
        AND ia2.alias_type      = ingredient_alias.alias_type
        AND COALESCE(ia2.language_code, '') = COALESCE(ingredient_alias.language_code, '')
   );

-- 3) Drop aliases that couldn't move (duplicates) from NAME rows that are about to be deleted
DELETE FROM ingredient_alias
 WHERE canonical_id LIKE 'NAME_%'
   AND EXISTS (
     SELECT 1
       FROM ingredient_alias a_cas
       JOIN ingredient_alias a_name
         ON a_cas.alias_normalized = a_name.alias_normalized
        AND a_cas.alias_type      = a_name.alias_type
        AND COALESCE(a_cas.language_code, '') = COALESCE(a_name.language_code, '')
      WHERE a_name.canonical_id = ingredient_alias.canonical_id
        AND a_cas.canonical_id LIKE 'CAS_%'
   );

-- 4) Delete orphaned NAME_* ingredient rows
DELETE FROM ingredient
 WHERE canonical_id LIKE 'NAME_%'
   AND EXISTS (
     SELECT 1
       FROM ingredient_alias a_cas
       JOIN ingredient_alias a_name
         ON a_cas.alias_normalized = a_name.alias_normalized
        AND a_cas.alias_type      = a_name.alias_type
        AND COALESCE(a_cas.language_code, '') = COALESCE(a_name.language_code, '')
      WHERE a_name.canonical_id = ingredient.canonical_id
        AND a_cas.canonical_id LIKE 'CAS_%'
   );

UPDATE ingestion_run
   SET finished_at = datetime('now'), status = 'completed'
 WHERE id = (SELECT id FROM ingestion_run
             WHERE ingester_name = 'reconcile-canonical-ids' AND status = 'running'
             ORDER BY started_at DESC LIMIT 1);
