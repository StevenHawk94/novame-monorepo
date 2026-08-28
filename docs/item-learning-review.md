# Tap Your Day and reviewed matching rules

## Rollout

1. Run `supabase/migrations/20260827000069_item_learning_review.sql` after the existing migrations (including 68). It is retry-safe, with a short DDL lock timeout. No production SQL has been run by this change.
2. Deploy API **and** Admin. The existing authenticated `/api/cron/item-learning` schedule remains every 15 minutes. Confirm `CRON_SECRET` is configured; this task is deliberately not on the Reflect response path.
3. Install the updated mobile bundle. App Store 1.0.16 does not contain the new Add UI, keyboard or rating changes. Old clients continue to use bundle-owned matching rules; they do not receive reviewed overrides.

## Custom choices

- The four Tap Your Day pages offer Add. Matching the typed name uses local executable rules, not AI. Browsing uses generated `Reflect_Subcategory_Map` secondary groups.
- Saved custom entries keep the typed name, canonical icon ID, question kind and chosen Group in account-scoped MMKV. They supplement—not replace—the built-in list.
- One custom entry per icon, at most 60; re-adding that icon edits its custom name/group. Each reflection selects one representation per canonical icon, preventing duplicate memory rows. The v3 selection protocol accepts up to 191 curated/custom icons. Existing v1/v2 protocols are unchanged.
- This is device-local persistence: another account cannot see the list; uninstalling clears it. No cross-device cache promise.

## Learning and cost bounds

- Only finalized Plus reflections with AI consent and written text participate. The existing background analyzer extracts at most six short, literal source phrases; no additional model calls occur while typing or choosing icons.
- Deterministic filtering rejects nonexistent source spans, nearby negations, already covered meanings and obvious sensitive strings. Canonical names, keyword aliases and visual definitions retrieve at most eight candidate icons per phrase; lexical retrieval never decides equivalence.
- A worker rechecks Plus/consent and batches the unseen candidates into one semantic verification request, with output capped at 650 tokens and thinking disabled. The shared provider fallback policy is unchanged. Cached phrase/concept decisions avoid repeated verification requests; already-approved matches are suppressed.
- Atomic job claims process six jobs per cron run; each job has at most two claims. This is intentionally bounded, so suggestions may queue behind other work. Missing candidates do not affect saved reflections, rewards, Connection updates or foreground latency.
- These are review suggestions, not guaranteed classifications. The model can miss a candidate or misclassify one. No automatic rule publication.

## Admin review

- **Missing Icons**: proposed drawable concept + short user phrase. Approval puts it in the asset backlog; it does not create art.
- **Missing Keywords**: existing icon + short user phrase. A star means that icon has a disabled ambiguous bare-word rule. A suitable multiword phrase can be approved as `AUTO / Phrase` without enabling the bare word. Ownership collisions and pre-existing exclusion policies require source-catalog review.
- **Confirmed Item Removals**: recorded when a saved reflection contains a confirmed removal from the matching preview. The server derives its exact accepted keywords; privacy toggles are not removal feedback. No full reflection is copied to this admin list. A user removal is not proof of a matching error.
- Disable affects only the exact reviewed keyword. All changes have an append-only audit trail and Undo. Optimistic revision checks reject concurrent stale review actions. Historical memories are never rewritten.

## Matching versions and source of truth

- An approval atomically stores the online mapping and `AUTO / Phrase` safety metadata. It does **not** write to the source XLSX on a developer's computer.
- Mobile checks the small public-rule snapshot in the background, at most once per 30 minutes while relevant screens are used. Each writing session pins its catalog/revision; the server uses that exact revision for Save. Existing page TTLs, assets and pairing sync are untouched.
- Before the next source-workbook/catalog update, export reviewed rules in Admin and reconcile them into both `Icon_Mapping.keywords_mapping` and `Keyword_Safety`. Carry approved phrases forward, retain disabled rules as `NEVER_AUTO`, and preserve exclusions. Do not blindly re-enable a rule from an older workbook.
- Catalog hashes include executable rules **and** the NEVER_AUTO safety index. An incompatible catalog fails closed rather than silently saving different icons. Future catalog releases must preserve support for deployed catalog versions or explicitly require an app update before writing; do not replace this version check with unversioned server matching.

## UI/rating verification

- Writing preview taps are handled on the first tap while the keyboard dismisses, and only Confirm commits removals.
- Automatic rating requests wait for a base tab, native stack transitions and app alerts to settle. A cancellable 1.2-second timer owns no overlay, navigation lock or interaction handle. Changing routes/entering the background defers it. Menu review is unchanged.
- Real-device QA is still required for keyboard/modal presentation and the OS-controlled review dialog. The app does not control whether Apple/Google actually display a prompt.

## Offline checks

`pnpm --filter @novame/engine test`

`node --test tools/test-tap-your-day.cjs tools/test-reflect-settlement.cjs tools/test-reflect-durability.cjs`

With a local PGlite installation: `PGLITE_MODULE=/path/to/@electric-sql/pglite node --test tools/test-item-learning-review.cjs tools/test-reflect-durable-db.cjs`
