# Contributing to Alzhal

Thanks for considering a contribution. Alzhal is a public-safety tool, so the bar is honesty over speed.

## What kinds of contribution help

- **Regulatory ingesters** — adding ANVISA (Brazil), MFDS (Korea), or any other authoritative regulator not yet on the list. Each ingester lives in `scripts/seed-*.{py,ts}` and writes into the canonical-ingredient-graph schema (see `scripts/d1-regulatory-schema.sql`). Every fact row must carry a `source_url` + `snapshot_date`. No row without a source.
- **Translations.** See the policy below — *read it before opening a translation PR*.
- **UI/UX fixes** in `app/page.tsx`, `components/`, especially anything that makes the result page easier for non-technical users.
- **Bug reports and reproductions** in GitHub Issues.
- **Eval-harness additions** — gold-standard ingredients with expected verdicts + expected citation URLs (`scripts/eval-harness.ts`). Catches regressions in the no-hallucination guarantee.

## Translation policy

Alzhal is a safety app. A confident-sounding but slightly-wrong translation of a safety message is **worse** than the English fallback, because users trust their mother tongue more.

### How translation works in Alzhal

- **English is the primary language.** Static UI labels are hardcoded in English. There is no per-language hardcoded UI string in the codebase — no language is privileged over another in code.
- **12 additional languages** (Hindi, Tamil, Telugu, Kannada, Bengali, Marathi, Gujarati, Punjabi, Malayalam, Odia, Assamese, Urdu) are exposed in the language picker. When a user selects one, the dynamic ingredient content — `simple_name`, `how_its_made`, `safety_summary`, voice replies, follow-up answers — is translated at runtime by the model (`translateContent` in `lib/gemini.ts`). The pipeline does not branch on language; it just passes the language string to the prompt. All 12 are handled uniformly as a group.
- **Verified hardcoded translations** for the static UI guidance copy (e.g. `WhatThisMeans`) are accepted on PR. None are merged today other than English. The map lives in `components/IngredientGuidance.tsx`.

### Rules for adding a verified translation

- A native speaker (or someone equally fluent) must confirm the wording.
- No machine-translated tier in the source. Either we are sure, or we show English.
- Open a PR adding an entry to `TRANSLATIONS` in `components/IngredientGuidance.tsx`. Match the structure of the English entry exactly.
- Tone: direct, second-person, no jargon, short sentences. Match the existing register — "Worth knowing" is right, "Note the following advisory" is not.

### Adding a new language to the picker

Open `app/page.tsx` and add an `<option value="LanguageName">Native script</option>`. The backend will route translation for it automatically; no other code changes needed.

## Code style

- Run `npm run typecheck` before pushing.
- Run `npm run lint` before pushing.
- Prefer editing existing files over adding new ones.
- No silent failures. If a fact source is unreachable, the system should say so, not pretend a result.
- No hallucinated regulator claims. The whole point of the grounded pipeline is the structural guarantee. New code must preserve it.

## Reporting a security issue

Do not open a public issue. Open a private security advisory on GitHub instead. Include:

- The endpoint or component involved.
- A minimal reproduction (curl + sample payload is ideal).
- The impact you observed.

## Submitting a pull request

1. Fork → branch → PR.
2. Keep PRs focused on one concern.
3. Describe the change in user-facing terms in the PR body (what does this look like to someone using the WhatsApp bot?).
4. By submitting, you agree your contribution is licensed under Apache 2.0.
