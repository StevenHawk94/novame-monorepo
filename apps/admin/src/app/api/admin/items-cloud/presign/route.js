import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/require-admin'
import { r2PresignPut } from '@/lib/r2-client'

export const runtime = 'nodejs'

export async function POST(request) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error
  try {
    const { batchId, files } = await request.json()
    if (!/^[a-zA-Z0-9_-]{8,64}$/.test(batchId || '') || !Array.isArray(files) || files.length < 1 || files.length > 500) {
      return NextResponse.json({ success: false, error: 'Invalid batch' }, { status: 400 })
    }
    const uploads = await Promise.all(files.map(async (file) => {
      const filename = String(file?.filename || '').replace(/[^a-zA-Z0-9._-]/g, '_')
      if (!filename.toLowerCase().endsWith('.webp')) throw new Error('Only .webp item images are accepted')
      const key = `Items/assets/${batchId}/${filename}`
      return { filename, key, contentType: 'image/webp', url: await r2PresignPut({ key, contentType: 'image/webp' }) }
    }))
    return NextResponse.json({ success: true, uploads })
  } catch (error) {
    return NextResponse.json({ success: false, error: error?.message || 'Presign failed' }, { status: 500 })
  }
}

