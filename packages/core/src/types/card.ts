/**
 * Wisdom Card types.
 */

export type Card = {
  id: string
  keyword_id?: string
  quote_short?: string
  insight_full?: string
  card_number?: number
  user_id?: string
  creator_name?: string
  saves_count?: number
}

export type CardEntry = {
  keyword_id?: string
  quote_short?: string
  insight_full?: string
}
