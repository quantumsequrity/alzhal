#!/usr/bin/env python3
"""
Open Food Facts (Parquet) → CIG product table seeder.

Reads the Hugging Face Parquet dump of Open Food Facts, filters for products
with complete data, and emits CIG SQL populating `product` and `product_alias`
(barcode → product_name) rows.

Licensing (ODbL):
    - Source data: https://opendatacommons.org/licenses/odbl/
    - Individual product records: DbCL (DATA_LICENSE.md in this repo)
    - If you REDISTRIBUTE the resulting D1 database, your derivative must be
      shared under ODbL. Internal/private use in your own Worker = fine.
    - UI must attribute: "Product data © Open Food Facts contributors, ODbL".

Inputs:
    scripts/bulk-data/openfoodfacts-food.parquet
    (download: https://huggingface.co/datasets/openfoodfacts/product-database/resolve/main/food.parquet)

Output:
    scripts/d1-regulatory-off.sql (may be chunked when large)

Usage:
    python3 scripts/seed-openfoodfacts.py [--limit N] [--min-completeness 0.5]

Defaults:
    --limit 100000         cap row count (D1 size guardrail)
    --min-completeness 0.5 require at least 50% of key fields populated
"""

import argparse
import json
import re
import sys
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

try:
    import pyarrow.parquet as pq
    import pyarrow as pa
except ImportError:
    print('pyarrow is required. Install with: pip install pyarrow', file=sys.stderr)
    sys.exit(2)

BASE = Path(__file__).resolve().parent
INPUT = BASE / 'bulk-data' / 'openfoodfacts-food.parquet'
OUTPUT = BASE / 'd1-regulatory-off.sql'

INGESTER = 'seed-openfoodfacts'
VERSION = '1.0.0'
SOURCE_NAME = 'Open Food Facts (Parquet, Hugging Face)'
SOURCE_URL = 'https://huggingface.co/datasets/openfoodfacts/product-database'

# Required and optional field names (OFF Parquet column names)
KEY_FIELDS = ('code', 'product_name', 'ingredients_text')
OPTIONAL_FIELDS = ('brands', 'categories_tags', 'countries_tags',
                   'additives_tags', 'allergens_tags',
                   'nutriscore_grade', 'nova_group', 'ecoscore_grade')

EAN_RE = re.compile(r'^[0-9]{8,14}$')


def esc(s):
    if s is None or s == '' or s == []:
        return 'NULL'
    if isinstance(s, (list, dict)):
        return "'" + json.dumps(s, ensure_ascii=False).replace("'", "''") + "'"
    return "'" + str(s).replace("'", "''") + "'"


def normalize_alias(s):
    if not s: return ''
    d = unicodedata.normalize('NFD', s)
    stripped = ''.join(c for c in d if unicodedata.category(c) != 'Mn')
    return re.sub(r'\s+', ' ', stripped).strip().lower()


def parse_args():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--limit', type=int, default=100_000,
                   help='Max rows to emit (D1 size guardrail)')
    p.add_argument('--min-completeness', type=float, default=0.5,
                   help='Require this fraction of optional fields populated')
    p.add_argument('--countries-filter', type=str, default=None,
                   help='Comma-separated country tag prefixes (e.g. "en:united-kingdom,en:india"). Empty = no filter.')
    return p.parse_args()


def first_non_empty(row, *keys):
    for k in keys:
        v = row.get(k)
        if v is not None and v != '':
            return v
    return None


def extract_multilang(value, preferred_langs=('en', 'main')):
    """OFF parquet stores name / ingredients_text as List<{lang, text}>.
    Extract the best-available text: prefer English, fall back to 'main',
    then the first available. Returns None if no usable text."""
    if value is None:
        return None
    # Plain string (older schema / some columns)
    if isinstance(value, str):
        return value.strip() or None
    # List of dicts with lang/text
    if isinstance(value, list):
        # Dict-style entries
        for pref in preferred_langs:
            for entry in value:
                if isinstance(entry, dict) and entry.get('lang') == pref:
                    t = entry.get('text')
                    if t and isinstance(t, str) and t.strip():
                        return t.strip()
        # Fallback: first non-empty text
        for entry in value:
            if isinstance(entry, dict):
                t = entry.get('text')
                if t and isinstance(t, str) and t.strip():
                    return t.strip()
            elif isinstance(entry, str) and entry.strip():
                return entry.strip()
    return None


def row_completeness(row):
    n_filled = sum(1 for k in OPTIONAL_FIELDS
                   if row.get(k) is not None and row.get(k) != '' and row.get(k) != [])
    return n_filled / len(OPTIONAL_FIELDS)


def main():
    args = parse_args()
    if not INPUT.exists():
        print(f'Missing {INPUT}.', file=sys.stderr)
        print('Download: curl -L -o scripts/bulk-data/openfoodfacts-food.parquet '
              '"https://huggingface.co/datasets/openfoodfacts/product-database/resolve/main/food.parquet?download=true"',
              file=sys.stderr)
        sys.exit(2)

    pf = pq.ParquetFile(INPUT)
    total_rows = pf.metadata.num_rows
    print(f'OFF parquet: {total_rows:,} total rows')
    print(f'Schema fields (first 20):')
    schema = pf.schema_arrow
    field_names = [f.name for f in schema]
    for f in field_names[:20]:
        print(f'  {f}')
    print(f'  ... ({len(field_names)} total)')

    # Validate required fields exist in schema
    missing_required = [f for f in KEY_FIELDS if f not in field_names]
    if missing_required:
        print(f'Required fields missing from parquet: {missing_required}', file=sys.stderr)
        sys.exit(3)

    # Build column list we'll actually read
    cols = list(KEY_FIELDS) + [f for f in OPTIONAL_FIELDS if f in field_names]

    countries_filter = None
    if args.countries_filter:
        countries_filter = [c.strip() for c in args.countries_filter.split(',') if c.strip()]

    snapshot = datetime.now(timezone.utc).date().isoformat()
    out_lines = []
    out_lines.append('-- ============================================================')
    out_lines.append(f'-- Open Food Facts → CIG product seed')
    out_lines.append(f'-- Generated: {datetime.now(timezone.utc).isoformat()}')
    out_lines.append(f'-- Ingester:  {INGESTER} v{VERSION}')
    out_lines.append(f'-- Total rows in parquet: {total_rows:,}')
    out_lines.append(f'-- Limit: {args.limit:,}')
    out_lines.append(f'-- LICENSE: Open Database License (ODbL). See DATA_LICENSE.md.')
    out_lines.append(f'--          Attribution in UI is mandatory.')
    out_lines.append('-- ============================================================')
    out_lines.append('')
    out_lines.append(f"INSERT INTO ingestion_run (ingester_name, ingester_version, status) "
                     f"VALUES ({esc(INGESTER)}, {esc(VERSION)}, 'running');")
    out_lines.append('')
    out_lines.append(
        f"INSERT INTO fact_evidence (source_name, source_url, source_section, snapshot_date, language, retrieved_by) "
        f"VALUES ({esc(SOURCE_NAME)}, {esc(SOURCE_URL)}, 'food.parquet (ODbL)', {esc(snapshot)}, 'en', {esc(INGESTER + ':' + VERSION)}) "
        f"ON CONFLICT(source_url, snapshot_date) DO NOTHING;"
    )
    out_lines.append('')

    emitted = 0
    skipped_no_barcode = 0
    skipped_no_ingredients = 0
    skipped_low_completeness = 0
    skipped_filtered_country = 0
    seen_barcodes = set()

    # Stream the parquet in batches
    for batch in pf.iter_batches(batch_size=50_000, columns=cols):
        if emitted >= args.limit:
            break

        d = batch.to_pydict()
        n = len(d[KEY_FIELDS[0]])
        for i in range(n):
            if emitted >= args.limit:
                break

            barcode = d.get('code', [None]*n)[i]
            if not barcode or not isinstance(barcode, str) or not EAN_RE.match(barcode.strip()):
                skipped_no_barcode += 1
                continue
            barcode = barcode.strip()
            if barcode in seen_barcodes:
                continue
            seen_barcodes.add(barcode)

            product_name = extract_multilang(d.get('product_name', [None]*n)[i])
            if not product_name:
                continue
            product_name = product_name[:200]

            ingredients_text = extract_multilang(d.get('ingredients_text', [None]*n)[i])
            if not ingredients_text:
                skipped_no_ingredients += 1
                continue
            ingredients_text = ingredients_text[:5000]

            # Build a row dict for completeness check
            row = {f: d.get(f, [None]*n)[i] for f in cols}

            if row_completeness(row) < args.min_completeness:
                skipped_low_completeness += 1
                continue

            countries = row.get('countries_tags') or []
            if countries_filter and countries:
                if not any(any(str(c).startswith(p) for p in countries_filter) for c in countries):
                    skipped_filtered_country += 1
                    continue

            brand = row.get('brands')
            if isinstance(brand, list):
                brand = brand[0] if brand else None
            if isinstance(brand, str):
                brand = brand.strip()[:120]

            additives = row.get('additives_tags') or []
            allergens = row.get('allergens_tags') or []
            cats = row.get('categories_tags') or []
            ctrys = row.get('countries_tags') or []
            nova = row.get('nova_group')
            nutri = row.get('nutriscore_grade')
            eco = row.get('ecoscore_grade')

            source_product_url = f'https://world.openfoodfacts.org/product/{barcode}'

            out_lines.append(
                f"INSERT INTO product (barcode, product_name, brand, ingredients_text, "
                f"additives_tags, allergens_tags, categories_tags, countries_tags, "
                f"nutriscore_grade, nova_group, ecoscore_grade, source, source_url) "
                f"VALUES ({esc(barcode)}, {esc(product_name)}, {esc(brand)}, {esc(ingredients_text)}, "
                f"{esc(additives)}, {esc(allergens)}, {esc(cats)}, {esc(ctrys)}, "
                f"{esc(nutri)}, {esc(nova)}, {esc(eco)}, 'OpenFoodFacts', {esc(source_product_url)}) "
                f"ON CONFLICT(barcode) DO UPDATE SET "
                f"  ingredients_text = excluded.ingredients_text, "
                f"  last_seen_at = datetime('now');"
            )
            out_lines.append(
                f"INSERT INTO product_alias (barcode, alias, alias_normalized, alias_type, language_code) "
                f"VALUES ({esc(barcode)}, {esc(barcode)}, {esc(barcode)}, 'barcode', NULL) "
                f"ON CONFLICT(alias_normalized, alias_type, COALESCE(language_code, '')) DO NOTHING;"
            )
            out_lines.append(
                f"INSERT INTO product_alias (barcode, alias, alias_normalized, alias_type, language_code) "
                f"VALUES ({esc(barcode)}, {esc(product_name)}, {esc(normalize_alias(product_name))}, 'product_name', 'en') "
                f"ON CONFLICT(alias_normalized, alias_type, COALESCE(language_code, '')) DO NOTHING;"
            )
            emitted += 1

            if emitted % 10_000 == 0:
                print(f'  emitted {emitted:,} products...')

    out_lines.append('')
    out_lines.append(
        f"UPDATE ingestion_run SET finished_at = datetime('now'), status = 'completed', rows_inserted = {emitted * 3} "
        f"WHERE id = (SELECT id FROM ingestion_run WHERE ingester_name = {esc(INGESTER)} AND status = 'running' ORDER BY started_at DESC LIMIT 1);"
    )
    out_lines.append('')

    OUTPUT.write_text('\n'.join(out_lines))
    size_mb = OUTPUT.stat().st_size / 1024 / 1024

    print('')
    print(f'Wrote {OUTPUT} ({size_mb:.2f} MB)')
    print(f'  products emitted: {emitted:,}')
    print(f'  skipped (no barcode): {skipped_no_barcode:,}')
    print(f'  skipped (no ingredients): {skipped_no_ingredients:,}')
    print(f'  skipped (low completeness): {skipped_low_completeness:,}')
    print(f'  skipped (country filter):   {skipped_filtered_country:,}')
    print('')
    print('Apply to D1:')
    print(f'  npx wrangler d1 execute alzhal-ingredients-ref --remote --file={OUTPUT.relative_to(Path.cwd())}')


if __name__ == '__main__':
    main()
