/**
 * Shadow tokens
 *
 * RN doesn't support `box-shadow` directly on Android (uses `elevation`),
 * and on iOS uses separate shadow* properties.
 * We export both web-style box-shadow strings and RN-compatible objects.
 */

// ──────────────────────────────────────────────
// Web-style box-shadow strings (for admin / @novame/ui-tokens web usage)
// ──────────────────────────────────────────────
export const boxShadowStrings = {
  none: 'none',
  ios: '0 1px 3px rgba(0,0,0,0.05), 0 1px 2px rgba(0,0,0,0.02)',
  card: '0 2px 12px rgba(0, 0, 0, 0.3)',
  elevated: '0 8px 32px rgba(0, 0, 0, 0.4), 0 2px 8px rgba(0, 0, 0, 0.2)',
  glow: '0 0 30px rgba(168, 85, 247, 0.4)',
  glowSoft: '0 2px 10px rgba(168, 85, 247, 0.3)',
} as const

// ──────────────────────────────────────────────
// RN-compatible shadow style objects
// Each one yields equivalent visual on iOS (shadow*) and Android (elevation)
// ──────────────────────────────────────────────
export const shadow = {
  none: {
    shadowColor: 'transparent',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
  },

  // Subtle — for nav, list items
  ios: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },

  // Standard — for cards
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 6,
  },

  // Modal sheets, prominent overlays
  elevated: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 32,
    elevation: 20,
  },

  // Glowing accents (record button, CTAs)
  glow: {
    shadowColor: '#A855F7',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 30,
    elevation: 12,
  },

  glowSoft: {
    shadowColor: '#A855F7',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 6,
  },
} as const

export type ShadowName = keyof typeof shadow
