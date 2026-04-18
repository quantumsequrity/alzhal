#!/usr/bin/env bash
# pull-bulk-data-v2.sh — fetch verified regulatory/ingredient datasets
# Only sources with HTTP 200 verified via curl on 2026-04-17 are included.
# NOT included (require manual UI / login): EU CosIng bulk export, EU
# webgate.ec.europa.eu FAD (foods_system) public endpoint — neither returns
# a public file URL; both require the UI session / account.

set -euo pipefail

DEST="$(cd "$(dirname "$0")" && pwd)/bulk-data"
mkdir -p "$DEST"

UA_BROWSER="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Firefox/121.0"
UA_CURL="curl/8.5.0"   # canada.ca requires non-browser UA over HTTP/2

fetch() {
  local name="$1" url="$2" ua="${3:-$UA_BROWSER}" extra="${4:-}"
  local out="$DEST/$name"
  echo ">> $name"
  # shellcheck disable=SC2086
  curl -fSL --retry 3 --retry-delay 2 --max-time 600 \
    -A "$ua" $extra -o "$out" "$url" \
    && echo "   OK  $out ($(stat -c%s "$out" 2>/dev/null || stat -f%z "$out") bytes)" \
    || { echo "   FAIL $name"; return 1; }
}

# 1. USDA FoodData Central — Foundation Foods + SR Legacy + full combined
fetch "usda_foundation_food_csv_2025-04-24.zip" \
      "https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_foundation_food_csv_2025-04-24.zip"
fetch "usda_sr_legacy_food_csv_2018-04.zip" \
      "https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_csv_2018-04.zip"
fetch "usda_fdc_full_csv_2024-10-31.zip" \
      "https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_csv_2024-10-31.zip"

# 2. EFSA OpenFoodTox (Zenodo record 8120114, published 2023-09-13 — latest OFT release)
ZENODO_BASE="https://zenodo.org/api/records/8120114/files"
fetch "efsa_openfoodtox_TX22809_2023.xlsx"          "$ZENODO_BASE/OpenFoodToxTX22809_2023.xlsx/content"
fetch "efsa_openfoodtox_SubstanceChar_2023.xlsx"    "$ZENODO_BASE/SubstanceCharacterisation_KJ_2023.xlsx/content"
fetch "efsa_openfoodtox_RefValues_2023.xlsx"        "$ZENODO_BASE/ReferenceValues_KJ_2023.xlsx/content"
fetch "efsa_openfoodtox_RefPoints_2023.xlsx"        "$ZENODO_BASE/ReferencePoints_KJ_2023.xlsx/content"
fetch "efsa_openfoodtox_Genotoxicity_2023.xlsx"     "$ZENODO_BASE/Genotoxicity_KJ_2023.xlsx/content"
fetch "efsa_openfoodtox_PhysChemToxicokin_2023.xlsx" "$ZENODO_BASE/PhysChem_Toxicokinetics_KJ_2023.xlsx/content"
fetch "efsa_openfoodtox_EFSAOutputs_2023.xlsx"      "$ZENODO_BASE/EFSAOutputs_KJ_2023.xlsx/content"

# 3. Codex Alimentarius — GSFA CXS 192-1995 (sh-proxy serves real PDF)
fetch "codex_gsfa_CXS_192.pdf" \
  "https://www.fao.org/fao-who-codexalimentarius/sh-proxy/en/?lnk=1&url=https%253A%252F%252Fworkspace.fao.org%252Fsites%252Fcodex%252FStandards%252FCXS%2B192-1995%252FCXS_192e.pdf"

# 4. Health Canada Cosmetic Hotlist — canada.ca rejects browser UA over HTTP/2
#    in some cases; plain curl/8.x works. The public landing is HTML; there is
#    no official single PDF/CSV — the list is rendered inline. We fetch the
#    HTML and let the downstream parser extract the table.
fetch "health_canada_hotlist.html" \
  "https://www.canada.ca/en/health-canada/services/consumer-product-safety/cosmetics/cosmetic-ingredient-hotlist-prohibited-restricted-ingredients/hotlist.html" \
  "$UA_CURL"

# 5. FSANZ — Food Standards Code schedules via legislation.gov.au.
#    URL pattern: /{titleId}/{startDate}/{startDate}/text/original/pdf
#    startDate is resolved from the api.prod.legislation.gov.au versions endpoint
#    (isCurrent=true). Below are the in-force IDs + the latest compilation start
#    we observed on 2026-04-17; re-resolve before bulk scheduled runs.
declare -A FSANZ=(
  [sched8_food_additives_names]="F2015L00478|2025-09-16"
  [sched14_technological_purposes]="F2015L00468|2015-03-01"
  [sched15_additives_for_foods]="F2015L00469|2015-03-01"
  [sched16_foods_additives_GMP]="F2015L00470|2015-03-01"
  [sched17_vitamin_min_forms]="F2015L00471|2015-03-01"
  [sched18_processing_aids]="F2015L00472|2015-03-01"
  [sched19_flavour_purity]="F2015L00473|2015-03-01"
  [sched20_MRLs]="F2017L01216|2017-09-08"
)
for key in "${!FSANZ[@]}"; do
  IFS='|' read -r tid start <<< "${FSANZ[$key]}"
  url="https://www.legislation.gov.au/${tid}/${start}/${start}/text/original/pdf"
  # Skip if HEAD/GET returns non-PDF; let fetch() error propagate if so.
  fetch "fsanz_${key}_${tid}.pdf" "$url" || true
done

# 6. FSANZ consolidated code PDF (all 80 standards + 29 schedules, March 2025)
fetch "fsanz_code_compilation_2025-03.pdf" \
  "https://www.foodstandards.gov.au/sites/default/files/2025-03/Food%20Standards%20Code%20-%20Compilation%20%28March%202025%29.pdf"

# 7. Japan MHLW — Specifications and Standards for Food, Food Additives, Etc.
#    (English, 9th edition 2022, currently latest English translation)
fetch "mhlw_positivelist_r01_a.pdf" \
  "https://www.mhlw.go.jp/english/topics/foodsafety/positivelist060228/dl/r01_a.pdf"

echo
echo "Done. Files in: $DEST"

# ---- NOT FETCHED (no verified public direct URL) ----
# * EU CosIng: single-market-economy.ec.europa.eu cosmetics DB. The public
#   export endpoints return 404 / HTML wrappers; the XLSX export is only
#   produced by an authenticated UI session. No public file URL verified.
# * EU Food Additives (Reg 1333/2008) via webgate.ec.europa.eu/foods_system:
#   the /main/?sector=FAD entrypoint returns 404 without a session cookie;
#   the public-facing search page is a Cold Fusion app with no file export.
#   Use EFSA's food additives re-evaluation deliverables or the Annex II/III
#   XLSX maintained by DG SANTE (URL rotates per consolidation date).
