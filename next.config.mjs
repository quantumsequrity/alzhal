/** @type {import('next').NextConfig} */
const nextConfig = {
  // Suppress sharp warnings on edge/CF
  images: {
    unoptimized: true,
  },
}

export default nextConfig
