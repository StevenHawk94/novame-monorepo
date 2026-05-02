/**
 * Seek (Q&A) types.
 */

export type Question = {
  id: string
  question_text: string
  question_tag: string
  creator_name: string
  card_count?: number
  is_published?: boolean
  created_at: string
}

export type LinkedCard = {
  link_id: string
  keyword_id?: string
  quote_short?: string
  card_number?: number
  creator_name?: string
  card_keywords?: { keyword?: string }
}

export type CsvRow = {
  keyword_id: string
  user_name: string
  question: string
  insight_full: string
  quote_short: string
  [k: string]: string
}

export type PreviewQuestion = {
  question: string
  keyword_id: string
  user_name: string
  cardCount: number
}

export type Preview = {
  questions: PreviewQuestion[]
}

export type UploadResult = {
  success: boolean
  summary?: { questions: number; cards: number; errors: number }
  errors?: string[]
}
