/**
 * ASPIRE_POOL — the canonical pool of personal-growth keywords.
 *
 * Used by:
 *   - apps/mobile/src/components/onboarding/aspire-words-picker.tsx
 *     (re-exported as ASPIRE_WORDS for visual-contract continuity with
 *     the Capacitor codebase; see onboarding/constants.ts).
 *   - apps/api/src/lib/generate-card.js (AI aspire_impacts match pool —
 *     expanded from profile.aspire_words 4-6 to the full 15 in Stage 6
 *     so the AI can match against any growth dimension, not just the
 *     user's preferred subset).
 *
 * Mutations to this list are intentional: when adding a new aspire
 * keyword, server-side generate-card.js will start matching against
 * it on the NEXT publish without any further code change. Existing
 * users' profile.aspire_scores never lose their old scores (B-strategy:
 * the scores dict is monotone, only publish-time +/-2 mutations touch
 * it). better_self_score is computed only from profile.aspire_words
 * (the user-selected 4-6 subset), so changes to ASPIRE_POOL do not
 * shift any existing user's better_self_score.
 *
 * `as const` keeps the tuple readonly + literal-typed so the AI prompt
 * builder can spread it into a comma-joined list without losing types.
 */
export const ASPIRE_POOL = [
  'Clear-minded',
  'Present',
  'Peaceful',
  'Focused',
  'Driven',
  'Disciplined',
  'Unbothered',
  'Authentic',
  'Confident',
  'Compassionate',
  'Resilient',
  'Self-Aware',
  'Intentional',
  'Grounded',
  'Radiant',
] as const;

export type AspirePoolWord = (typeof ASPIRE_POOL)[number];
