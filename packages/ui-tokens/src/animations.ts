/**
 * Animation tokens
 *
 * Centralizes all spring/timing configs used in the app.
 * Used with react-native-reanimated's withSpring / withTiming.
 */

// ──────────────────────────────────────────────
// Duration scale (in ms)
// ──────────────────────────────────────────────
export const duration = {
  instant: 100,
  fast: 200,       // Button presses, small UI feedback
  normal: 300,     // Most transitions (default)
  medium: 400,     // Card flips, modal entrance
  slow: 600,       // Page-level transitions
  slowest: 1000,   // Special hero animations
} as const

// ──────────────────────────────────────────────
// Easing curves (cubic-bezier values for web, named for RN)
// ──────────────────────────────────────────────
export const easing = {
  linear: [0, 0, 1, 1] as const,
  ease: [0.25, 0.1, 0.25, 1] as const,
  easeIn: [0.4, 0, 1, 1] as const,
  easeOut: [0, 0, 0.2, 1] as const,
  easeInOut: [0.4, 0, 0.2, 1] as const,

  // Apple's "smooth" curve — used for sheet presentations
  smooth: [0.33, 1, 0.68, 1] as const,

  // Bouncy — for celebratory micro-interactions
  bouncy: [0.68, -0.55, 0.265, 1.55] as const,
} as const

// ──────────────────────────────────────────────
// Spring presets — for react-native-reanimated withSpring()
// Each preset describes a different "feel"
// ──────────────────────────────────────────────
export const spring = {
  // Snappy, responsive — for button presses, tab feedback
  snappy: {
    damping: 20,
    stiffness: 300,
    mass: 0.5,
  },

  // Smooth, balanced — for most UI transitions (default)
  smooth: {
    damping: 15,
    stiffness: 150,
    mass: 1,
  },

  // Bouncy — for celebratory moments (level up, streak, achievements)
  bouncy: {
    damping: 8,
    stiffness: 120,
    mass: 1,
  },

  // Gentle — for slow, organic movements (progress bars, EXP)
  gentle: {
    damping: 18,
    stiffness: 90,
    mass: 1.2,
  },

  // Card flip — specific 3D rotation feel
  cardFlip: {
    damping: 14,
    stiffness: 90,
    mass: 1,
  },
} as const

export type Duration = keyof typeof duration
export type Easing = keyof typeof easing
export type Spring = keyof typeof spring
