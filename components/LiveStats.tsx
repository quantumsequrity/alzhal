'use client'

import { useEffect, useState } from 'react'

interface LiveStatsProps {
    language?: string
}

export default function LiveStats({ language = 'English' }: LiveStatsProps) {
    const [stats, setStats] = useState({
        productsChecked: 0,
        ingredientsAnalyzed: 0,
        toxicFound: 0,
        sourcesChecked: 6
    })
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        async function fetchStats() {
            try {
                const res = await fetch('/api/stats')
                if (res.ok) {
                    const data = await res.json()
                    setStats({
                        productsChecked: data.productsChecked || 0,
                        ingredientsAnalyzed: data.ingredientsAnalyzed || 0,
                        toxicFound: data.toxicFound || 0,
                        sourcesChecked: data.sourcesChecked || 6
                    })
                }
            } catch (e) {
                console.error("Failed to load stats", e)
            } finally {
                setLoading(false)
            }
        }

        fetchStats()
        const interval = setInterval(fetchStats, 30000)
        return () => clearInterval(interval)
    }, [])

    const allZero =
        stats.productsChecked === 0 &&
        stats.ingredientsAnalyzed === 0 &&
        stats.toxicFound === 0

    if (loading) {
        return (
            <div className="w-full border-t border-zinc-800/50 py-4">
                <div className="h-4 w-64 mx-auto rounded bg-zinc-800/60 animate-pulse" />
            </div>
        )
    }

    return (
        <div className="w-full border-t border-zinc-800/50 py-4">
            {allZero ? (
                <p className="text-xs text-zinc-600 text-center">
                    {'Start scanning to see stats'}
                </p>
            ) : (
                <p className="text-xs sm:text-sm text-zinc-500 text-center">
                    <span className="text-zinc-300 font-medium">
                        {stats.productsChecked.toLocaleString()}
                    </span>
                    {' '}{'products'}
                    <span className="mx-1.5 text-zinc-700">&middot;</span>
                    <span className="text-zinc-300 font-medium">
                        {stats.ingredientsAnalyzed.toLocaleString()}
                    </span>
                    {' '}{'ingredients'}
                    <span className="mx-1.5 text-zinc-700">&middot;</span>
                    <span className="text-zinc-300 font-medium">
                        {stats.toxicFound.toLocaleString()}
                    </span>
                    {' '}{'toxic'}
                    <span className="mx-1.5 text-zinc-700">&middot;</span>
                    <span className="text-zinc-300 font-medium">
                        {stats.sourcesChecked.toLocaleString()}
                    </span>
                    {' '}{'sources'}
                </p>
            )}
        </div>
    )
}
