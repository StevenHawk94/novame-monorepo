import { createClient } from '@supabase/supabase-js'
import { requireAdmin } from '@/lib/auth/require-admin'

export const runtime = 'edge'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

// GET: 列表
export async function GET(request) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  try {
    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '0')
    const limit = parseInt(searchParams.get('limit') || '20')
    const filter = searchParams.get('filter') || 'all'
    const search = searchParams.get('search') || ''

    const supabase = getSupabase()
    let query = supabase.from('wisdoms').select('*', { count: 'exact' }).order('created_at', { ascending: false }).range(page * limit, (page + 1) * limit - 1)

    if (filter === 'default') query = query.is('user_id', null)
    else if (filter === 'user') query = query.not('user_id', 'is', null)

    if (search.trim()) query = query.or(`text.ilike.%${search}%,description.ilike.%${search}%,creator_name.ilike.%${search}%`)

    const { data, count, error } = await query
    if (error) return Response.json({ error: error.message }, { status: 500 })

    return Response.json({ success: true, wisdoms: data || [], total: count || 0, hasMore: (page + 1) * limit < (count || 0) })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

// POST: 添加
export async function POST(request) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  try {
    const body = await request.json()
    const { text, description, creatorName, creatorAvatar, isPublic = true, duration_seconds, categories, initViews, initLikes } = body

    if (!text) return Response.json({ error: 'Missing text' }, { status: 400 })

    const supabase = getSupabase()

    const { data, error } = await supabase.from('wisdoms').insert({
      user_id: null,
      audio_url: '',
      text,
      description: description || text.substring(0, 200),
      duration_seconds: duration_seconds || 0,
      categories: categories?.length ? categories : ['Life'],
      is_public: isPublic,
      creator_name: creatorName || 'NovaMe Team',
      creator_avatar: creatorAvatar || '',
      listens: parseInt(initViews) || Math.floor(Math.random() * 76) + 25,
      likes: parseInt(initLikes) || Math.floor(Math.random() * 14) + 2,
      engagement_boosted: true,
    }).select().single()

    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ success: true, wisdom: data })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

// DELETE: support both query param and JSON body
export async function DELETE(request) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  try {
    let id = new URL(request.url).searchParams.get('id')
    if (!id) {
      try { const body = await request.json(); id = body.id } catch (e) {}
    }
    if (!id) return Response.json({ error: 'Missing ID' }, { status: 400 })

    const supabase = getSupabase()
    const { data: wisdom } = await supabase.from('wisdoms').select('audio_url').eq('id', id).single()
    try { await supabase.from('wisdom_comments').delete().eq('wisdom_id', id) } catch (e) {}
    try { await supabase.from('wisdom_cards').delete().eq('wisdom_id', id) } catch (e) {}
    if (wisdom?.audio_url?.includes('supabase')) {
      try { const path = wisdom.audio_url.split('/audio/')[1]; if (path) await supabase.storage.from('audio').remove([path]) } catch (e) {}
    }
    const { error } = await supabase.from('wisdoms').delete().eq('id', id)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ success: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
