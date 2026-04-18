#!/usr/bin/env python3
"""
FSANZ Schedule 8 (Food additive names and code numbers) → CIG seeder.

Extracts the additive name → INS number list from FSANZ Schedule 8, which
is the Australian/New Zealand list of permitted food additives under the
Food Standards Code.

Outputs:
    scripts/d1-regulatory-fsanz.sql

Source:
    https://www.legislation.gov.au/F2015L00478/latest/text
    (Schedule 8 of the Australia New Zealand Food Standards Code)
"""

import re
import sys
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

import pdfplumber

BASE = Path(__file__).resolve().parent
PDF = BASE / 'bulk-data' / 'sample_fsanz_sched8.pdf'
OUTPUT = BASE / 'd1-regulatory-fsanz.sql'

INGESTER = 'seed-fsanz'
VERSION = '1.0.0'
SOURCE_NAME = 'FSANZ Food Standards Code Schedule 8 — Food additive names and code numbers'
SOURCE_URL = 'https://www.legislation.gov.au/F2015L00478/latest/text'

# INS numbers are 3-4 digits, optionally followed by one or two lowercase letters.
INS_RE = re.compile(r'^(.+?)\s+(\d{2,4}[a-zA-Z]{0,2})\s*$')

GENERIC_SKIP = (
    'schedule 8', 'note ', 'the standards', 'standard 1', 'food standards',
    'page ', 'additive name', 'code number', 'section ',
)


def esc(s):
    if s is None or s == '':
        return 'NULL'
    return "'" + str(s).replace("'", "''") + "'"


def slug(s):
    s = s.lower()
    s = re.sub(r'\([^)]*\)', '', s)
    s = re.sub(r'[^\w\s-]', '', s)
    s = re.sub(r'[\s_-]+', '_', s).strip('_')
    return s[:80]


def normalize_alias(s):
    d = unicodedata.normalize('NFD', s)
    stripped = ''.join(c for c in d if unicodedata.category(c) != 'Mn')
    return re.sub(r'\s+', ' ', stripped).strip().lower()


def extract_additives():
    """Parses the PDF and yields (substance_name, ins_number) tuples."""
    entries = []
    pending_name = ''  # holds continuation text from a wrapped line

    with pdfplumber.open(PDF) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ''
            for raw_line in text.split('\n'):
                line = re.sub(r'\s+', ' ', raw_line).strip()
                if not line:
                    continue
                lower = line.lower()
                if any(lower.startswith(p) for p in GENERIC_SKIP):
                    pending_name = ''
                    continue

                m = INS_RE.match(line)
                if m:
                    name_part = m.group(1).strip()
                    ins = m.group(2)
                    # If there's a pending continuation from a prior line, combine them.
                    full_name = (pending_name + ' ' + name_part).strip() if pending_name else name_part
                    pending_name = ''
                    if len(full_name) >= 3:
                        entries.append((full_name, ins))
                else:
                    # Line without an INS at the end: wrap continuation
                    # only if it looks like text (avoid orphan page numbers etc).
                    if re.search(r'[a-zA-Z]', line) and len(line) <= 120:
                        pending_name = (pending_name + ' ' + line).strip() if pending_name else line
                    else:
                        pending_name = ''
    return entries


def main():
    if not PDF.exists():
        print(f'Missing {PDF}. Run bash scripts/pull-bulk-data-v2.sh first.', file=sys.stderr)
        sys.exit(2)

    entries = extract_additives()
    print(f'Extracted FSANZ entries: {len(entries)}')

    snapshot = datetime.now(timezone.utc).date().isoformat()
    lines = []
    lines.append('-- ============================================================')
    lines.append(f'-- FSANZ Schedule 8 → CIG seed')
    lines.append(f'-- Generated: {datetime.now(timezone.utc).isoformat()}')
    lines.append(f'-- Ingester:  {INGESTER} v{VERSION}')
    lines.append(f'-- Source:    {SOURCE_URL}')
    lines.append('-- ============================================================')
    lines.append('')
    lines.append(f"INSERT INTO ingestion_run (ingester_name, ingester_version, status) VALUES ({esc(INGESTER)}, {esc(VERSION)}, 'running');")
    lines.append('')
    lines.append(
        f"INSERT INTO fact_evidence (source_name, source_url, source_section, snapshot_date, language, retrieved_by) "
        f"VALUES ({esc(SOURCE_NAME)}, {esc(SOURCE_URL)}, 'Schedule 8 — Food additive names and code numbers', {esc(snapshot)}, 'en', {esc(INGESTER + ':' + VERSION)}) "
        f"ON CONFLICT(source_url, snapshot_date) DO NOTHING;"
    )
    lines.append('')

    seen = set()
    ingredient_count = 0
    alias_count = 0
    fact_count = 0

    for name, ins in entries:
        canonical_id = f'NAME_{slug(name)}'
        if not canonical_id or canonical_id == 'NAME_':
            continue
        alias_norm = normalize_alias(name)

        if canonical_id not in seen:
            seen.add(canonical_id)
            lines.append(
                f"INSERT INTO ingredient (canonical_id, primary_name, ingredient_class, ins_number, category, is_natural) "
                f"VALUES ({esc(canonical_id)}, {esc(name)}, 'substance', {esc(ins)}, 'food', 0) "
                f"ON CONFLICT(canonical_id) DO NOTHING;"
            )
            ingredient_count += 1

            lines.append(
                f"INSERT INTO ingredient_alias (canonical_id, alias, alias_normalized, alias_type, language_code, confidence, source) "
                f"VALUES ({esc(canonical_id)}, {esc(name)}, {esc(alias_norm)}, 'synonym', 'en', 1.0, 'FSANZ-Sched8') "
                f"ON CONFLICT(alias_normalized, alias_type, COALESCE(language_code, '')) DO NOTHING;"
            )
            alias_count += 1

            # INS number as alias
            lines.append(
                f"INSERT INTO ingredient_alias (canonical_id, alias, alias_normalized, alias_type, language_code, confidence, source) "
                f"VALUES ({esc(canonical_id)}, {esc(ins)}, {esc(normalize_alias(ins))}, 'ins_number', NULL, 1.0, 'FSANZ-Sched8') "
                f"ON CONFLICT(alias_normalized, alias_type, COALESCE(language_code, '')) DO NOTHING;"
            )
            alias_count += 1

        status = f'Permitted food additive in Australia/New Zealand (INS {ins})'
        lines.append(
            f"INSERT OR IGNORE INTO regulatory_fact (canonical_id, jurisdiction, fact_type, status, regulation_ref, product_category, evidence_id) "
            f"VALUES ({esc(canonical_id)}, 'AU_NZ_FSANZ', 'permitted', {esc(status)}, "
            f"'FSANZ Schedule 8', 'food', "
            f"(SELECT id FROM fact_evidence WHERE source_url = {esc(SOURCE_URL)} AND snapshot_date = {esc(snapshot)} LIMIT 1));"
        )
        fact_count += 1

    lines.append('')
    lines.append(
        f"UPDATE ingestion_run SET finished_at = datetime('now'), status = 'completed', rows_inserted = {ingredient_count + alias_count + fact_count} "
        f"WHERE id = (SELECT id FROM ingestion_run WHERE ingester_name = {esc(INGESTER)} AND status = 'running' ORDER BY started_at DESC LIMIT 1);"
    )

    OUTPUT.write_text('\n'.join(lines))
    print(f'Wrote {OUTPUT}')
    print(f'  ingredients: {ingredient_count}')
    print(f'  aliases:     {alias_count}')
    print(f'  facts:       {fact_count}')


if __name__ == '__main__':
    main()
