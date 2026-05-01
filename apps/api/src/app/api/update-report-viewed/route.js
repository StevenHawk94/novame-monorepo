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
 * POST: 更新用户最后查看报告的时间
 */
export async function POST(request) {
  try {
    const { userId } = await request.json()
    
    if (!userId) {
      return Response.json({ error: 'Missing userId' }, { status: 400 })
    }
    
    const supabase = getSupabaseAdmin()
    
    const { error } = await supabase
      .from('profiles')
      .update({ 
        last_report_viewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId)
    
    if (error) {
      console.error('Update report viewed error:', error)
      return Response.json({ error: 'Failed to update' }, { status: 500 })
    }
    
    return Response.json({ success: true })
    
  } catch (error) {
    console.error('Update report viewed error:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }
}
