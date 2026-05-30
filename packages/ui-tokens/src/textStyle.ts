/**
 * Semantic text styles — Stage 0 of responsive typography system.
 *
 * Maps Apple Dynamic Type roles to concrete font size / weight / line-height,
 * calibrated at the 375pt base width (iPhone SE). Larger screens scale these
 * up via the responsive helpers (see ./responsive). Smaller text has an 11pt
 * floor per Apple HIG (Caption 2 never scales below 11).
 *
 * Each value is the BASE (375pt) size. Apply scaleFont() at the call site for
 * responsive sizing. Body = 17pt per Apple HIG default body text.
 *
 * Sources: Apple HIG Typography / Dynamic Type Sizes; Inter line-height 1.4
 * verified empirically against real device render (FlippableCard tuning).
 */
import { fontSize } from './typography'

export type TextRole =
  | 'largeTitle'
  | 'title1'
  | 'title2'
  | 'title3'
  | 'headline'
  | 'body'
  | 'callout'
  | 'subheadline'
  | 'footnote'
  | 'caption'
  | 'caption2'

export type TextStyleToken = {
  /** Base font size at 375pt width (px). */
  fontSize: number
  /** RN fontWeight string. */
  fontWeight: '400' | '500' | '600' | '700'
  /** Line-height multiplier (multiply by fontSize for RN absolute value). */
  lineHeight: number
  /** Minimum font size floor (px) — text never scales below this. */
  minFontSize: number
}

// Base sizes calibrated at 375pt. Inter line-heights: titles tighter, body 1.4.
export const textStyle: Record<TextRole, TextStyleToken> = {
  largeTitle:  { fontSize: 34, fontWeight: '700', lineHeight: 1.2,  minFontSize: 28 },
  title1:      { fontSize: 28, fontWeight: '700', lineHeight: 1.2,  minFontSize: 24 },
  title2:      { fontSize: 22, fontWeight: '700', lineHeight: 1.25, minFontSize: 20 },
  title3:      { fontSize: 20, fontWeight: '600', lineHeight: 1.3,  minFontSize: 18 },
  headline:    { fontSize: 17, fontWeight: '600', lineHeight: 1.35, minFontSize: 16 },
  body:        { fontSize: 17, fontWeight: '400', lineHeight: 1.4,  minFontSize: 15 },
  callout:     { fontSize: 16, fontWeight: '400', lineHeight: 1.4,  minFontSize: 14 },
  subheadline: { fontSize: 15, fontWeight: '400', lineHeight: 1.4,  minFontSize: 13 },
  footnote:    { fontSize: 13, fontWeight: '400', lineHeight: 1.4,  minFontSize: 12 },
  caption:     { fontSize: 12, fontWeight: '500', lineHeight: 1.35, minFontSize: 11 },
  caption2:    { fontSize: 11, fontWeight: '500', lineHeight: 1.3,  minFontSize: 11 },
}

// Sanity: every base size exists within the raw fontSize scale envelope.
export const _fontSizeScaleRef = fontSize

export type TextStyle = keyof typeof textStyle
