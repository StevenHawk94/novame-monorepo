/**
 * Shared daily-task helpers.
 *
 * createWisdomQuests is the single source for turning a freshly generated
 * wisdom card's task_1/task_2 into "wisdom" daily_tasks rows. It is called
 * from:
 *   - publish-wisdom (server-authoritative): bound to a successfully
 *     created card, so the quests are created atomically with the card and
 *     do NOT depend on the client firing a separate /api/daily-tasks
 *     request (which could be skipped on a client timeout / network error
 *     even though the publish succeeded -- the same failure mode that the
 *     WP restore moved server-side in restoreWpOnPublish).
 *   - the /api/daily-tasks route's action:'create' (kept for parity).
 *
 * Keeping the insert in one place means the two callers can't drift on the
 * row shape (task_type, exp_reward, expires_at TTL, the 200-char cap).
 */

/**
 * Insert "wisdom" daily_tasks for the given user.
 *
 * @param supabase  service-role client
 * @param {string}  userId
 * @param {Array<{ text: string, keyword?: string }>} tasks
 * @returns {Promise<{ error: any | null }>}  best-effort; never throws.
 */
export async function createWisdomQuests(supabase, userId, tasks) {
  if (!userId || !Array.isArray(tasks) || tasks.length === 0) {
    return { error: null }
  }

  // 24h TTL, mirroring the previous route behaviour.
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

  // task_text cap is 200 chars (Stage 6.TaskTextLimit). generate-card.js
  // already caps task_1/task_2 at 120, so 200 is comfortable headroom.
  const rows = tasks
    .map((t) => {
      const text = (t && (t.text ?? t)) || ''
      return {
        user_id: userId,
        task_text: String(text).substring(0, 200),
        task_type: 'wisdom',
        exp_reward: 20,
        is_completed: false,
        expires_at: expiresAt,
        linked_keyword: (t && t.keyword) || null,
      }
    })
    .filter((r) => r.task_text.trim().length > 0)

  if (rows.length === 0) return { error: null }

  try {
    const { error } = await supabase.from('daily_tasks').insert(rows)
    if (error) console.warn('[daily-tasks] createWisdomQuests insert error:', error.message)
    return { error: error || null }
  } catch (e) {
    console.warn('[daily-tasks] createWisdomQuests exception:', e && e.message)
    return { error: e }
  }
}
