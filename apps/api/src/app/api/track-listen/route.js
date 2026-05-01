import { createClient } from '@supabase/supabase-js'

export const runtime = 'edge'

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  )
}

/**
 * POST: 增加 wisdom 的 listen 计数
 * 适用于所有 wisdoms（真实用户创建的和系统默认的）
 */
export async function POST(request) {
  try {
    const { wisdomId } = await request.json()
    
    if (!wisdomId) {
      return Response.json({ error: 'Missing wisdomId' }, { status: 400 })
    }
    
    console.log('Track listen for wisdom:', wisdomId)
    
    const supabase = getSupabaseAdmin()
    
    // 先获取当前值
    const { data: wisdom, error: fetchError } = await supabase
      .from('wisdoms')
      .select('listens')
      .eq('id', wisdomId)
      .single()
    
    if (fetchError) {
      console.error('Fetch wisdom error:', fetchError)
      return Response.json({ error: 'Wisdom not found' }, { status: 404 })
    }
    
    const newListens = (wisdom?.listens || 0) + 1
    
    // 更新计数
    const { error: updateError } = await supabase
      .from('wisdoms')
      .update({ listens: newListens })
      .eq('id', wisdomId)
    
    if (updateError) {
      console.error('Update listens error:', updateError)
      return Response.json({ error: 'Failed to update listens' }, { status: 500 })
    }
    
    console.log('Updated listens to:', newListens)
    
    return Response.json({ success: true, listens: newListens })
    
  } catch (error) {
    console.error('Track listen error:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }
}
