#!/usr/bin/env bash
# Pulls bulk regulatory data from official sources into scripts/bulk-data/.
# Idempotent: skips files that already exist with non-zero size.
#
# Usage:
#   bash scripts/pull-bulk-data.sh [source]
#
# Sources:
#   all             — everything below (default)
#   iarc            — IARC Monographs classifications (PDF, ~2 MB)
#   ecfr            — FDA CFR Title 21 relevant parts (XML, ~20 MB)
#   health_canada   — Health Canada Cosmetic Ingredient Hotlist (HTML)
#   openfda         — openFDA food endpoints download manifest (JSON)
#   usda            — instructions (versioned filenames — user must pick current)
#   eu_cosing       — instructions (EU Commission UI requires manual export)
#   eu_additives    — instructions (EU Commission Excel download)
#   efsa            — instructions (Zenodo record — pick current release)
#   codex           — instructions (FAO PDF navigation)
#   fsanz           — instructions (Australia/NZ legislation site)
#   japan           — instructions (MHLW English portal)
#   fssai           — instructions (FSSAI regulations + amendments PDFs)
#   bis             — instructions (BIS standards portal, some paywalled)
#
# Auto-fetched sources are fetched over HTTPS with retry. The "instructions"
# sources describe the manual steps honestly because their download URLs
# either rotate, require UI navigation, or require an account.

set -u
set -o pipefail

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BULK_DIR="${BASE_DIR}/scripts/bulk-data"
mkdir -p "${BULK_DIR}"

LOG="${BULK_DIR}/_pull.log"
: > "${LOG}"

log()    { printf '[%s] %s\n' "$(date -Is)" "$*" | tee -a "${LOG}"; }
notify() { printf '\n=== %s ===\n' "$*" | tee -a "${LOG}"; }

skip_if_exists() {
  if [ -s "$1" ]; then
    log "SKIP (exists, $(wc -c < "$1") bytes): $1"
    return 0
  fi
  return 1
}

fetch() {
  local url="$1"
  local out="$2"
  skip_if_exists "${out}" && return 0
  log "FETCH ${url} -> ${out}"
  if curl -sSL --fail --retry 3 --retry-delay 2 --max-time 120 \
          -A "Alzhal-Ingester/1.0" \
          -o "${out}" "${url}"; then
    log "OK     ${out} ($(wc -c < "${out}") bytes)"
  else
    log "FAIL   ${url}"
    rm -f "${out}"
    return 1
  fi
}

# --- Auto-fetched sources ---

pull_iarc() {
  notify "IARC Monographs — cumulative cross-index (agent → group → volume)"
  # IARC's official cumulative index PDF: lists every classified agent with its group + monograph volume.
  # Linked from https://monographs.iarc.who.int/agents-classified-by-the-iarc/
  # Baseline is 2018. Newer volumes (post-Vol 123) require manual addition — log a note.
  fetch "https://monographs.iarc.who.int/wp-content/uploads/2018/07/cumulative-cross-index.pdf" \
        "${BULK_DIR}/iarc-classifications.pdf"
  fetch "https://monographs.iarc.who.int/wp-content/uploads/2018/07/List-of-Volumes.pdf" \
        "${BULK_DIR}/iarc-list-of-volumes.pdf"
  log "NOTE: IARC cross-index PDF is the 2018 cumulative baseline."
  log "      Monograph volumes published since (Vol 124+) need manual addition."
  log "      Check https://monographs.iarc.who.int/list-of-classifications/ for current volumes."
}

pull_ecfr() {
  notify "FDA CFR Title 21 — food additives + GRAS + cosmetics parts"
  # eCFR snapshots are dated per-title; use the latest_issue_date, not today's date.
  local date
  date="$(curl -sSL --fail --max-time 30 -A "Alzhal-Ingester/1.0" \
            "https://www.ecfr.gov/api/versioner/v1/titles.json" \
            | python3 -c "import json,sys; d=json.load(sys.stdin); print([t for t in d['titles'] if t['number']==21][0]['latest_issue_date'])" 2>/dev/null)"
  if [ -z "${date}" ]; then
    log "FAIL  could not determine eCFR Title 21 latest date"
    return 1
  fi
  log "Using eCFR Title 21 date: ${date}"

  # Subchapter B — Food for Human Consumption (Parts 100–199)
  local subb=(170 171 172 173 174 175 176 177 178 179 180 181 182 184 186 189)
  for part in "${subb[@]}"; do
    fetch "https://www.ecfr.gov/api/versioner/v1/full/${date}/title-21.xml?chapter=I&subchapter=B&part=${part}" \
          "${BULK_DIR}/ecfr-21-part-${part}.xml"
    sleep 1
  done

  # Subchapter A — General (Part 74: Listing of Color Additives)
  fetch "https://www.ecfr.gov/api/versioner/v1/full/${date}/title-21.xml?chapter=I&subchapter=A&part=74" \
        "${BULK_DIR}/ecfr-21-part-74.xml"
  sleep 1

  # Subchapter G — Cosmetics (Parts 700-740)
  local subg=(700 701 720 740)
  for part in "${subg[@]}"; do
    fetch "https://www.ecfr.gov/api/versioner/v1/full/${date}/title-21.xml?chapter=I&subchapter=G&part=${part}" \
          "${BULK_DIR}/ecfr-21-part-${part}.xml"
    sleep 1
  done

  # Record the snapshot date for the ingester
  printf '%s\n' "${date}" > "${BULK_DIR}/ecfr-21-snapshot-date.txt"
}

pull_health_canada() {
  notify "Health Canada Cosmetic Ingredient Hotlist — try automated, fall back to manual"
  # canada.ca sometimes blocks automated User-Agents with HTTP/2 stream errors.
  if ! fetch "https://www.canada.ca/en/health-canada/services/consumer-product-safety/cosmetics/cosmetic-ingredient-hotlist-prohibited-restricted-ingredients.html" \
             "${BULK_DIR}/health-canada-hotlist.html"; then
    cat >&2 <<EOF
Automated fetch failed (canada.ca sometimes blocks non-browser clients).
Manual step:
  1. Open in a browser: https://www.canada.ca/en/health-canada/services/consumer-product-safety/cosmetics/cosmetic-ingredient-hotlist-prohibited-restricted-ingredients.html
  2. Save page as HTML (Ctrl+S → Web Page, HTML Only)
  3. Move the saved file to: ${BULK_DIR}/health-canada-hotlist.html
EOF
  fi
}

pull_openfda() {
  notify "openFDA bulk download manifest (food endpoints)"
  fetch "https://api.fda.gov/download.json" \
        "${BULK_DIR}/openfda-downloads.json"
  log "Parse this manifest in a follow-up script to selectively download food/event and food/enforcement ZIPs."
}

# --- Manual-steps sources (honest about what's not auto-downloadable) ---

pull_usda() {
  notify "USDA FoodData Central (bulk) — MANUAL STEP"
  cat >&2 <<EOF
USDA publishes quarterly CSV bulk dumps with versioned filenames (dates roll).
  1. Visit: https://fdc.nal.usda.gov/download-datasets.html
  2. Download:
     - 'SR Legacy' CSV ZIP   (~50 MB, ~8K foods)
     - 'Foundation Foods' CSV ZIP (~10 MB, ~200 foods)
  3. Save as:
     ${BULK_DIR}/usda-sr-legacy.zip
     ${BULK_DIR}/usda-foundation.zip
  (Skipping 'Branded Foods' — 1.5M products, 2 GB; call API instead when needed.)
EOF
}

pull_eu_cosing() {
  notify "EU CosIng (cosmetic ingredient database) — MANUAL STEP"
  cat >&2 <<EOF
EU Commission CosIng database requires UI export.
  1. Visit: https://single-market-economy.ec.europa.eu/sectors/cosmetics/cosmetics-products/cosmetic-ingredient-database_en
  2. Export each Annex as CSV/XLSX:
     - Annex II  (prohibited)
     - Annex III (restricted)
     - Annex IV  (colorants)
     - Annex V   (preservatives)
     - Annex VI  (UV filters)
  3. Save to:
     ${BULK_DIR}/eu-cosing-annex-ii.csv
     ${BULK_DIR}/eu-cosing-annex-iii.csv
     ${BULK_DIR}/eu-cosing-annex-iv.csv
     ${BULK_DIR}/eu-cosing-annex-v.csv
     ${BULK_DIR}/eu-cosing-annex-vi.csv
EOF
}

pull_eu_additives() {
  notify "EU Food Additives (Reg. 1333/2008) — MANUAL STEP"
  cat >&2 <<EOF
  1. Visit: https://food.ec.europa.eu/safety/food-improvement-agents/additives/database_en
  2. Click the 'Download Excel' button (Annex II entries)
  3. Save to: ${BULK_DIR}/eu-food-additives-annex-ii.xlsx
EOF
}

pull_efsa() {
  notify "EFSA OpenFoodTox — MANUAL STEP"
  cat >&2 <<EOF
Latest release on Zenodo (version numbers change).
  1. Search: https://zenodo.org/search?q=OpenFoodTox
  2. Download the most recent .xlsx or .csv
  3. Save to: ${BULK_DIR}/efsa-openfoodtox.xlsx
EOF
}

pull_codex() {
  notify "Codex Alimentarius GSFA (General Standard for Food Additives) — MANUAL STEP"
  cat >&2 <<EOF
  1. Visit: https://www.fao.org/fao-who-codexalimentarius/codex-texts/list-standards/en/
  2. Locate 'General Standard for Food Additives (CODEX STAN 192-1995)'
  3. Download the PDF
  4. Save to: ${BULK_DIR}/codex-gsfa-192-1995.pdf

  Alternative (structured online DB): https://www.fao.org/gsfaonline/
EOF
}

pull_fsanz() {
  notify "FSANZ Food Standards Code — MANUAL STEP"
  cat >&2 <<EOF
  1. Visit: https://www.foodstandards.gov.au/code/Pages/default.aspx
  2. Download schedules 14-20 (additive-related):
     - Schedule 14  Technological purposes (additives)
     - Schedule 15  Permitted substances for food additives
     - Schedule 16  Permitted substances for processing aids
     - Schedule 17  Vitamins and minerals
     - Schedule 18  Processing aids
     - Schedule 19  Prohibited and restricted ingredients
     - Schedule 20  Maximum residue limits
  3. Save to: ${BULK_DIR}/fsanz-schedule-14.pdf  ...  fsanz-schedule-20.pdf
EOF
}

pull_japan() {
  notify "Japan MHLW food additives — MANUAL STEP"
  cat >&2 <<EOF
  1. Visit: https://www.mhlw.go.jp/english/topics/foodsafety/foodadditives/
  2. Download 'List of Designated Additives' and 'Existing Food Additives List'
  3. Save to: ${BULK_DIR}/japan-mhlw-designated.pdf  and  japan-mhlw-existing.pdf
EOF
}

pull_fssai() {
  notify "FSSAI regulations (India) — MANUAL STEP"
  cat >&2 <<EOF
FSSAI does not expose a machine-readable API; regulations are PDFs.
  1. Visit: https://www.fssai.gov.in/cms/food-safety-and-standards-regulations.php
  2. Download the core document:
     'Food Safety and Standards (Food Products Standards and Food Additives)
      Regulations, 2011' (consolidated with amendments)
  3. Also download each amendment PDF published since 2011.
  4. Save to:
     ${BULK_DIR}/fssai-fss-2011.pdf
     ${BULK_DIR}/fssai-amendment-<YYYY-MM>.pdf (one per amendment)

The Python PDF parser (build-reference-db.py, pdfplumber) or Docling handles
these cleanly — no paid PDF API needed.
EOF
}

pull_bis() {
  notify "BIS standards (India) — MANUAL STEP"
  cat >&2 <<EOF
  1. Visit: https://www.bis.gov.in/  (search: IS 4707)
  2. Download Parts 1 & 2 — IS 4707 is the cosmetic safety standard.
     Some BIS standards require a free account. A few are paywalled.
  3. Save to:
     ${BULK_DIR}/bis-is-4707-part-1.pdf
     ${BULK_DIR}/bis-is-4707-part-2.pdf
EOF
}

SELECTED="${1:-all}"

case "${SELECTED}" in
  iarc)          pull_iarc ;;
  ecfr)          pull_ecfr ;;
  health_canada) pull_health_canada ;;
  openfda)       pull_openfda ;;
  usda)          pull_usda ;;
  eu_cosing)     pull_eu_cosing ;;
  eu_additives)  pull_eu_additives ;;
  efsa)          pull_efsa ;;
  codex)         pull_codex ;;
  fsanz)         pull_fsanz ;;
  japan)         pull_japan ;;
  fssai)         pull_fssai ;;
  bis)           pull_bis ;;
  all)
    pull_iarc
    pull_ecfr
    pull_health_canada
    pull_openfda
    pull_usda
    pull_eu_cosing
    pull_eu_additives
    pull_efsa
    pull_codex
    pull_fsanz
    pull_japan
    pull_fssai
    pull_bis
    ;;
  *)
    printf 'Unknown source: %s\n' "${SELECTED}" >&2
    printf 'Usage: bash scripts/pull-bulk-data.sh [all|iarc|ecfr|openfda|health_canada|usda|eu_cosing|eu_additives|efsa|codex|fsanz|japan|fssai|bis]\n' >&2
    exit 1
    ;;
esac

printf '\n'
log "Done. Log: ${LOG}"
log "Contents of ${BULK_DIR}:"
ls -la "${BULK_DIR}" | tee -a "${LOG}"
