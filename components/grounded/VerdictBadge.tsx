'use client'

import { CheckCircle2, AlertTriangle, XCircle, HelpCircle, ShieldCheck, Ban } from 'lucide-react'

export type Verdict = 'SAFE' | 'CAUTION' | 'AVOID' | 'BANNED' | 'UNKNOWN'

const styles: Record<Verdict, { icon: typeof ShieldCheck; bg: string; text: string; ring: string; label: string }> = {
  SAFE:    { icon: ShieldCheck,    bg: 'bg-emerald-50',  text: 'text-emerald-700',  ring: 'ring-emerald-200',  label: 'Safe' },
  CAUTION: { icon: AlertTriangle,  bg: 'bg-amber-50',    text: 'text-amber-700',    ring: 'ring-amber-200',    label: 'Caution' },
  AVOID:   { icon: XCircle,        bg: 'bg-orange-50',   text: 'text-orange-700',   ring: 'ring-orange-200',   label: 'Avoid' },
  BANNED:  { icon: Ban,            bg: 'bg-red-50',      text: 'text-red-700',      ring: 'ring-red-200',      label: 'Banned' },
  UNKNOWN: { icon: HelpCircle,     bg: 'bg-slate-50',    text: 'text-slate-600',    ring: 'ring-slate-200',    label: 'No official record' },
}

export function VerdictBadge({
  verdict,
  size = 'md',
  showGroundedMark = false,
}: {
  verdict: Verdict
  size?: 'sm' | 'md' | 'lg'
  showGroundedMark?: boolean
}) {
  const s = styles[verdict]
  const Icon = s.icon
  const sizeClasses = size === 'sm'
    ? 'text-xs px-2 py-0.5 gap-1'
    : size === 'lg'
    ? 'text-base px-3.5 py-1.5 gap-2'
    : 'text-sm px-2.5 py-1 gap-1.5'
  const iconSize = size === 'sm' ? 12 : size === 'lg' ? 18 : 14

  return (
    <span
      className={`inline-flex items-center rounded-full font-semibold ring-1 ring-inset ${s.bg} ${s.text} ${s.ring} ${sizeClasses}`}
      aria-label={`Verdict: ${s.label}`}
    >
      <Icon size={iconSize} strokeWidth={2.25} aria-hidden />
      <span>{s.label}</span>
      {showGroundedMark && (
        <span
          className="ml-1 text-[10px] font-medium uppercase tracking-wide opacity-70"
          title="Verdict derived from structured regulatory facts, not from an AI-generated claim."
        >
          grounded
        </span>
      )}
    </span>
  )
}

export function VerdictReason({ reason }: { reason: string }) {
  return (
    <p className="text-sm leading-relaxed text-slate-600">
      {reason}
    </p>
  )
}
