/**
 * useResponsive / useTextStyle — Stage 0 (mobile side) of the responsive
 * typography system.
 *
 * Backs @novame/ui-tokens responsive helpers with the live screen width from
 * useWindowDimensions (re-renders on rotation / size class change, unlike the
 * module-load Dimensions.get pattern used elsewhere in the app).
 *
 * Usage:
 *
 *   const t = useTextStyle();
 *   <Text style={t.title2}>Heading</Text>          // fully resolved style
 *   <Text style={[t.body, { color: '#fff' }]}>...</Text>
 *
 *   const { scale, moderateScale, scaleFont } = useResponsive();
 *   <View style={{ padding: scale(16) }} />
 *
 * Base width is 375pt (iPhone SE) — SE renders at 1:1, larger screens scale up.
 * Titles scale slower (factor 0.3) than body/caption (0.5), per Apple's
 * philosophy that large text should not grow as fast on bigger screens.
 */
import { useMemo } from 'react'
import { useWindowDimensions, type TextStyle as RNTextStyle } from 'react-native'

import {
  makeScalers,
  textStyle,
  type TextRole,
  type Scalers,
} from '@novame/ui-tokens'

// Per-role scaling factor: titles dampened more so they don't balloon on big
// screens; body and smaller use the standard 0.5.
const ROLE_FACTOR: Record<TextRole, number> = {
  largeTitle: 0.3,
  title1: 0.3,
  title2: 0.3,
  title3: 0.4,
  headline: 0.5,
  body: 0.5,
  callout: 0.5,
  subheadline: 0.5,
  footnote: 0.5,
  caption: 0.5,
  caption2: 0.5,
}

export function useResponsive(): Scalers {
  const { width } = useWindowDimensions()
  return useMemo(() => makeScalers(width), [width])
}

export type ResolvedTextStyle = Pick<
  RNTextStyle,
  'fontSize' | 'fontWeight' | 'lineHeight'
>

/**
 * Returns every text role pre-resolved to an RN style object for the current
 * screen width: fontSize scaled (with floor), lineHeight converted to the RN
 * absolute value (multiplier * fontSize), fontWeight passed through.
 */
export function useTextStyle(): Record<TextRole, ResolvedTextStyle> {
  const { scaleFont } = useResponsive()
  return useMemo(() => {
    const out = {} as Record<TextRole, ResolvedTextStyle>
    for (const role of Object.keys(textStyle) as TextRole[]) {
      const tok = textStyle[role]
      const factor = ROLE_FACTOR[role]
      const size = scaleFont(tok.fontSize, tok.minFontSize, factor)
      out[role] = {
        fontSize: size,
        fontWeight: tok.fontWeight,
        lineHeight: Math.round(size * tok.lineHeight),
      }
    }
    return out
  }, [scaleFont])
}
