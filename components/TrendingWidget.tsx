'use client'

import { useState, useEffect } from 'react'
import { TrendingUp, AlertTriangle, Package } from 'lucide-react'

interface TrendingData {
    topProducts?: { product_name: string; brand: string; scanned_count: number; category: string }[]
    topConcerns?: { name: string; category: string; analyzed_count: number }[]
}

export default function TrendingWidget({ language = 'English' }: { language?: string }) {
    const [data, setData] = useState<TrendingData | null>(null)

    useEffect(() => {
        fetch('/api/stats')
            .then(res => res.json())
            .then(stats => {
                if (stats.topProducts?.length > 0 || stats.topConcerns?.length > 0) {
                    setData({ topProducts: stats.topProducts, topConcerns: stats.topConcerns })
                }
            })
            .catch(() => {})
    }, [])

    if (!data) return null

    const categoryColors: Record<string, string> = {
        'BANNED': 'text-red-400 bg-red-500/10',
        'AVOID': 'text-red-400 bg-red-500/10',
        'CAUTION': 'text-yellow-400 bg-yellow-500/10',
    }

    return (
        <div className="space-y-4 animate-fade-in">
            {/* Top Products */}
            {data.topProducts && data.topProducts.length > 0 && (
                <div className="glass-card rounded-xl p-4">
                    <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                        <TrendingUp size={13} />
                        {'Most Checked Products'}
                    </h4>
                    <div className="space-y-2">
                        {data.topProducts.map((p, i) => (
                            <div key={i} className="flex items-center justify-between py-1.5">
                                <div className="flex items-center gap-2 min-w-0">
                                    <span className="text-xs text-gray-600 font-mono w-4">{i + 1}.</span>
                                    <div className="min-w-0">
                                        <p className="text-sm text-gray-300 truncate">{p.product_name}</p>
                                        {p.brand && <p className="text-[10px] text-gray-600">{p.brand}</p>}
                                    </div>
                                </div>
                                <span className="text-[10px] text-gray-600 flex items-center gap-1 flex-shrink-0 ml-2">
                                    <Package size={10} />
                                    {p.scanned_count}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Top Concerns */}
            {data.topConcerns && data.topConcerns.length > 0 && (
                <div className="glass-card rounded-xl p-4">
                    <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                        <AlertTriangle size={13} />
                        {'Ingredients of Concern'}
                    </h4>
                    <div className="flex flex-wrap gap-1.5">
                        {data.topConcerns.map((c, i) => {
                            const colorClass = categoryColors[c.category?.toUpperCase()] || 'text-gray-400 bg-white/5'
                            return (
                                <span
                                    key={i}
                                    className={`px-2.5 py-1 text-xs rounded-lg border border-white/5 ${colorClass}`}
                                >
                                    {c.name}
                                </span>
                            )
                        })}
                    </div>
                </div>
            )}
        </div>
    )
}
