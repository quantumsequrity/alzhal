# Setting up the regulatory D1 database (`v2-grounded`)

This is the grounded-facts database that replaces all LLM-generated regulatory claims. Schema: [`scripts/d1-regulatory-schema.sql`](../../scripts/d1-regulatory-schema.sql).

## Design guarantees

- **No fact without evidence.** Every `regulatory_fact` row has a `NOT NULL` foreign key to `fact_evidence`, which carries a mandatory `source_url` + `snapshot_date`. No fact can exist in the DB without a verifiable source.
- **One canonical identity per substance.** All aliases (E-numbers, CAS, INCI, synonyms, misspellings, translations) point to a single `ingredient.canonical_id`.
- **Supersession, not deletion.** When a regulation updates, the old `regulatory_fact` is linked via `superseded_by` to the new row. Historical state is preserved for audit.
- **Audit trail.** Every ingester run records start/end time, counts, and status in `ingestion_run`.

## One-time setup

```bash
# 1. Create the D1 database
npx wrangler d1 create consumer-truth-regulatory
```

Copy the returned `database_id` and add this binding to `wrangler.toml`:

```toml
[[d1_databases]]
binding        = "REGULATORY_DB"
database_name  = "consumer-truth-regulatory"
database_id    = "<paste-the-id-here>"
```

Apply the schema (locally and remotely):

```bash
# Remote (production)
npx wrangler d1 execute consumer-truth-regulatory --remote --file=scripts/d1-regulatory-schema.sql

# Local (development)
npx wrangler d1 execute consumer-truth-regulatory --local  --file=scripts/d1-regulatory-schema.sql
```

## Seeding IARC classifications

IARC Monographs (~1,000 substances classified as Group 1 / 2A / 2B / 3) is the simplest starting data source and the most authoritative for carcinogen claims.

Prerequisites:
1. Download the IARC list:
   - Source page: <https://monographs.iarc.who.int/list-of-classifications/>
   - PDF: <https://monographs.iarc.who.int/agents-classified-by-the-iarc/>
   - Save as `scripts/bulk-data/iarc-classifications.pdf`
2. Parse it to JSON with the existing Python pipeline (which uses `pdfplumber`):
   ```bash
   python3 scripts/build-reference-db.py
   # produces scripts/bulk-data/iarc-parsed.json
   ```

Run the CIG seeder:

```bash
npx tsx scripts/seed-iarc-cig.ts
# emits scripts/d1-regulatory-iarc.sql
```

Apply it:

```bash
npx wrangler d1 execute consumer-truth-regulatory --remote --file=scripts/d1-regulatory-iarc.sql
```

## Verifying the load

```bash
npx wrangler d1 execute consumer-truth-regulatory --remote --command \
  "SELECT jurisdiction, fact_type, COUNT(*) AS n FROM regulatory_fact GROUP BY jurisdiction, fact_type"
```

You should see `WHO_IARC | classification | ~1000`.

Every row in `regulatory_fact` is joinable to `fact_evidence` to get its `source_url`:

```sql
SELECT i.primary_name, rf.status, fe.source_url, fe.snapshot_date
FROM regulatory_fact rf
JOIN ingredient     i  ON rf.canonical_id = i.canonical_id
JOIN fact_evidence  fe ON rf.evidence_id  = fe.id
WHERE rf.jurisdiction = 'WHO_IARC'
LIMIT 5;
```

## Seeding FDA CFR Title 21 (GRAS + permitted + prohibited substances)

Downloaded and parsed automatically — no manual step.

```bash
bash scripts/pull-bulk-data.sh ecfr         # fetches XML snapshots from eCFR API
python3 scripts/seed-ecfr-cig.py            # parses XML → d1-regulatory-ecfr-21.sql
npx wrangler d1 execute consumer-truth-regulatory --remote \
  --file=scripts/d1-regulatory-ecfr-21.sql
```

Typical output: ~720 ingredients, ~790 regulatory facts. Each fact references a specific `21 CFR §N.M` citation and an eCFR URL at the dated snapshot.

## Migrating IARC facts from the legacy DB (fastest path)

Your existing `INGREDIENTS_REF_DB` already contains IARC classifications from a prior ingestion. Migrate those rows into the new CIG schema:

```bash
# 1. Export legacy IARC rows
npx wrangler d1 execute consumer-truth-ingredients-ref --remote --json \
  --command "SELECT name, name_original, cas_number, pubchem_cid, molecular_formula, molecular_weight, iupac_name, iarc_group, iarc_description, iarc_agent_name FROM ingredient_reference WHERE iarc_group IS NOT NULL" \
  > scripts/bulk-data/iarc-legacy-export.json

# 2. Transform to CIG SQL
npx tsx scripts/seed-iarc-from-legacy.ts

# 3. Apply
npx wrangler d1 execute consumer-truth-regulatory --remote \
  --file=scripts/d1-regulatory-iarc.sql
```

Canonical IDs are CAS-based when the legacy row has a valid CAS, which keeps IARC rows joinable with CFR rows (both end up at the same `canonical_id`).

## Enabling the grounded pipeline in the running app

Once the regulatory D1 is populated, turn on the feature flag:

```bash
# Add to .env.local
USE_GROUNDED_RENDERER=true
```

Or as a Worker secret:

```bash
npx wrangler secret put USE_GROUNDED_RENDERER
# enter: true
```

Add the D1 binding to `wrangler.toml`:

```toml
[[d1_databases]]
binding       = "REGULATORY_DB"
database_name = "consumer-truth-regulatory"
database_id   = "<your-id>"
```

### Integration point in `lib/analysis.ts`

Before the existing `analyzeIngredientBatch` call, attempt the grounded path first:

```typescript
import { maybeAnalyzeIngredientGrounded } from './analysis-grounded'

for (const item of productData.ingredients) {
  // Try the grounded pipeline first (feature-flagged, graceful fallback to null)
  const grounded = await maybeAnalyzeIngredientGrounded(item.name, language)
  if (grounded) {
    // Map RenderedAnalysis → existing analysis shape, or expose new shape in UI
    // grounded.verdict is deterministic (from facts, not LLM)
    // grounded.per_jurisdiction has every claim with a source_url
    // grounded.citations is the provenance list
    continue
  }
  // Fall back to legacy batch analysis for anything the grounded path didn't cover
  // ...
}
```

The fallback flow is unchanged, so turning the flag off immediately reverts to the legacy behaviour.

## Finishing the Open Food Facts ingest

The ingester (`scripts/seed-openfoodfacts.py`) is ready but the 500 MB Parquet dump from Hugging Face throttles heavily. Two options:

**Option A — persistent download (recommended, run overnight):**

```bash
curl -L -C - --retry 10 --retry-delay 30 --max-time 7200 \
  -o scripts/bulk-data/openfoodfacts-food.parquet \
  "https://huggingface.co/datasets/openfoodfacts/product-database/resolve/main/food.parquet?download=true"
```

The `-C -` resumes on retry, `--retry 10` keeps retrying after timeouts. Run this once; it may take 1–3 hours.

**Option B — OFF static CSV (different host, may be faster):**

```bash
curl -L -o scripts/bulk-data/off-products.csv.gz \
  "https://static.openfoodfacts.org/data/en.openfoodfacts.org.products.csv.gz"
gunzip scripts/bulk-data/off-products.csv.gz
```

Then adapt `seed-openfoodfacts.py` to read CSV instead of Parquet (one-line swap — `csv.DictReader` instead of `pq.iter_batches`).

**After the file is on disk:**

```bash
python3 scripts/seed-openfoodfacts.py --limit 200000
npx wrangler d1 execute consumer-truth-ingredients-ref --remote \
  --file=scripts/d1-regulatory-off.sql
```

This populates the `product` + `product_alias` tables (~200K barcode-keyed products with ingredients_text, nutrition, additive tags). Then the analysis pipeline can short-circuit "product scanned → known barcode → pre-parsed ingredient list" paths.

## Adding more sources

Each ingester produces its own `scripts/d1-regulatory-{source}.sql` file. Planned ingesters (in priority order):

| Ingester | Source | Status |
|---|---|---|
| `seed-iarc-cig.ts`     | IARC Monographs (WHO)        | Ready |
| `seed-ecfr-cig.ts`     | FDA CFR Title 21 (eCFR JSON) | Planned |
| `seed-eu-cosing.ts`    | EU CosIng Annexes II/III     | Planned |
| `seed-eu-additives.ts` | EU Reg. 1333/2008 Annex II   | Planned |
| `seed-fssai.ts`        | FSSAI FSS Regulations 2011   | Planned (Docling) |
| `seed-codex-gsfa.ts`   | Codex Alimentarius GSFA      | Planned |
| `seed-fsanz.ts`        | FSANZ Schedules              | Planned |
| `seed-health-canada.ts`| Health Canada Hotlist        | Planned |
| `seed-japan-mhlw.ts`   | Japan MHLW additives list    | Planned |

All ingesters write into the same regulatory DB. Canonical IDs stay consistent (preferring CAS-based IDs) so facts from different jurisdictions join cleanly on `ingredient.canonical_id`.
