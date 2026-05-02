/**
 * @novame/core/constants/pricing
 *
 * Subscription pricing tiers and book product pricing.
 * Source of truth for create-payment / book-payment / mobile paywall.
 */

export type PricingTierKey = 'free' | 'basic' | 'pro' | 'ultra'

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

export const PRICING_TIERS: Record<PricingTierKey, PricingTier> = {
  free: {
    name: 'Free',
    monthlyPrice: 0,
    yearlyPrice: 0,
    monthlyAnalyses: 1,
    maxSecondsPerRecord: 300,
    dailyRecordSeconds: 300,
    dailyTypeChars: 2000,
    features: ['1 wisdom insight / month', 'Basic character'],
  },
  basic: {
    name: 'Basic',
    monthlyPrice: 4.99,
    yearlyPrice: 39.99,
    monthlyAnalyses: 15,
    maxSecondsPerRecord: 300,
    dailyRecordSeconds: 300,
    dailyTypeChars: 3000,
    features: ['15 insights / month', '5 min recording / day', '3000 chars / day'],
  },
  pro: {
    name: 'Pro',
    monthlyPrice: 9.99,
    yearlyPrice: 79.99,
    monthlyAnalyses: 30,
    maxSecondsPerRecord: 600,
    dailyRecordSeconds: 600,
    dailyTypeChars: 5000,
    features: ['30 insights / month', '10 min recording / day', '5000 chars / day'],
  },
  ultra: {
    name: 'Ultra',
    monthlyPrice: 16.99,
    yearlyPrice: 129.99,
    monthlyAnalyses: 60,
    maxSecondsPerRecord: 600,
    dailyRecordSeconds: 600,
    dailyTypeChars: 5000,
    features: ['60 insights / month', '10 min recording / day', '5000 chars / day'],
  },
}

/** Wisdom Book ebook unlock threshold (total recorded words). */
export const BOOK_UNLOCK_WORDS = 20000

/** Wisdom Cards collection unlock — 48 unique keywords collected. */
export const CARDS_UNLOCK_COUNT = 48

/** Printed wisdom book price (USD). */
export const PRINTED_BOOK_PRICE = 99.99

/** Wisdom book milestone — minutes recorded to qualify for printing. */
export const BOOK_MILESTONE_MINS = 300
