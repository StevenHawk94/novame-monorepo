/**
 * Wisdom-related types.
 *
 * Note: `Post` (used in admin PostsTab) is the same domain entity as `Wisdom`
 * with a slightly different field set used by the post-stream view, so it's
 * defined here rather than in a separate post.ts.
 */

export type Wisdom = {
  id: string
  text?: string
  description?: string
  duration_seconds?: number
  creator_name?: string
  audio_url?: string
  user_id?: string
  created_at: string
  listens?: number
  likes?: number
  categories?: string[]
}

export type Post = {
  id: string
  text?: string
  description?: string
  creator_name?: string
  creator_avatar?: string
  user_id?: string
  created_at: string
  listens?: number
  comment_count?: number
}

export type WisdomCardData = {
  quote_short?: string
  insight_full?: string
  card_b?: string
  card_c?: string
}

export type WisdomEntry = {
  text?: string
  created_at: string
  card?: WisdomCardData
}
