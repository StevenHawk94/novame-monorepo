import type { ReactNode } from 'react'

/**
 * Root layout for the API server.
 *
 * This Next.js app primarily serves API routes under /api/*.
 * The single root page acts as a health check / status indicator.
 */
export const metadata = {
  title: 'NovaMe API',
  description: 'NovaMe backend services',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
