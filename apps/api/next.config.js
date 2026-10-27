/** @type {import('next').NextConfig} */
const path = require('node:path')
const nextConfig = {
  transpilePackages: ['@novame/core', '@novame/engine', '@novame/domain'],
  reactStrictMode: true,

  // Avoid bundling pages code — this is API-only
  pageExtensions: ['ts', 'tsx', 'js', 'jsx'],

  // Image domains (kept for parity with legacy project, in case admin embeds images)
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'lh3.googleusercontent.com' },
      { protocol: 'https', hostname: '*.supabase.co' },
      { protocol: 'https', hostname: '*.r2.cloudflarestorage.com' },
    ],
  },

  // Vercel deployment optimizations
  output: 'standalone',
  // pnpm keeps native binaries outside the API directory. Sharp 0.35 resolves
  // libvips dynamically, beyond NFT's static import graph. Include only this
  // route's native packages; never copy the whole workspace or mobile assets.
  outputFileTracingRoot: path.join(__dirname, '../..'),
  outputFileTracingIncludes: {
    '/api/upload-avatar': [
      '../../node_modules/.pnpm/@img+sharp-*/node_modules/@img/sharp-*/**/*',
    ],
  },

  // Disable type checking on build (we run `pnpm type-check` separately in CI)
  // This is fine for an API project — Next handles route validation at runtime
  typescript: {
    ignoreBuildErrors: false,
  },

  // Don't run ESLint during builds (run separately)
  eslint: {
    ignoreDuringBuilds: false,
  },
}

module.exports = nextConfig
