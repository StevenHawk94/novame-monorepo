/**
 * API root — returns a simple health-check page.
 * Visited if someone hits https://api.soulsayit.com/ in a browser.
 */
export default function HomePage() {
  return (
    <main style={{
      fontFamily: 'system-ui, sans-serif',
      padding: '2rem',
      maxWidth: 600,
      margin: '0 auto',
      textAlign: 'center',
    }}>
      <h1>NovaMe API</h1>
      <p>This server hosts API routes only. Visit the mobile app to interact.</p>
      <p style={{ marginTop: '2rem', color: '#888', fontSize: 14 }}>
        Status: ✅ Running
      </p>
    </main>
  )
}
