# lib/

Singleton clients and platform-glue utilities.

## Stage progression

- Stage 2.2: empty placeholder
- Stage 2.3: supabase.ts, storage.ts, haptics.ts, api.ts singletons
  created here

## Conventions

- One singleton per file, kebab-case filename
- Each module exports a single instance, not a factory
- api.ts wraps @novame/api-client with a Supabase token getter
- Modules in lib/ may import from @novame/* packages but not from
  app/, src/components/, or src/stores/
