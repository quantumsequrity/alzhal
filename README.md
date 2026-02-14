# Consumer Truth

AI-powered ingredient safety analyzer that tells you what's really in your products. Scan a product label, paste ingredients, or send a voice note — get instant, regulation-backed safety analysis.

## Features

- **Photo Analysis** — Take a photo of any product label. Gemini Vision extracts ingredients and analyzes each one.
- **Text Analysis** — Paste an ingredient list directly for instant breakdown.
- **Voice Analysis** — Record a voice note describing ingredients. Gemini transcribes and analyzes.
- **WhatsApp Bot** — Send product photos, voice notes, or text via WhatsApp for on-the-go analysis.
- **Multilingual** — Detects language and responds in 20+ languages (Hindi, Tamil, Telugu, Bengali, Marathi, Kannada, Malayalam, Gujarati, Punjabi, Odia, Assamese, Urdu, and more).
- **Audio Responses** — TTS audio replies on WhatsApp so users can listen instead of read.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router) + TypeScript |
| Styling | Tailwind CSS v4 |
| AI Model | Google Gemini 2.0 Flash (Vision + Text + Audio) |
| Database | Supabase (PostgreSQL) |
| Messaging | Twilio WhatsApp Sandbox |
| Hosting | Cloudflare Workers (via @opennextjs/cloudflare) |
| Audio Storage | Cloudflare R2 |
| Image Processing | sharp |
| TTS | google-tts-api |

## Where the Data Comes From

Consumer Truth uses a **two-layer verification system**: real external databases for factual chemical data, and AI analysis cross-referenced against official regulatory standards.

### Layer 1: External APIs (Deterministic Data)

These are the actual data sources queried at runtime for every analysis:

| Source | What It Provides | Endpoint |
|--------|-----------------|----------|
| **CAS Common Chemistry** | Chemical identity — maps ingredient names to CAS Registry Numbers for unambiguous identification | `https://commonchemistry.cas.org/api/search?q={ingredient}` |
| **OpenFDA** | Adverse event reports, drug interactions, FDA enforcement actions | `https://api.fda.gov/{endpoint}.json` |
| **EPA CompTox Dashboard** | Chemical toxicity data, environmental safety profiles | `https://comptox.epa.gov/dashboard/chemical/details/{cas}` |
| **OpenFoodFacts** | Global food product database — allergens, additives (E-numbers), NOVA processing level, eco-scores | `https://world.openfoodfacts.org/cgi/search.pl` |
| **OpenBeautyFacts** | Global cosmetics/beauty product database — same structure as OpenFoodFacts for personal care items | `https://world.openbeautyfacts.org/cgi/search.pl` |

All external API calls include:
- 8-second timeout to prevent hanging
- Circuit breaker (3 consecutive failures = 5-minute cooldown before retrying)
- In-memory caching with TTL to avoid redundant lookups

Implementation: [`lib/external-data.ts`](lib/external-data.ts)

### Layer 2: Regulatory Standards (AI Analysis)

Gemini's analysis prompts are calibrated against these official regulatory databases. No blogs, no influencer opinions, no wellness sites — only absolute standards:

| Standard | Authority | Coverage |
|----------|----------|----------|
| **FSSAI** | Food Safety and Standards Authority of India | Food additive limits, permitted ingredients, labeling requirements for India |
| **BIS IS 4707** | Bureau of Indian Standards | Cosmetic ingredient safety standards for the Indian market |
| **FDA CFR Title 21** | U.S. Food and Drug Administration | Food additives, color additives, GRAS substances, cosmetic regulations |
| **EU CosIng** | European Commission | Cosmetic ingredient database — restricted/banned substances in the EU |
| **WHO/IARC** | World Health Organization / International Agency for Research on Cancer | Carcinogenicity classifications (Group 1, 2A, 2B, 3) |
| **EPA SCIL** | U.S. Environmental Protection Agency | Safer Chemical Ingredients List — green chemistry alternatives |

Implementation: [`lib/gemini.ts`](lib/gemini.ts)

### What the AI Does NOT Use

- No blog posts, Reddit threads, or social media
- No "wellness" or "clean beauty" influencer content
- No unverified health claims
- No proprietary/paywalled databases

Every safety rating is traceable to a specific regulation or official database.

## API Routes

| Method | Route | Description |
|--------|-------|-------------|
| POST | `/api/analyze/image` | Upload product photo for analysis |
| POST | `/api/analyze/text` | Submit ingredient text for analysis |
| POST | `/api/analyze/voice` | Upload voice note for analysis |
| POST | `/api/question` | Follow-up questions about an analysis |
| GET | `/api/stats` | Live usage statistics |
| POST | `/api/whatsapp/webhook` | Twilio WhatsApp webhook |
| GET | `/api/audio/[id]` | Serve TTS audio files from R2 |

## Project Structure

```
consumer-truth/
├── app/
│   ├── api/
│   │   ├── analyze/          # Image, text, voice analysis endpoints
│   │   ├── audio/[id]/       # TTS audio serving from R2
│   │   ├── question/         # Follow-up questions
│   │   ├── stats/            # Usage statistics
│   │   └── whatsapp/webhook  # Twilio WhatsApp integration
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx
├── components/
│   ├── AnalysisResult.tsx    # Analysis result cards
│   ├── FileUpload.tsx        # Photo upload with drag-drop
│   └── LiveStats.tsx         # Real-time usage counter
├── lib/
│   ├── analysis.ts           # Core analysis pipeline
│   ├── audio-store.ts        # R2 / in-memory audio storage
│   ├── cache.ts              # In-memory caching with TTL
│   ├── external-data.ts      # CAS, FDA, EPA, OpenFoodFacts APIs
│   ├── gemini.ts             # Gemini AI integration + prompts
│   ├── security.ts           # Rate limiting, input sanitization
│   ├── supabase.ts           # Database client
│   ├── tts.ts                # Text-to-speech generation
│   └── twilio.ts             # WhatsApp messaging client
├── wrangler.toml             # Cloudflare Workers config
└── Architecture.md           # Full system specification
```

## Setup

### Prerequisites

- Node.js 18+
- Google AI Studio API key ([get one](https://aistudio.google.com/app/apikey))
- Supabase project ([create one](https://supabase.com))
- Twilio account with WhatsApp Sandbox ([setup](https://console.twilio.com))
- Cloudflare account (for deployment)

### Environment Variables

Create a `.env.local` file:

```env
GEMINI_API_KEY=your_gemini_api_key
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
TWILIO_ACCOUNT_SID=your_twilio_sid
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_WHATSAPP_NUMBER=whatsapp:+14155238886
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### Install and Run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Database Setup

Run the SQL in `supabase/schema.sql` in your Supabase project's SQL Editor.

### Deploy to Cloudflare Workers

```bash
# Set secrets (one-time)
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put TWILIO_ACCOUNT_SID
npx wrangler secret put TWILIO_AUTH_TOKEN

# Build and deploy
npm run deploy
```

### WhatsApp Setup

1. Go to Twilio Console > Messaging > Try it out > Send a WhatsApp message.
2. Connect your sandbox by sending the join code.
3. Set the webhook URL for "When a message comes in" to:
   `https://your-worker.workers.dev/api/whatsapp/webhook`
4. Send a product photo or ingredient list to the sandbox number.

## Architecture Highlights

- **Batch Analysis** — Ingredients analyzed in chunks of 8 per Gemini call to avoid output truncation
- **Circuit Breakers** — CAS and FDA APIs automatically pause after 3 consecutive failures (5-min cooldown)
- **R2 Audio Storage** — TTS audio stored in Cloudflare R2 for reliable delivery; in-memory fallback for local dev
- **Security** — Rate limiting, input sanitization, prompt injection protection, Twilio signature verification
- **SSRF Protection** — WhatsApp media URLs validated against Twilio domains before fetching

## License

ISC
