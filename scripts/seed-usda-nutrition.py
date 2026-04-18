#!/usr/bin/env python3
"""
USDA FoodData Central → Canonical Ingredient Graph nutrition seeder.

Parses USDA SR Legacy + Foundation Foods CSV dumps and emits SQL that
populates `nutrition_fact` rows linked to ingredient rows. Unlocks the
per-ingredient nutrition-attribution feature (given an ingredient list
with printed percentages, estimate per-100g macro contribution).

Inputs:
    scripts/bulk-data/usda_sr_legacy/FoodData_Central_sr_legacy_food_csv_*/
    scripts/bulk-data/usda_foundation/FoodData_Central_foundation_food_csv_*/

Output:
    scripts/d1-regulatory-usda-nutrition.sql

USDA values are already per-100g for SR Legacy and Foundation Foods
(the 'food_nutrient.csv' amounts are normalized per 100g of the food).
We do not re-scale; we store them verbatim with provenance.
"""

import csv
import re
import sys
from datetime import datetime
from pathlib import Path

BASE = Path(__file__).resolve().parent
BULK = BASE / 'bulk-data'
OUTPUT = BASE / 'd1-regulatory-usda-nutrition.sql'

SR_DIR = next(BULK.glob('usda_sr_legacy/FoodData_Central_sr_legacy_food_csv_*'), None)
FF_DIR = next(BULK.glob('usda_foundation/FoodData_Central_foundation_food_csv_*'), None)

INGESTER = 'seed-usda-nutrition'
VERSION  = '1.0.0'

# Nutrient IDs we care about. Primary + fallback.
NUTRIENTS = {
    'energy_kcal':        [1008, 2047, 2048],   # Energy; fallback Atwater
    'energy_kj':          [1062],
    'protein_g':          [1003],
    'fat_g':              [1004],
    'sat_fat_g':          [1258],
    'trans_fat_g':        [1257],
    'carbs_g':            [1005],
    'sugar_g':            [2000, 1063],          # Total sugars; fallback NLEA
    'fiber_g':            [1079],
    'sodium_mg':          [1093],
}

USDA_URL = 'https://fdc.nal.usda.gov/download-datasets'

csv.field_size_limit(sys.maxsize)


def esc(s) -> str:
    if s is None or s == '':
        return 'NULL'
    return "'" + str(s).replace("'", "''") + "'"


def num(v) -> str:
    if v is None or v == '':
        return 'NULL'
    try:
        f = float(v)
        if f != f or f == float('inf') or f == -float('inf'):
            return 'NULL'
        return f'{f:g}'
    except (ValueError, TypeError):
        return 'NULL'


def slug(s: str) -> str:
    s = s.lower()
    # strip parentheticals last (they're usually preparation notes)
    s = re.sub(r'\([^)]*\)', '', s)
    s = re.sub(r'[^\w\s-]', '', s)
    s = re.sub(r'[\s_-]+', '_', s).strip('_')
    return s[:80]


def normalize_alias(s: str) -> str:
    # Mirror lib/analysis-grounded.ts normalizeAliasClientSide
    import unicodedata
    d = unicodedata.normalize('NFD', s)
    stripped = ''.join(c for c in d if unicodedata.category(c) != 'Mn')
    return re.sub(r'\s+', ' ', stripped).strip().lower()


def load_foods(directory: Path, source_tag: str) -> dict:
    """Returns fdc_id -> {description, data_type}"""
    foods = {}
    food_file = directory / 'food.csv'
    if not food_file.exists():
        print(f'  SKIP {source_tag}: food.csv missing at {food_file}', file=sys.stderr)
        return foods
    with food_file.open(newline='', encoding='utf-8', errors='replace') as f:
        reader = csv.DictReader(f)
        for row in reader:
            fdc = row.get('fdc_id')
            desc = (row.get('description') or '').strip()
            dtype = (row.get('data_type') or '').strip()
            if fdc and desc and dtype in ('sr_legacy_food', 'foundation_food'):
                foods[fdc] = {'description': desc, 'data_type': dtype, 'source': source_tag}
    return foods


def load_nutrients_for_foods(directory: Path, food_ids: set) -> dict:
    """Returns fdc_id -> {nutrient_id: amount} for the food IDs we care about."""
    by_food = {}
    nf_file = directory / 'food_nutrient.csv'
    if not nf_file.exists():
        return by_food
    wanted_ids = {str(nid) for group in NUTRIENTS.values() for nid in group}
    with nf_file.open(newline='', encoding='utf-8', errors='replace') as f:
        reader = csv.DictReader(f)
        for row in reader:
            fdc = row.get('fdc_id')
            nid = row.get('nutrient_id')
            if not fdc or not nid or fdc not in food_ids or nid not in wanted_ids:
                continue
            amount = row.get('amount')
            try:
                val = float(amount) if amount else None
            except (ValueError, TypeError):
                val = None
            if val is None:
                continue
            d = by_food.setdefault(fdc, {})
            d[int(nid)] = val
    return by_food


def pick_first(d: dict, ids: list):
    for nid in ids:
        if nid in d and d[nid] is not None:
            return d[nid]
    return None


def main():
    if not SR_DIR and not FF_DIR:
        print('No USDA data directories found in scripts/bulk-data/.', file=sys.stderr)
        print('Run: bash scripts/pull-bulk-data-v2.sh usda  (or unzip the pulled archives).', file=sys.stderr)
        sys.exit(2)

    print('Loading USDA FoodData Central...')
    all_foods = {}
    if FF_DIR:
        ff = load_foods(FF_DIR, 'USDA-Foundation')
        all_foods.update(ff)
        print(f'  Foundation: {len(ff)} foods')
    if SR_DIR:
        sr = load_foods(SR_DIR, 'USDA-SR-Legacy')
        # Prefer Foundation entries if there's a collision by description.
        for k, v in sr.items():
            all_foods.setdefault(k, v)
        print(f'  SR Legacy:  {len(sr)} foods')

    print(f'  Total unique fdc_ids: {len(all_foods)}')

    # Collect nutrient measurements for all foods
    print('Loading nutrient measurements...')
    nutrients_ff = load_nutrients_for_foods(FF_DIR, set(all_foods)) if FF_DIR else {}
    nutrients_sr = load_nutrients_for_foods(SR_DIR, set(all_foods)) if SR_DIR else {}
    combined_nutrients = {**nutrients_sr, **nutrients_ff}  # Foundation takes precedence
    print(f'  Foods with nutrient data: {len(combined_nutrients)}')

    # De-dupe by normalized description — USDA sometimes has near-identical entries
    # across SR Legacy and Foundation. We pick one per slug.
    by_slug = {}
    for fdc, info in all_foods.items():
        s = slug(info['description'])
        if not s:
            continue
        # Prefer Foundation over SR Legacy for the same slug
        if s not in by_slug or info['source'] == 'USDA-Foundation':
            by_slug[s] = (fdc, info)

    print(f'  Unique canonical ingredients (by slug): {len(by_slug)}')

    snapshot = datetime.utcnow().date().isoformat()
    lines = []
    lines.append('-- ============================================================')
    lines.append(f'-- USDA FoodData Central → CIG nutrition_fact rows')
    lines.append(f'-- Generated: {datetime.utcnow().isoformat()}Z')
    lines.append(f'-- Ingester:  {INGESTER} v{VERSION}')
    lines.append(f'-- SR Legacy + Foundation Foods per-100g values, unchanged')
    lines.append(f'-- Source:    {USDA_URL}')
    lines.append('-- ============================================================')
    lines.append('')

    lines.append(f"INSERT INTO ingestion_run (ingester_name, ingester_version, status) VALUES ({esc(INGESTER)}, {esc(VERSION)}, 'running');")
    lines.append('')

    # One fact_evidence row per dataset
    evidence_ids = {
        'USDA-Foundation': 'USDA FoodData Central — Foundation Foods',
        'USDA-SR-Legacy':  'USDA FoodData Central — SR Legacy Foods',
    }
    for tag, name in evidence_ids.items():
        lines.append(
            f"INSERT INTO fact_evidence (source_name, source_url, source_section, snapshot_date, language, retrieved_by) "
            f"VALUES ({esc(name)}, {esc(USDA_URL)}, {esc(tag)}, {esc(snapshot)}, 'en', {esc(INGESTER + ':' + VERSION)}) "
            f"ON CONFLICT(source_url, snapshot_date) DO NOTHING;"
        )
    lines.append('')

    ingredient_count = 0
    nutrition_count = 0
    alias_count = 0

    for s, (fdc, info) in by_slug.items():
        nutri = combined_nutrients.get(fdc, {})
        if not nutri:
            continue

        canonical_id = f'NAME_{s}'
        primary_name = info['description']
        alias_norm = normalize_alias(primary_name)
        source_tag = info['source']

        kcal = pick_first(nutri, NUTRIENTS['energy_kcal'])
        kj   = pick_first(nutri, NUTRIENTS['energy_kj'])
        protein = pick_first(nutri, NUTRIENTS['protein_g'])
        fat = pick_first(nutri, NUTRIENTS['fat_g'])
        sat = pick_first(nutri, NUTRIENTS['sat_fat_g'])
        trans = pick_first(nutri, NUTRIENTS['trans_fat_g'])
        carbs = pick_first(nutri, NUTRIENTS['carbs_g'])
        sugar = pick_first(nutri, NUTRIENTS['sugar_g'])
        fiber = pick_first(nutri, NUTRIENTS['fiber_g'])
        sodium = pick_first(nutri, NUTRIENTS['sodium_mg'])

        # Skip if no useful nutrition data
        if not any(v is not None for v in (kcal, protein, fat, carbs, sugar, sodium)):
            continue

        # Upsert ingredient (ON CONFLICT preserves existing rows from CFR/IARC seeders)
        lines.append(
            f"INSERT INTO ingredient (canonical_id, primary_name, ingredient_class, category, is_natural) "
            f"VALUES ({esc(canonical_id)}, {esc(primary_name)}, 'food', 'food', 1) "
            f"ON CONFLICT(canonical_id) DO NOTHING;"
        )
        ingredient_count += 1

        lines.append(
            f"INSERT INTO ingredient_alias (canonical_id, alias, alias_normalized, alias_type, language_code, confidence, source) "
            f"VALUES ({esc(canonical_id)}, {esc(primary_name)}, {esc(alias_norm)}, 'synonym', 'en', 1.0, {esc(source_tag)}) "
            f"ON CONFLICT(alias_normalized, alias_type, COALESCE(language_code, '')) DO NOTHING;"
        )
        alias_count += 1

        evidence_name = evidence_ids[source_tag]
        lines.append(
            f"INSERT INTO nutrition_fact (canonical_id, source, source_food_id, "
            f"energy_kcal_100g, energy_kj_100g, protein_g_100g, fat_g_100g, saturated_fat_g_100g, "
            f"trans_fat_g_100g, carbohydrate_g_100g, sugar_g_100g, fiber_g_100g, sodium_mg_100g, evidence_id) "
            f"VALUES ({esc(canonical_id)}, {esc(source_tag)}, {esc(fdc)}, "
            f"{num(kcal)}, {num(kj)}, {num(protein)}, {num(fat)}, {num(sat)}, "
            f"{num(trans)}, {num(carbs)}, {num(sugar)}, {num(fiber)}, {num(sodium)}, "
            f"(SELECT id FROM fact_evidence WHERE source_name = {esc(evidence_name)} AND snapshot_date = {esc(snapshot)} LIMIT 1));"
        )
        nutrition_count += 1

    lines.append('')
    lines.append(
        f"UPDATE ingestion_run SET finished_at = datetime('now'), status = 'completed', rows_inserted = {ingredient_count + alias_count + nutrition_count} "
        f"WHERE id = (SELECT id FROM ingestion_run WHERE ingester_name = {esc(INGESTER)} AND status = 'running' ORDER BY started_at DESC LIMIT 1);"
    )
    lines.append('')

    OUTPUT.write_text('\n'.join(lines))

    print('')
    print(f'Wrote {OUTPUT}')
    print(f'  ingredients:    {ingredient_count}')
    print(f'  aliases:        {alias_count}')
    print(f'  nutrition rows: {nutrition_count}')
    print(f'  file size:      {OUTPUT.stat().st_size / 1024 / 1024:.2f} MB')


if __name__ == '__main__':
    main()
