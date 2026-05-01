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
 * POST: 举报内容或用户
 * 
 * 支持举报类型：
 * - wisdom: 举报某条 wisdom
 * - question: 举报某条 question
 * - user: 举报某个用户
 */
export async function POST(request) {
  try {
    const { 
      reporterId,      // 举报人 ID
      reportType,      // 'wisdom' | 'question' | 'user'
      targetId,        // 被举报的内容/用户 ID
      reason,          // 举报原因
      details,         // 详细描述（可选）
    } = await request.json()
    
    if (!reporterId || !reportType || !targetId || !reason) {
      return Response.json({ 
        error: 'Missing required fields',
        required: ['reporterId', 'reportType', 'targetId', 'reason']
      }, { status: 400 })
    }
    
    // 验证举报类型
    const validTypes = ['wisdom', 'question', 'user']
    if (!validTypes.includes(reportType)) {
      return Response.json({ 
        error: 'Invalid report type',
        validTypes 
      }, { status: 400 })
    }
    
    // 验证举报原因
    const validReasons = [
      'inappropriate',    // 不当内容
      'spam',            // 垃圾信息
      'harassment',      // 骚扰
      'hate_speech',     // 仇恨言论
      'violence',        // 暴力内容
      'misinformation',  // 虚假信息
      'copyright',       // 侵权
      'other',           // 其他
    ]
    if (!validReasons.includes(reason)) {
      return Response.json({ 
        error: 'Invalid reason',
        validReasons 
      }, { status: 400 })
    }
    
    const supabase = getSupabaseAdmin()
    
    // 检查是否已经举报过（防止重复举报）
    const { data: existingReport } = await supabase
      .from('reports')
      .select('id')
      .eq('reporter_id', reporterId)
      .eq('report_type', reportType)
      .eq('target_id', targetId)
      .single()
    
    if (existingReport) {
      return Response.json({
        success: true,
        message: 'You have already reported this content',
        alreadyReported: true,
      })
    }
    
    // 保存举报记录
    const { data: report, error: insertError } = await supabase
      .from('reports')
      .insert({
        reporter_id: reporterId,
        report_type: reportType,
        target_id: targetId,
        reason: reason,
        details: details || null,
        status: 'pending',
      })
      .select()
      .single()
    
    if (insertError) {
      console.error('Report insert error:', insertError)
      return Response.json({ 
        error: 'Failed to submit report',
        details: insertError.message 
      }, { status: 500 })
    }
    
    console.log('Report submitted:', report?.id)
    
    return Response.json({
      success: true,
      message: 'Thank you for your report. We will review it shortly.',
      reportId: report?.id,
    })
    
  } catch (error) {
    console.error('Report error:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }
}

/**
 * GET: 获取举报记录（管理员用）
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status') || 'pending'
    const limit = parseInt(searchParams.get('limit') || '50')
    
    const supabase = getSupabaseAdmin()
    
    const { data: reports, error } = await supabase
      .from('reports')
      .select('*')
      .eq('status', status)
      .order('created_at', { ascending: false })
      .limit(limit)
    
    if (error) {
      return Response.json({ error: 'Failed to fetch reports' }, { status: 500 })
    }
    
    return Response.json({
      success: true,
      reports: reports || [],
      count: reports?.length || 0,
    })
    
  } catch (error) {
    console.error('Get reports error:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }
}
