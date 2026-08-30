# Supabase business API access hardening (migration 70)

## Decision

Business tables and RPCs are server-only. Mobile and Admin browser clients use
Supabase Auth; mobile also receives private Realtime broadcasts. Business requests
go through Vercel API/Admin handlers with server-side `service_role` clients.

Do **not** disable the Data API or remove `public` from exposed schemas: those
server handlers still use PostgREST. A schema named `public` is not itself a
public-access grant.

## Changes

- Revoke PUBLIC/anon/authenticated access to public tables, views, sequences and
  non-extension functions; leave every existing service_role grant unchanged.
- Keep RLS enabled and existing owner policies as defense in depth. Remove the
  legacy unrestricted listens INSERT policy.
- Make user_stats/leaderboard views security-invoker.
- Pin missing application function search paths to public, pg_temp. The migration
  aborts if client roles can CREATE in public or column grants require review.
- Explicitly preserve Auth's signup trigger access.
- Remove postgres client default grants, including global PUBLIC function EXECUTE
  (per-schema revocation alone cannot override PostgreSQL's global default).

No data rows, trigger bodies, UUID identity logic, subscription logic, page caches,
Auth/Storage/Realtime schema permissions or private channel policies are changed.
The vector extension is left in place for compatibility.

## Deployment and verification

The live linked project was audited on 2026-08-28. Before deployment, run the
migration and permission assertions inside one transaction ending in ROLLBACK.
Verify service-role table reads/RPCs, Auth hook grants, private Realtime grants and
client denial. Test future-object defaults too. Register version 20260828000070 in
supabase_migrations.schema_migrations in the same transaction as the real change.

Local regression test (requires PGlite, configurable for an existing installation):

```sh
PGLITE_MODULE=/path/to/@electric-sql/pglite node --test tools/test-db-access-hardening.cjs
```

Run the read-only audit in tools/sql-review/20260828000070_verify_business_access.sql
after deployment. Also check Supabase Security Advisor and HTTP access with the
public anon key versus service_role; never print or commit either credential.
Real-device smoke tests should cover anonymous onboarding, Reflect, pairing/Plus
broadcast updates and Admin login. Database tests cannot replace these UI tests.

## Future migrations and remaining intentional permissions

Application migrations run as postgres. Future client access must be an explicit,
reviewed GRANT with narrow RLS, not a blanket grant. Supabase-managed
supabase_admin defaults are deliberately untouched: if a managed tool creates a
new business table, review its grants/RLS before use. Other creator roles also need
their own reviewed default privileges.

Anonymous Supabase Auth remains enabled by product design. An anonymous Auth
session is an authenticated role session, not the unauthenticated anon role.
Both roles now lack direct business-table access; authenticated retains private
Realtime access. Storage avatar policies and extension APIs are separate existing
permissions and are not silently disabled by this migration.

## Emergency rollback

supabase/rollback/20260828000070_private_business_api_down.sql restores the audited
pre-change ACLs and affected settings; it contains no user records. **It reopens
previously exposed access and is for a confirmed outage only.** Prefer a narrowly
scoped corrective grant if a specific legitimate dependency is discovered.
Use the snapshot rollback only before subsequent schema/ACL changes; review it
again otherwise. It also removes the migration-70 ledger entry. No automatic
rollback is scheduled.

## Applied verification (2026-08-28)

Migration 20260828000070 is registered on the linked production project.

- 78/78 public base tables have RLS enabled.
- Client business-table/sequence/application-function access: 0.
- Missing application-function search paths: 0.
- Both legacy views are security-invoker.
- All audited service_role grants and both private Realtime receive policies
  survived unchanged; all three Auth hook permissions remain available.
- Transactional live dry run and exact snapshot rollback round trip passed.
- Six local PGlite tests passed, including repeated migration execution,
  anonymous-role denial, service reads/writes, signup UUID preservation and
  isolated Realtime receive access.
- Anonymous HEAD requests to eleven business endpoints return 401.
- Service-role HEAD requests to nine representative endpoints return 200.
- Security Advisor reports 0 ERROR and 53 WARN (previously 2 ERROR, 88 WARN).
  Remaining warnings: 51 anonymous-Auth policy notices, vector extension location,
  and leaked-password protection. Client table grants are still zero despite
  retained owner-policy definitions. Do not disable anonymous Auth to silence
  these notices; it is required by the current onboarding/payment design.

No credentials or user-record snapshots are stored here. A real-device
end-to-end smoke test remains necessary; the above checks do not simulate an
actual purchase or a two-device pairing session.
