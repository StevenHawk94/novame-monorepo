# NovaMe

> Journal. Reflect. Evolve.

Monorepo containing the NovaMe mobile app, admin dashboard, API, and shared packages.

## Structure
## Status

| Component | Status | URL / Path |
|-----------|--------|------------|
| `apps/api` | ✅ Deployed | https://novame-monorepo-api.vercel.app |
| `apps/admin` | 🚧 Stage 1.3 | - |
| `apps/mobile` | 🚧 Batch 2 | - |
| `packages/tsconfig` | ✅ Done | - |
| `packages/ui-tokens` | ✅ Done | - |
| `packages/core` | 🚧 Stage 1.4 | - |
| `packages/api-client` | 🚧 Stage 1.4 | - |

## Domain strategy

- `https://api.soulsayit.com` — currently points to legacy Cloudflare Pages (still serving old mobile app)
- `https://novame-monorepo-api.vercel.app` — new Vercel deployment (current source of truth)
- DNS cutover: `api.soulsayit.com` → Vercel will happen after mobile RN rewrite is stable

## Requirements

- Node.js 20.x LTS
- pnpm 9.x
- Xcode 16+ (for iOS, batch 4)
- Android Studio + JDK 17 (for Android, batch 4)

## Getting Started

```bash
# Install all dependencies
pnpm install

# Run API dev server (port 3001)
pnpm --filter @novame/api dev

# Build everything
pnpm build
```

## Development conventions

- All commits follow conventional commits: `feat(api): ...`, `chore(repo): ...`
- API routes live in `apps/api/src/app/api/*`
- Shared business logic goes in `packages/core` (TODO)
- Mobile (RN) UI uses tokens from `packages/ui-tokens`

## Migration history

This monorepo replaces two legacy projects:

- `Github/Visdom` — old Next.js project (API + Admin + abandoned web frontend) → archived after migration
- `visdom-capacitor` — old Capacitor + Next.js mobile app → replaced by `apps/mobile` in batch 2-3

Source code from these legacy projects has been selectively copied into the monorepo
(API routes + lib files for `apps/api`; rules/UI logic to be ported into `apps/mobile`).
The legacy `api.soulsayit.com` Cloudflare deployment continues to serve old mobile app
clients during the transition window.
