'use client'

import { Lightbulb, ExternalLink, BookOpen } from 'lucide-react'

type Verdict = 'safe' | 'caution' | 'danger' | 'banned' | 'unknown'
type Guidance = { title: string; action: string }

// Translation policy (read this before adding entries):
//
//   Alzhal is a safety app. A confident-sounding but slightly-wrong
//   translation of a safety message is worse than the English fallback,
//   because users trust their mother tongue more.
//
//   Therefore: only add a language entry here if a native speaker (or
//   someone equally fluent) has confirmed the wording. Languages without a
//   verified entry intentionally fall through to English. There is no
//   machine-translated tier; either we're sure, or we show English.
//
//   To contribute: open a PR adding a new entry below, verified by a native
//   speaker. Keep the tone direct, second-person, no jargon.
//
//   Note: dynamic ingredient explanations and voice replies are translated
//   at runtime by the Gemini layer using the selected language, and do not
//   depend on this map.

const TRANSLATIONS: Partial<Record<string, Record<Verdict, Guidance>>> = {
  English: {
    safe: {
      title: "You're good.",
      action: 'This is permitted everywhere we checked and has no major safety flags. Use it as you normally would.',
    },
    caution: {
      title: 'Worth knowing.',
      action: 'Generally allowed, but watch the dose. Variety helps — try not to make this a daily, large-portion ingredient, especially for children, pregnancy, or existing health conditions.',
    },
    danger: {
      title: 'Skip if you can.',
      action: 'Multiple regulators flag this. Look for an alternative product, especially if you would consume it often or give it to kids.',
    },
    banned: {
      title: 'Avoid.',
      action: 'Banned in at least one major market. If you have a choice, pick a product without this ingredient.',
    },
    unknown: {
      title: 'No official record.',
      action: 'We did not find a regulation for this ingredient. That is not a green light — it just means no public hazard data is indexed yet. Use the "Learn more" links below to read up.',
    },
  },
  // All other languages currently fall through to English. See policy above.
}

function pickGuidance(language: string, verdict: Verdict): Guidance {
  const verified = TRANSLATIONS[language]
  if (verified) return verified[verdict]
  return TRANSLATIONS.English![verdict]
}

const SECTION_LABELS: Partial<Record<string, { whatThisMeans: string; learnMore: string; learnMoreSub: string }>> = {
  English: {
    whatThisMeans: 'What this means for you',
    learnMore: 'Learn more — free official sources',
    learnMoreSub: 'Public databases. Cross-check Alzhal against any of these.',
  },
}

function pickSectionLabels(language: string) {
  return SECTION_LABELS[language] ?? SECTION_LABELS.English!
}

export function WhatThisMeans({ verdict, language }: { verdict: string; language: string }) {
  const v = (verdict || 'unknown') as Verdict
  const g = pickGuidance(language, v)
  const labels = pickSectionLabels(language)

  const tint =
    v === 'safe' ? { ring: 'border-emerald-500/20', bg: 'bg-emerald-500/5', text: 'text-emerald-300', icon: 'text-emerald-400' } :
    v === 'caution' ? { ring: 'border-yellow-500/20', bg: 'bg-yellow-500/5', text: 'text-yellow-300', icon: 'text-yellow-400' } :
    v === 'danger' ? { ring: 'border-orange-500/20', bg: 'bg-orange-500/5', text: 'text-orange-300', icon: 'text-orange-400' } :
    v === 'banned' ? { ring: 'border-red-500/25', bg: 'bg-red-500/8', text: 'text-red-300', icon: 'text-red-400' } :
                     { ring: 'border-white/10', bg: 'bg-white/[0.03]', text: 'text-gray-200', icon: 'text-gray-400' }

  return (
    <div className={`p-4 rounded-xl border ${tint.ring} ${tint.bg}`}>
      <div className="flex items-start gap-3">
        <Lightbulb size={18} className={`${tint.icon} mt-0.5 flex-shrink-0`} aria-hidden />
        <div>
          <p className={`text-sm font-semibold ${tint.text} mb-1`}>
            {labels.whatThisMeans} — {g.title}
          </p>
          <p className="text-sm text-gray-300 leading-relaxed">{g.action}</p>
        </div>
      </div>
    </div>
  )
}

type LearnMoreInput = {
  name: string
  casNumber?: string | null
  pubchemCid?: number | null
  eNumber?: string | null
}

// Public-database links the user can use to cross-check Alzhal. Every URL
// here points at a free, government-or-NIH-grade source. None of these are
// required for Alzhal's verdict — they exist so a curious user can dig in.
//
// Labels stay in English on purpose: PubChem, MedlinePlus, EPA CompTox, etc.
// are proper nouns of the destination sites. Translating them would obscure
// what site the user is about to open.

type ExtLink = { label: string; href: string; hint: string }

function buildLinks(input: LearnMoreInput): ExtLink[] {
  const links: ExtLink[] = []
  const cas = input.casNumber && input.casNumber !== 'N/A' ? input.casNumber : null
  const cid = input.pubchemCid && input.pubchemCid > 0 ? input.pubchemCid : null
  const q = encodeURIComponent(input.name)

  // PubChem — formula, hazards, synonyms. Preferred when we have an identifier.
  links.push({
    label: 'PubChem (NIH)',
    href: cid
      ? `https://pubchem.ncbi.nlm.nih.gov/compound/${cid}`
      : cas
        ? `https://pubchem.ncbi.nlm.nih.gov/#query=${encodeURIComponent(cas)}`
        : `https://pubchem.ncbi.nlm.nih.gov/#query=${q}`,
    hint: 'Molecular structure and names',
  })

  // MedlinePlus — NIH's plain-language consumer health portal.
  links.push({
    label: 'MedlinePlus (NIH)',
    href: `https://medlineplus.gov/search.html?query=${q}`,
    hint: 'Plain-language health info',
  })

  if (cas) {
    // EPA CompTox — toxicity summaries, CAS-keyed.
    links.push({
      label: 'EPA CompTox',
      href: `https://comptox.epa.gov/dashboard/chemical/details/${cas}`,
      hint: 'Toxicity data',
    })
    // ECHA — EU Chemicals Agency; CAS-keyed.
    links.push({
      label: 'ECHA (EU)',
      href: `https://echa.europa.eu/search-for-chemicals?text=${encodeURIComponent(cas)}`,
      hint: 'EU chemical safety',
    })
  }

  // Open Food Facts — see what other products contain this.
  links.push({
    label: 'Open Food Facts',
    href: `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${q}&search_simple=1&action=process`,
    hint: 'Products that contain this',
  })

  // Wikipedia — general background.
  links.push({
    label: 'Wikipedia',
    href: `https://en.wikipedia.org/wiki/Special:Search?search=${q}`,
    hint: 'General background',
  })

  return links
}

export function LearnMoreLinks({ input, language }: { input: LearnMoreInput; language: string }) {
  const links = buildLinks(input)
  const labels = pickSectionLabels(language)
  return (
    <div className="pt-3 border-t border-white/5">
      <div className="mb-2">
        <h5 className="text-[10px] font-bold text-gray-500 uppercase tracking-wider flex items-center gap-1">
          <BookOpen size={11} aria-hidden />
          {labels.learnMore}
        </h5>
        <p className="text-[10px] text-gray-600 mt-0.5 leading-relaxed">{labels.learnMoreSub}</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
        {links.map((l, i) => (
          <a
            key={i}
            href={l.href}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg bg-white/[0.02] hover:bg-blue-500/10 border border-white/5 hover:border-blue-500/30 transition"
          >
            <div className="min-w-0">
              <p className="text-xs font-medium text-blue-300 group-hover:text-blue-200 truncate">{l.label}</p>
              <p className="text-[10px] text-gray-500 truncate">{l.hint}</p>
            </div>
            <ExternalLink size={11} className="text-gray-500 group-hover:text-blue-300 flex-shrink-0" aria-hidden />
          </a>
        ))}
      </div>
    </div>
  )
}
