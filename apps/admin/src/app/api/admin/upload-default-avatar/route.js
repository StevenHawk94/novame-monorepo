import { createClient } from '@supabase/supabase-js'
import { requireAdmin } from '@/lib/auth/require-admin'

export const runtime = 'edge'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )
}

export async function POST(request) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  try {
    const formData = await request.formData()
    const file = formData.get('file')
    const name = formData.get('name') || 'default-user'

    if (!file) return Response.json({ error: 'No file provided' }, { status: 400 })

    const bytes = await file.arrayBuffer()
    // Edge-compatible: use Uint8Array instead of Buffer
    const uint8 = new Uint8Array(bytes)

    const ext = file.type === 'image/webp' ? 'webp' : 'jpg'
    const slug = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
    const filename = `defaults/${slug}-${Date.now()}.${ext}`

    const supabase = getSupabase()
    const { error } = await supabase.storage
      .from('avatars')
      .upload(filename, uint8, {
        contentType: file.type,
        upsert: true,
      })

    if (error) return Response.json({ error: error.message }, { status: 500 })

    const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(filename)

    return Response.json({ success: true, url: publicUrl })
  } catch (error) {
    console.error('Upload default avatar error:', error)
    return Response.json({ error: 'Upload failed' }, { status: 500 })
  }
}
