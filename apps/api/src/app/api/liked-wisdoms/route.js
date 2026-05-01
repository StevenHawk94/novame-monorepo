import { createClient } from '@supabase/supabase-js'

export const runtime = 'edge'

/**
 * Liked Wisdoms API
 * 
 * POST: 添加 liked wisdom，增加 likes 计数
 * DELETE: 移除 liked wisdom，减少 likes 计数
 * 
 * 支持两种 wisdom：
 * - 数据库 wisdoms (UUID 格式 ID)
 * - 默认 wisdoms (default-1, default-2 等)
 */

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

// 检查是否是有效的 UUID
function isValidUUID(str) {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  return uuidRegex.test(str)
}

export async function POST(request) {
  try {
    const { userId, wisdomId } = await request.json()
    
    if (!userId || !wisdomId) {
      return Response.json({ error: 'Missing userId or wisdomId' }, { status: 400 })
    }
    
    const supabase = getSupabaseAdmin()
    const isDbWisdom = isValidUUID(wisdomId)
    
    if (isDbWisdom) {
      // 数据库 wisdom - 使用原有逻辑
      const { error } = await supabase
        .from('user_liked_wisdoms')
        .insert({
          user_id: userId,
          wisdom_id: wisdomId,
        })
      
      if (error) {
        if (error.code === '23505') {
          return Response.json({ success: true, message: 'Already liked' })
        }
        console.error('Like error:', error)
        return Response.json({ error: 'Failed to like wisdom' }, { status: 500 })
      }
      
      // 获取当前 likes 数并 +1
      const { data: wisdom } = await supabase
        .from('wisdoms')
        .select('likes')
        .eq('id', wisdomId)
        .single()
      
      const newLikes = (wisdom?.likes || 0) + 1
      
      await supabase
        .from('wisdoms')
        .update({ likes: newLikes })
        .eq('id', wisdomId)
      
      return Response.json({ success: true, newLikes })
    } else {
      // 默认 wisdom - 存储到 user_liked_defaults 表
      const { error } = await supabase
        .from('user_liked_defaults')
        .insert({
          user_id: userId,
          wisdom_id: wisdomId,
        })
      
      if (error) {
        if (error.code === '23505') {
          return Response.json({ success: true, message: 'Already liked' })
        }
        // 如果表不存在，创建它
        if (error.code === '42P01') {
          // 表不存在，先创建
          await supabase.rpc('exec_sql', {
            sql: `
              CREATE TABLE IF NOT EXISTS user_liked_defaults (
                id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
                user_id uuid NOT NULL,
                wisdom_id text NOT NULL,
                created_at timestamptz DEFAULT now(),
                UNIQUE(user_id, wisdom_id)
              );
            `
          })
          // 重试插入
          await supabase.from('user_liked_defaults').insert({
            user_id: userId,
            wisdom_id: wisdomId,
          })
        } else {
          console.error('Like default error:', error)
          return Response.json({ error: 'Failed to like wisdom' }, { status: 500 })
        }
      }
      
      return Response.json({ success: true, isDefault: true })
    }
    
  } catch (error) {
    console.error('Like wisdom error:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }
}

export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')
    const wisdomId = searchParams.get('wisdomId')
    
    if (!userId || !wisdomId) {
      return Response.json({ error: 'Missing userId or wisdomId' }, { status: 400 })
    }
    
    const supabase = getSupabaseAdmin()
    const isDbWisdom = isValidUUID(wisdomId)
    
    if (isDbWisdom) {
      // 数据库 wisdom
      const { error } = await supabase
        .from('user_liked_wisdoms')
        .delete()
        .eq('user_id', userId)
        .eq('wisdom_id', wisdomId)
      
      if (error) {
        console.error('Unlike error:', error)
        return Response.json({ error: 'Failed to unlike wisdom' }, { status: 500 })
      }
      
      // 获取当前 likes 数并 -1
      const { data: wisdom } = await supabase
        .from('wisdoms')
        .select('likes')
        .eq('id', wisdomId)
        .single()
      
      const newLikes = Math.max((wisdom?.likes || 0) - 1, 0)
      
      await supabase
        .from('wisdoms')
        .update({ likes: newLikes })
        .eq('id', wisdomId)
      
      return Response.json({ success: true, newLikes })
    } else {
      // 默认 wisdom
      const { error } = await supabase
        .from('user_liked_defaults')
        .delete()
        .eq('user_id', userId)
        .eq('wisdom_id', wisdomId)
      
      if (error && error.code !== '42P01') {
        console.error('Unlike default error:', error)
        return Response.json({ error: 'Failed to unlike wisdom' }, { status: 500 })
      }
      
      return Response.json({ success: true, isDefault: true })
    }
    
  } catch (error) {
    console.error('Unlike wisdom error:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }
}
