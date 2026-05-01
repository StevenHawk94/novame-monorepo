/** @type {import('next').NextConfig} */
const nextConfig = {
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
