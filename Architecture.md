# Alzhal — Architecture

## 1. System Overview

**Purpose.** Help consumers — particularly Indian consumers, including those who do not read English — understand product ingredients via WhatsApp, Telegram, or the web, with explanations in their native language in simple, everyday words.

**Core principle.** Accessible to everyone. Works via voice, images, and basic phones. No reading required. Every explanation is written as if talking to someone who never went to school. Every safety claim links back to an official regulation — no AI guesses.

---

## 2. System Architecture

```
+-------------------+
|      USERS        |
|                   |
| - WhatsApp        |
| - Telegram        |
| - Website         |
| - Voice notes     |
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
|  2. Extract data (OCR / STT)                 |
|  3. Detect language                          |
|  4. Resolve each ingredient to canonical_id  |
|  5. Fetch regulatory facts (D1, with         |
|     external-API fallback for unknowns)      |
|  6. Compute deterministic verdict            |
|  7. Render layman summary (LLM, structurally |
|     unable to invent regulations)            |
|  8. Translate if needed                      |
|  9. Store scan in D1                         |
+--------+------------------------------------+
         |
         v
+---------------------------------------------+
|         AI LAYER                             |
|                                              |
|  - Gemini Vision  (label OCR)                |
|  - Gemini 2.0 Flash (analysis, STT)          |
|  - Workers AI (OCR + grounded renderer)      |
|  - Google TTS (voice responses)              |
+--------+------------------------------------+
         |
         v
+---------------------------------------------+
|        EXTERNAL DATA LAYER (APIs)            |
|                                              |
|  - PubChem REST API (chemical properties)    |
|  - CAS Common Chemistry (CAS numbers)        |
|  - OpenFDA Adverse Events (safety reports)   |
|  - OpenFDA Food Enforcement (recalls)        |
|  - EPA CompTox Dashboard (chemical safety)   |
|  - Open Food Facts / Open Beauty Facts       |
+--------+------------------------------------+
         |
         v
+---------------------------------------------+
|        STORAGE LAYER (Cloudflare)            |
|                                              |
|  - D1 (×5):                                  |
|      APP_DB             scans, queries, etc. |
|      FOOD_DB            FDA / OFF product DB |
|      FOOD_NUTRITION_DB  USDA + nutrition     |
|      FOOD_META_DB       product metadata     |
|      INGREDIENTS_REF_DB canonical graph +    |
|                         regulatory facts     |
|  - R2: TTS audio replies                     |
|  - In-memory cache: API results, ingredient  |
|    cache, rate-limit buckets                 |
+---------------------------------------------+
```

---

## 3. Tech Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Backend + Frontend | Next.js 16 (TypeScript) | Single codebase, App Router |
| AI (vision + text + STT) | Gemini 2.0 Flash | OCR, voice transcription, analysis, translation |
| AI (grounded renderer) | Workers AI — Gemma 4 (with Gemini fallback) | Plain-language rendering of structured facts |
| WhatsApp | Meta WhatsApp Cloud API | Direct integration, no third-party reseller |
| Telegram | Telegram Bot API | Second messaging channel |
| Database | Cloudflare D1 (×5 SQLite at the edge) | App data, food/nutrition/meta tables, canonical ingredient graph + regulatory facts |
| Audio Storage | Cloudflare R2 | TTS audio file hosting |
| Deployment | Cloudflare Workers (via OpenNext) | Global edge deployment |
| Styling | Tailwind CSS v4 | Mobile-first responsive UI |
| Chemical identity | PubChem REST + CAS Common Chemistry | Formulas, weights, CAS numbers |
| Safety data | OpenFDA + EPA CompTox | Adverse events, recalls, toxicity link-out |
| Product DB | Open Food Facts / Open Beauty Facts | Global product database |
| Voice output | google-tts-api | Multilingual TTS replies |

---

## 4. External API Integration

### Data flow (parallel enrichment for unknown ingredients)

```
Ingredients identified
        |
        v
+-------+-------+-------+-------+
|       |       |       |       |
v       v       v       v       v
PubChem  CAS   FDA     FDA     D1
Props   Numbers Events  Recalls  cache
|       |       |       |       |
+-------+-------+-------+-------+
        |
        v
  Format as structured context
        |
        v
  Pass to grounded renderer
  (or, legacy path, to enriched Gemini batch)
```

### API summary

| API | Endpoint | Auth | Rate Limit | Data |
|-----|----------|------|------------|------|
| PubChem | `pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/{name}/property/...` | None | 5 req/sec | Molecular formula, weight, IUPAC name, CID |
| CAS | `commonchemistry.cas.org/api/search` | None | Reasonable use | CAS Registry Numbers |
| OpenFDA Events | `api.fda.gov/food/event.json` | None | Generous | Adverse event report counts |
| OpenFDA Recalls | `api.fda.gov/food/enforcement.json` | None | Generous | Recall reasons, classifications, status |
| EPA CompTox | `comptox.epa.gov/dashboard/chemical/details/{cas}` | None | Link only | Safety dashboard link-out |

### Circuit breaker pattern

All external APIs share a circuit breaker:

- **Threshold:** 3 consecutive failures
- **Reset:** 5 minutes (half-open probe every 60s)
- **Behavior:** When open, returns null/0 immediately (no API calls)
- **Caching:** 12-hour TTL for all API results

---

## 5. Analysis Pipeline

### Grounded path (v2, current default behind `USE_GROUNDED_RENDERER`)

```
Image OCR (Gemini Vision + Workers AI + Tesseract → merge)
    |
    v
For each ingredient name:
    |
    +---> resolveCanonicalId (alias graph in D1)
    |
    +---> fetch regulatory facts for canonical_id
    |       (one row per jurisdiction; each row carries a source_url)
    |
    +---> computeVerdict (deterministic, in code)
    |
    +---> renderGroundedFacts (LLM)
    |       prompt has NO slots for inventing regulation status,
    |       limits, or references. LLM only writes prose for:
    |         - simple_name
    |         - how_its_made (optional)
    |         - safety_summary
    |
    +---> validateNoJurisdictionLeak
            rejects renderings that mention jurisdictions we did
            not actually have facts for; falls back to a safe template.
```

### Legacy path (still serves traffic for unindexed ingredients)

```
Image OCR
    |
    +---> CSV lookup (parallel) ---------+
    +---> getEnrichedDataForBatch ------+   (PubChem + CAS + FDA Events + FDA Recalls)
    |                                    |
    v                                    v
    Format both as context strings
    |
    v
    Gemini batch analysis
    |
    v
    Merge results
    |
    v
    Save to D1 + return to user
```

The legacy path remains for ingredients not yet indexed in the canonical graph. Both paths can run in the same response.

---

## 6. Prompt Schema (grounded renderer)

Inputs to the renderer LLM (no fact-generation slots):

```ts
type RendererInput = {
  primary_name: string
  aliases: string[]
  ingredient_class: string
  category: string
  is_natural: boolean
  cas_number?: string | null
  e_number?: string | null
  facts: RegulatoryFact[]       // one row per jurisdiction, with source_url
  nutrition?: NutritionFact | null
}
```

Outputs from the renderer LLM (prose only):

```ts
type RendererOutput = {
  simple_name: string           // "Atta — same flour you use to make roti"
  how_its_made?: string | null  // 2-3 sentence everyday explanation
  safety_summary: string        // narrative summary of the supplied facts
}
```

The verdict, per-jurisdiction rows, and source citations are all produced by code, not the LLM.

### Country coverage

US (FDA / EPA), EU (EFSA / CosIng), UK (FSA), Canada (Health Canada), Australia / New Zealand (FSANZ), India (FSSAI / BIS), Japan (MHLW), Nordic countries, WHO / IARC, Codex Alimentarius. Brazil (ANVISA) and Korea (MFDS) are on the roadmap.

---

## 7. Response Formatting

### Shared formatter (`lib/format-response.ts`)

Used by both WhatsApp and Telegram webhooks. Format:

```
[SAFE] *Wheat Flour*
Atta — the same flour used to make roti at home.

[CAUTION] *Sodium Benzoate*
A powder that stops food from going bad, made from chemicals.
Limit: For every 100g of food, only a tiny pinch (0.015g) is allowed in India.
Concerns: May form benzene with Vitamin C.
```

**Rules:**

- `simple_name` is shown for every ingredient — it is the most useful field.
- Limits are shown for CAUTION / AVOID / BANNED only.
- `how_its_made` is only shown on single-ingredient deep-dives, never in batch reports.
- Dynamic ingredient count based on remaining characters (~300 chars/ingredient).
- Hard cap 4096 chars (WhatsApp limit).

---

## 8. Database Schema (D1)

### `APP_DB` — application data

- **products** — `id, product_name, brand, category, image_url, total_ingredients, scanned_count, first_scanned_at, last_scanned_at`
- **ingredients** — `id, name (unique), simple_name, chemical_formula, raw_materials, common_uses, fda_status, eu_status, who_status, banned_in, safe_limit, concerns, category, analyzed_count`
- **scans** — `id, product_id, user_phone (hashed), input_type, language, timestamp, ingredients_found, response_sent`
- **conversations** — message threads keyed by phone/chat (WhatsApp + Telegram)
- **queries** — `id, scan_id, question, question_type, language, response, timestamp`
- **feedback** — `id, scan_id, rating, comment, type, timestamp`

### `FOOD_DB`, `FOOD_NUTRITION_DB`, `FOOD_META_DB`

Local materializations of FDA + USDA + OpenFoodFacts data used for fast product lookup at the edge.

### `INGREDIENTS_REF_DB` — the canonical ingredient graph

- **ingredient** — one row per canonical substance; `canonical_id, primary_name, cas_number, pubchem_cid, e_number, molecular_formula, iupac_name, category, is_natural, ...`
- **ingredient_alias** — many-to-one to `ingredient`. Holds names, E-numbers, INCI codes, common misspellings, translations.
- **fact_evidence** — `source_name, source_url, source_section, snapshot_date, language, retrieved_by`. Every regulatory_fact row must point at one.
- **regulatory_fact** — `canonical_id, jurisdiction, fact_type, status, regulation_ref, product_category, evidence_id`. The structural guarantee: no fact exists without a source.

Schema files: [`scripts/d1-regulatory-schema.sql`](scripts/d1-regulatory-schema.sql).

---

## 9. API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/whatsapp/webhook` | GET/POST | Meta WhatsApp Cloud API (verification + messages) |
| `/api/telegram/webhook` | POST | Telegram Bot API webhook |
| `/api/telegram/setup` | POST | One-time webhook setup helper |
| `/api/analyze/image` | POST | Image upload analysis |
| `/api/analyze/text` | POST | Text / ingredient list analysis |
| `/api/analyze/voice` | POST | Voice note analysis |
| `/api/analyze/nutrition` | POST | Nutrition-panel structured extraction |
| `/api/compare` | POST | Side-by-side product comparison |
| `/api/question` | POST | Follow-up Q&A |
| `/api/search` | GET | Product / ingredient search |
| `/api/share` | POST | Share a result via a short link |
| `/api/feedback` | POST | Capture rating / comment |
| `/api/stats` | GET | Live usage stats |
| `/api/audio/[id]` | GET | Stream a generated TTS file from R2 |
| `/api/cron/fda-sync` | GET | Scheduled FDA refresh |

---

## 10. Caching Strategy

| Layer | TTL | Purpose |
|-------|-----|---------|
| Ingredient cache | 7 days | Avoid re-analyzing known ingredients |
| Product cache | 1 day | Quick re-scan of the same product |
| External API cache | 12 hours | PubChem, CAS, FDA |
| Stats cache | 5 minutes | Dashboard analytics |

In-memory with lazy cleanup (no timers), compatible with Workers cold starts. Max 10,000 entries with LRU eviction.

---

## 11. Deployment

- **Platform:** Cloudflare Workers (via the OpenNext adapter)
- **Build:** `npx opennextjs-cloudflare build`
- **Deploy:** `npx wrangler deploy`
- **Config:** `wrangler.toml` (D1 bindings, R2 bucket, env vars). The public template uses placeholder IDs; real IDs go in `wrangler.private.toml` (gitignored).

### Environment variables

```
GEMINI_API_KEY              (required)
GEMINI_TEMPERATURE          (optional, default 0.2)
WHATSAPP_TOKEN              (optional — for WhatsApp bot)
WHATSAPP_PHONE_NUMBER_ID    (optional)
WHATSAPP_VERIFY_TOKEN       (optional)
WHATSAPP_APP_SECRET         (optional, but required for WhatsApp signature verification)
TELEGRAM_BOT_TOKEN          (optional — for Telegram bot)
NEXT_PUBLIC_APP_URL         (optional, default http://localhost:3000)
USE_GROUNDED_RENDERER       (optional, default false → legacy path)
RENDERER_BACKEND            (optional: "gemini" | "gemma", default gemini)
RENDERER_MODEL              (optional, override Workers AI model id)
APP_CONTACT_EMAIL           (optional — used in outbound API User-Agent)
```

---

## 12. Supported Languages

**Primary language: English.** All static UI text and hardcoded copy lives in English.

**Additional languages (treated as a uniform group):** Hindi, Tamil, Telugu, Kannada, Bengali, Marathi, Gujarati, Punjabi, Malayalam, Odia, Assamese, Urdu.

When a user selects one of the additional languages, the dynamic content — ingredient `simple_name`, `how_its_made`, `safety_summary`, voice replies, and follow-up Q&A — is translated by the renderer (`translateContent` in `lib/gemini.ts`). The backend does not branch on language; the pipeline passes the language string straight through to the model, so adding a new language is a one-line dropdown change with no backend work.

Static UI labels are intentionally not translated in code. Translation quality varies by language in the model, and presenting a confident-sounding but slightly-wrong safety message in someone's mother tongue is worse than the English fallback. The translation policy is in `CONTRIBUTING.md`; native-speaker PRs are the way verified translations get in.

All responses are written for a non-technical audience: simple words, everyday analogies, no chemistry jargon unless explicitly requested via a follow-up question.

---

## 13. Security posture

- **Webhook signature verification** — Meta WhatsApp HMAC-SHA256 (`X-Hub-Signature-256`) verified against `WHATSAPP_APP_SECRET`. Unsigned requests dropped.
- **Rate limiting** — In-memory per-IP / per-phone limits in `lib/security.ts`. Store self-evicts at 10K entries (no Worker memory exhaustion).
- **Input sanitization** — Ingredient names stripped of control chars, prompt-injection delimiters, and XML tags before reaching the LLM. SQL-injection patterns rejected at the boundary.
- **Origin checks** — Browser API routes require same-origin `Origin` / `Referer`. Webhooks are signature-verified instead.
- **SSRF protection** — Outbound fetches go through allowlist hosts; user-supplied URLs are not followed.
- **Circuit breakers** — Upstream API failures cannot snowball into worker outages.
- **No secrets in source** — `wrangler.toml` ships with placeholder IDs; real IDs in gitignored `wrangler.private.toml`. All API keys read from `process.env` / Cloudflare secrets.
- **No third-party telemetry** — Alzhal does not ship analytics to anyone outside the operator's Cloudflare account.

---

## 14. Historical planning document

The pre-build planning document (user journeys, demo scripts, original architecture sketch) is archived at [`docs/archive/consumer-truth-hackathon-plan.md`](docs/archive/consumer-truth-hackathon-plan.md). Some details there (Twilio, Vercel, Supabase) have been superseded by the current implementation (Meta WhatsApp Cloud API, Cloudflare Workers, D1).

---

## 15. Roadmap

- ANVISA (Brazil) and MFDS (Korea) regulatory ingesters.
- First-party allergen-profile mode (set your allergens once; every scan warns you).
- Offline ingredient lookup for the most-scanned 50K substances.
- Native mobile (Android first) wrapping the same Workers backend.

The grounded direction — "no hallucinations" as a structural guarantee, not a prompt instruction — is the load-bearing invariant. New code should preserve it.
