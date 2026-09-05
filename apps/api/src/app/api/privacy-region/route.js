import { NextResponse } from 'next/server'

export const runtime = 'edge'

const EEA_AND_UK = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR',
  'GR', 'HU', 'IE', 'IS', 'IT', 'LI', 'LT', 'LU', 'LV', 'MT', 'NL', 'NO',
  'PL', 'PT', 'RO', 'SE', 'SI', 'SK', 'GB',
])

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Cache-Control': 'private, no-store',
}

function requestCountry(request) {
  const raw = request.headers.get('x-vercel-ip-country')
    || request.headers.get('cf-ipcountry')
    || ''
  const country = raw.trim().toUpperCase()
  return /^[A-Z]{2}$/.test(country) ? country : null
}

export function GET(request) {
  const country = requestCountry(request)
  return NextResponse.json(
    {
      success: true,
      country,
      region: country == null
        ? 'unknown'
        : EEA_AND_UK.has(country) ? 'eea_uk' : 'other',
    },
    { headers: CORS_HEADERS },
  )
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}
