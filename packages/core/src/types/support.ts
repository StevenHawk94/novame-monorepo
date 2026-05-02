/**
 * Support ticket types.
 */

export type Ticket = {
  id: string
  subject: string
  message: string
  email: string
  category: string
  status: string
  created_at: string
  user_id?: string
  admin_notes?: string
}
