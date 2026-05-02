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

// GET: 获取举报列表
export async function GET(request) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  try {
    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status') || 'pending'

    const supabase = getSupabase()
    
    const { data: reports, error } = await supabase
      .from('reports')
      .select('*')
      .eq('status', status)
      .order('created_at', { ascending: false })

    if (error) return Response.json({ error: error.message }, { status: 500 })

    // 获取举报人信息和被举报内容
    for (const report of reports || []) {
      // 举报人
      if (report.reporter_id) {
        const { data: reporter } = await supabase
          .from('profiles')
          .select('display_name, avatar_url')
          .eq('id', report.reporter_id)
          .single()
        report.reporter = reporter
      }

      // 被举报内容
      if (report.report_type === 'wisdom') {
        const { data: wisdom } = await supabase
          .from('wisdoms')
          .select('id, text, description, audio_url, user_id, creator_name')
          .eq('id', report.target_id)
          .single()
        report.target = wisdom
      } else if (report.report_type === 'question') {
        const { data: question } = await supabase
          .from('questions')
          .select('id, text, question_text, user_id')
          .eq('id', report.target_id)
          .single()
        report.target = question
      } else if (report.report_type === 'user') {
        const { data: user } = await supabase
          .from('profiles')
          .select('id, display_name, avatar_url')
          .eq('id', report.target_id)
          .single()
        report.target = user
      }
    }

    return Response.json({ success: true, reports: reports || [] })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

// POST: 处理举报
export async function POST(request) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  try {
    const body = await request.json()
    const { reportId, action, adminNotes } = body

    if (!reportId || !action) return Response.json({ error: '缺少参数' }, { status: 400 })

    const supabase = getSupabase()

    // 获取举报信息
    const { data: report } = await supabase
      .from('reports')
      .select('*')
      .eq('id', reportId)
      .single()

    if (!report) return Response.json({ error: '举报不存在' }, { status: 404 })

    // 更新举报状态
    const newStatus = action === 'dismiss' ? 'dismissed' : 'resolved'
    await supabase
      .from('reports')
      .update({
        status: newStatus,
        admin_notes: adminNotes || null,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', reportId)

    // 执行操作
    if (action === 'delete') {
      if (report.report_type === 'wisdom') {
        // 删除评论
        try { await supabase.from('wisdom_comments').delete().eq('wisdom_id', report.target_id) } catch (e) {}
        // 删除点赞
        try { await supabase.from('user_liked_wisdoms').delete().eq('wisdom_id', report.target_id) } catch (e) {}
        // 删除 wisdom
        await supabase.from('wisdoms').delete().eq('id', report.target_id)
      } else if (report.report_type === 'question') {
        await supabase.from('questions').delete().eq('id', report.target_id)
      }
    }

    // TODO: 实现警告用户功能（可以发送通知或记录警告次数）

    return Response.json({ success: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
