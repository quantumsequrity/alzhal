#!/usr/bin/env python3
"""
Health Canada Cosmetic Ingredient Hotlist → CIG seeder.

Parses the two tables from the "Cosmetic Ingredient Hotlist – List of Ingredients
that are Prohibited for Use in Cosmetic Products" HTML page.

Outputs:
    scripts/d1-regulatory-hc-hotlist.sql

Source:
    https://www.canada.ca/en/health-canada/services/consumer-product-safety/cosmetics/cosmetic-ingredient-hotlist-prohibited-restricted-ingredients.html
"""

import re
import sys
import unicodedata
from datetime import datetime
from html import unescape
from pathlib import Path

BASE = Path(__file__).resolve().parent
HTML_FILE = BASE / 'bulk-data' / 'sample_hc_hotlist.html'
OUTPUT    = BASE / 'd1-regulatory-hc-hotlist.sql'

INGESTER = 'seed-hc-hotlist'
VERSION  = '1.0.0'
SOURCE_NAME = 'Health Canada — Cosmetic Ingredient Hotlist'
SOURCE_URL  = 'https://www.canada.ca/en/health-canada/services/consumer-product-safety/cosmetics/cosmetic-ingredient-hotlist-prohibited-restricted-ingredients.html'

CAS_RE = re.compile(r'\b\d{2,7}-\d{2}-\d\b')


def esc(s) -> str:
    if s is None or s == '':
        return 'NULL'
    return "'" + str(s).replace("'", "''") + "'"


def slug(s: str) -> str:
    s = s.lower()
    s = re.sub(r'\([^)]*\)', '', s)
    s = re.sub(r'[^\w\s-]', '', s)
    s = re.sub(r'[\s_-]+', '_', s).strip('_')
    return s[:80]


def normalize_alias(s: str) -> str:
    d = unicodedata.normalize('NFD', s)
    stripped = ''.join(c for c in d if unicodedata.category(c) != 'Mn')
    return re.sub(r'\s+', ' ', stripped).strip().lower()


def clean_cell(html: str) -> str:
    text = re.sub(r'<[^>]+>', ' ', html)
    text = unescape(text)
    return re.sub(r'\s+', ' ', text).replace('\xa0', ' ').strip()


def parse_tables(html: str):
    """Returns (prohibited_rows, restricted_rows) each as list of dicts."""
    tables = re.findall(r'<table[\s\S]*?</table>', html)
    if len(tables) < 2:
        raise SystemExit(f'Expected 2 tables in hotlist HTML, found {len(tables)}')

    def extract_rows(table_html, expected_cols):
        rows = re.findall(r'<tr[\s\S]*?</tr>', table_html)
        data = []
        for r in rows:
            cells = re.findall(r'<t[dh][^>]*>([\s\S]*?)</t[dh]>', r)
            if len(cells) < expected_cols:
                continue
            cleaned = [clean_cell(c) for c in cells]
            # Skip header rows (first three cells identical to header labels is a weak signal;
            # simplest heuristic: if the first cell contains an ingredient-shaped string, keep).
            if not cleaned[0] or cleaned[0].lower() in (
                'ingredient', 'ingredient information', 'restrictions'
            ):
                continue
            data.append(cleaned)
        return data

    prohibited = extract_rows(tables[0], 3)
    restricted = extract_rows(tables[1], 6)
    return prohibited, restricted


def main():
    if not HTML_FILE.exists():
        print(f'Missing {HTML_FILE}. Run bash scripts/pull-bulk-data-v2.sh first.', file=sys.stderr)
        sys.exit(2)

    html = HTML_FILE.read_text(encoding='utf-8', errors='replace')
    prohibited, restricted = parse_tables(html)
    print(f'Prohibited rows: {len(prohibited)}')
    print(f'Restricted rows (line-level): {len(restricted)}')

    snapshot = datetime.now(datetime.now().astimezone().tzinfo).date().isoformat()
    lines = []
    lines.append('-- ============================================================')
    lines.append(f'-- Health Canada Cosmetic Ingredient Hotlist → CIG seed')
    lines.append(f'-- Generated: {datetime.now().astimezone().isoformat()}')
    lines.append(f'-- Ingester:  {INGESTER} v{VERSION}')
    lines.append('-- ============================================================')
    lines.append('')
    lines.append(f"INSERT INTO ingestion_run (ingester_name, ingester_version, status) VALUES ({esc(INGESTER)}, {esc(VERSION)}, 'running');")
    lines.append('')
    lines.append(
        f"INSERT INTO fact_evidence (source_name, source_url, source_section, snapshot_date, language, retrieved_by) "
        f"VALUES ({esc(SOURCE_NAME)}, {esc(SOURCE_URL)}, 'Prohibited and Restricted Ingredients', {esc(snapshot)}, 'en', {esc(INGESTER + ':' + VERSION)}) "
        f"ON CONFLICT(source_url, snapshot_date) DO NOTHING;"
    )
    lines.append('')

    ingredient_count = 0
    fact_count = 0
    seen_canonical = set()

    def emit_substance(ingredient_name, cas_field, fact_type, status_text):
        nonlocal ingredient_count, fact_count
        cas_matches = CAS_RE.findall(cas_field or '')
        primary_cas = cas_matches[0] if cas_matches else None
        canonical_id = f'CAS_{primary_cas.replace("-", "_")}' if primary_cas else f'NAME_{slug(ingredient_name)}'
        if not canonical_id or canonical_id == 'NAME_':
            return
        alias_norm = normalize_alias(ingredient_name)

        if canonical_id not in seen_canonical:
            seen_canonical.add(canonical_id)
            lines.append(
                f"INSERT INTO ingredient (canonical_id, primary_name, ingredient_class, cas_number, category, is_natural) "
                f"VALUES ({esc(canonical_id)}, {esc(ingredient_name)}, 'substance', {esc(primary_cas)}, 'cosmetic', 0) "
                f"ON CONFLICT(canonical_id) DO NOTHING;"
            )
            ingredient_count += 1
            lines.append(
                f"INSERT INTO ingredient_alias (canonical_id, alias, alias_normalized, alias_type, language_code, confidence, source) "
                f"VALUES ({esc(canonical_id)}, {esc(ingredient_name)}, {esc(alias_norm)}, 'synonym', 'en', 1.0, 'HC-Hotlist') "
                f"ON CONFLICT(alias_normalized, alias_type, COALESCE(language_code, '')) DO NOTHING;"
            )
            if primary_cas:
                lines.append(
                    f"INSERT INTO ingredient_alias (canonical_id, alias, alias_normalized, alias_type, language_code, confidence, source) "
                    f"VALUES ({esc(canonical_id)}, {esc(primary_cas)}, {esc(normalize_alias(primary_cas))}, 'cas', NULL, 1.0, 'HC-Hotlist') "
                    f"ON CONFLICT(alias_normalized, alias_type, COALESCE(language_code, '')) DO NOTHING;"
                )

        lines.append(
            f"INSERT OR IGNORE INTO regulatory_fact (canonical_id, jurisdiction, fact_type, status, regulation_ref, product_category, evidence_id) "
            f"VALUES ({esc(canonical_id)}, 'CA_HC', {esc(fact_type)}, {esc(status_text)}, "
            f"'Health Canada Cosmetic Ingredient Hotlist', 'cosmetic', "
            f"(SELECT id FROM fact_evidence WHERE source_url = {esc(SOURCE_URL)} AND snapshot_date = {esc(snapshot)} LIMIT 1));"
        )
        fact_count += 1

    # Prohibited table
    for row in prohibited:
        if len(row) >= 2 and row[0]:
            emit_substance(row[0], row[1] if len(row) > 1 else '', 'prohibited',
                           f'Prohibited in cosmetic products (Health Canada Hotlist)')

    # Restricted table — multi-line rows for compound restrictions. We group
    # by the leading ingredient name (rows with non-empty col 0 are primary).
    # Sub-rows (empty col 0) carry continuation of the restrictions.
    current_primary = None
    restriction_lines = []

    def flush_restricted():
        if current_primary and current_primary[0]:
            status = 'Restricted in cosmetic products (Health Canada Hotlist)'
            if restriction_lines:
                status += ' — ' + '; '.join(restriction_lines)[:300]
            emit_substance(current_primary[0], current_primary[1] if len(current_primary) > 1 else '',
                           'restricted', status)

    for row in restricted:
        first = row[0].strip() if row else ''
        if first:  # new primary substance
            flush_restricted()
            current_primary = row
            restriction_lines = []
            if len(row) >= 5 and (row[3] or row[4]):
                parts = [x for x in (row[3], row[4]) if x]
                if parts:
                    restriction_lines.append(' '.join(parts))
        else:  # continuation sub-row
            if len(row) >= 5 and (row[3] or row[4]):
                parts = [x for x in (row[3], row[4]) if x]
                if parts:
                    restriction_lines.append(' '.join(parts))
    flush_restricted()

    lines.append('')
    lines.append(
        f"UPDATE ingestion_run SET finished_at = datetime('now'), status = 'completed', rows_inserted = {ingredient_count + fact_count} "
        f"WHERE id = (SELECT id FROM ingestion_run WHERE ingester_name = {esc(INGESTER)} AND status = 'running' ORDER BY started_at DESC LIMIT 1);"
    )

    OUTPUT.write_text('\n'.join(lines))
    print(f'Wrote {OUTPUT}')
    print(f'  ingredients: {ingredient_count}')
    print(f'  facts:       {fact_count}')


if __name__ == '__main__':
    main()
