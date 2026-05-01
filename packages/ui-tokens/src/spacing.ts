/**
 * Spacing & sizing tokens
 *
 * Based on a 4px grid — matches Tailwind's default spacing scale
 * but with explicit pixel values so RN can use them directly.
 */

// ──────────────────────────────────────────────
// Spacing scale (margin, padding, gap)
// ──────────────────────────────────────────────
export const spacing = {
  px: 1,
  '0.5': 2,
  '1': 4,
  '1.5': 6,
  '2': 8,
  '2.5': 10,
  '3': 12,
  '3.5': 14,
  '4': 16,
  '5': 20,
  '6': 24,
  '7': 28,
  '8': 32,
  '9': 36,
  '10': 40,
  '12': 48,
  '14': 56,
  '16': 64,
  '20': 80,
  '24': 96,
  '32': 128,
} as const

// ──────────────────────────────────────────────
// Border radius
// ──────────────────────────────────────────────
export const radius = {
  none: 0,
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  '2xl': 20,    // Speech bubbles
  '3xl': 24,    // Cards
  '4xl': 32,    // Large modal sheets
  full: 9999,
} as const

// ──────────────────────────────────────────────
// Layout dimensions used across the app
// ──────────────────────────────────────────────
export const layout = {
  // Bottom nav
  tabBarHeight: 56,
  tabBarRecordButtonSize: 52,
  tabBarRecordButtonOffset: -20,  // Lifts the central record button up

  // Cards
  wisdomCardWidth: 270,
  wisdomCardWidthSmall: 240,  // For screens ≤ 375px wide
  wisdomCardAspectRatio: 1.4,

  // Modals
  modalMaxWidth: 390,
  modalMaxHeight: 844,

  // Touch targets
  touchTargetMin: 44,  // iOS HIG minimum
} as const

// ──────────────────────────────────────────────
// Z-index scale — explicit ordering avoids stacking conflicts
// ──────────────────────────────────────────────
export const zIndex = {
  base: 0,
  raised: 1,
  dropdown: 10,
  tabBar: 50,
  header: 60,
  overlay: 100,
  modal: 110,
  reportPrompt: 150,
  paywall: 180,
  forceUpdate: 200,
  toast: 250,
} as const

export type Spacing = keyof typeof spacing
export type Radius = keyof typeof radius
