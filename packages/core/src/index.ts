/**
 * @novame/core
 *
 * Shared business logic for NovaMe monorepo — types, constants, and pure
 * rule functions consumed by apps/admin, apps/api, and apps/mobile.
 *
 * Two import styles are supported:
 *
 *   // Top-level barrel (convenient, pulls everything):
 *   import { Wisdom, KEYWORDS, formatMinutes } from '@novame/core'
 *
 *   // Subpath (precise, smaller surface):
 *   import { Wisdom } from '@novame/core/types'
 *   import { KEYWORDS, slugToId } from '@novame/core/constants/keywords'
 *   import { formatMinutes } from '@novame/core/rules/format'
 */

// Domain types
export * from './types'

// Constants
export * from './constants/keywords'
export * from './constants/pricing'
export * from './constants/character'
export * from './constants/exp'
export * from './constants/recording'
export * from './constants/categories'

// Rules (pure functions)
export * from './rules/format'
export * from './rules/exp'
export * from './rules/character'
