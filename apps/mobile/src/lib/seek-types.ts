/**
 * Seek (Discover tab) shared types — Stage 3.9.A.1.
 *
 * Single source of truth for question + wisdom card shapes used by
 * discover.tsx, seek-question modal, new-question modal, my-questions
 * modal, and the SeekQuestionCard component.
 *
 * Shapes derived from observed apps/api responses (seek-questions /
 * user-questions / publish-wisdom). Verified against real responses
 * during stage 3.9.A.1.2 (API integration step).
 */
export type QuestionStatus = 'pending' | 'approved' | 'rejected';

export type SeekQuestion = {
  id: string;
  question_text: string;
  question_tag: string | null;
  card_count: number;
  creator_id: string | null;
  creator_name: string | null;
  creator_avatar: string | null;
  status: QuestionStatus;
  is_published: boolean;
  rejection_reason: string | null;
  created_at: string;
};

/**
 * Wisdom card under a Seek question. Shape matches publish-wisdom
 * response (see stage 3.7 record.tsx insight phase) plus seek-specific
 * join fields for the offering author.
 */
export type SeekCard = {
  id: string;
  user_id: string;
  question_id: string;
  keyword_id: string;
  quote_short: string;
  insight_full: string;
  emotion: string | null;
  score: number | null;
  is_saved?: boolean;
  saved_count?: number;
  creator_name: string | null;
  creator_avatar: string | null;
  created_at: string;
};
