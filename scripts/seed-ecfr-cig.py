#!/usr/bin/env python3
"""
FDA CFR Title 21 → Canonical Ingredient Graph seeder.

Parses eCFR XML files in scripts/bulk-data/ (produced by pull-bulk-data.sh ecfr)
and emits SQL for the new regulatory schema.

For each substance-named section (e.g. "§ 184.1005 Acetic acid"):
    - ingredient row           (NAME_-prefixed canonical_id)
    - ingredient_alias row     (the substance name as a synonym)
    - fact_evidence row        (one per part)
    - regulatory_fact row      (US_FDA jurisdiction, fact_type by part)

Fact types by part:
    74                  permitted (color additives listing)
    172, 173            permitted (direct food additives)
    174-178             permitted (indirect food additives)
    179                 permitted (irradiation)
    180, 181            restricted / prior sanctioned
    182, 184, 186       gras
    189                 prohibited
    700, 701, 720, 740  permitted (cosmetics)

Substance name extraction uses section headers of the form
    "§ N.M Substance name."
General / procedural / definitional sections are skipped by heuristic.

Usage:
    python3 scripts/seed-ecfr-cig.py

Output:
    scripts/d1-regulatory-ecfr-21.sql

Then import:
    npx wrangler d1 execute consumer-truth-regulatory --remote \
        --file=scripts/d1-regulatory-ecfr-21.sql

Source:
    FDA Code of Federal Regulations, Title 21, via eCFR versioner API.
    https://www.ecfr.gov/current/title-21
"""

import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from datetime import datetime

BASE = Path(__file__).resolve().parent
BULK_DIR = BASE / 'bulk-data'
OUTPUT = BASE / 'd1-regulatory-ecfr-21.sql'

INGESTER = 'seed-ecfr-cig'
VERSION = '1.0.0'

SOURCE_NAME = 'FDA Code of Federal Regulations, Title 21'
ECFR_BASE_URL = 'https://www.ecfr.gov/current/title-21'

PART_FACT_TYPE = {
    # Only parts that list substances per-section. Procedural / policy parts
    # (170, 171, 179, 701, 720, 740) are excluded — they define rules, not
    # substances, and would generate noise rows.
    74:  ('permitted',  'subchapter-A'),
    172: ('permitted',  'subchapter-B'),
    173: ('permitted',  'subchapter-B'),
    175: ('permitted',  'subchapter-B'),
    176: ('permitted',  'subchapter-B'),
    177: ('permitted',  'subchapter-B'),
    178: ('permitted',  'subchapter-B'),
    180: ('restricted', 'subchapter-B'),
    181: ('permitted',  'subchapter-B'),
    182: ('gras',       'subchapter-B'),
    184: ('gras',       'subchapter-B'),
    186: ('gras',       'subchapter-B'),
    189: ('prohibited', 'subchapter-B'),
    700: ('permitted',  'subchapter-G'),
}

PART_TITLES = {
    74:  'Listing of Color Additives Subject to Certification',
    170: 'Food Additives',
    171: 'Food Additive Petitions',
    172: 'Food Additives Permitted for Direct Addition to Food for Human Consumption',
    173: 'Secondary Direct Food Additives Permitted in Food for Human Consumption',
    174: 'Indirect Food Additives: General',
    175: 'Indirect Food Additives: Adhesives and Components of Coatings',
    176: 'Indirect Food Additives: Paper and Paperboard Components',
    177: 'Indirect Food Additives: Polymers',
    178: 'Indirect Food Additives: Adjuvants, Production Aids, and Sanitizers',
    179: 'Irradiation in the Production, Processing and Handling of Food',
    180: 'Food Additives Permitted in Food or in Contact with Food on an Interim Basis',
    181: 'Prior-Sanctioned Food Ingredients',
    182: 'Substances Generally Recognized as Safe',
    184: 'Direct Food Substances Affirmed as Generally Recognized as Safe',
    186: 'Indirect Food Substances Affirmed as Generally Recognized as Safe',
    189: 'Substances Prohibited from Use in Human Food',
    700: 'General (Cosmetics)',
    701: 'Cosmetic Labeling',
    720: 'Voluntary Filing of Cosmetic Product Ingredient Composition Statements',
    740: 'Cosmetic Product Warning Statements',
}

GENERIC_TITLE_MARKERS = (
    'definitions', 'scope', 'authority', 'general provisions', 'petitions',
    'applications', 'labeling', 'standards of identity', 'general requirements',
    'nomenclature', 'substances added directly to human food',
    'substances generally recognized as safe', 'filing of',
    'enforcement', 'exemption', 'exemptions',
    'general principles', 'safety factors', 'eligibility for classification',
    'affirmation of', 'criteria for', 'requirements and standards',
    'basis for classification', 'general considerations', 'purpose',
    'list of ', 'listing of ', 'recommended use', 'directions for',
    'restrictions on', 'conditions of safe use', 'conditions of use',
    'use of', 'procedure for', 'procedures for', 'review of',
)

HEADER_RE = re.compile(r'§\s*(\d+(?:\.\d+)?)\s+(.+?)\.?\s*$', re.DOTALL)


def parse_section_header(text: str):
    """'§ 184.1005 Acetic acid.' -> ('184.1005', 'Acetic acid')"""
    m = HEADER_RE.match(text.strip())
    if not m:
        return None, None
    return m.group(1), re.sub(r'\s+', ' ', m.group(2)).strip()


def is_substance_section(section_num: str, name: str) -> bool:
    if not section_num or not name:
        return False
    parts = section_num.split('.')
    if len(parts) != 2:
        return False
    try:
        subnum = int(parts[1])
    except ValueError:
        return False
    if subnum < 10:                       # part intros (e.g. 184.1, 184.2) skipped
        return False
    lower = name.lower()
    if any(m in lower for m in GENERIC_TITLE_MARKERS):
        return False
    if len(name) > 160:                   # likely prose, not a substance name
        return False
    return True


def slugify(s: str) -> str:
    s = s.lower()
    s = re.sub(r"[^\w\s-]", "", s)
    s = re.sub(r"[\s-]+", "_", s).strip("_")
    return s[:80]


def normalize_alias(s: str) -> str:
    # Mirrors lib/analysis-grounded.ts normalizeAliasClientSide so that
    # alias rows seeded from Python match what the query engine produces
    # at runtime. NFD decomposition strips combining diacritics.
    import unicodedata
    decomposed = unicodedata.normalize('NFD', s)
    stripped = ''.join(c for c in decomposed if unicodedata.category(c) != 'Mn')
    return re.sub(r'\s+', ' ', stripped).strip().lower()


def escape_sql(s) -> str:
    if s is None:
        return 'NULL'
    return "'" + str(s).replace("'", "''") + "'"


def read_snapshot_date() -> str:
    p = BULK_DIR / 'ecfr-21-snapshot-date.txt'
    if p.exists():
        return p.read_text().strip()
    return datetime.utcnow().date().isoformat()


def section_source_url(snapshot: str, part: int, section: str) -> str:
    # Canonical eCFR path for a specific section
    return f'https://www.ecfr.gov/on/{snapshot}/title-21/section-{section}'


def part_source_url(snapshot: str, part: int) -> str:
    return f'https://www.ecfr.gov/on/{snapshot}/title-21/part-{part}'


def gather_sections(snapshot: str):
    """Returns list of dicts describing substance sections parsed from all CFR XML files."""
    sections = []
    xml_files = sorted(BULK_DIR.glob('ecfr-21-part-*.xml'))
    if not xml_files:
        print('No ecfr-21-part-*.xml files in scripts/bulk-data/. Run: bash scripts/pull-bulk-data.sh ecfr', file=sys.stderr)
        return []

    for xml_file in xml_files:
        m = re.match(r'ecfr-21-part-(\d+)\.xml$', xml_file.name)
        if not m:
            continue
        part_num = int(m.group(1))

        if part_num not in PART_FACT_TYPE:
            print(f'  skip (unknown part): {xml_file.name}', file=sys.stderr)
            continue

        fact_type, subchapter = PART_FACT_TYPE[part_num]
        part_title = PART_TITLES.get(part_num, f'Part {part_num}')

        try:
            tree = ET.parse(xml_file)
        except ET.ParseError as e:
            print(f'  PARSE FAIL {xml_file.name}: {e}', file=sys.stderr)
            continue

        root = tree.getroot()
        sect_count = 0
        skip_count = 0
        for sec in root.findall('.//DIV8'):
            head = sec.find('HEAD')
            if head is None or not head.text:
                continue
            section_num, substance_name = parse_section_header(head.text)
            if not is_substance_section(section_num, substance_name):
                skip_count += 1
                continue
            sections.append({
                'part': part_num,
                'part_title': part_title,
                'subchapter': subchapter,
                'section': section_num,
                'name': substance_name,
                'fact_type': fact_type,
            })
            sect_count += 1
        print(f'  part {part_num}: {sect_count} substance sections, {skip_count} skipped (non-substance)')
    return sections


def emit_sql(sections, snapshot: str):
    lines = []
    lines.append('-- ============================================================')
    lines.append(f'-- FDA CFR Title 21 -> Canonical Ingredient Graph seed')
    lines.append(f'-- Generated: {datetime.utcnow().isoformat()}Z')
    lines.append(f'-- Ingester: {INGESTER} v{VERSION}')
    lines.append(f'-- eCFR snapshot date: {snapshot}')
    lines.append(f'-- Parts ingested: {sorted(set(s["part"] for s in sections))}')
    lines.append(f'-- Substance sections found: {len(sections)}')
    lines.append('-- ============================================================')
    lines.append('')
    # Note: D1 rejects raw BEGIN TRANSACTION / COMMIT (use JS transaction API instead).
    # Wrangler applies each statement individually; idempotent ON CONFLICT clauses provide safety.
    lines.append('')
    lines.append(f'INSERT INTO ingestion_run (ingester_name, ingester_version, status)')
    lines.append(f'  VALUES ({escape_sql(INGESTER)}, {escape_sql(VERSION)}, \'running\');')
    lines.append('')

    # Emit one fact_evidence row per (part, snapshot) combo — keeps provenance
    # granular while avoiding per-section evidence explosion.
    parts_seen = {}  # part_num -> (url, section_title)
    for s in sections:
        parts_seen.setdefault(s['part'], (part_source_url(snapshot, s['part']), s['part_title']))

    lines.append('-- fact_evidence: one row per CFR Part ingested')
    for part_num, (url, title) in sorted(parts_seen.items()):
        source_section = f'21 CFR Part {part_num} — {title}'
        lines.append(
            f'INSERT INTO fact_evidence (source_name, source_url, source_section, snapshot_date, language, retrieved_by) '
            f'VALUES ({escape_sql(SOURCE_NAME)}, {escape_sql(url)}, {escape_sql(source_section)}, {escape_sql(snapshot)}, \'en\', {escape_sql(INGESTER + ":" + VERSION)}) '
            f'ON CONFLICT(source_url, snapshot_date) DO NOTHING;'
        )
    lines.append('')

    # Track duplicates within this ingestion
    seen_canonical_ids = set()
    ingredient_count = 0
    alias_count = 0
    fact_count = 0

    lines.append('-- ingredient + alias + regulatory_fact per substance section')
    for s in sections:
        section_num = s['section']
        part_num = s['part']
        name = s['name']
        fact_type = s['fact_type']

        canonical_id = f'NAME_{slugify(name)}'
        alias_norm = normalize_alias(name)
        source_url = section_source_url(snapshot, part_num, section_num)
        part_url = parts_seen[part_num][0]
        reg_ref = f'21 CFR §{section_num}'
        status_human = f'{fact_type.upper() if fact_type != "gras" else "GRAS"} per {reg_ref} ({PART_TITLES[part_num]})'

        if canonical_id not in seen_canonical_ids:
            lines.append(
                f'INSERT INTO ingredient (canonical_id, primary_name, ingredient_class, category, is_natural) '
                f'VALUES ({escape_sql(canonical_id)}, {escape_sql(name)}, \'substance\', '
                f'{"'cosmetic'" if part_num >= 700 else "'food'"}, 0) '
                f'ON CONFLICT(canonical_id) DO NOTHING;'
            )
            ingredient_count += 1
            seen_canonical_ids.add(canonical_id)

            lines.append(
                f'INSERT INTO ingredient_alias (canonical_id, alias, alias_normalized, alias_type, language_code, confidence, source) '
                f'VALUES ({escape_sql(canonical_id)}, {escape_sql(name)}, {escape_sql(alias_norm)}, '
                f'\'synonym\', \'en\', 1.0, \'FDA CFR 21\') '
                f'ON CONFLICT(alias_normalized, alias_type, COALESCE(language_code, \'\')) DO NOTHING;'
            )
            alias_count += 1

        lines.append(
            f'INSERT INTO regulatory_fact (canonical_id, jurisdiction, fact_type, status, regulation_ref, product_category, evidence_id) '
            f'VALUES ({escape_sql(canonical_id)}, \'US_FDA\', {escape_sql(fact_type)}, {escape_sql(status_human)}, {escape_sql(reg_ref)}, '
            f'{"'cosmetic'" if part_num >= 700 else "'food'"}, '
            f'(SELECT id FROM fact_evidence WHERE source_url = {escape_sql(part_url)} AND snapshot_date = {escape_sql(snapshot)} LIMIT 1));'
        )
        fact_count += 1

    lines.append('')
    lines.append(f'UPDATE ingestion_run SET finished_at = datetime(\'now\'), status = \'completed\', rows_inserted = {ingredient_count + alias_count + fact_count} '
                 f'WHERE id = (SELECT id FROM ingestion_run WHERE ingester_name = {escape_sql(INGESTER)} AND status = \'running\' ORDER BY started_at DESC LIMIT 1);')
    lines.append('')

    OUTPUT.write_text('\n'.join(lines))
    return ingredient_count, alias_count, fact_count


def main():
    snapshot = read_snapshot_date()
    print(f'eCFR snapshot date: {snapshot}')
    print('Scanning XML files...')
    sections = gather_sections(snapshot)
    if not sections:
        sys.exit(2)
    ingredient_count, alias_count, fact_count = emit_sql(sections, snapshot)
    print('')
    print(f'Wrote {OUTPUT}')
    print(f'  ingredients: {ingredient_count}')
    print(f'  aliases:     {alias_count}')
    print(f'  facts:       {fact_count}')
    print('')
    print('Apply to regulatory D1:')
    print(f'  npx wrangler d1 execute consumer-truth-regulatory --remote --file={OUTPUT.relative_to(Path.cwd())}')


if __name__ == '__main__':
    main()
