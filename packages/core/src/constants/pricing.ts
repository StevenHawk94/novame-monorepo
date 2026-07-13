/**
 * @novame/core/constants/pricing
 *
 * Subscription pricing tiers and book product pricing.
 * Source of truth for create-payment / book-payment / mobile paywall.
 */

export type PricingTierKey = 'free' | 'plus'

export type PricingTier = {
  name: string
  monthlyPrice: number
  yearlyPrice: number
  monthlyAnalyses: number
  maxSecondsPerRecord: number
  dailyRecordSeconds: number
  dailyTypeChars: number
  features: string[]
}

/** Seat model: solo = just the owner, duo = owner + one invited member. */
export type PlanType = 'solo' | 'duo'

/**
 * The v2 subscription is a single paid tier ("Plus"). The seat model (solo vs
 * duo) is a separate dimension: duo lets the owner share Plus with one other
 * account. Both solo and duo grant the same tier ('plus'); only the seat count
 * differs. Prices (USD): Plus 6.99/mo, 49.99/yr; Plus Duo 9.99/mo, 79.99/yr.
 */
export const PLUS_PRICING = {
  solo: { monthly: 6.99, yearly: 49.99 },
  duo: { monthly: 9.99, yearly: 79.99 },
} as const

export const PRICING_TIERS: Record<PricingTierKey, PricingTier> = {
  free: {
    name: 'Free',
    monthlyPrice: 0,
    yearlyPrice: 0,
    monthlyAnalyses: 0,
    maxSecondsPerRecord: 300,
    dailyRecordSeconds: 300,
    dailyTypeChars: 2000,
    features: ['Rule-based reflections', 'Collect items', 'Your companion'],
  },
  plus: {
    name: 'Plus',
    monthlyPrice: 6.99,
    yearlyPrice: 49.99,
    monthlyAnalyses: 90,
    maxSecondsPerRecord: 600,
    dailyRecordSeconds: 600,
    dailyTypeChars: 5000,
    features: [
      'Full AI reflections',
      'Skills from your own words',
      'Visit the Master',
      'All focus scenes',
    ],
  },
}

/** Wisdom Book ebook unlock threshold (total recorded words). */
export const BOOK_UNLOCK_WORDS = 20000

/** Wisdom Cards collection unlock — 48 unique keywords collected. */
export const CARDS_UNLOCK_COUNT = 48

/** Printed wisdom book price (USD). */
export const PRINTED_BOOK_PRICE = 99.99

/** Printed wisdom cards deck price (USD). */
export const WISDOM_CARDS_PRICE = 59.99

/** Flat shipping fee for printed assets (USD). */
export const SHIPPING_FEE = 0
