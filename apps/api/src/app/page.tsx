/**
 * NovaMe API -- root health check.
 */
import type { CSSProperties } from 'react'

const containerStyle: CSSProperties = {
  fontFamily: 'ui-sans-serif, system-ui, sans-serif',
  padding: '3rem 1.5rem',
  maxWidth: 720,
  margin: '0 auto',
  color: '#1a1a2e',
  lineHeight: 1.6,
}

const statusBoxStyle: CSSProperties = {
  background: '#f0fdf4',
  border: '1px solid #86efac',
  color: '#166534',
  padding: '0.75rem 1rem',
  borderRadius: 8,
  fontSize: 14,
  fontFamily: 'ui-monospace, monospace',
}

export default function HomePage() {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA
  const buildId = sha ? sha.slice(0, 7) : 'local'

  return (
    <main style={containerStyle}>
      <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem', fontWeight: 800 }}>
        NovaMe API
      </h1>
      <p style={{ color: '#666', marginBottom: '2rem' }}>
        Backend services for the NovaMe mobile app.
      </p>
      <div style={statusBoxStyle}>
        Server running &middot; build {buildId}
      </div>
    </main>
  )
}
