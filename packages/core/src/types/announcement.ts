/**
 * Announcement types.
 */

export type Announcement = {
  id: string
  title: string
  content: string
  button_text?: string | null
  action_url?: string | null
  image_url?: string | null
  type: string
  target_users: string
  is_active: boolean
  created_at: string
  end_at?: string
}
