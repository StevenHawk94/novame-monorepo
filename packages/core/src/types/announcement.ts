/**
 * Announcement types.
 */

export type Announcement = {
  id: string
  title: string
  content: string
  image_url?: string | null
  type: string
  target_users: string
  is_active: boolean
  created_at: string
  end_at?: string
}
