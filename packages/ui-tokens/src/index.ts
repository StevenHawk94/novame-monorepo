/**
 * @novame/ui-tokens
 *
 * Single source of truth for all design tokens.
 *
 * Usage examples:
 *
 *   // Import everything
 *   import { theme } from '@novame/ui-tokens'
 *
 *   // Import a specific category
 *   import { spacing, radius } from '@novame/ui-tokens/spacing'
 *   import { night } from '@novame/ui-tokens/colors'
 *
 *   // Use in RN component
 *   <View style={{ padding: theme.spacing[4], borderRadius: theme.radius.lg }} />
 */

export * from './colors'
export * from './typography'
export * from './spacing'
export * from './shadows'
export * from './animations'
export * from './theme'

// Re-export the default theme for convenience
export { defaultTheme as theme } from './theme'
