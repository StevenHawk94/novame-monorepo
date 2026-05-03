/**
 * Typography tokens
 *
 * NovaMe uses Inter as primary, with system fallbacks.
 * Mobile-first with fixed pixel values for cross-device consistency.
 *
 * fontFamily exposes platform-specific font name lookups as a
 * plain object (ios / android / web) instead of using Platform.select.
 * This keeps @novame/ui-tokens free of react-native runtime deps —
 * web consumers (admin/api) read .web, mobile consumers select
 * .ios or .android based on Platform.OS in their own code.
 */

// ──────────────────────────────────────────────
// Font families
// ──────────────────────────────────────────────
// Note: On iOS we prefer San Francisco system font (-apple-system),
// on Android we ship Inter via expo-font (loaded in mobile app root).
export const fontFamily = {
  sans: {
    ios: 'System',
    android: 'Inter',
    web: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif',
  },
  // For numeric displays, weekly stats, large counters
  mono: {
    ios: 'Menlo',
    android: 'monospace',
    web: 'ui-monospace, SFMono-Regular, monospace',
  },
} as const

// ──────────────────────────────────────────────
// Font sizes — match Tailwind defaults but kept explicit
// ──────────────────────────────────────────────
export const fontSize = {
  xs: 10,
  sm: 12,
  base: 14,
  md: 16,
  lg: 18,
  xl: 20,
  '2xl': 24,
  '3xl': 28,
  '4xl': 32,
  '5xl': 40,
} as const

// ──────────────────────────────────────────────
// Font weights — RN string-based, matches Tailwind
// ──────────────────────────────────────────────
export const fontWeight = {
  normal: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
  extrabold: '800',
  black: '900',
} as const

// ──────────────────────────────────────────────
// Line heights (multipliers, RN uses absolute values though)
// ──────────────────────────────────────────────
export const lineHeight = {
  tight: 1.2,
  snug: 1.375,
  normal: 1.5,
  relaxed: 1.625,
  loose: 2,
} as const

// ──────────────────────────────────────────────
// Letter spacing (in pixels for RN compatibility)
// ──────────────────────────────────────────────
export const letterSpacing = {
  tighter: -0.5,
  tight: -0.25,
  normal: 0,
  wide: 0.25,
  wider: 0.5,
  widest: 1,
} as const

export type FontSize = keyof typeof fontSize
export type FontWeight = keyof typeof fontWeight
