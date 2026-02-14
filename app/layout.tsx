import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({
    subsets: ['latin'],
    display: 'swap',
    variable: '--font-inter',
})

export const metadata: Metadata = {
    title: 'Consumer Truth - Know What You Consume',
    description: 'AI-powered ingredient analysis against FDA, EU, WHO & BIS/FSSAI safety standards. Instant safety reports for food, cosmetics, household products & more.',
    keywords: ['ingredient analysis', 'food safety', 'cosmetic safety', 'FDA', 'FSSAI', 'consumer safety', 'product ingredients'],
    authors: [{ name: 'Consumer Truth' }],
    openGraph: {
        title: 'Consumer Truth - Know What You Consume',
        description: 'Instant AI analysis of product ingredients against global safety standards.',
        type: 'website',
    },
}

export const viewport: Viewport = {
    width: 'device-width',
    initialScale: 1,
    maximumScale: 1,
    themeColor: '#050508',
}

export default function RootLayout({
    children,
}: {
    children: React.ReactNode
}) {
    return (
        <html lang="en" className={`${inter.variable} dark`}>
            <body className={`${inter.className} noise-overlay`}>{children}</body>
        </html>
    )
}
