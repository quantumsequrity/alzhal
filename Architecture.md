# Consumer Truth - Architecture Document

## 1. System Overview

**Purpose:** Help consumers (especially uneducated/illiterate Indian consumers) understand product ingredients through WhatsApp, Telegram, or a website, with explanations in their native language using crystal-clear layman language.

**Core Principle:** Accessible to ALL - Works via voice notes, images, basic phones. No reading required. Every explanation written as if talking to someone who never went to school.

---

## 2. System Architecture

```
+-------------------+
|      USERS        |
|                   |
| - WhatsApp        |
| - Telegram        |
| - Website         |
| - Voice Notes     |
+--------+----------+
         |
         v
+---------------------------------------------+
|            INPUT LAYER                       |
|                                              |
|  +------------------+  +------------------+  |
|  | Meta WhatsApp    |  | Telegram Bot     |  |
|  | Cloud API        |  | API              |  |
|  | Webhook          |  | Webhook          |  |
|  +--------+---------+  +--------+---------+  |
|           |                      |            |
|  +--------v----------------------v---------+  |
|  |          Next.js Web + API              |  |
|  +-----------------------------------------+  |
+--------+------------------------------------+
         |
         v
+---------------------------------------------+
|         PROCESSING LAYER (Next.js)           |
|                                              |
|  1. Detect input type (image/voice/text)     |
|  2. Extract data (Gemini Vision OCR)         |
|  3. Detect language                          |
|  4. Fetch external API data (parallel):      |
|     - PubChem (chemical identity)            |
|     - CAS Common Chemistry                  |
|     - OpenFDA (adverse events + recalls)     |
|     - EPA CompTox                            |
|     - Local CSV datasets (FDA/OFF)           |
|  5. Analyze with Gemini (enriched context)   |
|  6. Format response (shared formatter)       |
|  7. Translate if needed                      |
|  8. Store in database                        |
+--------+------------------------------------+
         |
         v
+---------------------------------------------+
|         AI LAYER (Gemini 2.0 Flash)          |
|                                              |
|  - Gemini Vision (label OCR)                 |
|  - Gemini 2.0 Flash (batch analysis)         |
|  - Speech-to-Text (voice transcription)      |
|  - Translation (multilingual output)         |
|  - Google TTS (voice responses)              |
+--------+------------------------------------+
         |
         v
+---------------------------------------------+
|        EXTERNAL DATA LAYER (APIs)            |
|                                              |
|  - PubChem REST API (chemical properties)    |
|  - CAS Common Chemistry (CAS numbers)       |
|  - OpenFDA Adverse Events (safety reports)   |
|  - OpenFDA Food Enforcement (recalls)        |
|  - EPA CompTox Dashboard (chemical safety)   |
|  - Open Food Facts (product DB)              |
|  - Cloudflare D1 (local CSV datasets)        |
+--------+------------------------------------+
         |
         v
+---------------------------------------------+
|        STORAGE LAYER                         |
|                                              |
|  - Supabase (PostgreSQL): products,          |
|    ingredients, scans, queries, analytics    |
|  - Cloudflare D1: FOOD_DB, FOOD_NUTRITION_DB,|
|    FOOD_META_DB (local CSV data)             |
|  - Cloudflare R2: audio file storage         |
|  - In-memory cache: ingredient/API results   |
+---------------------------------------------+
```

---

## 3. Tech Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Backend + Frontend | Next.js 16 (TypeScript) | Single codebase, API routes |
| AI Engine | Gemini 2.0 Flash | Multimodal (vision+text+voice), multilingual |
| WhatsApp | Meta WhatsApp Cloud API | Direct integration, no Twilio dependency |
| Telegram | Telegram Bot API | Second messaging channel |
| Database | Supabase (PostgreSQL) | Products, ingredients, scans, analytics |
| Local Data | Cloudflare D1 (3 databases) | FOOD_DB, FOOD_NUTRITION_DB, FOOD_META_DB |
| Audio Storage | Cloudflare R2 | TTS audio file hosting |
| Deployment | Cloudflare Workers (via OpenNext) | Global edge deployment |
| Styling | Tailwind CSS v4 | Mobile-first responsive UI |
| Chemical Data | PubChem REST API | Molecular formulas, weights, IUPAC names |
| Chemical Identity | CAS Common Chemistry API | CAS Registry Numbers |
| Safety Data | OpenFDA API | Adverse events + food recall enforcement |
| Chemical Safety | EPA CompTox Dashboard | Toxicity and safety profiles |
| Product Data | Open Food Facts | Global product database |
| Voice | Google TTS API | Text-to-speech responses |

---

## 4. External API Integration

### Data Flow (Parallel Enrichment)

```
Ingredients identified
        |
        v
+-------+-------+-------+-------+
|       |       |       |       |
v       v       v       v       v
PubChem  CAS   FDA     FDA     CSV
Props   Numbers Events  Recalls  Data
|       |       |       |       |
+-------+-------+-------+-------+
        |
        v
  Format as context string
        |
        v
  Pass to Gemini batch analysis
  (enriched with verified API data)
```

### API Details

| API | Endpoint | Auth | Rate Limit | Data Provided |
|-----|----------|------|------------|---------------|
| PubChem | `pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/{name}/property/...` | None | 5 req/sec | Molecular formula, weight, IUPAC name, CID, PubChem URL |
| CAS | `commonchemistry.cas.org/api/search` | None | Reasonable use | CAS Registry Numbers |
| OpenFDA Events | `api.fda.gov/food/event.json` | None | Generous | Adverse event report counts |
| OpenFDA Recalls | `api.fda.gov/food/enforcement.json` | None | Generous | Recall reasons, classifications, status |
| EPA CompTox | `comptox.epa.gov/dashboard/chemical/details/{cas}` | None | Link only | Chemical safety dashboard link |

### Circuit Breaker Pattern

All external APIs use a shared circuit breaker:
- **Threshold:** 3 consecutive failures
- **Reset:** 5 minutes
- **Behavior:** When open, returns null/0 immediately (no API calls)
- **Caching:** 12-hour TTL for all API results

---

## 5. Analysis Pipeline

### Previous Flow (slow, sequential):
```
Image OCR -> CSV lookup -> Gemini batch -> per-ingredient getOfficialData() (sequential!) -> merge
```

### Current Flow (parallel, enriched):
```
Image OCR
    |
    v
Identify uncached ingredients
    |
    +---> CSV lookup (parallel)  ---------+
    +---> getEnrichedDataForBatch() -------+  (PubChem + CAS + FDA Events + FDA Recalls)
    |                                      |
    v                                      v
    Format both as context strings
    |
    v
    Gemini batch analysis (with enriched context)
    |
    v
    Merge results (no per-ingredient API calls needed)
    |
    v
    Save to DB + return to user
```

---

## 6. Gemini Prompt Schema

### Batch Analysis Output (per ingredient):

```json
{
  "simple_name": "Layman explanation using everyday analogies",
  "how_its_made": "2-3 sentence manufacturing process",
  "chemical_formula": "Formula or N/A",
  "cas_number": "CAS Registry Number",
  "raw_materials": ["List of raw materials"],
  "common_uses": ["3 common products"],
  "regulatory_status": {
    "india_fssai": "FSSAI status",
    "eu_efsa": "EU EFSA status",
    "us_fda": "FDA status",
    "who_iarc": "WHO/IARC classification",
    "uk_fsa": "UK FSA status",
    "australia_nz_fsanz": "FSANZ status",
    "canada_hc": "Health Canada status",
    "japan_mhlw": "Japan MHLW status",
    "nordic_countries": "Nordic regulations status"
  },
  "safety_limits_per_100g": {
    "india_fssai": "e.g. 0.015g per 100g",
    "eu": "e.g. 0.02g per 100g",
    "us_fda": "e.g. 0.1g per 100g",
    "codex": "Codex Alimentarius limit",
    "australia_nz": "FSANZ limit",
    "uk": "UK limit",
    "plain_english": "One simple sentence a child could understand"
  },
  "safety_verdict": "SAFE/CAUTION/AVOID/BANNED",
  "concerns": ["Official source findings only"],
  "banned_countries": ["Countries where banned"],
  "restricted_countries": ["Countries with specific limits"],
  "sources_cited": ["Specific regulation references"],
  "limit_exceeded": { ... },
  "regional_ban_conflicts": ["e.g. 'Legal in India but banned in EU'"]
}
```

### Single Deep-Dive (additional fields):
- `health_impact_layman`: Simple health effects explanation
- `how_its_made`: Extended 5-6 sentence version

### Country Coverage:
India (FSSAI/BIS), EU (EFSA/CosIng), US (FDA/EPA), UK (FSA), Australia/NZ (FSANZ), Canada (Health Canada), Japan (MHLW), Nordic countries, WHO/IARC, Codex Alimentarius

---

## 7. Response Formatting

### Shared Formatter (`lib/format-response.ts`)

Used by both WhatsApp and Telegram webhooks. Format:

```
[SAFE] *Wheat Flour*
Atta - the same flour used to make roti at home.

[CAUTION] *Sodium Benzoate*
A powder that stops food from going bad, made from chemicals.
Limit: For every 100g of food, only a tiny pinch (0.015g) is allowed in India
Concerns: May form benzene with Vitamin C
```

**Rules:**
- `simple_name` shown for ALL ingredients (most valuable field)
- `safety_limits_per_100g.plain_english` shown for CAUTION/AVOID/BANNED only
- `how_its_made` only shown on single-ingredient deep-dive, NOT batch reports
- Dynamic ingredient count based on remaining chars (~300 chars/ingredient)
- Max 4096 chars (WhatsApp limit)

---

## 8. Database Schema

### Supabase (PostgreSQL)

**products:** id, product_name, brand, category, image_url, total_ingredients, scanned_count, first_scanned_at, last_scanned_at

**ingredients:** id, name (unique), simple_name, chemical_formula, raw_materials, common_uses, fda_status, eu_status, who_status, banned_in, safe_limit, concerns, category, analyzed_count

**scans:** id, product_id, user_phone (hashed), input_type, language, timestamp, ingredients_found, response_sent

**queries:** id, scan_id, question, question_type, language, response, timestamp

**analytics:** id, date, total_scans, whatsapp_scans, web_scans, voice_queries, languages_used, top_products, top_concerns

### Cloudflare D1 (3 databases)

- **FOOD_DB:** FDA food additive and ingredient data
- **FOOD_NUTRITION_DB:** Nutritional information
- **FOOD_META_DB:** Product metadata from Open Food Facts

---

## 9. API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/whatsapp/webhook` | GET/POST | Meta WhatsApp Cloud API webhook (verification + messages) |
| `/api/telegram/webhook` | POST | Telegram Bot API webhook |
| `/api/analyze/image` | POST | Image upload analysis |
| `/api/analyze/text` | POST | Text/ingredient list analysis |
| `/api/analyze/voice` | POST | Voice note analysis |
| `/api/question` | POST | Follow-up questions |
| `/api/search` | GET | Product/ingredient search |
| `/api/share` | POST | Share analysis results |
| `/api/stats` | GET | Real-time analytics |

---

## 10. Caching Strategy

| Layer | TTL | Purpose |
|-------|-----|---------|
| Ingredient cache | 7 days | Avoid re-analyzing known ingredients |
| Product cache | 1 day | Quick re-scan of same product |
| External API cache | 12 hours | PubChem, CAS, FDA results |
| Stats cache | 5 minutes | Dashboard analytics |

In-memory cache with lazy cleanup (no timers), compatible with Cloudflare Workers cold starts. Max 10,000 entries with LRU eviction.

---

## 11. Deployment

- **Platform:** Cloudflare Workers (via OpenNext.js adapter)
- **Build:** `npx opennextjs-cloudflare build`
- **Deploy:** `npx wrangler deploy`
- **Config:** `wrangler.toml` (D1 bindings, R2 bucket, environment variables)

### Environment Variables

```
GEMINI_API_KEY
WHATSAPP_ACCESS_TOKEN
WHATSAPP_PHONE_NUMBER_ID
WHATSAPP_VERIFY_TOKEN
WHATSAPP_APP_SECRET
TELEGRAM_BOT_TOKEN
SUPABASE_URL
SUPABASE_ANON_KEY
R2_PUBLIC_URL
```

---

## 12. Supported Languages

Auto-detected from user input: English, Hindi, Tamil, Telugu, Kannada, Bengali, Marathi, Gujarati

All responses adapted for uneducated audience: simple words, everyday analogies, no technical jargon.

---

## Historical planning document

The pre-build planning document (user journeys, demo scripts, original architecture sketch) is archived at [`docs/archive/consumer-truth-hackathon-plan.md`](docs/archive/consumer-truth-hackathon-plan.md). Some details there (Twilio, Vercel, Supabase) have been superseded by the current implementation documented above (Meta WhatsApp Cloud API, Cloudflare Workers, D1).

---

## v2 direction (`v2-grounded` branch)

Work is in progress on `v2-grounded` to eliminate LLM-generated regulatory claims. The target architecture:

- **Canonical Ingredient Graph**: one canonical ID per substance, with all aliases (E-numbers, CAS, INCI, synonyms, misspellings, translations) mapped. Schema: [`scripts/d1-regulatory-schema.sql`](scripts/d1-regulatory-schema.sql).
- **Regulatory facts with mandatory provenance**: every per-jurisdiction claim (FSSAI, FDA CFR, EU, IARC, Codex, etc.) stored as a structured row with a verifiable `source_url`. No row exists without a source.
- **LLM as renderer, not fact generator**: Gemini receives pre-fetched structured facts and produces layman explanations. It cannot invent a regulation, limit, or citation — those slots do not exist in the prompt.
- **Deterministic ingestion pipelines**: one ingester per authoritative source (eCFR JSON API, EU CosIng CSV, IARC monographs, FSSAI PDFs via Docling, USDA FDC). Raw documents stored in R2 as evidence; parsed facts stored in D1.
- **Eval harness**: gold-standard ingredients with expected verdicts + expected citation URLs, run on every change to measure hallucination rate.

Net effect: "no hallucinations" becomes a structural guarantee, not a prompt instruction.

