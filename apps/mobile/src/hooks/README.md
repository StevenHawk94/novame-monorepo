# hooks/

Custom React hooks shared across screens.

## Stage progression

- Stage 2.2: empty placeholder
- Stage 3+: populated during UI rewrite (useTheme, useHaptics,
  useAuthState, useCardCollection, etc.)

## Conventions

- One hook per file, kebab-case filename starting with use-
- Hooks must be safe to call during render (no side effects in
  the function body)
