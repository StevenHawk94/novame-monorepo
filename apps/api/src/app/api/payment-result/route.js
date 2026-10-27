// Retired payment rail. Keep a non-mutating tombstone for old clients/webhooks.
export const runtime = 'edge'
const retired = () => Response.json({ error: 'payment_method_retired' }, { status: 410, headers: { 'Cache-Control': 'no-store' } })
export const GET = retired
export const POST = retired
