// NOTE: This file uses Tailwind CSS v3 config syntax and is IGNORED by
// Tailwind CSS v4 (@tailwindcss/postcss). The project uses v4, which reads
// configuration from CSS files instead. This file is kept for reference only.

/** @type {import('tailwindcss').Config} */
module.exports = {
    content: [
        './app/**/*.{js,ts,jsx,tsx,mdx}',
        './pages/**/*.{js,ts,jsx,tsx,mdx}',
        './components/**/*.{js,ts,jsx,tsx,mdx}',
        './src/**/*.{js,ts,jsx,tsx,mdx}',
    ],
    theme: {
        extend: {},
    },
    plugins: [],
}
