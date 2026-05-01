/**
 * Theme — aggregates all tokens into a single object,
 * ready to be consumed by ThemeProvider in mobile/web apps.
 */

import { brand, night, day, status, type ThemeName } from './colors'
import { fontSize, fontWeight, lineHeight, letterSpacing, fontFamily } from './typography'
import { spacing, radius, layout, zIndex } from './spacing'
import { shadow, boxShadowStrings } from './shadows'
import { duration, easing, spring } from './animations'

// ──────────────────────────────────────────────
// A single theme bundles colors + everything else
// ──────────────────────────────────────────────
function makeTheme(themeName: ThemeName) {
  const colors = themeName === 'night' ? night : day

  return {
    name: themeName,
    colors: {
      ...colors,
      brand,
      status,
    },
    typography: {
      fontFamily,
      fontSize,
      fontWeight,
      lineHeight,
      letterSpacing,
    },
    spacing,
    radius,
    layout,
    zIndex,
    shadow,
    boxShadowStrings,
    animation: {
      duration,
      easing,
      spring,
    },
  } as const
}

export const themes = {
  night: makeTheme('night'),
  day: makeTheme('day'),
} as const

// Default active theme — currently always night
export const defaultTheme = themes.night

export type Theme = typeof themes.night
