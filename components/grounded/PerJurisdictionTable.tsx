'use client'

import { ExternalLink } from 'lucide-react'

export type PerJurisdictionRow = {
  jurisdiction: string
  status: string
  regulation_ref: string | null
  source_url: string
  source_name: string
}

const JURISDICTION_LABELS: Record<string, string> = {
  US_FDA:       'United States — FDA',
  EU:           'European Union',
  EFSA:         'EFSA (EU)',
  IN_FSSAI:     'India — FSSAI',
  IN_BIS:       'India — BIS',
  UK_FSA:       'United Kingdom — FSA',
  AU_NZ_FSANZ:  'Australia / New Zealand — FSANZ',
  CA_HC:        'Canada — Health Canada',
  JP_MHLW:      'Japan — MHLW',
  WHO_IARC:     'WHO / IARC',
  CODEX:        'Codex Alimentarius',
  NORDIC:       'Nordic Food Authorities',
}

function label(code: string): string {
  return JURISDICTION_LABELS[code] ?? code
}

export function PerJurisdictionTable({
  rows,
  missingJurisdictions = [],
}: {
  rows: PerJurisdictionRow[]
  missingJurisdictions?: string[]
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-2.5">Jurisdiction</th>
            <th className="px-4 py-2.5">Status</th>
            <th className="px-4 py-2.5">Reference</th>
            <th className="px-4 py-2.5 text-right">Source</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={4} className="px-4 py-6 text-center text-slate-400">
                No indexed regulatory records for this ingredient.
              </td>
            </tr>
          ) : (
            rows.map((r, i) => (
              <tr key={`${r.jurisdiction}-${i}`} className="hover:bg-slate-50/50">
                <td className="px-4 py-3 font-medium text-slate-900">
                  {label(r.jurisdiction)}
                </td>
                <td className="px-4 py-3 text-slate-700">{r.status}</td>
                <td className="px-4 py-3 text-slate-500 font-mono text-xs">
                  {r.regulation_ref ?? '—'}
                </td>
                <td className="px-4 py-3 text-right">
                  <a
                    href={r.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-sky-700 hover:text-sky-900 hover:underline"
                  >
                    {r.source_name.length > 40 ? r.source_name.slice(0, 38) + '…' : r.source_name}
                    <ExternalLink size={12} aria-hidden />
                  </a>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      {missingJurisdictions.length > 0 && (
        <div className="border-t border-slate-100 bg-slate-50/60 px-4 py-2.5 text-xs text-slate-500">
          <span className="font-medium">Checked but not recorded:</span>{' '}
          {missingJurisdictions.map(label).join(', ')}
          <span className="ml-1 italic">— no claim made.</span>
        </div>
      )}
    </div>
  )
}
