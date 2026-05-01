# @novame/ui-tokens

Design tokens shared between the mobile (RN) app and admin (Next.js) dashboard.

## Why

Single source of truth for colors, spacing, typography, animations.
Change a token here, both apps update.

## Structure

- `colors.ts` — brand, night theme (active), day theme (preserved), status
- `typography.ts` — font sizes, weights, families
- `spacing.ts` — spacing scale, border radius, layout dims, z-index
- `shadows.ts` — RN-compatible shadow objects + web box-shadow strings
- `animations.ts` — durations, easings, spring presets
- `theme.ts` — aggregated theme object

## Usage

```ts
import { theme, night, spring } from '@novame/ui-tokens'

// Mobile (RN):
<View style={{
  backgroundColor: night.bgCard,
  padding: theme.spacing[4],
  borderRadius: theme.radius.lg,
  ...theme.shadow.card,
}} />

// Animations:
import Animated, { withSpring } from 'react-native-reanimated'
scale.value = withSpring(1.1, spring.bouncy)
```

## Active theme

Currently the mobile app uses **only the night theme**. Day theme tokens
are preserved in code but not connected to a theme switcher.
