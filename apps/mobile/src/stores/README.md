# stores/

Zustand stores for global client state.

## Stage progression

- Stage 2.2: empty placeholder
- Stage 2.3: zustand installed via Provider scaffolding (later
  stage may add store files here)
- Stage 3+: domain stores added (auth-store, journal-store,
  card-collection-store, etc.)

## Conventions

- One store per file, kebab-case filename ending in -store.ts
- Use mmkv-backed persist middleware for stores that survive app
  restart
- Stores must not import from app/ (one-way dependency)
