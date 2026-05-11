'use client'

import { CheckCircle2, AlertTriangle, XCircle, ShieldCheck } from 'lucide-react'

interface ComparisonProduct {
    name: string
    safety_score: string
    key_concerns: string[]
    pros: string[]
}

interface ComparisonData {
    product_a: ComparisonProduct
    product_b: ComparisonProduct
    verdict: string
    recommendation: string
    sources: string[]
}

function ScoreBadge({ score }: { score: string }) {
    const upper = score?.toUpperCase() || 'UNKNOWN'
    if (upper === 'HIGH') return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-green-500/15 text-green-400 text-xs font-bold">
            <CheckCircle2 size={12} /> HIGH
        </span>
    )
    if (upper === 'MEDIUM') return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-yellow-500/15 text-yellow-400 text-xs font-bold">
            <AlertTriangle size={12} /> MEDIUM
        </span>
    )
    if (upper === 'LOW') return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-red-500/15 text-red-400 text-xs font-bold">
            <XCircle size={12} /> LOW
        </span>
    )
    return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/5 text-gray-400 text-xs font-bold">
            UNKNOWN
        </span>
    )
}

function ProductCard({ product, isRecommended, language }: { product: ComparisonProduct; isRecommended: boolean; language: string }) {
    return (
        <div className={`flex-1 glass-card rounded-2xl p-5 space-y-4 ${isRecommended ? 'border-green-500/30 ring-1 ring-green-500/20' : ''}`}>
            {isRecommended && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-500/15 text-green-400 text-[10px] font-bold uppercase tracking-wider">
                    <ShieldCheck size={10} />
                    {'Recommended'}
                </span>
            )}
            <h3 className="text-lg font-semibold text-white">{product.name}</h3>
            <ScoreBadge score={product.safety_score} />

            {product.pros && product.pros.length > 0 && (
                <div>
                    <p className="text-[10px] text-gray-500 uppercase tracking-wider font-bold mb-2">
                        {'Positives'}
                    </p>
                    <ul className="space-y-1.5">
                        {product.pros.map((p, i) => (
                            <li key={i} className="text-sm text-green-400/80 flex items-start gap-2">
                                <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-green-400 flex-shrink-0" />
                                {p}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {product.key_concerns && product.key_concerns.length > 0 && (
                <div>
                    <p className="text-[10px] text-gray-500 uppercase tracking-wider font-bold mb-2">
                        {'Concerns'}
                    </p>
                    <ul className="space-y-1.5">
                        {product.key_concerns.map((c, i) => (
                            <li key={i} className="text-sm text-yellow-400/80 flex items-start gap-2">
                                <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-yellow-400 flex-shrink-0" />
                                {c}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    )
}

export default function ComparisonView({ data, language = 'English' }: { data: ComparisonData; language?: string }) {
    const recLower = (data.recommendation || '').toLowerCase()

    return (
        <div className="w-full max-w-5xl mx-auto pb-20 space-y-6 animate-fade-in">
            {/* Side by side cards */}
            <div className="flex flex-col md:flex-row gap-4">
                <ProductCard
                    product={data.product_a}
                    isRecommended={recLower === 'a' || recLower.includes('product a') || recLower.includes(data.product_a?.name?.toLowerCase?.() || '__')}
                    language={language}
                />
                <ProductCard
                    product={data.product_b}
                    isRecommended={recLower === 'b' || recLower.includes('product b') || recLower.includes(data.product_b?.name?.toLowerCase?.() || '__')}
                    language={language}
                />
            </div>

            {/* Verdict */}
            {data.verdict && (
                <div className="glass-card rounded-2xl p-5 space-y-3">
                    <h4 className="text-sm font-bold text-gray-400 uppercase tracking-wider flex items-center gap-2">
                        <ShieldCheck size={14} />
                        {'Verdict'}
                    </h4>
                    <p className="text-sm text-gray-300 leading-relaxed">{data.verdict}</p>
                </div>
            )}

            {/* Sources */}
            {data.sources && data.sources.length > 0 && (
                <div className="glass-card rounded-2xl p-5">
                    <div className="flex flex-wrap gap-1.5">
                        {data.sources.map((s, i) => (
                            <span key={i} className="px-2 py-1 text-[10px] rounded-lg bg-blue-500/8 text-blue-400/80 border border-blue-500/15">
                                {s}
                            </span>
                        ))}
                    </div>
                    <p className="text-gray-600 text-[10px] mt-3">
                        {'Educational information only, not medical advice.'}
                    </p>
                </div>
            )}
        </div>
    )
}
