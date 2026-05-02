/**
 * @novame/core/constants/keywords
 *
 * The 48 wisdom keywords — single source of truth across admin, api, and mobile.
 *
 * Each keyword has three forms:
 *   - id:     'mind-clarity'  (database row id, prefixed by domain)
 *   - slug:   'Clarity'       (display label, used in CSV uploads & AI prompts)
 *   - domain: 'mind'          (one of 4 thematic groupings)
 *
 * Consumers:
 *   - admin CardsTab uses .id (form input value)
 *   - admin SeekQuestionsTab uses .slug (tag display)
 *   - apps/api ALL_KEYWORDS — replace with KEYWORDS.map(k => k.slug)
 *   - apps/api KEYWORD_TO_ID — replace with slugToId()
 */

export type Domain = 'mind' | 'heart' | 'action' | 'connection'

export const KEYWORDS = [
  // mind (12)
  { id: 'mind-clarity',         slug: 'Clarity',         domain: 'mind' },
  { id: 'mind-grounding',       slug: 'Grounding',       domain: 'mind' },
  { id: 'mind-focus',           slug: 'Focus',           domain: 'mind' },
  { id: 'mind-curiosity',       slug: 'Curiosity',       domain: 'mind' },
  { id: 'mind-stillness',       slug: 'Stillness',       domain: 'mind' },
  { id: 'mind-objectivity',     slug: 'Objectivity',     domain: 'mind' },
  { id: 'mind-adaptability',    slug: 'Adaptability',    domain: 'mind' },
  { id: 'mind-unlearning',      slug: 'Unlearning',      domain: 'mind' },
  { id: 'mind-vision',          slug: 'Vision',          domain: 'mind' },
  { id: 'mind-acceptance',      slug: 'Acceptance',      domain: 'mind' },
  { id: 'mind-humor',           slug: 'Humor',           domain: 'mind' },
  { id: 'mind-intuition',       slug: 'Intuition',       domain: 'mind' },

  // heart (12)
  { id: 'heart-resilience',      slug: 'Resilience',      domain: 'heart' },
  { id: 'heart-boundaries',      slug: 'Boundaries',      domain: 'heart' },
  { id: 'heart-self-compassion', slug: 'Self-Compassion', domain: 'heart' },
  { id: 'heart-courage',         slug: 'Courage',         domain: 'heart' },
  { id: 'heart-vulnerability',   slug: 'Vulnerability',   domain: 'heart' },
  { id: 'heart-empathy',         slug: 'Empathy',         domain: 'heart' },
  { id: 'heart-gratitude',       slug: 'Gratitude',       domain: 'heart' },
  { id: 'heart-patience',        slug: 'Patience',        domain: 'heart' },
  { id: 'heart-forgiveness',     slug: 'Forgiveness',     domain: 'heart' },
  { id: 'heart-release',         slug: 'Release',         domain: 'heart' },
  { id: 'heart-balance',         slug: 'Balance',         domain: 'heart' },
  { id: 'heart-joy',             slug: 'Joy',             domain: 'heart' },

  // action (12)
  { id: 'action-initiative',       slug: 'Initiative',       domain: 'action' },
  { id: 'action-consistency',      slug: 'Consistency',      domain: 'action' },
  { id: 'action-discipline',       slug: 'Discipline',       domain: 'action' },
  { id: 'action-decisiveness',     slug: 'Decisiveness',     domain: 'action' },
  { id: 'action-purpose',          slug: 'Purpose',          domain: 'action' },
  { id: 'action-rest',             slug: 'Rest',             domain: 'action' },
  { id: 'action-resourcefulness',  slug: 'Resourcefulness',  domain: 'action' },
  { id: 'action-accountability',   slug: 'Accountability',   domain: 'action' },
  { id: 'action-boldness',         slug: 'Boldness',         domain: 'action' },
  { id: 'action-endurance',        slug: 'Endurance',        domain: 'action' },
  { id: 'action-communication',    slug: 'Communication',    domain: 'action' },
  { id: 'action-momentum',         slug: 'Momentum',         domain: 'action' },

  // connection (12)
  { id: 'connection-sovereignty',   slug: 'Sovereignty',   domain: 'connection' },
  { id: 'connection-authenticity',  slug: 'Authenticity',  domain: 'connection' },
  { id: 'connection-inspiration',   slug: 'Inspiration',   domain: 'connection' },
  { id: 'connection-generosity',    slug: 'Generosity',    domain: 'connection' },
  { id: 'connection-trust',         slug: 'Trust',         domain: 'connection' },
  { id: 'connection-reciprocity',   slug: 'Reciprocity',   domain: 'connection' },
  { id: 'connection-collaboration', slug: 'Collaboration', domain: 'connection' },
  { id: 'connection-leadership',    slug: 'Leadership',    domain: 'connection' },
  { id: 'connection-harmony',       slug: 'Harmony',       domain: 'connection' },
  { id: 'connection-legacy',        slug: 'Legacy',        domain: 'connection' },
  { id: 'connection-respect',       slug: 'Respect',       domain: 'connection' },
  { id: 'connection-loyalty',       slug: 'Loyalty',       domain: 'connection' },
] as const satisfies ReadonlyArray<{ id: string; slug: string; domain: Domain }>

export type Keyword = (typeof KEYWORDS)[number]
export type KeywordId = Keyword['id']
export type KeywordSlug = Keyword['slug']

// ============================================
// Lookup tables (built once at module load)
// ============================================

const ID_TO_KEYWORD: Record<string, Keyword> = Object.fromEntries(
  KEYWORDS.map((k) => [k.id, k])
)

const SLUG_TO_KEYWORD: Record<string, Keyword> = Object.fromEntries(
  KEYWORDS.map((k) => [k.slug, k])
)

// ============================================
// Lookup functions
// ============================================

/** 'Clarity' -> 'mind-clarity'. Returns undefined for unknown slugs. */
export function slugToId(slug: string): KeywordId | undefined {
  return SLUG_TO_KEYWORD[slug]?.id
}

/** 'mind-clarity' -> 'Clarity'. Returns undefined for unknown ids. */
export function idToSlug(id: string): KeywordSlug | undefined {
  return ID_TO_KEYWORD[id]?.slug
}

/** 'mind-clarity' -> 'mind'. Returns undefined for unknown ids. */
export function domainOf(id: string): Domain | undefined {
  return ID_TO_KEYWORD[id]?.domain
}

/** All slugs (e.g. for AI prompt enumeration). */
export const ALL_KEYWORD_SLUGS: readonly KeywordSlug[] = KEYWORDS.map((k) => k.slug)

/** All ids (e.g. for admin CardsTab dropdown values). */
export const ALL_KEYWORD_IDS: readonly KeywordId[] = KEYWORDS.map((k) => k.id)
