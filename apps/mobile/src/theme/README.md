# theme/

Theming layer wired into root layout.

## Stage progression

- Stage 2.2: empty placeholder
- Stage 2.3: ThemeProvider created here, consuming tokens from
  @novame/ui-tokens
- Stage 3: light/dark switching, NativeWind class merging helpers

## Conventions

- ThemeProvider is the single source of truth for runtime theme
  state, mounted in app/_layout.tsx
- Tokens are imported from @novame/ui-tokens, not redefined here
- Reanimated-based theme transitions live alongside the provider
