'use client'

import { VerdictBadge, VerdictReason, type Verdict } from './VerdictBadge'
import { PerJurisdictionTable, type PerJurisdictionRow } from './PerJurisdictionTable'

export type GroundedIngredientCardProps = {
  primary_name: string
  canonical_id?: string
  verdict: Verdict
  verdict_reason: string
  simple_name?: string
  how_its_made?: string | null
  safety_summary?: string
  per_jurisdiction: PerJurisdictionRow[]
  missing_jurisdictions?: string[]
  percentage?: string | null
}

/**
 * A single-ingredient card that rendered-from-grounded-facts analysis.
 *
 * Every user-facing claim on this card traces to one of:
 *   - verdict / verdict_reason: deterministic, computed from facts in code
 *   - per_jurisdiction: one row per regulatory_fact with clickable source_url
 *   - simple_name / how_its_made / safety_summary: LLM-rendered, but the
 *     prompt is structurally unable to invent regulatory claims
 *
 * The presence of this card in the UI signals "grounded path" — distinct
 * from the legacy heuristic-based cards.
 */
export function GroundedIngredientCard(props: GroundedIngredientCardProps) {
  const {
    primary_name,
    verdict,
    verdict_reason,
    simple_name,
    how_its_made,
    safety_summary,
    per_jurisdiction,
    missing_jurisdictions,
    percentage,
  } = props

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-slate-900">
            {primary_name}
            {percentage && <span className="ml-2 text-sm font-normal text-slate-500">{percentage}</span>}
          </h3>
          {simple_name && (
            <p className="mt-1 text-sm leading-relaxed text-slate-600">{simple_name}</p>
          )}
        </div>
        <VerdictBadge verdict={verdict} size="md" showGroundedMark />
      </header>

      <div className="mb-4 rounded-lg bg-slate-50 p-3">
        <VerdictReason reason={verdict_reason} />
      </div>

      {safety_summary && safety_summary !== verdict_reason && (
        <div className="mb-4">
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Plain-language summary</h4>
          <p className="text-sm leading-relaxed text-slate-700">{safety_summary}</p>
        </div>
      )}

      {how_its_made && (
        <div className="mb-4">
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">How it's made</h4>
          <p className="text-sm leading-relaxed text-slate-700">{how_its_made}</p>
        </div>
      )}

      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Regulatory records</h4>
        <PerJurisdictionTable rows={per_jurisdiction} missingJurisdictions={missing_jurisdictions} />
      </div>
    </article>
  )
}
