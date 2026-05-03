# components/

Reusable presentational components for @novame/mobile.

## Stage progression

- Stage 2.2: empty placeholder
- Stage 3: populated during UI rewrite (CardFront, CardBack,
  VideoCharacter, ScreenSurface, etc.)

## Conventions

- One component per file, kebab-case filename
- Co-locate styles with the component using NativeWind className
- Re-export shared building blocks via an index.ts barrel only when
  it reduces import noise
