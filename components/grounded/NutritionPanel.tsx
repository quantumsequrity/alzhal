'use client'

import type { NutritionPanelData, NutritionValue } from '@/lib/nutrition-ocr'

function fmt(v: NutritionValue): { perServing: string; per100g: string; dv: string } {
  const p = (n: number | null, unit: string | null) =>
    n == null ? '—' : `${Number.isInteger(n) ? n : n.toFixed(1)} ${unit ?? ''}`.trim()
  return {
    perServing: p(v.amount_per_serving, v.unit),
    per100g:    p(v.amount_per_100g, v.unit),
    dv:         v.percent_dv == null ? '—' : `${v.percent_dv}%`,
  }
}

const LABEL_SOURCE_NAMES: Record<string, string> = {
  US_FDA_nutrition_facts:        'US FDA Nutrition Facts',
  EU_nutrition_declaration:      'EU Nutrition Declaration',
  IN_FSSAI_nutritional_information: 'India FSSAI Nutritional Information',
  unknown:                       'Unrecognized label format',
}

export function NutritionPanel({ data }: { data: NutritionPanelData }) {
  const rows: Array<{ name: string; v: NutritionValue; indent?: boolean }> = [
    { name: 'Energy',              v: data.energy.kcal },
    { name: 'Protein',             v: data.macros.protein_g },
    { name: 'Total Fat',           v: data.macros.fat_g },
    { name: 'Saturated Fat',       v: data.macros.saturated_fat_g, indent: true },
    { name: 'Trans Fat',           v: data.macros.trans_fat_g,     indent: true },
    { name: 'Total Carbohydrate',  v: data.macros.carbohydrate_g },
    { name: 'Sugar',               v: data.macros.sugar_g,         indent: true },
    { name: 'Added Sugar',         v: data.macros.added_sugar_g,   indent: true },
    { name: 'Fiber',               v: data.macros.fiber_g,         indent: true },
    { name: 'Sodium',              v: data.sodium_mg },
  ]

  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <header className="flex items-baseline justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Nutrition — transcribed from the label</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            Format: {LABEL_SOURCE_NAMES[data.source_label] ?? data.source_label}
            {data.serving_size && <> · Serving: <span className="font-medium">{data.serving_size}</span></>}
            {data.servings_per_container && <> · {data.servings_per_container} servings per container</>}
          </p>
        </div>
        <span
          className="shrink-0 rounded-full bg-slate-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500 ring-1 ring-inset ring-slate-200"
          title="Values here are transcribed from the printed panel. They are not inferred by AI and not cross-verified against regulatory limits."
        >
          ocr, not inferred
        </span>
      </header>

      <table className="w-full text-sm">
        <thead className="bg-slate-50/50 text-xs font-medium uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-2 text-left">Nutrient</th>
            <th className="px-4 py-2 text-right">Per serving</th>
            <th className="px-4 py-2 text-right">Per 100 g/ml</th>
            <th className="px-4 py-2 text-right">% DV</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r, i) => {
            const f = fmt(r.v)
            return (
              <tr key={i}>
                <td className={`px-4 py-2 ${r.indent ? 'pl-8 text-slate-500' : 'text-slate-800 font-medium'}`}>
                  {r.name}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{f.perServing}</td>
                <td className="px-4 py-2 text-right tabular-nums">{f.per100g}</td>
                <td className="px-4 py-2 text-right tabular-nums text-slate-500">{f.dv}</td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {data.micronutrients.length > 0 && (
        <div className="border-t border-slate-100 px-4 py-3">
          <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Vitamins & Minerals</h4>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm md:grid-cols-3">
            {data.micronutrients.map((m, i) => (
              <li key={i} className="flex justify-between gap-2 text-slate-700">
                <span>{m.name}</span>
                <span className="tabular-nums text-slate-500">
                  {m.amount_per_serving != null ? `${m.amount_per_serving} ${m.unit}` : '—'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {data.raw_ocr_text && (
        <details className="border-t border-slate-100 px-4 py-3 text-xs">
          <summary className="cursor-pointer text-slate-500 hover:text-slate-700">Raw OCR text</summary>
          <pre className="mt-2 whitespace-pre-wrap rounded bg-slate-50 p-3 font-mono text-[11px] leading-snug text-slate-600">
            {data.raw_ocr_text}
          </pre>
        </details>
      )}
    </section>
  )
}
