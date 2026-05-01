/**
 * NovaMe color tokens — extracted from legacy globals.css
 *
 * Currently the mobile app only uses the "night" theme (deep purple/violet).
 * The "day" theme structure is preserved but not actively used.
 */

// ──────────────────────────────────────────────
// Shared (theme-agnostic) brand colors
// ──────────────────────────────────────────────
export const brand = {
  primary: '#E8825E',        // Warm coral — primary CTAs, focus states
  primaryLight: '#F5A889',
  accent: '#D4A574',         // Gold accent
  accentLight: '#F0DCC8',
  danger: '#E85B5B',         // Errors, destructive actions

  // Purple gradient (used in record button, paywall CTAs)
  purple: '#A855F7',
  purpleDeep: '#7C3AED',
  purpleLight: '#C084FC',
} as const

// ──────────────────────────────────────────────
// Night theme tokens (the active theme)
// ──────────────────────────────────────────────
export const night = {
  // Backgrounds
  bgPrimary: '#0F0B2E',         // Main app background (deep navy/violet)
  bgSecondary: '#1A1445',
  bgCard: '#1E1650',            // Cards, modals
  bgCardAlt: '#251D5C',
  bgNav: '#150F3A',             // Bottom nav, headers
  bgOverlay: 'rgba(15, 11, 46, 0.95)',

  // Text
  textPrimary: '#F0E8FF',       // Body text
  textSecondary: '#9B8FBF',     // Helper, labels
  textMuted: '#6B5F8F',         // Disabled, placeholder

  // Borders & dividers
  border: '#2A2060',
  borderLight: '#221A55',

  // Speech bubble (character HomeView)
  bubbleBg: '#1E1650',
  bubbleText: '#D0C8F0',

  // Bottom nav states
  navActive: '#C8A0FF',
  navInactive: '#5A4F80',
  navBgDark: '#0A0A0F',         // Darker variant for tab bar bg

  // Progress, tags, inputs
  progressTrack: '#2A2060',
  tagBg: '#1E1650',
  tagSelectedBg: '#7C5CFC',
  tagSelectedText: '#FFFFFF',
  inputBg: '#1A1445',
} as const

// ──────────────────────────────────────────────
// Day theme tokens (preserved for future use)
// ──────────────────────────────────────────────
export const day = {
  bgPrimary: '#FFF5EC',
  bgSecondary: '#FFEEE0',
  bgCard: '#FFFFFF',
  bgCardAlt: '#FFF8F2',
  bgNav: '#FFFFFF',
  bgOverlay: 'rgba(255, 245, 236, 0.95)',

  textPrimary: '#2D1B0E',
  textSecondary: '#8B7355',
  textMuted: '#B8A08A',

  border: '#F0E0D0',
  borderLight: '#F5EBE0',

  bubbleBg: '#FFF0E5',
  bubbleText: '#5C3A1E',

  navActive: '#E8825E',
  navInactive: '#C4A88A',
  navBgDark: '#FFFFFF',

  progressTrack: '#F0E0D0',
  tagBg: '#FFF0E5',
  tagSelectedBg: '#E8825E',
  tagSelectedText: '#FFFFFF',
  inputBg: '#FFF5EC',
} as const

// ──────────────────────────────────────────────
// Status colors (semantic)
// ──────────────────────────────────────────────
export const status = {
  success: '#10B981',
  warning: '#F59E0B',
  error: '#EF4444',
  info: '#3B82F6',
} as const

// ──────────────────────────────────────────────
// Type exports — derived from night theme since it's our active theme
// ──────────────────────────────────────────────
export type ThemeColors = typeof night
export type BrandColors = typeof brand
export type StatusColors = typeof status

// Theme name union
export type ThemeName = 'night' | 'day'
