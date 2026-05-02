import { createClient } from '@supabase/supabase-js'
import { requireAdmin } from '@/lib/auth/require-admin'

export const runtime = 'edge'

/**
 * GET: 导出指定用户的所有 wisdom 文字
 * 
 * 用于 Admin 后台一键下载用户 wisdoms 用于书本编排
 */
export async function GET(request) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  const { searchParams } = new URL(request.url)
  const userId = searchParams.get('userId')
  const exportType = searchParams.get('type') // 'wisdoms' | 'cards' (bulk export for admin)
  const format = searchParams.get('format') || 'txt'
  
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )
  
  // ===== Bulk export: all wisdoms as CSV =====
  if (exportType === 'wisdoms') {
    try {
      const { data: wisdoms, error } = await supabase
        .from('wisdoms')
        .select('id, user_id, text, description, categories, duration_seconds, is_public, creator_name, created_at')
        .order('created_at', { ascending: false })
        .limit(5000)
      
      if (error) return Response.json({ error: error.message }, { status: 500 })
      
      let csv = 'id,user_id,creator_name,text,description,categories,duration_seconds,is_public,created_at\n'
      for (const w of (wisdoms || [])) {
        const text = (w.text || '').replace(/"/g, '""').replace(/\n/g, ' ')
        const desc = (w.description || '').replace(/"/g, '""').replace(/\n/g, ' ')
        const cats = (w.categories || []).join('; ')
        csv += `"${w.id}","${w.user_id}","${w.creator_name || ''}","${text}","${desc}","${cats}",${w.duration_seconds || 0},${w.is_public},"${w.created_at}"\n`
      }
      
      return new Response(csv, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="wisdoms-all-${new Date().toISOString().split('T')[0]}.csv"`,
        },
      })
    } catch (e) {
      return Response.json({ error: e.message }, { status: 500 })
    }
  }
  
  // ===== Bulk export: all A-cards as CSV =====
  if (exportType === 'cards') {
    try {
      const { data: cards, error } = await supabase
        .from('wisdom_cards')
        .select('id, wisdom_id, user_id, card_a, card_b, card_c, created_at')
        .order('created_at', { ascending: false })
        .limit(5000)
      
      if (error) return Response.json({ error: error.message }, { status: 500 })
      
      let csv = 'id,wisdom_id,user_id,card_a,card_b,card_c,created_at\n'
      for (const c of (cards || [])) {
        const a = (c.card_a || '').replace(/"/g, '""').replace(/\n/g, ' ')
        const b = (c.card_b || '').replace(/"/g, '""').replace(/\n/g, ' ')
        const cc = (c.card_c || '').replace(/"/g, '""').replace(/\n/g, ' ')
        csv += `"${c.id}","${c.wisdom_id}","${c.user_id}","${a}","${b}","${cc}","${c.created_at}"\n`
      }
      
      return new Response(csv, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="wisdom-cards-all-${new Date().toISOString().split('T')[0]}.csv"`,
        },
      })
    } catch (e) {
      return Response.json({ error: e.message }, { status: 500 })
    }
  }
  
  // ===== Single user export (original behavior) =====
  if (!userId) {
    return Response.json({ error: 'Missing userId or type parameter' }, { status: 400 })
  }
  
  try {
    // 获取用户信息
    const { data: profile } = await supabase
      .from('profiles')
      .select('display_name, email')
      .eq('id', userId)
      .single()
    
    // 获取用户所有 wisdoms
    const { data: wisdoms, error } = await supabase
      .from('wisdoms')
      .select('id, text, description, categories, duration_seconds, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: true })
    
    if (error) {
      console.error('Error fetching wisdoms:', error)
      return Response.json({ error: 'Failed to fetch wisdoms' }, { status: 500 })
    }
    
    if (!wisdoms || wisdoms.length === 0) {
      return Response.json({ error: 'No wisdoms found for this user' }, { status: 404 })
    }
    
    const userName = profile?.display_name || 'Unknown User'
    const userEmail = profile?.email || ''
    
    // 计算统计
    const totalWisdoms = wisdoms.length
    const totalSeconds = wisdoms.reduce((acc, w) => acc + (w.duration_seconds || 0), 0)
    const totalMinutes = Math.round(totalSeconds / 60)
    const totalWords = wisdoms.reduce((acc, w) => {
      const text = w.text || w.description || ''
      return acc + text.split(/\s+/).filter(Boolean).length
    }, 0)
    const totalChars = wisdoms.reduce((acc, w) => {
      const text = w.text || w.description || ''
      return acc + text.length
    }, 0)
    
    // 根据格式生成内容
    if (format === 'json') {
      return Response.json({
        success: true,
        user: { name: userName, email: userEmail, id: userId },
        stats: { totalWisdoms, totalMinutes, totalWords, totalChars },
        wisdoms: wisdoms.map((w, i) => ({
          index: i + 1,
          text: w.text || w.description || '',
          categories: w.categories || [],
          duration: w.duration_seconds,
          createdAt: w.created_at,
        })),
      })
    }
    
    // 生成纯文本格式
    let content = ''
    
    // 标题和统计
    content += `${'='.repeat(60)}\n`
    content += `WISDOM BOOK - ${userName}\n`
    content += `${'='.repeat(60)}\n\n`
    
    content += `Author: ${userName}\n`
    if (userEmail) content += `Email: ${userEmail}\n`
    content += `Total Wisdoms: ${totalWisdoms}\n`
    content += `Total Recording Time: ${totalMinutes} minutes\n`
    content += `Total Words: ${totalWords.toLocaleString()}\n`
    content += `Total Characters: ${totalChars.toLocaleString()}\n`
    content += `Export Date: ${new Date().toISOString().split('T')[0]}\n`
    content += `\n${'='.repeat(60)}\n\n`
    
    // 按分类分组
    const categorizedWisdoms = {}
    wisdoms.forEach(w => {
      const cats = w.categories && w.categories.length > 0 ? w.categories : ['Uncategorized']
      cats.forEach(cat => {
        if (!categorizedWisdoms[cat]) categorizedWisdoms[cat] = []
        categorizedWisdoms[cat].push(w)
      })
    })
    
    // 生成内容（按分类）
    Object.keys(categorizedWisdoms).sort().forEach(category => {
      content += `\n${'─'.repeat(40)}\n`
      content += `📁 ${category.toUpperCase()}\n`
      content += `${'─'.repeat(40)}\n\n`
      
      categorizedWisdoms[category].forEach((w, index) => {
        const text = w.text || w.description || ''
        const date = new Date(w.created_at).toLocaleDateString('en-US', { 
          year: 'numeric', month: 'short', day: 'numeric' 
        })
        const duration = w.duration_seconds ? `${Math.floor(w.duration_seconds / 60)}:${(w.duration_seconds % 60).toString().padStart(2, '0')}` : ''
        
        content += `[${date}]${duration ? ` (${duration})` : ''}\n`
        content += `${text}\n\n`
      })
    })
    
    // 添加页脚
    content += `\n${'='.repeat(60)}\n`
    content += `END OF WISDOM BOOK\n`
    content += `Generated by NovaMe App\n`
    content += `${'='.repeat(60)}\n`
    
    // 返回文本文件
    const filename = `wisdoms_${userName.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.txt`
    
    return new Response(content, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
    
  } catch (error) {
    console.error('Export wisdoms error:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }
}
