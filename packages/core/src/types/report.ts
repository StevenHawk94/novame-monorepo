/**
 * Content report types.
 */

export type Report = {
  id: string
  status: string
  reason: string
  report_type: string
  created_at: string
  details?: string
  admin_notes?: string
  target?: { text?: string; description?: string }
  reporter?: { display_name?: string }
}
