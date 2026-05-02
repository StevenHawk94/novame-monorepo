/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@novame/core'],
  reactStrictMode: true,
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.r2.cloudflarestorage.com',
      },
      {
        protocol: 'https',
        hostname: '**.r2.dev',
      },
      {
        protocol: 'https',
        hostname: '**.supabase.co',
      },
    ],
  },
  async rewrites() {
    const apiUrl = process.env.NOVAME_API_URL || 'http://localhost:3001'
    console.log('[next.config.js] NOVAME_API_URL =', JSON.stringify(process.env.NOVAME_API_URL))
    console.log('[next.config.js] resolved apiUrl =', JSON.stringify(apiUrl))
    return [
      { source: '/api/orders', destination: `${apiUrl}/api/orders` },
      { source: '/api/orders/:path*', destination: `${apiUrl}/api/orders/:path*` },
      { source: '/api/force-update', destination: `${apiUrl}/api/force-update` },
      { source: '/api/force-update/:path*', destination: `${apiUrl}/api/force-update/:path*` },
      { source: '/api/generate-abc-cards', destination: `${apiUrl}/api/generate-abc-cards` },
      { source: '/api/generate-abc-cards/:path*', destination: `${apiUrl}/api/generate-abc-cards/:path*` },
    ]
  },
};

module.exports = nextConfig;
