# Consumer Truth

AI-powered ingredient safety analyzer. Send a product photo via WhatsApp, Telegram, or the website - get regulation-backed safety analysis grounded in official sources (FDA, FSSAI, EU, IARC, WHO), not AI guesses.

**Live:** [sage-insight.cloudsequrity.com](https://sage-insight.cloudsequrity.com)

## Features

- **Photo Analysis** - Product label image → Gemini Vision OCR → per-ingredient safety breakdown
- **Text Analysis** - Paste ingredient list, get instant analysis
- **Voice Analysis** - Voice note in any supported language → transcribe → analyze → audio reply
- **WhatsApp Bot** - Meta WhatsApp Cloud API. Send photos, voice notes, or text.
- **Telegram Bot** - Same analysis via Telegram.
- **Multilingual** - Auto-detects and responds in 20+ languages: Hindi, Tamil, Telugu, Bengali, Marathi, Kannada, Malayalam, Gujarati, Punjabi, Odia, Assamese, Urdu, and more.
- **Audio Responses** - TTS audio replies on WhatsApp for accessibility.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router) + TypeScript |
| Styling | Tailwind CSS v4 |
| AI Model | Google Gemini 2.0 Flash (Vision + Text + TTS) |
| Database | Cloudflare D1 (5 databases: APP_DB, FOOD_DB, FOOD_NUTRITION_DB, FOOD_META_DB, INGREDIENTS_REF_DB) |
| Messaging | Meta WhatsApp Cloud API + Telegram Bot API |
| Hosting | Cloudflare Workers (via `@opennextjs/cloudflare`) |
| Audio Storage | Cloudflare R2 |
| OCR | Multi-source: Gemini Vision + Workers AI + client-side Tesseract (merged) |
| TTS | google-tts-api |

## Where the Data Comes From

Consumer Truth uses a **two-layer verification system**: deterministic external databases for factual chemical data, and AI analysis cross-referenced against official regulatory standards. Every safety claim traces to a specific regulation.

### Layer 1: External APIs (Deterministic Data)

Queried at runtime with circuit breakers (3 consecutive failures → 5-minute cooldown) and in-memory caching.

| Source | Purpose | Endpoint |
|--------|---------|----------|
| **CAS Common Chemistry** | Chemical identity - maps names to CAS Registry Numbers | `commonchemistry.cas.org/api/search` |
| **OpenFDA** | Adverse events + food recall enforcement | `api.fda.gov/{food\|drug}/{event\|enforcement}.json` |
| **PubChem** | Molecular formulas, weights, IUPAC names, CIDs | `pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/{name}/property/...` |
| **EPA CompTox Dashboard** | Chemical toxicity and safety profiles (link-out) | `comptox.epa.gov/dashboard/chemical/details/{cas}` |
| **OpenFoodFacts / OpenBeautyFacts** | Global product database - additives (E-numbers), allergens, NOVA processing level | `world.openfoodfacts.org/cgi/search.pl` |

All OpenFoodFacts data is licensed under ODbL; see [`DATA_LICENSE.md`](DATA_LICENSE.md) for attribution terms.

Implementation: [`lib/external-data.ts`](lib/external-data.ts)

### Layer 2: Regulatory Standards (AI Analysis)

Gemini's analysis prompts are calibrated against these official regulatory databases. No blogs, no influencers - only absolute standards:

| Standard | Authority | Coverage |
|----------|-----------|----------|
| **FSSAI** | Food Safety and Standards Authority of India | Food additive limits, permitted ingredients (India) |
| **BIS IS 4707** | Bureau of Indian Standards | Cosmetic ingredient safety (India) |
| **FDA CFR Title 21** | U.S. Food and Drug Administration | Food additives, color additives, GRAS, cosmetic regulations |
| **EU CosIng** | European Commission | Cosmetic ingredient database - banned/restricted (EU) |
| **EU Reg. 1333/2008** | European Commission | Food additives Annex II / III |
| **WHO/IARC** | World Health Organization / IARC | Carcinogenicity classifications (Group 1, 2A, 2B, 3) |
| **Codex Alimentarius** | WHO/FAO | International food standards (GSFA) |
| **EPA SCIL** | U.S. Environmental Protection Agency | Safer Chemical Ingredients List |

Implementation: [`lib/gemini.ts`](lib/gemini.ts)

### What the AI Does NOT Use

- No blog posts, Reddit threads, or social media
- No "wellness" or "clean beauty" content
- No unverified claims
- No paywalled databases

## Project Structure

```
.
├── app/
│   ├── api/
│   │   ├── analyze/          # Image, text, voice analysis
│   │   ├── audio/[id]/       # TTS audio serving from R2
│   │   ├── compare/          # Product comparison
│   │   ├── cron/             # Scheduled refresh jobs
│   │   ├── feedback/         # User feedback collection
│   │   ├── question/         # Follow-up Q&A
│   │   ├── search/           # Product/ingredient search
│   │   ├── share/            # Share analysis results
│   │   ├── stats/            # Live usage statistics
│   │   ├── telegram/webhook/ # Telegram Bot API webhook
│   │   └── whatsapp/webhook/ # Meta WhatsApp Cloud API webhook
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx
├── components/
│   ├── AnalysisResult.tsx    # Per-ingredient result cards
│   ├── ComparisonView.tsx    # Side-by-side product comparison
│   ├── FileUpload.tsx        # Drag-drop image upload
│   ├── LiveStats.tsx         # Real-time usage counter
│   └── TrendingWidget.tsx    # Most-scanned products
├── lib/
│   ├── analysis.ts           # Core OCR → enrichment → analysis pipeline
│   ├── audio-store.ts        # R2 / in-memory audio storage
│   ├── cache.ts              # In-memory caching with TTL
│   ├── db.ts                 # D1 client
│   ├── external-data.ts      # CAS, FDA, EPA, PubChem, OFF APIs + circuit breakers
│   ├── format-response.ts    # Shared formatter (WhatsApp + Telegram)
│   ├── gemini.ts             # Gemini integration + prompts (deterministic + creative models)
│   ├── ocr-merge.ts          # Merges Gemini + Workers AI + Tesseract OCR outputs
│   ├── product-data.ts       # Local CSV lookups (FDA / OFF)
│   ├── security.ts           # Rate limiting, sanitization, prompt-injection guards
│   ├── telegram.ts           # Telegram Bot API client
│   ├── tts.ts                # Text-to-speech generation
│   ├── whatsapp.ts           # Meta WhatsApp Cloud API client
│   └── workers-ai-ocr.ts     # Cloudflare Workers AI OCR
├── scripts/                  # D1 schemas, ingestion/import scripts
├── docs/archive/             # Historical planning docs
├── wrangler.toml             # Cloudflare Workers config (D1, R2, AI bindings)
└── Architecture.md           # System architecture
```

## Setup

### Prerequisites

- Node.js 18+
- Google AI Studio API key - [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)
- Meta Business account with WhatsApp app - [developers.facebook.com/apps](https://developers.facebook.com/apps/)
- (Optional) Telegram Bot token via [@BotFather](https://t.me/BotFather)
- Cloudflare account (for deployment)

### Environment Variables

Create a `.env.local` file. See [`.env.example`](.env.example) for the full list.

```env
GEMINI_API_KEY=...
GEMINI_TEMPERATURE=0.2

# Meta WhatsApp Cloud API
WHATSAPP_TOKEN=...
WHATSAPP_PHONE_NUMBER_ID=...
WHATSAPP_VERIFY_TOKEN=...
WHATSAPP_APP_SECRET=...

# Telegram (optional)
TELEGRAM_BOT_TOKEN=...

NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### Install and Run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Database Setup

D1 databases are defined in [`wrangler.toml`](wrangler.toml). Schemas live in `scripts/`:

```bash
npx wrangler d1 execute consumer-truth-app --file=scripts/d1-app-schema.sql
npx wrangler d1 execute consumer-truth-ingredients-ref --file=scripts/d1-ingredients-ref-schema.sql
# ... plus food, nutrition, meta databases from their respective import scripts
```

### Deploy to Cloudflare Workers

```bash
# One-time secrets setup
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put WHATSAPP_TOKEN
npx wrangler secret put WHATSAPP_APP_SECRET
npx wrangler secret put TELEGRAM_BOT_TOKEN

# Build and deploy
npm run deploy
```

### WhatsApp Setup (Meta Cloud API)

1. In Meta for Developers, create an app → add the WhatsApp product.
2. Copy the test number's Phone Number ID and the temporary access token into `.env.local` / Worker secrets.
3. Set the webhook URL to `https://your-worker.workers.dev/api/whatsapp/webhook` with the verify token you chose.
4. Subscribe to `messages` events on the WhatsApp webhook.
5. Add your phone as a recipient in the Meta test console, then send a photo.

Meta's free tier includes 1,000 business-initiated conversations/month; user-initiated conversations to your number are always free to receive.

### Telegram Setup

1. Create a bot via `@BotFather`, copy the token.
2. Set the webhook:
   ```bash
   curl -F "url=https://your-worker.workers.dev/api/telegram/webhook" \
        "https://api.telegram.org/bot<TOKEN>/setWebhook"
   ```
3. Send a photo to your bot.

## Architecture Highlights

- **Deterministic layer first**: CAS, PubChem, OpenFDA, EFSA, IARC data hits before Gemini sees anything. Hard regulatory signals (IARC Group 1, banned-country lists, EFSA critical hazards) short-circuit the LLM entirely with a deterministic verdict.
- **Multi-source OCR**: Gemini Vision + Workers AI + client-side Tesseract results are merged; the most confident source wins per field.
- **Batch analysis**: Ingredients are grouped in chunks of 8 per Gemini call to avoid output token truncation, with 3-second gaps between chunks to respect rate limits.
- **Circuit breakers**: CAS, FDA, and PubChem APIs automatically pause after 3 consecutive failures (5-minute cooldown).
- **R2 audio**: TTS responses stored in R2 for reliable delivery on WhatsApp.
- **Security**: Rate limiting per phone/IP, input sanitization, prompt-injection guards, Meta webhook signature verification, SSRF protection on media URLs.

## Roadmap (`v2-grounded` branch)

Work in progress to eliminate any remaining LLM-generated regulatory claims:

- **Canonical Ingredient Graph** - one canonical ID per substance + full alias graph ([`scripts/d1-regulatory-schema.sql`](scripts/d1-regulatory-schema.sql))
- **Regulatory facts with mandatory provenance** - FSSAI, FDA CFR, EU CosIng, IARC, Codex ingested as structured rows, each with a verifiable `source_url`
- **Gemini as renderer only** - it receives structured facts, produces layman text; cannot invent a regulation or limit
- **Eval harness** - gold-standard ingredients measure hallucination rate before/after each change

Details in [`Architecture.md`](Architecture.md).

## License

**Proprietary. All rights reserved.**

The code in this repository is not licensed for redistribution, modification, or derivative use. The regulatory data assembled in D1 (where sourced from openly licensed providers like Open Food Facts under ODbL) carries its own license - see [`DATA_LICENSE.md`](DATA_LICENSE.md) for attribution terms on those components.

The product itself is **free to use**. The codebase is not open source.
