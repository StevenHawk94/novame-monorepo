/**
 * User types.
 */

export type User = {
  id: string
  email?: string
  display_name?: string
  avatar_url?: string
  created_at?: string
  wisdoms_count?: number
  cards_count?: number
  subscription_tier?: string
}

export type DefaultUser = {
  id: string
  name: string
  avatar_url?: string
  total_mins?: number
}

export type Creator = {
  id: string
  name: string
  avatar_url?: string
}
